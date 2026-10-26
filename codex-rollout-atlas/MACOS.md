# 在 macOS 上打开查看器

学习内容统一从 [学习入口](README.md#first-lesson) 开始。这里只说明在自己电脑上打开页面；远程服务器使用 [Linux 指南](LINUX.md)。

使用已有 Node.js 20+，在解压后的 `codex-rollout-atlas/` 目录执行：

```bash
node scripts/serve.mjs
```

浏览器打开 <http://127.0.0.1:4173>，按 `Control-C` 停止服务。也可直接打开 `dist/index.html`，无需安装依赖。

导入 [人工样例](tests/fixtures/native-rollout.jsonl)，按学习入口对照 `call_rg_01`。这个文件和首页演示都不是实际运行记录；当前包没有真实 Codex 工具调用 rollout。

需要批量解析已明确选定的日志时，按 [批量解析说明](README.md#parse-rollout)操作，输入与输出使用不同路径。不要把私人日志放进 `dist/`；页面只在本地浏览器解析，服务没有上传接口。

保留 `Codex_Client/` 与 `codex-rollout-atlas/` 的相邻位置，源码链接才能有效。更换 Codex 源码版本后，按函数名重新查找位置，不能沿用旧行号。
