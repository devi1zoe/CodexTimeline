# CodexTimeline：Coding Agent 运行机制分析与日志可视化

以 OpenAI Codex CLI 为案例，对照开源源码分析工具调度、审批与沙箱、上下文构造、压缩恢复、MCP、子代理与中断，并提供 JSONL 会话日志的解析和时间线查看工具。分析结论限定于随包源码快照；上游代码的来源与许可证保留在 `Codex_Client/`。

**唯一学习入口：[跟清工具请求、执行与反馈](codex-rollout-atlas/README.md#first-lesson)。**

先在 [miniAgent](https://github.com/devi1zoe/Agent-Learning-Lab/blob/main/README.md) 看懂基本循环，再来这里回答三个具体问题：哪条记录是模型提出的请求？程序在哪里执行它？结果怎样成为下一次模型输入？本项目用时间线与随包源码对照这些位置，不再重复讲一套 Agent 架构入门课。

**当前材料有一个缺口：没有附带可核验的真实 Codex 工具调用 rollout。** 查看器的 11 行样例和首页演示都是人工编写；上游还带了一份界面回放，但它没有工具执行事件，格式也不是这里解析的 rollout。学习入口已把源码核对、人工样例练习和真实记录仍需验证的部分分开说明。

先读 [一条真实任务](codex-rollout-atlas/docs/HARNESS_CASES.md#real-run)：miniAgent 当时怎样搜索、阅读并生成仍不充分的回答；它不是 Codex rollout。随后返回入口对照 Codex 的反馈路径，再读 [审批与自动审查](codex-rollout-atlas/docs/HARNESS_CASES.md#approval) → [Skill、记忆与上下文](codex-rollout-atlas/docs/HARNESS_CASES.md#context) → [压缩与恢复](codex-rollout-atlas/docs/HARNESS_CASES.md#compaction)。MCP、子代理、并行和中断按需要读后面的短案例。完整技术细节留在 [机制参考](codex-rollout-atlas/docs/CODEX_CLI_RESEARCH.md)。

[Codex_Client](Codex_Client/) 保留 OpenAI Codex CLI 源码快照、原始资料和许可证。[查看器](codex-rollout-atlas/dist/index.html) 只展示文件实际包含的记录；模型是否正确完成任务仍需另外检查。平台启动方法见 [Linux](codex-rollout-atlas/LINUX.md) 或 [macOS](codex-rollout-atlas/MACOS.md)。
