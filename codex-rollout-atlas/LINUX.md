# 在远程 Linux 上打开查看器

学习内容统一从 [学习入口](README.md#first-lesson) 开始；这里只解释如何打开页面。查看器不需要编译 Codex，不需要模型服务或 API Key。

## 在服务器启动

使用服务器已有的 Node.js 20+，在远程终端执行：

```bash
cd /mnt/data/projectnew/codextimeline/codex-rollout-atlas
node scripts/serve.mjs
```

服务监听服务器自己的 `127.0.0.1:4173`，只提供 `dist/` 中的静态文件。保持终端运行，按 `Ctrl+C` 停止；无需 `npm install`。

## 把端口转发到自己的电脑

使用 VS Code Remote - SSH 时，在“端口”面板转发远程端口 `4173`，按面板显示的已转发地址打开浏览器。

也可以在自己电脑另开终端，用日常 SSH 登录目标替换占位符：

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4173:127.0.0.1:4173 用户名@服务器地址
```

保持连接，浏览器打开 <http://127.0.0.1:4173>。本地端口冲突时把左侧改成 `14173`，浏览器也改用 `14173`；服务器端口保持 `4173`。

## 导入文件

端口转发只转发网页服务。自己电脑的浏览器选择的是自己电脑上的文件，不能直接选择服务器路径。先在 VS Code 远程资源管理器中下载 [人工样例](tests/fixtures/native-rollout.jsonl)，再导入页面，按[学习入口](README.md#first-lesson)完成练习。

普通 JSONL 可直接导入；多个文件或压缩日志才需要[批量解析](README.md#parse-rollout)。文件与生成的 bundle 都不要放进 `dist/`。当前学习包没有真实 Codex 工具调用 rollout，人工样例不能替代它。

## 端口被占用时

只在自己需要启动时换一个端口：

```bash
ROLLOUT_ATLAS_PORT=4174 node scripts/serve.mjs
```

同时把转发命令右侧目标端口改为 `4174`；变量不会改变服务的本地回环监听地址。
