# 调查命令记录

1. `git status --short --branch` 和 `git log` 确认仓库范围与运行提交。
2. 使用 `rg` 扫描源代码、配置、文档、测试、隐藏本地历史和发布路径引用。退役标识在命令中通过字符串片段组合，避免重新写入仓库。
3. 调用 `/api/version`、游戏与论坛 `/api/config`、游戏与论坛 `/api/remote-tag`。
4. 对携带目标覆盖参数的远端镜像请求验证 HTTP 400。
5. 运行 `npm test`、`git diff --check` 与三个 JavaScript 语法检查。
6. 使用只读 SSH 扫描当前生产游戏 Compose、Swarm 服务环境和论坛 Compose。
7. 运行 `npm run history:migrate:v2` 并复查 migration 回执与仓库扫描结果。
8. 使用真实浏览器切换游戏和论坛，读取 DOM、控制台、远端镜像与流程状态。
9. 保存顶层、流程底边和表单底边截图，并测量最终浏览器像素几何。
10. 使用 `gemini-pro-agent` 进行截图视觉复核，主 Agent 以完整边界截图和像素几何处理视口裁切误判。

所有生产命令均为只读。没有执行 `/api/execute`、Docker build、镜像上传、Compose 写入或服务切换。
