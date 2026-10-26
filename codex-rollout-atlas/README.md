# 用一条工具调用读 Codex

miniAgent 解释了“模型决定下一步、程序执行动作”的基本循环。接下来先看一条已保存的真实任务，再在 Codex 中找到对应的反馈路径；之后用短案例理解运行程序增加了哪些管理功能。

<a id="first-lesson"></a>

## 这一遍怎样读

1. [主案例：搜到文档，回答为什么仍不充分](docs/HARNESS_CASES.md#real-run)。用两次模型请求、两次工具执行跟清一条真实任务；材料来自 miniAgent，不能当作 Codex 的实测。
2. 回到本页第 1–3 节，对照 Codex 源码、工具字段和人工样例。
3. 读短案例：[审批与 Auto Review](docs/HARNESS_CASES.md#approval) → [Skill、记忆与上下文](docs/HARNESS_CASES.md#context) → [压缩与恢复](docs/HARNESS_CASES.md#compaction)。
4. 按需要选读 [MCP](docs/HARNESS_CASES.md#mcp)、[子代理与并行](docs/HARNESS_CASES.md#agents)、[改方向与中断](docs/HARNESS_CASES.md#steering)、[界面回放](docs/HARNESS_CASES.md#ui-replay)。每例都标明来源，并给出只读自测。

## 先知道手中有什么记录

**rollout** 是 Codex 保存会话信息、模型交互项和部分运行事件的文件；**JSONL** 表示每行一个 JSON 对象。它能帮助检查发生过什么，但不等于完整模型请求、全部实时事件或模型的内部思考。

当前学习包没有可核验的真实 Codex 工具调用 rollout。请按下面的用途使用已有材料：

| 材料 | 实际是什么 | 能用来做什么 |
| --- | --- | --- |
| [11 行原生格式样例](tests/fixtures/native-rollout.jsonl) | 人工编写的测试样例 | 练习字段、行号和一次调用的配对；不能作为实测证据 |
| 页面“人工示例” | 人工混合的 rollout 与实时事件演示 | 熟悉界面；不能推断真实文件必有所有事件 |
| [上游界面回放](../Codex_Client/codex-rs/tui/tests/fixtures/oss-story.jsonl) | `ts/dir/kind` 格式的 TUI 回放资料，来源是附带的上游源码 | 观察界面事件与原生 rollout 的格式差别；不适合本课工具调用练习 |
| [Codex 源码快照](../Codex_Client/codex-rs/) | 运行程序的实现 | 核对工具结果如何进入后续模型请求；不能替代一次真实执行记录 |

上游回放共有 8041 行，其中 `codex_event` 1520 条，包括模型文本增量、3 次任务开始和3次任务结束；没有 `exec_command_begin/end`。目前未找到该回放的独立采集说明，所以不能进一步保证其采集方式，也不能从它补造一次工具调用。原文件保持原样。

真实任务放在案例页，Codex 的控制流程在下面核对；人工样例只用于练习字段。三种材料各自回答不同问题。

<a id="source-reading"></a>

## 1. 为什么工具结果能影响下一次生成

沿着“定位 rollout 事件定义”这个具体任务读代码。下面的问题来自人工样例；代码摘录来自随包 OpenAI Codex CLI 源码，按其 [Apache-2.0 许可证](../Codex_Client/LICENSE) 和 [NOTICE](../Codex_Client/NOTICE) 保留来源。

假设模型提出 `exec_command` 请求，参数是 `rg -n RolloutItem codex-rs`。这段生成还没有执行命令。先看这三个位置，不必先学 Rust 全部语法：

| 顺序 | 去哪里看 | 对照什么 |
| --- | --- | --- |
| 请求被识别 | [stream_events_utils.rs](../Codex_Client/codex-rs/core/src/stream_events_utils.rs)，搜索 `handle_output_item_done` | `ToolRouter::build_tool_call` 识别请求；记录请求，安排工具任务，并设置 `needs_follow_up = true` |
| 执行被调度，结果被保存 | [tools/parallel.rs](../Codex_Client/codex-rs/core/src/tools/parallel.rs)，搜索 `handle_tool_call_with_source`；然后读 [turn.rs](../Codex_Client/codex-rs/core/src/session/turn.rs) 的 `drain_in_flight` | 工具任务经过运行程序分发；返回的结果作为 conversation item 写入历史 |
| 下一次请求取得新历史 | [turn.rs](../Codex_Client/codex-rs/core/src/session/turn.rs)，搜索 `run_turn`、`clone_history`、`needs_follow_up` | 程序读取更新后的历史构造输入；仍有工具反馈或待处理输入时继续请求模型 |

可以在源码目录用 `rg` 定位，也可以直接在编辑器里搜索函数名：

```bash
rg -n 'handle_output_item_done|needs_follow_up' codex-rs/core/src/stream_events_utils.rs
rg -n 'handle_tool_call_with_source' codex-rs/core/src/tools/parallel.rs
rg -n 'drain_in_flight|clone_history|needs_follow_up' codex-rs/core/src/session/turn.rs
```

关键是这三段连接起来：

```rust
// handle_output_item_done：模型请求工具后，安排执行并要求后续处理。
output.needs_follow_up = true;
output.tool_future = Some(tool_future);
```

```rust
// drain_in_flight：等待工具结果，并写入对话历史。
sess.record_annotated_conversation_items(
    turn_context,
    &step_context.settings.model_info,
    vec![envelope],
).await;
```

```rust
// run_turn：从当前历史构造要发给模型的输入。
sess.clone_history()
    .await
    .for_prompt(&step_context.settings.model_info.input_modalities)
```

**发生的顺序是：模型请求 → 程序分发与执行 → 结果写入历史 → 下一次请求读取历史。** 工具输出只在终端打印、却没有进入这条历史路径，就不能说明模型已收到它。

`run_turn` 的 **turn（任务回合）** 可以包含多次模型请求。工具任务可以并发，但 `drain_in_flight` 使用 `FuturesOrdered` 收集结果，写入顺序不等于实际完成先后。没有真实执行记录时，不要画出声称测得的并行耗时。

## 2. 让人工样例中的字段有具体含义

查看器无需编译 Codex，也不需要模型服务。使用已有 Node.js 20+ 环境，在 `codex-rollout-atlas/` 中运行：

```bash
node scripts/serve.mjs
```

本机浏览器打开 <http://127.0.0.1:4173>。远程连接的启动与端口转发见 [Linux 指南](LINUX.md)，本地 macOS 见 [macOS 指南](MACOS.md)。也可以直接打开 `dist/index.html`。

点击“导入 JSONL”，选择 [native-rollout.jsonl](tests/fixtures/native-rollout.jsonl)。它是人工样例，导入后应有 11 条记录。若浏览器在自己电脑，文件选择器也使用自己电脑的文件系统，需要先把样例下载到本机。

搜索 `call_rg_01`，保持事件分类全部开启，应留下三条相关记录。展开原始 JSON：

| 文件行号 | 看哪个字段 | 它表示什么 |
| --- | --- | --- |
| 5 | `payload.type=function_call`、`name`、`arguments`、`call_id` | 模型请求运行搜索命令 |
| 7 | `payload.item.type=CommandExecution`、`id`、`stdout`、`exit_code` | 样例设定的执行完成记录；页面把类型显示成 `item_completed:command_execution` |
| 8 | `payload.type=function_call_output`、`call_id`、`output` | 给模型的工具结果 |

这里 `call_id` 是**一次调用的关联编号**。样例的请求与返回共用 `call_rg_01`；第 7 行的 `item.id` 也取这个值。不能把这个样例约定扩大为所有类型的 `id` 都等于 `call_id`。页面“相关记录”只是按标识匹配的辅助链接，仍要核对原字段。

这三条不是三次调用。第 7 行的退出码 0 表示样例中的命令成功退出，还不能证明搜索对象选对、资料足够，或最终答复满足用户问题。

清空搜索，找出第 4 行用户请求、第 10 行最终回答和第 11 行 `task_complete`。任务结束也不等于任务正确。第 9 行的压缩记录先跳过，后面按专题再学。

**ordinal** 是部分日志带的记录序号；这个样例从 0 开始，所以第 5 行的 ordinal 为 4。页面保留文件行顺序，不按时间戳重新排序。它帮助定位记录，不表示模型请求次数。

## 3. 动手核对，再做一个反例

先不看上表，自己指出请求、执行记录和返回；再去源码找到写入历史与构造后续请求的位置。你应该能解释为什么文件里出现了工具输出，仍不能仅凭这份样例还原模型每轮看到的完整上下文。

用下面四个反例自测：

- 搜索到 `function_call`，没有返回记录：只能确认记录里有请求；执行是否发生、是否成功仍需其他依据。
- 退出码 0，但搜索到了错误文件：命令成功，任务仍可能失败。
- 保存了全文日志，下一次输入被截断：模型只能使用实际提交的部分。
- 回合标为 `task_complete`：说明结束，仍要检查答案和中间操作。

如果要在真实 Codex 上验证反馈，还需要一条包含请求与返回的真实 rollout，以及相应版本的源码。当前包缺这份材料，因此只能把后面的源码流程与样例格式分开学习。

## Atlas 能展示多少上下文

消息、工具输出、`turn_context`、`world_state`、`retained_context` 及压缩检查点，只有文件实际保存了才会显示。相关记录由 ID 匹配，行序只是保存顺序；它们不是每次模型请求的完整输入清单。

Codex 的 `for_prompt` 会规范化历史，`build_prompt` 还加入基础指令、工具说明与输出要求。Atlas 没有逐请求完整快照、WorldState 补丁合并、跨 `history_base` 拼接或压缩后有效上下文重建。压缩记录若含 `replacement_history` 可以展开原字段，却没有压缩前后输入的差异视图。见 [压缩与恢复案例](docs/HARNESS_CASES.md#compaction)。

## 以后再看：按问题找机制

| 想追的问题 | 位置 |
| --- | --- |
| 外层 `type` 与 `payload.type` 为什么不同 | [history/src/lib.rs](../Codex_Client/codex-rs/history/src/lib.rs) 的 `RolloutItem`、`RolloutLine`；[机制参考](docs/CODEX_CLI_RESEARCH.md)第 3 节 |
| 工具被拒绝后，模型会收到什么 | [stream_events_utils.rs](../Codex_Client/codex-rs/core/src/stream_events_utils.rs) 的 `RespondToModel` 分支；参考第 2、4 节 |
| 允许请求与实际执行为什么是两层 | [orchestrator.rs](../Codex_Client/codex-rs/core/src/tools/orchestrator.rs)、[approvals.rs](../Codex_Client/codex-rs/core/src/tools/approvals.rs)；参考第 4 节 |
| 为什么日志里找不到某些实时事件 | [rollout/policy.rs](../Codex_Client/codex-rs/rollout/src/policy.rs) 的 `should_persist_event_msg`；参考第 8 节 |
| 压缩与恢复后，模型看到的历史怎样改变 | [compact.rs](../Codex_Client/codex-rs/core/src/compact.rs)、[rollout_reconstruction.rs](../Codex_Client/codex-rs/core/src/session/rollout_reconstruction.rs)；参考第 5、3.4 节 |
| 方法或技能进入上下文后，操作权限是否也改变 | 参考第 4.9、4.12、6.3 节；分别追踪输入构造与操作授权，不能把内容继承当成权限继承 |

这些位置也能为后续 RSI 安全研究提供观察点：方法更新在哪里进入输入、约束怎样保留、哪些操作由程序阻止。案例说明可观察的位置；普通调用链不能直接推出 RSI 的安全结论。

<a id="parse-rollout"></a>

## 有需要时再批量解析

一个普通 `.jsonl` 可直接导入。**bundle** 是把多个会话及其来源信息汇总到一个 JSON 文件，适合批量或压缩日志。Node 与 Python 两版任选一个：

```bash
node scripts/parse-rollout.mjs tests/fixtures/native-rollout.jsonl -o /tmp/atlas-practice.bundle.json --pretty
python3 scripts/parse_rollout.py tests/fixtures/native-rollout.jsonl -o /tmp/atlas-practice-python.bundle.json --pretty
```

两条命令各自解析同一人工样例，预期都是 1 个会话、11 条记录；运行一种即可。默认不覆盖输出，重复操作请换新文件名。输入日志只读，输出不能指向源文件。目录输入只发现 `rollout-` 开头的 `.jsonl` / `.jsonl.zst`；直接传入文件时没有此前缀限制。

`.jsonl.zst` 需要运行时支持 Zstandard 解压：Node 提供 `zlib.zstdDecompressSync`，或 Python 3.14 的 `compression.zstd`，更早 Python 也可使用可选 `zstandard`。浏览器不能直接解压；普通 JSONL 无此要求。

<a id="viewer-source"></a>

## 想改查看器时再读这些代码

[dist/app.js](dist/app.js)：`parseJsonLines → buildSession → normalizeRecord → renderTimeline`；`extractIds` 与 `buildCallIndex` 负责相关记录。[Node 解析器](scripts/parse-rollout.mjs)：`parseRollout → buildBundle → writeBundle`；[Python 版本](scripts/parse_rollout.py)提供相同用途的实现。

页面按文件中的顺序展示，保留原始 JSON 文本与行号；未知类型仍显示，坏行标记为 `parse_error`，不替你补造因果关系。直接导入单文件上限为 256 MiB。静态服务只提供 `dist/`，没有日志上传接口；不要把私人日志复制进 `dist/`。

随包 [源码 README](../Codex_Client/README.md)、[LICENSE](../Codex_Client/LICENSE) 与 [NOTICE](../Codex_Client/NOTICE) 均保留。源码副本缺 Git 提交信息，函数与行号只对应这个快照；升级后需要重新核对。上游源码不是本教程作者自行实现的系统。
