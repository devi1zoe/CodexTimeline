# Codex 运行机制参考：循环、权限、上下文与日志

> 研究日期：2026-10-16（Asia/Shanghai）  
> 研究对象：工作区 `Codex_Client` 中的 OpenAI Codex CLI 官方源码快照、原生 rollout 数据结构与 OpenAI 官方文档  
> 阅读方法：从 [唯一学习入口](../README.md#first-lesson) 读真实任务与短案例，再按问题查本文。
> 当前学习包没有可核验的真实 Codex 工具调用 rollout；人工样例和界面回放的用途见学习入口。本文的源码分析不等于一次真实链路实测。

## 0. 先抓住这些关系

Codex CLI 不是“模型调用 + shell”的薄封装。它更像一个有持久化事件日志的本地工作流运行时：

1. `ThreadManager → Session → submission_loop → Task → run_turn` 组成任务调度链；同一个 turn（任务轮次）内可以经历多轮模型请求、并行工具调用、追加输入（steer）、自动压缩、重试和恢复。
2. rollout JSONL 保存了恢复和审计依据的原始记录，也用于界面展示。它同时保存模型协议中的输入输出项、用户可见事件和恢复检查点（checkpoint）；由这些记录生成的 SQLite 数据可以滞后更新或重新构建。
3. 安全性由多层独立约束共同实现：配置来源与项目信任、管理员要求、命令静态分类、审批/Guardian、路径权限、操作系统沙箱、网络代理策略，以及执行后的 TOCTOU 复核（检查与使用之间的状态变化检查）。任何单层“允许”都不等于最终可执行。
4. 自动上下文压缩（Auto Compaction）不只是生成聊天摘要。它还维护上下文窗口的前后关系（window lineage）、压缩后替换原历史的记录（replacement history）、token 用量快照，以及 WorldState/TurnContext 检查点；本地压缩、远端压缩和 token 预算模式分别有对应的恢复逻辑。
5. 许多自动行为都有对应事件，包括 hook（在特定时机触发的处理程序）、重试、通信协议回退、审查、子 Agent、终端和工具的生命周期、上下文压缩、模型切换。时间线应显示日志中实际记录的内容，并明确标注根据邻近事件作出的推断。

本文的结论分为三种：**源码事实**指当前快照可直接验证；**文档事实**指 OpenAI 官方公开文档；**设计推断**是根据控制流作出的工程解释。推断不会冒充日志事实。

## 1. 证据边界与可复现基线

OpenAI 官方把 `openai/codex` 列为 Codex CLI 的主要开源仓库，见 [Open source at OpenAI](https://learn.chatgpt.com/docs/open-source)。本地 `Codex_Client/README.md:1-38` 也明确其为 Codex CLI。

这份工作区副本没有 `.git` 目录，`codex-rs/Cargo.toml:154` 的工作区版本为占位值 `0.0.0`，所以无法确定对应的提交版本。尝试在线获取 HEAD 也因当前网络环境失败。为避免源码版本变化导致行号失效，以下位置均以本地快照为准；关键文件时间为 2026-09-12 23:53:20，SHA-256 为：

| 文件 | SHA-256 |
|---|---|
| `codex-rs/core/src/session/turn.rs` | `A5233BB975735B8737D60CA52B2CC53DF66BA6F7AEC18BBAE2EBF0D497EF5726` |
| `codex-rs/protocol/src/protocol.rs` | `141CE4AFC82E1F9DFB299F89500BF4ED4E1BD6909702824194B09C56F14343B1` |
| `codex-rs/history/src/lib.rs` | `B6A677EE6A5E6BD5F87B89C5842F175E150F9EA64CD17C7C564E9FA13214F4B5` |
| `codex-rs/core/src/tools/approvals.rs` | `797B757D0227D5EFA3AE3DC03CE8C4FD4402D0EDEB96E01618298A7B604B27D8` |
| `codex-rs/core/src/compact.rs` | `F43C9C6B76E0F1DE600A12FE063D205510EBD26BF67BEB6A9F6C3EA48A9E1653` |

因此，升级源码后应按函数名重新定位，而不是机械沿用行号。

## 2. 从入口到结束：真正的 Agent 执行闭环

### 2.1 控制层级

```text
CLI / TUI / App Server
        │ thread/start、turn/start、steer、interrupt、resume
        ▼
ThreadManager ── create / resume / fork / registry
        ▼
Session + submission_loop（串行处理 Op）
        ▼
Task（turn 生命周期、取消、完成、flush）
        ▼
run_turn
  ├─ pre-turn compaction / WorldState / hooks / input persistence
  └─ sampling loop
       ├─ build canonical prompt
       ├─ Responses stream
       ├─ persist ResponseItem
       ├─ dispatch tools concurrently when allowed
       ├─ ordered tool outputs → history
       └─ follow-up sampling / steer / finish
```

源码对应：

- CLI 分流：`codex-rs/cli/src/main.rs:1126-1269`；交互 TUI 最终到 `codex_tui::run_main`（`:2757-2765`），非交互 `exec/review` 到 `codex_exec::run_main`。TUI 的当前启动路径通过 app-server `thread/start`：`codex-rs/tui/src/app_server_session.rs:801-850`。
- 统一的会话管理：`codex-rs/core/src/thread_manager.rs:226-267`；创建链 `start_thread → start_thread_inner → spawn_thread → Session::spawn` 位于 `:989-990,1058-1079,1924-2177`；恢复链在 `:1118-1197`。复用已有会话的恢复（warm resume）只复用同一 thread 与同一 rollout，见 `:1985-2015`。
- `SessionIo` 与 spawn：`codex-rs/core/src/session/mod.rs:394-407,498-575,823-891`。提交队列容量为 512，事件队列不设容量上限；创建后启动 `submission_loop`。
- 串行操作调度：`codex-rs/core/src/session/handlers.rs:411-618`。这里统一匹配 `TurnInput`、`RecoverTurn`、`Interrupt`、`Compact`、`Shutdown` 等 `Op`；即使输入通道未显式关闭，也会完成运行时和持久化的收尾工作。
- turn 输入处理：`codex-rs/core/src/session/turn_input.rs:1-12,202-507`。`Started/Steered/Rejected` 只表示路由结果，不表示 hook、持久化或模型请求已完成。
- task 生命周期：`codex-rs/core/src/tasks/mod.rs:269-410,591-844` 与 `tasks/regular.rs:38-97`。`start_task` 设置取消令牌和当前 turn 状态；完成路径生成 `TurnComplete` 或 `TurnAborted` 并刷新日志缓冲区。需要注意：某些错误会包含在 `TurnComplete(error)`，所以 `TurnComplete` 不等价于业务成功。

### 2.2 一个 turn 为什么可能有多次模型请求

`codex-rs/core/src/session/turn.rs:149-170` 的注释已经把核心语义写成循环；实现 `run_turn` 位于 `:163-782`：

1. `run_pre_sampling_compact` 在请求模型前检查上下文（`:179-222`）。
2. 固定本步的 StepContext、获取 WorldState（`:257-306`），执行 hook，并把用户输入按 `TurnStart` 语义持久化（`:320-376`）。
3. 模型请求循环从 `:423` 开始，每一步从当前作为依据的历史记录重新构建模型输入（`:510-532`）。
4. 模型若产生工具调用，工具输出会成为下一次模型请求的输入；若 token 再次超出阈值，会在当前 turn 内压缩上下文；若收到追加输入或仍有待处理输入，也继续同一 turn（`:535-640`）。只有没有后续工作时才结束（`:642-703`）。

`build_prompt`（`:1508-1525`）向模型提供本步可用的工具列表，并设置 `parallel_tool_calls=true`。`run_sampling_request`（`:1538-1648`）复用当前 turn 的客户端会话；失败重试时从最新历史记录重建输入，避免重新发送已经过时的请求内容。

### 2.3 流式响应、并行工具与确定性顺序

- Responses 响应流：`try_run_sampling_request` 在 `turn.rs:2405+`；建立响应流在 `:2440-2457`，处理 `ResponseEvent` 在 `:2487+`，`OutputItemDone` 在 `:2538+`，Completed/usage/response id 在 `:2783-2831`，最后等待所有执行中的工具结束，并收集结果（`:2992-2998`）。
- 工具调用识别与记录：`core/src/stream_events_utils.rs:299-420`。成功识别的模型工具调用先写入日志，再将工具执行任务排入队列。`RespondToModel` 错误分支会生成失败结果并写回历史，但当前快照在 `:392-394` 使用空 `call_id`，不能概括为所有错误都保留原调用 ID；`Fatal` 分支直接返回错误。
- 并发语义：`core/src/tools/parallel.rs:44-63,112-305`。允许并行执行的工具获取 `RwLock` 读锁；非并行工具获取写锁，因此会与所有其它调用互斥。取消与失败统一转为对应 `FunctionCallOutput` / `CustomToolCallOutput`。
- 结果顺序：工具任务可以并发执行，但使用 `FuturesOrdered`，`turn.rs:2356-2383` 按模型输出顺序记录结果；下一次模型请求读取的是稳定顺序，而非工具实际完成的先后顺序。

这是值得直接借鉴的工程技巧：**执行并发、提交排序**。它保留吞吐量，同时让历史重放、测试与模型上下文可复现。

### 2.4 steer、interrupt、suspend 不是一回事

- steer：`session/turn_input.rs:472-507` 把新输入送进当前正在执行的 turn；`turn.rs:553-565` 在适当的处理节点接收，因此不一定新建 turn。
- interrupt：`tasks/mod.rs:878-981` 先发出取消信号，等待 100 ms，再中止任务句柄；可写入模型可见的中断标记，刷新日志缓冲区后发出 `TurnAborted` 并再次刷新日志缓冲区。原因枚举见 `protocol/src/protocol.rs:4205-4212`：`interrupted/replaced/review_ended/budget_limited`。
- 后台终端不会随普通中断操作一起终止；必须显式 `CleanBackgroundTerminals`，见 `protocol/src/protocol.rs:600-607`。
- suspend/recover：`session/turn_suspension.rs:13-119` 仅允许正在执行的 Regular 任务，且不能有尚未结束的后代 Agent；它不会写入结束事件，而是在关闭日志写入器后用原 turn ID 恢复。于是同一 turn ID 可以有多个 `task_started`，文件尾存在未结束的 turn 也可能是正常情况，不能一律判定为崩溃。
- shutdown：`session/handlers.rs:284-371` 会依次中止当前 turn，关闭工具、MCP、hooks 与日志写入器；`ShutdownComplete` 只发送给客户端，不进入 rollout。

## 3. Rollout JSONL：事件日志、恢复日志与 UI 日志的交集

### 3.1 每行实际保存的数据结构

每条物理行都使用扁平的记录结构（envelope）：

```json
{"timestamp":"2026-...Z","ordinal":17,"type":"event_msg","payload":{"type":"task_started","turn_id":"..."}}
```

定义在：

- `codex-rs/history/src/lib.rs:257-268`：`RolloutLine { timestamp, ordinal?, item(flatten) }`。
- `codex-rs/history/src/rollout_payload.rs:21-63`：带 `type/payload/metadata` 的序列化枚举。
- `codex-rs/rollout/src/recorder.rs:2039-2073`：UTC RFC3339 毫秒时间、ordinal 与单行 JSON 写入。
- `codex-rs/rollout/src/lib.rs:40-81`：标准解码器先从 JSON 对象移除 `timestamp/ordinal`，再反序列化剩余对象，以避开 `serde_json` 任意精度数字与字段展开功能组合使用时的问题。

顶层 `RolloutItem` 共 12 类，定义在 `history/src/lib.rs:120-138`：

| 顶层 type | 作用 | 模型上下文/恢复意义 |
|---|---|---|
| `session_meta` | thread 身份、来源、cwd、模型、基础指令、版本等 | 恢复根信息；首个非空记录必须是它 |
| `response_item` | 原始 Responses 输入/输出项 | 作为恢复依据的对话内容；唯一可携带顶层运行时元数据 |
| `inter_agent_communication` | V2 Agent 之间具有明确类型的消息 | 消息收件箱与历史重放 |
| `inter_agent_communication_metadata` | 是否触发 turn | 调度元数据 |
| `compacted` | 压缩检查点 | 恢复替换历史、窗口前后关系及用量 |
| `turn_context` | turn 执行时确定的设置 | 模型、sandbox、approval、cwd 等重放 |
| `token_usage_record` | token 快照 | 预算与 UI 统计恢复 |
| `world_state` | 环境、指令、技能等状态的完整记录或增量补丁 | 恢复或派生会话时重建基准状态 |
| `retained_context` | 保留上下文事件 | 长时任务恢复 |
| `security_risk_score` | 风险评分 | 安全审计状态 |
| `event_msg` | UI/控制生命周期事件 | 可观察时间线主干；并非全部返回给模型 |
| `realtime_item` | 实时会话记录 | 实时语音/会话恢复 |

`ResponseItem` 子类型定义在 `protocol/src/models.rs:999-1245`：`message`、`agent_message`、`reasoning`、`local_shell_call`、`function_call`、`tool_search_call`、对应的输出记录、`custom_tool_call`、`web_search_call`、`image_generation_call`、`compaction`、`configuration_update`、`context_compaction` 等。`additional_tools`、`compaction_trigger`、`other` 等是否持久化由 `rollout/src/policy.rs:42-64` 过滤；因此“协议中定义了这个枚举项”不代表一定出现在 rollout。

### 3.2 三个事件层不要混在一起

1. **协议事实层**：`response_item`。这是模型请求和响应中的标准记录项，例如消息、推理摘要、工具调用及其输出。
2. **产品生命周期层**：`event_msg`。它用 TurnStarted、ExecCommandBegin、审批、hook 等事件向界面、客户端和审计工具表示运行状态；很多项不是模型上下文。
3. **恢复检查点层**：`session_meta/turn_context/world_state/compacted/token_usage_record/...`。它们主要服务持久化、重建和预算，不应伪装成“模型做了一步”。

实时事件通道还有一层 `Event { id, msg }`，定义在 `protocol/src/protocol.rs:1337-1344`。落盘时只保存 `event.msg`（`session/mod.rs:2554-2558`），所以 rollout 会丢掉实时事件外层的提交 ID；解析器只能使用 payload 中的 `turn_id`、ResponseItem 中透传的元数据、`call_id/process_id` 等做关联。

### 3.3 写入、顺序与损坏恢复

- rollout 路径形如 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`；revert 可追加 rollout id，见 `rollout/src/recorder.rs:94-120,1700-1721`。目录日期用本地时间，行 timestamp 用 UTC，时间线不要用目录名覆盖事件时间。
- `RolloutRecorder` 使用容量为 256 的写入队列；新文件可以延迟创建，恢复时则立即打开：`recorder.rs:851-1007`。
- 写入器只在单项写入成功后才将其移出待写队列；失败时释放文件句柄，保留尚未写入的记录，再重新打开文件重试：`:1746-1910`。`SessionMeta` 保证先写：`:1854-1875,1949-1975`。
- `LocalThreadStore` 先将记录追加到 JSONL 并刷新日志缓冲区，再更新分页模式下的 SQLite 数据；后一步失败时只发出警告，因此应以 JSONL 为准，SQLite 可以滞后：`thread-store/src/local/live_writer.rs:317-374`。
- paginated rollout 有 ordinal，legacy 没有。ordinal 只在成功写入后递增：`rollout/src/ordinal.rs:16-53`。恢复时反向找最后有效记录；paginated 的最终有效行缺 ordinal 会报错，见 `:55-130`。
- 单文件展示应始终保留物理行序；Paginated 的 ordinal 用来验证缺口、重复和派生关系的边界。不要按 timestamp 重排，因为多个事件可以共享同一毫秒，损坏记录还可能缺 ordinal。
- 加载器忽略空行，对无法解析的 JSON 或不符合类型定义的行计数后跳过，并以**第一个** SessionMeta 确定 thread ID：`recorder.rs:1069-1148`。普通文件和 zstd 压缩文件使用统一读取接口；向压缩 rollout 追加记录前，先将其解压为普通文件：`rollout/src/compression.rs:41-109` 与 `recorder.rs:1994-2017`。

### 3.4 恢复不是“把所有行重放一遍”

`session/rollout_reconstruction.rs:133-488` 会：

1. 倒序依据 TurnStarted/Complete/Aborted、TurnContext、ThreadRolledBack 划分有效区段；
2. 找到最新且仍然有效的、包含替换历史的检查点；
3. 正向重放检查点之后的记录；
4. 兼容没有替换历史的旧版 compacted 记录，用用户消息与摘要重建；
5. 只有在已有完整 WorldState 基准状态后才应用增量补丁；
6. ThreadRolledBack 按真实用户 turn 删除最新 N 段。

入口 `session/mod.rs:1455-1590` 还会恢复中断状态、token 用量和设置，追加 `ThreadSettingsApplied`。这解释了为什么 rollout 查看器必须同时展示“按文件顺序保存的原始日志”和“检查点及回滚的含义”，不能把文件简单等价为最终对话。

### 3.5 兼容性陷阱

- 缺 `history_mode` 默认 legacy，但首个 SessionMeta 中出现未知历史模式时会直接报错并终止：`protocol.rs:775-801`、`recorder.rs:1201-1214`。
- 旧 SessionMeta 缺 `session_id` 时用 `id` 补：`protocol.rs:3166-3200`。
- `task_started/task_complete` 与 `turn_started/turn_complete` 是兼容别名：`protocol.rs:1405-1417`。
- 旧 `ItemCompleted::Plan` 缺 `completed_at_ms` 默认 0：`protocol.rs:1939-1955`。
- 旧版 compacted 中数值类型的 `window_id` 可迁为 `window_number`；替换历史及其配套元数据的记录数必须相同，不允许出现未报告的错位：`history/src/rollout_payload.rs:223-293`。
- legacy `ghost_snapshot` 会在顶层和 compacted 替换历史中被剔除：`rollout/src/recorder.rs:1216-1277`。

## 4. 安全模型：多层约束共同决定能否执行

官方文档明确把沙箱与审批视为两类独立控制；默认网络关闭，不支持所需策略的平台应拒绝运行，而不是悄悄退回无沙箱。平台实现分别包括 macOS Seatbelt、Linux/WSL bubblewrap + seccomp、Windows sandbox/MXC。参见 [Sandboxing](https://learn.chatgpt.com/docs/sandboxing)、[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security) 与 [Permissions](https://learn.chatgpt.com/docs/permissions)。源码进一步显示完整判定链：

```text
配置来源可信度 / managed requirements
        ↓
工具参数与路径解析（fail closed）
        ↓
exec/MCP/network 静态风险与规则匹配
        ↓
PreToolUse / PermissionRequest hooks
        ↓
Guardian Auto Review 或用户审批
        ↓
OS sandbox + 网络代理/防火墙强制执行
        ↓
执行前 owner/root/policy 再验证（防 stale approval）
        ↓
事件、OTel、rollout 中的可观察结果
```

### 4.1 配置来源、项目信任与企业约束

`codex-rs/config/src/loader/README.md` 给出配置层顺序；内部从低到高合并，但被禁用的层仍留作诊断。安全关键点：

- `config/src/loader/mod.rs:70-93` 的 `PROJECT_LOCAL_CONFIG_DENYLIST` 禁止项目 `.codex` 改 provider、auth、endpoint、notify、profile、OTel 等高风险键。
- 管理员配置在识别工作区根目录和判断信任状态之前加载（`:328-400`），因此项目无法先改写“谁有资格决定信任”。
- `ProjectTrustDecision` 在 `:1010-1089`；未获信任或没有信任记录会禁用项目配置、hooks 和命令执行策略。`sanitize_project_config`（`:1123-1214`）还会移除禁止项目设置的键、凭据代理场景中的 `ZDOTDIR/BASH_ENV` 与凭据键、项目级权限热键。
- 从仓库根目录到当前目录的 `.codex` 发现位于 `:1559-1741`。未获信任的项目即使 TOML 无效也只警告并禁用，可信项目无效则显式报错。
- 管理员要求中的标量、网络、规则、hooks 和禁止读取规则，分别按各自规则合并：`config/src/requirements_layers/stack.rs:60-319`。结构使用穷尽解构，新增字段必须明确决定“覆盖还是合并”。管理员配置的 hooks 只能追加；生效目录冲突时直接拒绝：`requirements_layers/hooks.rs:61-240`。各配置层的禁止读取规则取并集：`requirements_layers/permissions.rs:20-80`。
- `config/src/config_requirements.rs:159-286,1818-2027` 规范化并约束权限、审批者、沙箱、Windows 后端、命令执行策略、网络搜索和 hook 等设置。安全默认设置为只读权限和缓存搜索；受保护模型要求自动审批；允许的审批方式列表不能为空，允许的沙箱模式必须包含只读。

这层防的是“项目仓库把自身配置成可信执行器”。它先于模型和工具执行，不能用提示词替代。

### 4.2 路径权限、deny-read 与链接攻击

`codex-rs/protocol/src/permissions.rs` 是权限模型核心：

- `.git/.agents/.codex` 默认写保护，只有范围更小、更具体的显式写权限才能覆盖（`:36-72`）；网络默认 Restricted（`:80-89`）。规则匹配范围同样具体时，严格程度为 `Deny > Write > Read`（`:92-130`）。
- 禁止规则的 glob 模式编译失败时，不会放宽权限；`ReadDenyMatcher` 支持 `FailClosed`：`:304-378,1053-1095`。
- 当前目录或候选路径解析失败时直接拒绝；同时检查原路径与规范化路径，防止符号链接或目录联接绕过：`:388-427`。
- 替换策略时会保留禁止读取规则；一旦存在显式拒绝规则，即使请求“unrestricted”，也会转换为允许根目录写入但仍受限制的模式：`:676-746`。
- 工作区可写模式由根目录可读、项目根目录可写和可选的临时目录可写组成，再单独保护元数据目录：`:797-853`。
- 无法解析、深度未知或危险的可写根目录，默认拒绝或不纳入授权：`:945-1051,1200-1293`。
- 根目录推导不会沿着攻击者可修改的路径组件继续解析；Windows/gitdir 等别名只在可信的顶层目录规范化：`:1465-1628,2191-2248`。
- 外部沙箱无法表达工作区外的写权限时直接报错，不会悄悄扩大权限：`:1679-1792`。

`core/src/tools/sandboxing.rs:238-306` 还有一个容易忽略的组合规则：存在禁止读取规则时，不能升级为无沙箱执行；即使请求 `require_escalated`，也会降回默认沙箱，以保持读取隔离。Windows 后端被禁用但当前目录位于 Windows 上时仍强制 RestrictedToken（`:407-417`）。

### 4.3 命令分类、exec policy 与审批

命令判定并非简单检查字符串是否包含允许或禁止的词：

- `core/src/exec_policy.rs:327-460` 先拆分 shell 命令，再匹配精确规则、宿主可执行文件规则和备用规则；Forbidden/Prompt/Allow 中，只有**每个命令片段都被显式 Allow** 才能绕过沙箱。
- 多条规则匹配取最严格值，精确规则优先，备用规则只在没有显式规则时生效：`execpolicy/src/decision.rs:7-25`、`execpolicy/src/policy.rs:305-410`。
- `bash/zsh/sh` 只有简单命令序列才会拆分；PowerShell 和无法确认结构的命令按整体评估：`core/src/exec_policy.rs:876-904`。tree-sitter 的“安全证明”只接受仅包含字面参数的简单命令与 `&& || ; |`；重定向、替换和控制流拒绝：`shell-command/src/bash.rs:11-135`。
- 命令包装最多解开 8 层；超限视为危险，并递归识别 sudo/env/trap/rm 与 Windows 危险命令：`shell-command/src/command_safety/is_dangerous_command.rs:25-205`、`windows_dangerous_commands.rs:6-185`。
- 策略文件损坏时，解析错误会触发回退，仅使用管理员要求中的策略，并发出警告；读取类错误直接返回：`core/src/exec_policy.rs:645-715`。
- 用户要保存命令前缀规则时，会拒绝空、范围过宽、已存在或危险的前缀（shell/interpreter/git/rm/sudo 等），并验证候选规则能允许所有命令片段：`:57-146,958-997`。

工具调用的统一调度位于 `core/src/tools/orchestrator.rs:61-520`：先处理网络审批，再审批具体动作，最后选择沙箱；只有类型明确的 `SandboxErr::Denied` 才可能进入升级/重试，而且必须同时满足工具、审批、网络和禁止读取规则的条件。严格自动审批模式下的重试必须重新审批，且最多重试一次，不能把第一次批准视为永久许可。

统一动作表示与审批决策在 `core/src/tools/approvals.rs:54-156,422-854`：覆盖 exec、stdin、execve、patch、MCP、network、request-permission；无效或超时的决策按拒绝或中止处理。审批来源的优先顺序是 hooks → Guardian → user。会话缓存中的命令执行指纹包含环境的执行策略，避免跨策略复用审批；stdin 只接受明确批准或中止。

### 4.4 Approval Auto Review（Guardian）与 `/review` 是两套系统

官方把 Auto Review 描述为：在会话边界请求发生时临时切换审批者，根据保留的精简对话记录与**准确待执行动作**作出决定；它不扩大沙箱权限，不读取隐藏思维链；失败或超时不会运行动作，并有连续 3 次拒绝或最近 50 次中 10 次拒绝的熔断机制。参见 [Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)。源码映射如下：

- 配置类型：`protocol/src/config_types.rs:175-200`；选择路线 `core/src/guardian/review.rs:105-129`。
- 主审批链：`core/src/tools/approvals.rs:466-665`；Guardian 在隔离的操作系统线程中作出决定：`guardian/decision.rs:23-197`。`None` 是“转用户”，不是隐式允许；没有参与审批的模块时绝不允许；格式无效的动作直接拒绝。
- 审批者配置会显式移除 skills、apps、MCP、hooks、multi-agent 等能力：`guardian/reviewer_config.rs:18-106`。这是一张重要的“禁止能力清单”，不是仅用提示词告诫审批者。
- 审批者池、主干上下文复用与会话：`guardian/review.rs:313-326`、`guardian/review_session.rs:107-169,300-312`、`ext/guardian-reviewer/src/pool.rs:119-380`；失败或超时后，共用同一截止时间的重试在 `ext/guardian-reviewer/src/retry.rs:15-121`。
- 审批结束后还会重新检查所有者和根授权依据；如果期间发生变化，会将允许改为 Cancelled，防止使用过期授权或出现 TOCTOU 问题：`guardian/review_request.rs:190-266`。
- 可观察事件：`GuardianAssessment`、approval request，以及 `protocol/src/approvals.rs:90-121,188-254` 中带有明确类型的动作与决策。

而用户命令 `/review` 是代码审查子会话：

- 操作、目标与结果：`protocol/src/protocol.rs:746-747,3387-3468`；提示词构建：`prompts/src/review_request.rs:42-122`。
- 子会话：`core/src/session/review.rs:6-203`；task：`tasks/review.rs:37-275`；代码审查 turn 不接受追加输入：`session/turn_input.rs:603-615`。
- UI/rollout 事件是 `EnteredReviewMode` / `ExitedReviewMode`。

**Auto Review 审动作权限；`/review` 审代码质量**。时间线必须分两个类别，不能都标成“自动审查”。官方的代码审查产品行为另见 [Code review](https://learn.chatgpt.com/docs/code-review)。

### 4.5 操作系统沙箱：能力不足就拒绝

统一的沙箱后端管理器位于 `codex-rs/sandboxing/src/manager.rs:42-206,367-803`：支持 None、Seatbelt、LinuxSeccomp、WindowsRestrictedToken、MXC；路径/URI 保留到执行边界，转换失败时不回退；MXC 或 Windows managed-network 能力不足时报错；WSL1 在要求 bwrap 时也报错。

| 平台 | 关键防线 | 源码 |
|---|---|---|
| Linux | bwrap FS 隔离后再 seccomp/no_new_privs；非法组合拒绝；bwrap 失败绝不回退 Landlock | `linux-sandbox/src/linux_run_main.rs:153-449` |
| Linux | Landlock 未真正 Enforced 视为错误；seccomp 禁 ptrace/process_vm/io_uring/网络等 | `linux-sandbox/src/landlock.rs:34-290` |
| Linux | full-write + 无 deny + full-network 才走快路径，否则 namespace/cap drop/read-only root；mask WSL interop/host proc | `linux-sandbox/src/bwrap.rs:232-420,1271-1335` |
| Linux | fd mount 验证 FD>2、存活、CLOEXEC、绝对 target、dev+inode；bundled bwrap 构建时 SHA-256 后从 `/proc/self/fd` 执行 | `linux-sandbox/src/fd_mount.rs:12-86`、`bundled_bwrap.rs:35-161` |
| macOS | 固定 `/usr/bin/sandbox-exec` 防 PATH 注入；base profile `deny default` | `sandboxing/src/seatbelt.rs:21-63`、`seatbelt_base_policy.sbpl:1+` |
| macOS | proxy/socket scope fail closed；拒绝 nested symlink，deny anchor 最后施加、不能被 allow 重开 | `seatbelt.rs:255-575,923-1051` |
| Windows | 无法执行 full-disk write/managed restriction 直接报错；RestrictedToken 去除最大权限、LUA、write-restricted，只留 traversal 权限 | `windows-sandbox-rs/src/resolved_permissions.rs:39-116`、`token.rs:429-561` |
| Windows | 逐组件 no-reparse handle 检查；环境清理、ACL/deny-read；私有 desktop 只在 policy fingerprint 相同复用 | `no_reparse_dir.rs:83-244`、`spawn_prep.rs:83-448`、`desktop.rs:89-140,271+` |
| Windows | firewall 要求所有 profile 且 read-back SID；WFP per-user 禁 ICMP/DNS/SMB；MXC 禁 permissive learning | `setup_provisioning/firewall.rs:165-413`、`wfp/filter_specs.rs:25-124`、`mxc-sandbox/src/native.rs:25-33` |

### 4.6 网络不是一个布尔开关

`network-proxy` 把主机、请求方法、IP、代理、凭据代理和管理员约束分层处理：

- 同一匹配模式下 Deny 优先于 Allow；危险功能默认关闭；凭据代理自动要求 MITM：`network-proxy/src/config.rs:20-28,70-223`。
- Limited 只允许 GET/HEAD/OPTIONS，CONNECT 要 MITM；监听器默认限制为本地回环地址；Unix socket 仍要求本地回环限制，且路径必须为绝对路径：`:352-532`。
- 运行时按拒绝规则、是否显式允许本地或私网、允许列表的顺序判断；即使主机名在允许列表中，DNS 解析到内网地址时仍会拒绝，连接时再检查目标 IP，防 DNS rebinding 与 TOCTOU：`runtime.rs:644-836`、`connect_policy.rs:67-111`。
- 基准策略中的 `NotAllowed` 才允许交给决策模块覆盖；显式拒绝和本地拒绝不能被覆盖，且每次都记录审计信息：`network_policy.rs:24-98,266-442`。
- Limited/host hook 需要 MITM；缺少时直接阻止；Limited 模式下拒绝无法检查内容的隧道：`http_proxy.rs:290-423`。
- 管理员约束限制模式、上游代理、非本地回环监听、socket 和禁止列表；违反直接错误，并拒绝全局 denylist `*` 这种高风险误配：`state.rs:60-224,330-424`。

注意可观察性边界：代理的每次策略判定主要进入 `codex.network_proxy.policy_decision` OTel/observer，并不保证成为 rollout 行。rollout 通常只能看到请求审批、工具失败或 sandbox-denied 摘要；查看器不能凭缺失事件断言“没有做网络判定”。

### 4.7 MCP、Apps 与 hooks 的信任边界

- MCP 配置中 Auto 与 Writes 相遇取更严格 Prompt；支持按工具审批、输出 token 上限、环境变量校验、超时和允许列表：`config/src/mcp_types.rs:27-98,208+`。
- MCP 连接管理器拒绝调用已禁用的工具，限制超时，并移除或拒绝调用者注入由宿主维护的授权元数据：`codex-mcp/src/connection_manager.rs:938-1000`。
- `core/src/mcp_tool_call.rs:121-285,1395-1650,2324-2354` 校验 JSON、元数据和可用性；Apps 依据 destructive/open-world/read-only annotation，custom MCP 依据配置。`destructive=true`、unknown destructive/open-world 默认 prompt，明确 `read_only=true` 才 auto。strict auto-review、Never、session remember 各有独立门控。
- 发现 hook 时，只运行 Managed/Trusted 或明确允许绕过检查的来源；忽略未获信任的项目 hook；必需的管理员 hook 出错时必须失败：`hooks/src/engine/discovery.rs:45-188,695-820`。
- 命令 hook 明确运行在沙箱外，因此启动界面必须展示信任状态；执行前 `env_clear`，只重建环境快照与 hook 环境变量，清除禁止继承的变量，并在超时时终止进程组或进程树：`hooks/src/engine/command_runner.rs:206-432`。
- 一个重要的可用性取舍：PreToolUse 明确 block 或 exit 2 会拦截；runtime error、invalid JSON、其它 exit 多数记录 Failed 后继续。PermissionRequest 也是合法 allow/deny 或 exit 2 才终止，其它失败继续交 reviewer：`hooks/src/events/pre_tool_use.rs:193-307`、`permission_request.rs:188-279`。这里并非一律出错即拒绝，而是将 hook 作为可组合的审批参与方，最终安全仍由 Guardian、用户审批和沙箱共同保证。

Apps 的本地文件参数也不是把路径直接交给网络上传：`core/src/mcp_openai_file.rs:132-254` 先确认 ChatGPT 身份认证，合并 turn 和会话授权，构造当前执行器的文件系统沙箱，要求支持沙箱内流式读取文件，并检查是否为普通文件及是否超出大小上限，再流式读取并上传。`view_image` 同样通过沙箱内的元数据查询和读取 API，并在读取后做统一图像准备：`core/src/tools/handlers/view_image.rs:139-184`。因此“工具是 hosted/Apps”不等于绕过本地读权限。

### 4.8 动态权限与 apply_patch：授权仍受原请求和环境限制

`request_permissions` 不是模型直接改全局 sandbox 的后门：

- 参数先按选定环境的当前目录和路径规则规范化，空请求和不可表示的权限拒绝：`core/src/tools/handlers/request_permissions.rs:65-122,141-207`。
- 审批仍走 PermissionRequest hook → Guardian/user；客户端返回后，`session/mod.rs:2924-3301` 取响应权限与原请求权限的交集，并按环境保存为 turn 或会话授权。严格自动审批会把授权范围从整个会话缩小到当前 turn（`:3237-3264`）。
- shell、patch、extension、Apps 文件读取在实际执行时重新合并当前环境的会话和 turn 授权，而不是把一次决定变成全局布尔值：`tools/handlers/mod.rs:269-320`、`apply_patch.rs:290-337`、`mcp_openai_file.rs:158-185`。

`apply_patch` 自身也有两阶段边界。解析/预验证在 `apply-patch/src/invocation.rs:201-289` 读取当前内容、解析所有源路径、目标路径和移动路径，并确定具体操作；Core 再把全部受影响路径映射为权限要求，并经过统一审批和沙箱：`core/src/tools/handlers/apply_patch.rs:223-337,548-615`。真正写入由执行器的文件系统 API 在当前沙箱环境中执行：`core/src/tools/runtimes/apply_patch.rs:87-235`、`apply-patch/src/lib.rs:430-712`。但它**不是多文件事务**：补丁块按顺序提交，后段失败时前段可能已落盘；因此运行时明确保留 `committed_delta`，失败事件仍报告已经发生的修改（`apply-patch/src/lib.rs:245-311`、`core/src/tools/events.rs:421+`）。审计工具不能把一次失败的补丁操作简化为“零副作用”。

### 4.9 子 Agent 委派不扩权

多 Agent 的权限继承不是靠提示词约定：

- 新子 Agent 先复制父 turn 当前生效的配置，再用**当前运行时**的服务提供方与模型、审批策略、审批者、当前目录和权限快照覆盖对应值，防止恢复过程或持久化的旧值造成策略不一致：`core/src/tools/handlers/multi_agents_common.rs:170-220,234-264`。
- 角色配置采用具有明确类型的允许列表，只能改 developer instructions、模型/推理/verbosity/personality/service tier，或关闭 Shell、Apps、Plugins、Memory、RequestPermissions 和 skills；它没有 sandbox、approval、MCP provider 等提权字段。源码注释即是“reduce capabilities, never replace parent authority”：`core/src/agent/role.rs:1-5,36-128,241-263`。
- 子 Agent 只有在配置根目录、忽略标记和管理员要求策略一致时，才共享父 Agent 的 `ExecPolicyManager`，否则重建；resume 还验证 parent id、同一 control state/owner，并在 role 后重新覆盖 runtime authority：`core/src/agent/control.rs:780-823`、`agent/control/spawn.rs:296-450`。
- 完整历史派生禁止另外传入 `agent_type`，并剥离 parent-local Guardian history、authorization evidence、latest token usage 与 `SecurityRiskScore`；root authorization 由 host 重新取得：`multi_agents_common.rs:223-231`、`agent/control/spawn.rs:1019-1077`。

这可以防止通过委派、恢复或派生会话，复用过期审批或仅适用于局部的审查证据。时间线可以观察 spawn/activity/communication 的持久化部分，却不能因 child 看起来“继承历史”就推断其继承了授权。

### 4.10 Guardian V2 风险快照不等于最终审批

`SecurityRiskScore` 是 thread-owned 的异步风险分类快照，字段只有 scores、可选 call/action/sampled_at，并明确不得进入模型可见上下文或普通 thread item projection：`protocol/src/security_risk.rs:8-24`。低风险快路径只有在 retained context 完整、score lag 未超限、没有较新的 scoring failure、且采样时 authorization 与当前一致时才批准；缺分、过期、失败、授权变化或高风险都回退同步 review：`ext/guardian-v2/src/async_scorer/approval.rs:180-268`。分类失败会写内存中的 fail-closed 高风险分数：`async_scorer/extension.rs:234-240,388-486`。

落盘还要同时满足 `[features.guardianv2].persist_scores = true` 且线程非 ephemeral；append 失败只告警：`features/src/feature_configs.rs:124-139`、`async_scorer/extension.rs:743-756`。所以查看器对该项只能标注为“异步风险快照”：存在不代表最终 action 已批准，缺失也不代表没有审查。最终审批事件本身又被 rollout policy 过滤，详见第 8 节。

### 4.11 日志、环境变量、秘密与隐私边界

安全控制保护“能做什么”，不自动保证所有持久化内容脱敏：

- shell 环境默认 `inherit = All` 且 `ignore_default_excludes = true`；名称含 KEY/SECRET/TOKEN 的通用排除只有显式启用才执行。无条件清除的只是 Codex 或身份基础设施专用、禁止继承的变量：`protocol/src/config_types.rs:205-270`、`protocol/src/shell_environment.rs:5-48,104-159`。因此普通仓库命令仍可能看到调用 Codex 时已有的第三方密钥。
- `RedactedString` 只保证 Rust `Debug` 显示 `<redacted>`，Serde 仍采用透明序列化：`utils/redacted-string/src/lib.rs:7-49`。通用 `redact_secrets` 也明确是仅用少量正则表达式尽力匹配（OpenAI key、AWS access key、Bearer、常见 assignment），不是全局数据流防泄漏：`secrets/src/sanitizer.rs:3-23`。
- managed secret 的本地后端使用 age+scrypt 加密文件，随机口令保存在操作系统密钥环，原子写入；keyring 失败会报错而不是悄悄将该后端的数据以明文保存：`secrets/src/lib.rs:98-145`、`secrets/src/local.rs:163-258,279-403`。这和“所有 shell 环境变量都由密钥管理器接管”是两回事。
- message history 在 Unix 显式建为/修正为 `0600`：`message-history/src/lib.rs:125-169,305-325`。主 rollout writer 则用普通 append/create OpenOptions，没有同位置的显式 `0600`/Windows ACL 设置：`rollout/src/recorder.rs:1728-1744,1994-2018`；实际权限依 `$CODEX_HOME` 目录权限、umask/ACL 与既有文件。`ephemeral` 则同时跳过 LiveThread rollout 和 state DB：`core/src/session/session.rs:904-1013`。
- OTel log/trace exporter 默认 None，`log_user_prompt` 默认 false；metrics exporter 默认 Statsig（仍受产品/analytics 开关解析）：`core/src/config/otel.rs:8-29`、`otel/src/config.rs:13-26`。关闭 prompt 正文时 log 写 `[REDACTED]`，trace 只带长度/计数：`otel/src/events/session_telemetry.rs:1076-1095`。但启用 tool-result 日志会记录 arguments 与 output prefix，默认 2,048 UTF-8 bytes：`protocol/src/config_types.rs:25-39`、`otel/src/tool_result.rs:28-78`。

结论是：rollout、message history、stdout/stderr、hook/OTel 日志和本工具生成的 bundle 都应按**潜在敏感材料**治理。本工具因此默认纯本地、无网络，并在 UI 明示风险；它不擅自替用户做可能破坏证据的脱敏重写。

### 4.12 Skills 与插件供应链

读取 Skill 文档并加入模型输入、执行 skill 脚本、安装插件包，是三个不同操作，分别受约束：skills 有独立的目录和 token 上限，并记录显式或隐式调用（`core/src/skills.rs:38-203`、`core/src/config/mod.rs:692-699`）；真正运行 `scripts/` 仍是普通 shell/tool call，继续经过 exec policy、approval 与 sandbox，而不是因“来自 skill”自动获权。

远程插件主链在 `core-plugins` 中做了相当完整的归档防护：初始 URL 要 HTTPS，下载 100 MiB、解压 512 MiB 上限，tar 路径必须留在 staging root，拒绝 symlink/hardlink/特殊文件，并以同父目录 staging + rename/backup/rollback 激活：`core-plugins/src/remote_bundle.rs:31-35,166-227,301-406,496-611`、`plugin_bundle_archive.rs:127-257`、`store.rs:605-741`。安装前还要通过产品和管理员策略检查。

仍需依赖哪些信任前提，也应写清：backend 返回的 bundle schema 没有独立 digest/signature/integrity 字段，客户端依赖已认证元数据 API、TLS/presigned URL；未固定允许的主机。redirect 的 final scheme 是请求完成后才复核，错误链还可能携带完整 initial/final URL（含 presigned query）：`remote.rs:612-634,1362-1428,2239-2314`、`remote_bundle.rs:76-117,240-326`。另外 curated startup-sync 的 HTTP archive 是另一条实现，不能把 remote bundle 的所有大小/归档约束自动套过去：`startup_sync.rs:185-229,307-363,752-829,921-1103`。

### 4.13 Hosted web search 与 shell 网络是两条能力线

Responses hosted web-search 的 Cached/Indexed/Live 决定的是发给 provider 的 hosted tool spec：`core/src/tools/hosted_spec.rs:8-45`；可见性还取决于 provider/model capabilities、standalone web runtime 与 feature gates：`tools/spec_plan.rs:609-624,1038-1048,1432-1453`。它不等同于给本地 shell 开放 socket。后者仍由 permission profile、network approval、proxy/firewall 执行。时间线上看到 `web_search_call` 只能证明 hosted/standalone search 动作，不能反推出 shell 获得 unrestricted network。

## 5. 自动上下文压缩：记录窗口关系的上下文检查点

OpenAI 的 [Compaction API 指南](https://developers.openai.com/api/docs/guides/compaction) 解释了服务端压缩记录可以携带加密、客户端无法直接解读的保留状态，并可继续接在后续请求中。Codex CLI 在此基础上增加了本地触发机制、窗口前后关系、替换历史与恢复记录。

### 5.1 阈值不是简单的上下文窗口百分比

- 模型配置在 `protocol/src/openai_models.rs:456-460,510-531` 暴露 `resolved_context_window`、`usable_context_window` 与 `auto_compact_token_limit`；默认阈值约为窗口 90%，同时受配置中的上限约束。
- `core/src/session/context_window.rs:8-19,52-109` 区分 total 与 `BodyAfterPrefix` 作用域，施加硬上限，并在缺少精确 token 数据时使用大小受限的备用缓冲区。
- `core/src/state/auto_compact_window.rs:5-20,48-140` 保存 UUIDv7 的首个、上一个和当前窗口的 ID、窗口编号，以及提醒重置状态；有服务端输入用量基准时优先采用，而不是只靠客户端估算。

因此查看器显示“达到阈值”时应同时展示 token 统计范围、实际可用窗口大小和窗口 ID；只算 JSON 字节数会得出错误解释。

### 5.2 四类触发与三条执行路线

触发位置：

- turn 前：`core/src/session/turn.rs:1231-1258` 的 `run_pre_sampling_compact`。
- comp-hash/旧模型兼容路径：`:1295-1340`。
- 切换到更小的上下文窗口：`:1343-1387`。
- turn 中后续工具调用或模型请求后：`:535-639`；Guardian 场景可以重试：`:706-738`。
- 用户显式 `/compact`：`core/src/tasks/compact.rs:28-75`。

调度器 `turn.rs:1397-1454` 按模型能力和功能开关选择：

1. **本地压缩**：`core/src/compact.rs:63-406`。提示词来自 `prompts/src/compact.rs:1-2` 及模板；每条用户消息上限为 20k tokens（`compact.rs:61`）；流错误会重试，并保证工具调用与输出成对。完成后用摘要和适当保留的历史记录组成替换内容。
2. **远端压缩 v2**：`core/src/compact_remote_v2.rs:73-509`，单次请求 `compact_remote_v2_attempt.rs:31-135`。`compact_remote_history.rs:68-185` 裁剪历史记录，完成后移除触发标记，避免下一轮重复触发。
3. **token 预算模式**：`core/src/compact_token_budget.rs:19-83`；新窗口及其记录见 `session/mod.rs:4399-4449`，功能与账号限制，以及提醒与回退逻辑见 `session/token_budget.rs:13-224`。

远端压缩的重试复用模型请求辅助函数，但最多重试 2 次。Pre/PostCompact hooks 可以停止压缩，见 `core/src/hook_runtime.rs:524-600`。

### 5.3 检查点保存了什么

`CompactedItem` 在 `history/src/lib.rs:189-207` 保存：

- 摘要消息；
- `replacement_history` 及一一对应的元数据；
- Guardian 历史、保留的上下文、MCP 资源来源；
- 窗口编号，以及首个、上一个和当前窗口的 ID；
- 压缩响应 ID；
- 当时最新的 token 用量记录。

`session/mod.rs:3943-4020` 用替换历史更新当前上下文；rollout 的持久项定义与可恢复表示在 `history/src/lib.rs:120-138,189-207`。恢复时从后向前扫描，并限制扫描范围，而非每次读完整大文件：`rollout/src/model_context.rs:18-48`。模型协议中还有 `ResponseItem::ContextCompaction`（`protocol/src/models.rs:1232-1242`）；`protocol/src/items.rs:473-490` 定义的是供 `TurnItem` 使用的 `ContextCompactionItem`。legacy UI 事件 `ContextCompacted` 位于 `protocol/src/legacy_events.rs:71-74`。

### 5.4 时间线上应如何呈现

同一次压缩可能同时留下：

- `ItemStarted/ItemCompleted(ContextCompaction)`；
- `event_msg.ContextCompacted`（兼容 UI）；
- 原始 `response_item.compaction/context_compaction`；
- `compacted` 检查点；
- `RawResponseCompleted`、`TokenCount`，失败时还有 `StreamError/Error/Warning`；
- 新的 `WorldState/TurnContext/ThreadSettingsApplied`。

这些不是五次压缩。查看器应根据窗口 ID、turn ID、响应 ID 和相邻记录顺序，将其归为同一次压缩，同时保留每条原始记录。只有检查点真正写入磁盘后，才可标记为“可恢复压缩完成”。

## 6. 上下文组织：增量更新、稳定顺序、明确类型与大小限制

### 6.1 AGENTS.md 与会话指令

`core/src/agents_md.rs:1-16,53-183,270-472` 实现从仓库根目录到当前目录逐级发现和拼接指令，并限制字节数；项目未获信任时，不注入仓库中的 AGENTS 指令。`agents_md_manager.rs:21-172` 串行刷新，以输入构建缓存键，只在成功后替换快照，并为会话指令设置 10k 的硬上限。

上下文不是随手拼字符串：`context-fragments/src/fragment.rs:55-107` 定义具有明确类型的上下文片段。这样来源、排序、生命周期和渲染方式可以独立演进，也避免同一段内容因包装变化破坏提示词缓存。

### 6.2 WorldState 与 StepContext

- `core/src/session/world_state.rs:87-308` 维护完整状态与合并补丁。
- 初始标准上下文在 `session/mod.rs:4108-4345` 组装；差异和完整状态的计算与持久化在 `:4471-4548`，同一 turn 的变化在 `:3589-3622`。
- `session/turn.rs:257-306` 在每次模型请求前固定 StepContext。执行中的策略、模型和当前目录不会被中途更改；新设置在明确的处理节点进入下一步。
- 恢复时增量补丁必须基于完整的基准状态；无法确认参考上下文等价时，派生会话会放弃继承基准状态，重新注入，而不是猜测兼容。

这套设计把“环境事实”从聊天消息中独立出来，成为可以比较差异、可以重放的状态，使恢复会话、派生会话和 turn 内压缩能够配合工作。

### 6.3 技能、插件与提示词注入防护

`session/turn.rs:939-1103` 负责本 turn 的技能与插件上下文：

- Guardian 提示词注入防护在 `:975-1007`；
- 显式技能加载在 `:1028-1048`；
- 最终排序与去重在 `:1089-1103`。

基础指令优先级在 `session/mod.rs:687-732`。这意味着“用户提到了一个 skill 名”与“skill 内容已进入模型上下文”是两件事；时间线若没有直接事件，只能依据持久化 Context/WorldState 或原始内容说明“已观察到注入”，不能仅从文字提及推断。

### 6.4 提示词缓存与增量 Responses

`core/src/client.rs:235-377,497-518,794-842,1254-1333` 管理模型输入构建、增量 Responses 请求、上一次响应 ID 与兼容检查；只有严格等价且能力兼容时采用增量请求，否则发送完整请求。`context_manager/normalize.rs:18-19` 为输出生成确定性 id；`session/session.rs:810-825` 保持会话与缓存的关联。

设计重点不是“尽量少发 token”这么简单，而是让**稳定前缀保持字节和结构稳定**：系统/开发者上下文在前，可变输入在后；上下文更新使用有明确类型的片段与检查点，不随意改写历史。这样缓存命中建立在正确性的基础上，而不是拿正确性换速度。

### 6.5 token 统计与历史截断

`context_manager/history.rs:329-409,440-468,470+,639-723,811-831` 负责记录、规范化、估算与按策略截断工具输出、图像、音频等内容。token 记录与广播在 `session/mod.rs:4551-4682,4719-4733`。这解释了两个看似矛盾的现象：

- rollout 可以保留工具输出的原始截断预算及元数据；
- 下一次模型请求看到的内容可能已经根据当前策略进一步规范化或截断。

查看器应将“持久化原始数据”和“推测的模型可见性”分列显示；没有明确的来源依据时不要把二者画等号。

### 6.6 模型请求重试、限流与通信协议回退

- `session/turn.rs:1540-1647` 每次重试都清除与上一响应 ID 的关联；首次输入之后，从当前最新历史记录重建模型输入。ContextWindowExceeded 立即标记上下文已满，UsageLimitReached 更新限流快照后终止；其他错误只有满足 `is_retryable()` 才进入重试辅助函数。
- `core/src/responses_retry.rs:17-143` 优先采用服务端的 `retry-after`，否则按退避策略等待；发 `StreamError("Reconnecting… n/max")`。WebSocket 重试耗尽且允许 HTTPS 时，会将当前会话切换为 HTTPS，后续不再尝试 WebSocket，并发出 Warning、重置重试计数；HTTPS 重试也耗尽后才返回最终错误。
- `Feature::UnboundedConnectionRetries` 针对支持该能力的服务提供方，在模型请求连接失败后持续重连，等待间隔从 5 秒指数增长到 60 秒，并发出“waiting for network”；在 `features/src/lib.rs:1241-1244` 为 Stable/default true。
- HTTP 层 `codex-client/src/retry.rs:8-47,80-106` 分别控制 429、5xx 和传输错误的重试，指数退避加 ±10% 的随机扰动，并记录 `codex.retry` 遥测数据。
- 限流数据结构在 `protocol.rs:2336-2383`，`TokenCountEvent` 可携 primary/secondary/credits/plan/reached type。

因此时间线中的 `StreamError` 往往是可恢复状态，而非 turn 失败；需要将终止时的 Error/TurnComplete(error)/TurnAborted 与上下文结合，才能判断最终结果。

## 7. 其他内置自动化：上下文压缩和审查之外的机制

### 7.1 Hooks：控制执行流程，也提供上下文

`config/src/hook_config.rs:36-60,128-193` 定义 12 类事件：`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`、`Interrupt`；处理程序可以是 Command/MCP/Prompt/Agent，支持同步或异步执行，并设有超时和 additionalContext 转存阈值（默认约 2,500 tokens，0 表示不转存）。

`hooks/src/engine/dispatcher.rs:115-185` 用 `FuturesUnordered` 并发运行同步处理程序，完成后按配置顺序排列；异步命令交给后台运行时。执行器范围内的异步 hook，只在同步结果没有要求停止或阻止时发起。这里同样采用“并发执行、确定性提交”。

Core 集成点：

- PreToolUse 可以注入上下文或阻止执行：`core/src/hook_runtime.rs:190-240`。
- Stop/SubagentStop 与继续执行逻辑：`:385-500`。
- Pre/PostCompact：`:524-600`。
- UserPromptSubmit 可以停止流程并注入额外上下文：`:674-764`。
- 异步结果只在 turn 的安全处理节点收集；存在正在执行的 turn 时注入，否则记入历史：`:767-808`。
- additionalContext 的每段内容转换为独立的开发者消息；提示词处理程序的反馈使用带 `hook_run_id` 的 `<hook_prompt>` 有明确类型的上下文片段：`hook_runtime.rs:841-865`、`protocol/src/items.rs:99-119,626-694`。

协议层保留 source（system/user/project/MDM/plugin/cloud）、trust（managed/untrusted/trusted/modified）、scope、状态与 typed output：`protocol.rs:1576-1708`。UI 生命周期用 `HookStarted/HookCompleted`；但 `hook_runtime.rs:867-923` 只对非内置的同步 hook 发出这些界面事件；异步或内置 hook 仍可能只有指标或分析记录。因此“rollout 没有 HookStarted”不能证明没运行 hook。

legacy notify 与 TUI notifications 分离：`hooks/src/legacy_notify.rs:13-58` 把 turn complete 作为最终 argv JSON；`core/src/config/mod.rs:720-733` 保持两套配置；OSC9/BEL/焦点策略在 `config/src/types.rs:647-722`。

### 7.2 Unified exec：后台进程有独立生命周期

- 工具输入与默认等待时间：`core/src/tools/handlers/unified_exec.rs:28-66`。普通调用等待 250 ms–30 s，Windows 首次至少等待 10 s；空 `write_stdin` 轮询最少等待 5 s，后台默认最长可等待 300 s：`unified_exec/mod.rs:73-78,210-216`。
- `unified_exec/process_manager.rs:447-605` 在**第一次返回之前**就将运行中的会话存入管理器，防止 turn 中断时释放最后一个 Arc 引用，误杀后台进程。
- `write_stdin` 在 `:817-1060` 按 retained launch permissions 与当前策略再审核；非空才写入，空串只 poll。仍活返回同 process id，结束移除并返回 exit code。
- `head_tail_buffer.rs:11-114` 用固定内存保留输出的开头和结尾，并插入明确的省略标记；`async_watcher.rs:57-240` 持续读 PTY，退出会主动发最终 command event，不依赖下一次轮询。
- 容量满时按最近最少使用顺序清理：先清理已退出进程，再清理最久未使用且未受保护的进程；正在写入或轮询的进程不会被清理：`process_manager.rs:1619-1677`。

可观察链是 `ExecCommandBegin → OutputDelta* → TerminalInteraction* → ExecCommandEnd`，定义在 `protocol.rs:1471-1480,3493-3618`。同一进程可以跨多个 turn 运行，因此查看器必须按 `process_id` 跨 turn 关联。

### 7.3 Multi-Agent：身份、常驻与执行配额分离

- 每棵 root session tree 共享一个 `AgentControl`，包含 registry、V2 residency、execution limiter、rollout budget 与 root service tier：`core/src/agent/control.rs:120-140`。管理器使用 Weak 避免循环引用。
- 注册表限制每个用户会话的子 Agent 总数；创建时原子预留名额，失败时通过 RAII 回滚，关闭或移除时释放：`agent/registry.rs:18-28,79-133`。
- spawn 主线在 `agent/control/spawn.rs:614-817`：解析 MA version/max threads，reserve residency/slot，创建含 parent/depth/path/nickname/role 的 `SessionSource::SubAgent`，按 fresh/full/last-N fork，记录 spawn edge，发 hook/activity，启动 completion watcher。
- 派生前先刷新存储缓冲区；LastNTurns 做 rollout truncation；FullHistory 只有能证明 reference context 时才保 WorldState/TurnContext，否则重注；替换父 agent hints 为 child role hints，并清 inherited usage/review 检查点：`spawn.rs:821-1135`。
- V2 residency 满时卸载最老 idle/unloadable resident，并保存 environments；再次通信时，由所有者验证来源、父 Agent、执行策略和环境，再从 rollout 恢复：`agent/control/residency.rs:49-153,233+`、`spawn.rs:314-614`。
- execution capacity 是另一层 RAII guard，root-derived max threads 用 OnceLock，child role 不能放宽：`agent/control/execution.rs:30-99`。
- completion watcher 把 V2 结果作为 typed `InterAgentCommunication` 送 parent mailbox；V1 注入大小受限 `SubagentNotification` fragment。环境 child 列表最多 8 个、1,024 bytes：`agent/control.rs:481-548,622-710`。
- V2 工具位于 `core/src/tools/handlers/multi_agents_v2/`：spawn、send_message、followup_task、interrupt、list、wait。send_message 不触发 idle turn，followup_task 会触发/复用下一 turn；wait timeout 有 min/default/max。

旧式可观察事件是 `CollabAgentSpawn/Interaction/Waiting/Close/Resume Begin/End`，V2 有 `SubAgentActivity` 与 `TurnItem::CollabAgentToolCall`；每个子 Agent 仍有独立 rollout，并持久化记录创建关系图。因此单文件时间线只能完整描述一个 thread；完整 Agent 树需要根据父节点、根节点和 Agent 路径关联多个 rollout。

### 7.4 Plan/Default 由 Core 约束，不只依赖提示词

- `protocol/src/config_types.rs:669-703` 只有 Default/Plan 两种 TUI mode；旧 `code/pair_programming/execute/custom` 反序列化为 Default。mode 是包含 model/reasoning/developer instructions 的设置包，preset 在 `models-manager/src/collaboration_mode_presets.rs:7-28`。
- Plan 模板 `collaboration-mode-templates/templates/plan.md:1-126` 规定只读探索、三阶段对话和 `<proposed_plan>`；Default 模板在 `default.md:1-19`。
- Core admission 在 `session/turn_input.rs:54-78,338-365`：automatic turn 不能进入/退出 Plan，Plan 中拒绝 automatic start。这些约束直接由 Core 执行。
- `request_user_input` handler 只允许 root thread，并检查 available modes；Plan 时 `is_blocking=true`：`tools/handlers/request_user_input.rs:69-90`。
- `update_plan` 是独立工具，schema 为 explanation + steps/status；handler 只发送 `EventMsg::PlanUpdate`：`tools/handlers/plan_spec.rs:24-45`、`tools/handlers/plan.rs:95`。它不切换模式。

### 7.5 功能开关与管理员固定设置

`codex-rs/features/src/lib.rs:44-61,93+,899-908` 用同一个注册表定义开发阶段、配置键和默认值。最终生效配置以默认值为基础，依次叠加基础配置、配置档、命令行和旧版覆盖值，最后规范化依赖关系：`:481-675`；未知配置键只发出警告；使用旧版别名时记录提示；非默认状态会产生指标记录。

当前快照中：

- Hooks、request compression、unbounded connection retry、multi-agent v1 为 Stable/default true；
- multi-agent v2 为 Stable/default false；
- GuardianV2、TokenBudget、ContextManagement、RolloutBudget、StepModelSwitching 为 UnderDevelopment/default false；
- 旧 responses-websocket / remote-compaction-v2 flags 已 Removed，能力改由 provider/model 声明。

位置：`features/src/lib.rs:1175-1278,1605-1698,1749-1764`。`core/src/config/managed_features.rs:41-203` 把企业 requirements 解析为 pinned map，normalize 后校验；pins 覆盖用户设置，并对冲突给带来源的错误。也就是说，时间线中能看到哪些自动机制是“build registry × provider/model capabilities × 用户配置 × managed requirements”的交集，不能仅凭 feature 默认值下结论。

## 8. 完整 EventMsg 列表与“为什么 rollout 看不到全部运行事件”

`protocol/src/protocol.rs:1351-1574` 的完整 `EventMsg` 名单如下；内部默认 snake_case。`TurnStarted` 写作 `task_started`（兼容 `turn_started`），`TurnComplete` 写作 `task_complete`（兼容 `turn_complete`）：

```text
error, warning, auth_recovery_started, auth_recovery_completed,
guardian_warning, realtime_conversation_started, realtime_conversation_realtime,
realtime_conversation_closed, realtime_conversation_sdp, model_reroute,
model_verification, turn_moderation_metadata, safety_buffering,
context_compacted, thread_rolled_back, task_started, thread_settings_applied,
task_complete, token_count, agent_message, user_message, agent_reasoning,
agent_reasoning_raw_content, agent_reasoning_section_break, session_configured,
environment_connected, environment_disconnected, thread_goal_updated,
thread_queue_changed, mcp_startup_update, mcp_startup_complete,
mcp_tool_call_begin, mcp_tool_call_end, web_search_begin, web_search_end,
image_generation_begin, image_generation_end, exec_command_begin,
exec_command_output_delta, terminal_interaction, exec_command_end,
view_image_tool_call, exec_approval_request, request_permissions,
request_user_input, dynamic_tool_call_request, dynamic_tool_call_response,
elicitation_request, apply_patch_approval_request, guardian_assessment,
deprecation_notice, stream_error, patch_apply_begin, patch_apply_updated,
patch_apply_end, turn_diff, realtime_conversation_list_voices_response,
plan_update, turn_aborted, shutdown_complete, entered_review_mode,
exited_review_mode, raw_response_item, raw_response_completed, item_started,
item_completed, hook_started, hook_completed, agent_message_content_delta,
plan_delta, reasoning_content_delta, reasoning_raw_content_delta,
collab_agent_spawn_begin/end, collab_agent_interaction_begin/end,
collab_waiting_begin/end, collab_close_begin/end, collab_resume_begin/end,
sub_agent_activity
```

但 `rollout/src/policy.rs:9-25,92-205` 明确筛选哪些事件需要持久化：

| 范围 | 会持久化的 EventMsg |
|---|---|
| Legacy 与 Paginated 都保存 | `token_count`、`thread_goal_updated`、`thread_rolled_back`、`turn_aborted`、`task_started`、`task_complete`、`thread_settings_applied` |
| Paginated | 保存全部 `ItemCompleted(TurnItem)`；TurnItem 全变体在 `protocol/src/items.rs:41-77` |
| Legacy 的 ItemCompleted | 只保存 FunctionCallOutput、Plan、Extension::Sleep，以及 Completed 的 SubAgentActivity |
| 仅 Legacy 的兼容高层事件 | user/agent/reasoning、review enter/exit、patch end、context compacted、MCP/web/image end、未完成的 SubAgentActivity |
| 明确不落 rollout | 大量仅通过实时通道发送的事件：error/warning/stream_error、审批、exec begin/delta/end、MCP begin/startup、patch begin/update、GuardianAssessment、deltas、ItemStarted、Hook lifecycle、RawResponse lifecycle、SessionConfigured、协作 begin/end、ShutdownComplete 等 |

所有非 EventMsg 顶层项通常保存；`realtime_item` 仅 Paginated。其子类型在 `protocol/src/realtime.rs:6-33`。

**关键结论：rollout JSONL 只保存恢复和审计所需的部分事件，不能完整记录实时事件通道的全部内容。** 官方 [App Server 文档](https://learn.chatgpt.com/docs/app-server) 说明 app-server 用 JSONL/JSON-RPC 风格的双向消息承载实时 thread/turn/item 更新；那条 stdio 实时流与这里分析的磁盘 rollout JSONL 不是同一种日志。仅用磁盘 rollout 构建的工具可以完整展示“持久化事实”，却不能还原从未落盘的 token delta、审批等待时长、并行任务的实际完成时刻或每一次网络策略判定。

### 8.1 关联键与可信度

- thread：`session_meta.session_id` 是 root/session 身份，`session_meta.id` 是当前逻辑会话；`parent_thread_id/forked_from_id` 表示派生关系。字段在 `protocol.rs:3056-3131`。revert 后文件/rollout id 可变，logical id 不必变。
- turn：TaskStarted/Complete/Aborted、TurnContext、TokenUsageRecord、ItemCompleted 各自携带 turn id/root turn id；见 `protocol.rs:1939-1951,2253-2264,3232-3289`。
- item 与 tool：ResponseItem `id` 和 tool `call_id` 不是同一概念；运行时可按类型前缀补缺失 item id：`session/mod.rs:3453-3468`、`models.rs:1297-1315`。请求/输出应首选同 `call_id` 配对。
- 持久化元数据：`session/mod.rs:3385-3435` 尽量写入 `internal_chat_message_metadata_passthrough.turn_id/create_time`，但旧记录与不支持 metadata 的 variant 可以缺。
- legacy user/agent/reasoning 事件常没有 turn id，只能关联“当前尚未结束的 turn”，必须标注为推导或启发式关联。
- Response Completed 若有 usage，通常紧跟 TokenUsageRecord，再按模型 call 顺序写 tool outputs；usage 可以缺，所以它只是较可靠边界，协议并未保证这种顺序。

建议任何派生视图都显示三个层级：`observed`（JSONL 明确存在）、`derived`（调用与输出配对、持续时间、turn 是否结束）、`unobservable`（rollout 无法回答）。本工具保留每条实际记录；关联链接属于推导结果，绝不改写源记录。

## 9. Codex Rollout Atlas：实现方案与源码映射

### 9.1 目标与取舍

实现位于同级 `codex-rollout-atlas/`，是一套无框架、无构建步骤、无服务端状态的静态站点。它优先保证：

1. 源 rollout 只读；
2. 兼容未来新增、当前尚未识别的数据结构；
3. 每条物理记录可展开到格式化 JSON；
4. 摘要/详情是派生视图，不替换原始对象；
5. 文件留在本机，不做遥测或网络请求。

当前版本已提供这些基础功能：左栏会话、右栏垂直时间线、分类/搜索、摘要与详情、JSON 高亮、配套批处理解析器全部可用。它呈现导入 rollout 中的完整物理事件流；无法补回 `rollout/src/policy.rs` 已经过滤掉的实时事件。

### 9.2 页面结构

| 能力 | 实现位置 |
|---|---|
| 静态页面框架、左侧会话栏、右时间线、导入/拖放 | `dist/index.html` |
| 主题、响应式布局、事件色带、展开态、JSON 语法配色 | `dist/styles.css` |
| 文件导入与 bundle 识别 | `dist/app.js:424-516` |
| JSONL 容错逐行解析与记录结构检查 | `dist/app.js:518-598` |
| session/meta/record 规范化 | `dist/app.js:600-682` |
| 按文件行号保持完整顺序；ordinal 仅校验/展示 | `dist/app.js:684-690` |
| category、summary、ID 提取与关联索引 | `dist/app.js:692-906` |
| 会话列表、指标、过滤和分批时间线 | `dist/app.js:933-1116` |
| 两级详情、根据 ID 建立的关联跳转、原始 JSON | `dist/app.js:1118-1208` |
| 原始 JSON 词法格式化、逐片段转义与高亮 | `dist/app.js:1428-1519,1605-1613` |
| 严格本地 CSP 静态服务 | `scripts/serve.mjs:13-42` |

分类器识别 lifecycle、user、assistant、reasoning、tool、approval/security、compaction、context、configuration、usage、collaboration 与 error；未来新增顶层 type 或子类型时落入 `other`（未知），仍保留并可搜索完整 JSON。页面一次渲染 180 条，继续加载，避免大文件一次性生成过多 DOM；浏览器直接导入另设 256 MiB 单文件上限，批量文件和压缩文件使用命令行解析器。

时间排序保留原物理行号，timestamp 与 ordinal 仅展示/校验。这样即使坏行缺 ordinal、ordinal 重复或损坏回拨，比较器仍能给出明确的先后顺序。bundle schema v2 用并行 `recordLines` 与 `recordRawLines` 保存源位置和数字的原始文本；原始 JSON 面板直接按文本格式化，不先解析为对象再重新序列化，因此超出 JS 安全整数范围的内容仍可逐字复制。顶层 ordinal 还直接从原始数字文本提取并按 `u64` 校验，显示值无需经过 IEEE-754 浮点数的往返转换。

### 9.3 只读解析器

主要版本是 `scripts/parse-rollout.mjs`，没有 Node 环境时可使用 Python 版本 `scripts/parse_rollout.py`：

| 阶段 | Node | Python |
|---|---|---|
| 递归发现、普通文件优先于 `.zst` 副本 | `:51-76` | `:40-65` |
| 读取一次内存快照、Zstandard 能力检测 | `:78-91` | `:68-96` |
| 逐行解析、首个 SessionMeta、坏行节点、SHA-256 | `:148-238` | `:98-247` |
| 多会话打包与严格模式 | `:258-284` | `:249-277` |
| 通过临时文件原子创建或替换输出 | `:286-337` | `:279-323` |

防误操作约束：

- 输入只使用读取 API；不重命名、截断或删除原文件。
- 输出是必填的独立路径；解析前比较解析后的输入和输出路径，重合则拒绝。
- 输入先 realpath；输出若指向同一真实源则拒绝，避免符号链接别名绕过检查。
- 默认拒绝覆盖现有输出；未强制覆盖时，通过同目录硬链接原子创建输出，避免“先检查是否存在、再重命名”之间的竞态。`--force` 只影响明确的输出 bundle，Windows 替换失败会保留并尝试恢复旧 bundle。
- `--strict` 在坏 JSON、无效记录结构或读取期间源文件继续变化时不写 bundle；宽容模式把坏行变成 `parse_error` 节点并保留诊断。
- 两版解析器都先读取内存快照，再从同一份快照解码并计算文件大小和 SHA-256，并在读取前后检查 stat；保存原始行、源文件元数据和诊断信息，便于核对分析的是哪份数据。Node 版是本项目实际运行验收所依据的参考版本。

浏览器可直接拖入 `.jsonl`；批量目录与 `.jsonl.zst` 建议先运行解析器。把 `$CODEX_HOME` 根目录作为输入即可同时递归发现 `sessions/` 与 `archived_sessions/`。

### 9.4 尚未实现的进一步分析视图

以下功能需要进一步解释日志含义，目前尚未实现；这不影响本版展示原始时间线：

- `history_base` 递归拼接、循环引用和字节边界检查；官方参考为 `thread-store/src/local/rollout_lineage.rs:14-188`。
- 压缩和回滚后“最终有效模型上下文”的第二视图；官方参考为 `session/rollout_reconstruction.rs:133-488`。
- WorldState full + JSON Merge Patch 的计算后状态视图。
- 捕获 app-server 实时事件通道，以补足持久化策略过滤掉的审批、delta、begin/end 瞬时事件。
- 跨多个 child rollout 的 agent-tree 图，以及按实际时间记录的并行轨迹（后者单靠 rollout 不可恢复）。

保留这些边界比生成看似完整但错误的因果图更重要。后续若扩展，应采用“原始日志 / 恢复后的状态 / 实时界面事件”三个可切换视图，不能覆盖彼此。

## 10. 最值得学习的工程设计

### 10.1 优化前先确认等价性

增量 Responses 请求、提示词缓存关联、Guardian 主干上下文复用、完整历史派生和常驻子 Agent 重载，都会先检查等价条件；无法确认时，就发送完整请求、创建新上下文或重新注入内容。它们遵循同一个原则：可以放弃性能优化，但不能猜测上下文是否等价。

### 10.2 用检查点保存状态

WorldState 的完整状态与补丁、TurnContext、Compacted 中的替换历史、TokenUsageRecord 和 ThreadSettingsApplied 共同构成可重放的状态。恢复算法可以选用有效检查点和后续记录，无需把提示词字符串当作数据库。

### 10.3 为所有不可信输入设置限制

AGENTS 的字节数、会话指令的 10k 上限、hook 大段内容转存、终端输出的首尾保留、MCP 输出上限、远端压缩的 64k/10k 限制、多 Agent 环境的 8 个/1 KB 限制、命令包装层的 8 层递归上限、日志写入队列的 256 容量、提交队列的 512 容量，都在靠近输入的位置实施限制，并明确记录截断情况，避免等到内存耗尽才处理。

### 10.4 规则、决策与强制执行分离

规则和管理员要求决定允许范围，hook、Guardian 或用户作出具体决策，操作系统沙箱与网络代理负责强制执行，TOCTOU 检查最后确认环境没有变化。审计时必须检查整条调用链，不能看到一次“Approved”就推断执行不受限制。

### 10.5 并发执行、确定性提交

工具任务与 hook 处理程序并发执行；结果用 `FuturesOrdered` 或配置顺序排列。这个模式可以降低延迟，并保持模型输入和历史重放稳定，适合用于实际的 Agent 系统。

### 10.6 从主流程开始考虑恢复

派生会话前先刷新日志缓冲区，写入器保留未写完的记录，压缩检查点携带替换历史与 token 记录，子 Agent 卸载后可以恢复，暂停后继续使用原 turn ID，旧版迁移也有独立分支。恢复能力贯穿主要执行流程，每条路径都明确了哪些状态需要持久化。

### 10.7 明确列出禁止使用的能力

Guardian 审批者显式关闭 skills/apps/MCP/hooks/multi-agent；Core 拒绝在 Plan 模式中自动发起 turn；代码审查会话限制可用能力；deny-read 阻止升级为无沙箱执行。安全设计既描述允许范围，也通过配置和类型明确禁止使用的能力。

## 11. 建议的源码阅读顺序

1. 先读 `history/src/lib.rs`、`history/src/rollout_payload.rs`、`rollout/src/policy.rs`，建立“协议项/事件/恢复检查点”三层模型。
2. 沿 `thread_manager.rs → session/handlers.rs → tasks/regular.rs → session/turn.rs` 走一遍普通 turn。
3. 从 `stream_events_utils.rs → tools/parallel.rs → tools/orchestrator.rs → tools/approvals.rs → sandboxing` 跟踪一次命令执行调用。
4. 用 `compact.rs / compact_remote_v2.rs → replace_compacted_history → rollout_reconstruction.rs` 对照压缩前后日志。
5. 再读 `world_state.rs`、`agents_md_manager.rs`、`context_manager/history.rs`、`client.rs`，理解如何保持模型输入稳定。
6. 最后读多 Agent、hooks、网络代理和各平台沙箱；这些模块会复用前面的会话、持久化和安全机制。

## 12. 源码版本与已有检查说明

Codex CLI 的核心价值不只在模型能力，而在把不确定的模型输出放入一个可恢复、具有明确资源限制、受策略约束且可观察的运行时。最关键的源码线索不是某个巨大的 `agent_loop()`，而是多个边界共同构成的闭环：输入处理、每步状态快照、流式响应处理、工具结果排序、审批链、沙箱执行、检查点、日志写入与历史重放。

本研究已对当前本地快照完成静态源码对照，并用官方公开文档交叉核验产品语义。由于本地副本缺少 Git 元数据，报告未标注无法确认的提交版本；由于 rollout 持久化策略本身会过滤实时事件，工具也没有虚构缺失动作。行号、功能默认值与事件保存策略都可能随未来版本改变，升级后应根据函数名、枚举定义和策略实现重新定位。

以下是原报告记录的历史检查结果，不是本次重新执行 Codex 的结果：浏览器脚本、Node 解析器和静态服务器均通过语法检查；Node 与 Python 解析器各 6 项测试全部通过；两者对同一测试样例生成的数据结构、SHA-256、记录数、物理行号和原始行完全一致；命令行严格模式对测试样例均生成 1 个会话、11 条记录、0 个解析错误和 0 个数据结构错误。静态服务器返回 HTTP 200，并带有禁止网络连接的 CSP；页面已在 1440×1000 视口完成渲染检查，验收截图保存在 `tests/atlas-preview.png`。





