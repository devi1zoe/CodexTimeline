# 从真实任务读懂 Agent 运行程序

[返回唯一学习入口](../README.md#first-lesson)。先读下面的真实任务，再按需要选择短案例。这里的 **harness** 指组织模型输入、调度工具、管理权限与状态的运行程序。基本循环已在 miniAgent 学过，这里重点看这些部件怎样影响一次具体执行。

## 阅读时先分清材料

| 证据类型 | 本页怎样使用 |
| --- | --- |
| 真实保存的运行轨迹 | 主案例使用 miniAgent 已保存的模型请求与工具记录；它是 JSON 格式的课程运行记录，**不是 Codex 原生 rollout** |
| 人工构造示例 | 短案例中的假设任务及查看器演示；用于解释分支，不填写真实运行成绩 |
| 上游 UI 回放 | 最后一个短案例，直接检查上游文件的行与事件；不替代原生 rollout |
| 仅由 Codex_Client 源码验证 | 各短案例中的控制流程；说明代码怎样实现，不能证明某次会话启用了它 |

当前没有可核验的真实 Codex 工具调用 rollout。以下每例都会说明能从现有材料确认什么；不把别的程序的记录改成 Codex 格式，也不为缺失事件补写日志。Codex 与 miniAgent 副本均没有 Git 元数据，`source_commit=UNKNOWN`；不能给它们补写提交号。主案例以归档文件哈希定位，Codex 以本页引用的源码文件与函数定位。代码路径对应随包快照，保留上游 [LICENSE](../../Codex_Client/LICENSE) 与 [NOTICE](../../Codex_Client/NOTICE)。

<a id="real-run"></a>

## 主案例：搜到了文档，为什么回答仍没有讲清问题

**证据：真实保存的 miniAgent 运行轨迹；与 Codex 的关系只由源码对照说明。**

### 为什么选这个任务

只看“调用成功”很容易误判完成。这个任务有两个相互依赖的工具、一批工具请求、一次结果反馈以及最终回答，既能跟清完整执行，也能看出程序检查与回答质量的区别。

当时的用户要求：在官方 Ollama 文档中搜索 `tool calling`，读取至少一个候选页面，用两句话解释工具调用循环，并引用实际取得的来源。记录中的模型标识为 `qwen3:0.6b-cpu`，后端标识为 Transformers CPU 教学适配器；接口形式不能当作 Ollama 产品本身运行的证据。

先打开 [原始 result.json](https://github.com/devi1zoe/Agent-Learning-Lab/blob/main/archive/supporting-materials/20261021/evidence/20261020/stage2-web-research/result.json)。[原有来源与文件哈希清单](https://github.com/devi1zoe/Agent-Learning-Lab/blob/main/archive/supporting-materials/20261021/manifest.json)中包含该文件，本次已确认内容哈希一致。原记录未改写；这说明当前文件与归档清单一致，不是一次新的独立复现实验。

### 按记录跟完这一轮

| 顺序 | 原记录位置 | 实际发生什么，为什么影响后续 |
| --- | --- | --- |
| 1 | `model_requests[0].request.messages` | 第一轮只有 system 与 user 消息。任务已经点明搜索范围、查询词和阅读要求，不能称为完全自主设计研究计划 |
| 2 | `trace[0].message.tool_calls` | 模型一次返回两项请求：`search_web(query="tool calling")` 和 `read_page(source_id="L1")` |
| 3 | `trace[1]` | 程序先执行搜索，返回候选 L1 与官方文档 URL；候选说明是尚未读正文 |
| 4 | `trace[2]` | 程序随后执行阅读，取得官方 Markdown 正文，把 L1 标记为 `read=true`。这一步才有可引用正文 |
| 5 | `model_requests[1].request.messages` | 输入顺序为 system、user、assistant、tool、tool。两条工具消息的 JSON 内容分别与 `trace[1].result`、`trace[2].result` 完全相同 |
| 6 | `trace[3].message.content` 与 `answer` | 第二次模型请求生成最终回答；程序的引用检查为空错误列表，状态为 `completed` |

**这里没有“搜索后模型再次思考，再决定阅读”的中间步骤。** 搜索与阅读在同一批模型输出中已经提出，程序按列表顺序执行；L1 也不是在一次后续模型生成中从搜索结果推导出来的。两项请求出现在一起，不等于程序并行执行。

实际回答主要说“已取得工具调用文档，L1 含有过程说明”，没有充分解释用户所问的循环。记录支持“两次模型请求、两次工具执行、正文进入第二次请求”，但 `completed` 与引用合法没有证明问题答好了。也不能从这条轨迹推断它处理过自动审批、压缩或子代理。

### 对上实际代码，再比较 Codex

在 [联网研究 Notebook](https://github.com/devi1zoe/Agent-Learning-Lab/blob/main/02-tools-rag-memory/03-web-research.ipynb#impl-run) 的 `run` 中，`search_web` 把候选放进 `candidates`，`read_page` 用来源编号取候选、保存正文。搜索后不建候选，紧随其后的阅读就没有对应对象。

在 [Harness.run](https://github.com/devi1zoe/Agent-Learning-Lab/blob/main/03-agent-harness/01-harness.ipynb) 中，程序按 `for item in calls` 顺序处理工具，并把每项结果追加成 `role="tool"` 消息。下一次模型请求才看到这两项结果。这是**此课程实现**的执行方式。

Codex 对应路径是 [handle_output_item_done](../../Codex_Client/codex-rs/core/src/stream_events_utils.rs) 识别调用、[ToolCallRuntime](../../Codex_Client/codex-rs/core/src/tools/parallel.rs) 调度、[drain_in_flight / run_turn](../../Codex_Client/codex-rs/core/src/session/turn.rs) 保存结果并构造后续输入。它允许符合条件的工具并发，使用有序队列收集结果。两种程序的实现不同，不能把课程轨迹的实际执行顺序直接套给 Codex。

### 只读自测

在 JSON 中找到第一轮的两项 `tool_calls` 和第二轮的两项工具消息，说明为什么只有两次模型请求。再读原始最终回答，指出它缺少用户要求的哪项解释。若你只能看到 `tool_calls=2`，还不足以判断两工具是串行还是并行。

<a id="approval"></a>

## 短案例 1：自动审查同意了，工具为什么还可能被拒绝

**证据：仅由 Codex_Client 源码验证。下面写报告的情境是人工构造示例，未运行。**

模型请求一条写报告的命令，目标在当前可写范围之外。为什么不能只让主模型说“这很安全”？因为决定能否做与真正限制执行是不同职责。

1. 运行程序判断工具请求是无需另行批准、禁止，还是需要批准；禁止分支直接返回错误。
2. 需要批准时，程序把具体动作交给审批链：先看权限 hook 的明确决定，再按当前设置交 Guardian 或用户。**Auto Review** 就是这里对动作权限的自动审查，不是 `/review` 的代码质量检查。
3. Guardian 通过单独的评审会话判断动作。设置要求使用只读权限，并关闭记忆、Skill 指令、继承的 MCP 等能力；实际配置仍由宿主应用。
4. 得到批准后，程序还要选择沙箱并执行。**沙箱**是运行时对文件和网络等能力的实际限制；批准本身不会自动扩大它。
5. 如果评审期间用户授权或所属会话状态发生变化，完成阶段可取消已生成的允许决定。执行失败的重试也受独立条件限制，不是任意报错就取消沙箱。

依次读 [ToolOrchestrator::run](../../Codex_Client/codex-rs/core/src/tools/orchestrator.rs)、[Session::request_approval](../../Codex_Client/codex-rs/core/src/tools/approvals.rs)、[reviewer_config_overrides](../../Codex_Client/codex-rs/ext/guardian-reviewer/src/settings.rs) 和 [ReviewRuntime 实现的 complete](../../Codex_Client/codex-rs/core/src/guardian/review_request.rs)。分别找 `Forbidden`、`NeedsApproval`、`select_initial` 与授权版本复核。

**日志能说明到哪里？** 配置或工具结果可能留下线索，但当前 [should_persist_event_msg](../../Codex_Client/codex-rs/rollout/src/policy.rs) 不保存 `GuardianAssessment` 和审批请求等多种实时事件。Atlas 有“安全”分类，不代表普通 rollout 必有完整审批过程。

**你来判断：** 一条结果写“Approved”，能否推出命令已经执行、沙箱已关闭？两者都不能；还需执行结果与当时权限依据。

<a id="context"></a>

## 短案例 2：加载了 Skill 或记忆，模型到底多看到了什么

**证据：仅由 Codex_Client 源码验证。报告方法和语言偏好的情境是人工构造示例，未运行。**

假设任务要使用一份报告 Skill，旧记忆中还保存了语言偏好。它们解决的是“把哪些方法与信息提供给模型”，不是一次模型训练更新，也不是工具执行许可。

1. [build_skills_and_plugins](../../Codex_Client/codex-rs/core/src/session/turn.rs) 从当前技能快照与用户输入识别显式提及，调用 `load_skill_prompts`，把返回的指令片段转换为模型交互项。提到名称、文件存在、正文成功加载，是三个检查位置。
2. [MemoriesExtension::contribute_thread_context](../../Codex_Client/codex-rs/ext/memories/src/extension.rs) 先检查功能与 `use_memories` 配置；没有启用或没有取得指令，就返回空内容。启用后的读取上下文以开发者片段提供；[MemoryContextFragment](../../Codex_Client/codex-rs/core/src/context/memory.rs) 标明角色与大小限制。
3. 程序再从历史生成 `for_prompt` 输入，加入基础指令、当前工具说明等。文件里的全文不等于最终提交的全部输入。
4. 长期记忆的更新是另一条程序路径。[phase1::run](../../Codex_Client/codex-rs/memories/write/src/phase1.rs) 领取符合条件的记录做提取，[phase2::run](../../Codex_Client/codex-rs/memories/write/src/phase2.rs) 组织整合；这些实现存在，不说明它们在主案例中运行过。

把 [build_prompt](../../Codex_Client/codex-rs/core/src/session/turn.rs)、[ContextManager::for_prompt](../../Codex_Client/codex-rs/core/src/context_manager/history.rs) 与前面两条加载路径对照：谁选择内容，谁包装消息，模型最终使用什么。这里仅阅读实现，没有读取任何个人记忆资料。

**Atlas 的范围：** 已保存的开发者消息、`world_state`、`retained_context` 等可展开，但它没有每次请求的完整输入快照，也不计算 WorldState 增量补丁后的完整状态。不能因为日志里出现 Skill 名或某条偏好，就认定每轮都加载了全文。

**你来判断：** 模型按旧偏好使用中文，能否单靠这个结果证明本轮读取了长期记忆？不能；同样要求也可能来自当前用户或其他指令。应找实际输入与来源。

<a id="compaction"></a>

## 短案例 3：长任务压缩后，为什么恢复不能只读最后一句摘要

**证据：压缩与恢复流程仅由 Codex_Client 源码验证；查看器中的压缩演示是人工构造示例。**

设想研究助手已读过许多长文，接下来的请求放不进可用上下文。**自动压缩（auto compaction）**要缩短模型使用的历史，同时让任务可以继续；它不等于简单删除文件前半段。

1. `run_pre_sampling_compact` 在请求前检查上下文预算，`run_turn` 还在后续处理时检查是否需要压缩。触发检查的是程序，不要求主模型先输出“我要压缩”。
2. [run_auto_compact](../../Codex_Client/codex-rs/core/src/session/turn.rs) 根据配置与服务能力选择 token 预算模式、本地压缩或远端压缩；不能假设所有版本走同一路线。
3. 本地 [compact.rs](../../Codex_Client/codex-rs/core/src/compact.rs) 收集消息与摘要，构造 `new_history`。初始指令怎样重新加入还要区分回合开始前和回合中途的压缩。
4. [replace_compacted_history](../../Codex_Client/codex-rs/core/src/session/mod.rs) 更新内存历史，并保存 `CompactedItem`；其中可含 `replacement_history`、窗口关系和用量快照，还可能跟随 WorldState 与 TurnContext。
5. 之后恢复会话时，[reconstruct_history_from_rollout](../../Codex_Client/codex-rs/core/src/session/rollout_reconstruction.rs) 找仍有效的检查点，再重放后续有效记录，并处理回滚与 WorldState 基准。它不是把所有物理行都直接拼回输入。

**用现有人工材料就能看清一个差别：** [11 行样例](../tests/fixtures/native-rollout.jsonl)第 9 行只有摘要、窗口等信息，没有 `replacement_history`；[DEMO_RECORDS](../dist/app.js) 另一个人工压缩演示包含这个字段。这只说明两份示例给的信息不同，不能充当真实压缩前后的两次快照。

Atlas 能展示文件里存在的旧消息、压缩摘要和替换历史原字段；它没有压缩前后有效输入的差异视图、恢复算法或请求级快照，也不能解读服务端加密压缩内容。Codex 程序可以恢复，不能据此推断 Atlas 已实现恢复。

**你来判断：** 日志保留着压缩前的一段工具输出，压缩后模型就一定还能看见它吗？不一定；需要检查替换历史、后续更新与实际构造的输入。断线恢复也不能反推某条写入动作被自动重做。

<a id="mcp"></a>

## 短案例 4：工具被发现以后，为什么还不一定能调用

**证据：仅由 Codex_Client 源码验证。查询资料库的情境是人工构造示例，未连接服务。**

假设模型需要通过资料库工具找论文。**MCP**是客户端与工具服务交互的协议；发现一个工具，只提供了接口与连接线索。

1. 模型提出工具及参数。`handle_mcp_tool_call` 先解析 JSON；工具没有准备好或不向模型开放时，会产生错误结果。
2. `maybe_request_mcp_tool_approval` 按当前模式、工具元数据与严格审查设置决定是否请求批准。不能只按一个 `read_only` 标签推断所有模式都自动允许；例如 `destructive=true` 在相应判断中优先要求审批。
3. 连接管理器 `call_tool` 检查服务、环境与工具过滤；被禁用、没有连接等情况会失败。调用等待受超时限制，调用方也不能注入宿主保留的授权元数据。
4. 通过这些检查后才向服务发请求，把取得的结果或错误交回运行程序。服务返回文字不表示它能授权另一项操作。

源码顺序：[handle_mcp_tool_call / maybe_request_mcp_tool_approval / requires_mcp_tool_approval](../../Codex_Client/codex-rs/core/src/mcp_tool_call.rs) → [connection_manager.rs 中的 call_tool](../../Codex_Client/codex-rs/codex-mcp/src/connection_manager.rs)。

**日志能说明到哪里？** 当前主案例的 `search_web`、`read_page` 是普通本地注册函数，不是 MCP；不要因名字像搜索就归入 MCP。原生 rollout 中是否存在 MCP 完成记录，还受历史模式与保存策略影响；运行时的 begin 通知也不一定落盘。

**你来判断：** 工具列表有某项、参数 JSON 合法、服务返回成功，这三项分别说明发现、请求格式和哪一步完成？它们都还不能单独证明论文找对或答案正确。

<a id="agents"></a>

## 短案例 5：委派子任务以后，谁保留控制与限制

**证据：仅由 Codex_Client 源码验证。两位助手分别查资料的情境是人工构造示例，未创建子代理。**

当两个子问题可以独立查证时，父 Agent 可能请求委派。模型负责提出分工，运行程序负责创建会话、交接选定上下文、管理执行与返回，不能只把“你是研究员”当成全部实现。

1. [build_agent_spawn_config / apply_spawn_agent_runtime_overrides](../../Codex_Client/codex-rs/core/src/tools/handlers/multi_agents_common.rs) 从父回合构造配置，并覆盖为当前运行时的权限、审批方式和目录状态，避免拿旧设置当当前权限。
2. [apply_role_to_config](../../Codex_Client/codex-rs/core/src/agent/role.rs) 允许职责、模型等有限调整，以及关闭部分能力。角色配置不能替换父会话的授权范围。
3. [spawn.rs](../../Codex_Client/codex-rs/core/src/agent/control/spawn.rs) 的上下文派生有显式过滤路径；来源、截取方式和参考上下文能否保留都会影响传入内容。不能把“继承历史”理解成逐字继承所有消息、累计 token 和批准记录。
4. 子代理各有自己的执行与记录，父代理再处理返回。单个父日志不能自动展开成全部子任务的执行图。

再比较普通工具并行：[handle_tool_call_with_source](../../Codex_Client/codex-rs/core/src/tools/parallel.rs) 根据工具是否支持并行选择读锁或写锁；[drain_in_flight](../../Codex_Client/codex-rs/core/src/session/turn.rs) 有序收集输出。子代理委派、同批工具请求、工具并行是三个问题；主案例只有按顺序处理的一批工具，没有子代理。

**你来判断：** 父日志里出现 `spawn` 或最终汇总，就能证明两个子任务同时执行、没有权限扩大、都答对了吗？每项结论都需要相应执行记录或代码依据，不能用一种事件包办。

<a id="steering"></a>

## 短案例 6：用户改方向与用户中断，会走同一条路吗

**证据：仅由 Codex_Client 源码验证。研究中途改为只读的情境是人工构造示例，未执行。**

用户说“继续查，但先别写报告”，通常要把新要求交给仍在处理的任务；用户说“停止”，则需要取消当前任务。两者影响状态的方式不同。

- [turn_input.rs 的 steer](../../Codex_Client/codex-rs/core/src/session/turn_input.rs) 校验输入与预期回合，再通过 `steer_input` 接纳或拒绝追加输入。[run_turn](../../Codex_Client/codex-rs/core/src/session/turn.rs) 在处理节点检查待处理输入，必要时继续同一回合。消息抵达不等于正在阻塞的工具瞬间重写参数。
- [handle_task_abort](../../Codex_Client/codex-rs/core/src/tasks/mod.rs) 发送取消信号、结束任务，并按路径记录中断信息。中断不能撤销此前已经发生的副作用。
- [Op::Interrupt 与 CleanBackgroundTerminals](../../Codex_Client/codex-rs/protocol/src/protocol.rs) 是两个操作；普通中断不等于所有后台终端进程都被终止。

**日志能说明到哪里？** 需要结合输入接纳、工具结果和 `turn_aborted` 等记录；不能把文件尾暂时没有完成事件直接叫作崩溃，也不能从最终答复声称“已停”推断后台工作已全部消失。

**你来判断：** 用户改变要求时，哪些动作已经不可撤销，哪些尚未执行，程序何时把新要求提供给模型？现有样例没有这条真实轨迹，先在源码指出相应位置即可。

<a id="ui-replay"></a>

## 短案例 7：界面回放里的很多事件，为什么不是很多次模型请求

**证据：上游 UI 回放。仅核对文件已有记录；未找到独立采集说明，不声称已验证其采集过程。**

打开 [oss-story.jsonl](../../Codex_Client/codex-rs/tui/tests/fixtures/oss-story.jsonl)，先看第 5 行的 `session_configured`，再看第 35 行 `task_started`、第 773 行完整 `agent_message`、第 774 行 `task_complete`。中间有文本增量与界面重绘记录；它们解释文字如何进入显示过程，不等于每行发起一次模型请求。

文件共 8041 行，其中 1520 条 `codex_event`，有 3 个开始与 3 个完成事件，没有 `exec_command_begin/end`。其外层是 `ts/dir/kind`，不同于 Atlas 原生 rollout 解析使用的 `timestamp/type/payload`。不要为了导入页面而替原件改字段，或把这份回放当成完整模型请求记录。

这个案例可以比较界面事件与保存到磁盘的会话记录；它不能说明 MCP、压缩、自动审查、子代理或工具执行真的发生过。`task_complete` 也只表明记录中的回合结束，任务质量还需另查。

## 还缺哪些真实材料

后续若要补充实际观测，优先选择一条允许公开、复杂度适中的 Codex 任务：包含用户请求、两到四次工具调用及结果、一次可定位的失败或方向调整，以及可核对的最终产物。需同时记录对应代码版本和哪些事件没有保存。当前不采集、不访问项目外日志，也不为此启动新案例。

再按研究需要补独立短轨迹：审批与沙箱拒绝、压缩后继续及恢复、MCP 失败、Skill/记忆加载与更新、子代理交接或中断。无需强求一条日志包含所有机制；完整审批或实时中断过程可能还需要与 rollout 分开的实时事件记录。

如果目标是研究精确上下文变化，还需要另行设计逐请求输入快照与压缩前后重建；Atlas 当前没有这些功能，本页也没有新增它们。
