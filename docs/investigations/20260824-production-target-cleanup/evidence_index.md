# 证据索引

| 主张 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 游戏与论坛目标固定为当前生产 | `release-publisher.config.json`、配置 API、远端镜像 API | 高 | 未执行发布 |
| 请求不能覆盖目标或路径 | `src/releasePublisherCore.js`、`server.js`、成功与失败测试 | 高 | 管理员仍可通过正式代码变更迁移主机 |
| IDEA 路径不再参与发布 | 核心代码、页面、README 和 tracked-file 扫描 | 高 | 业务仓库其他开发分支仍可保留个人 IDEA 文件 |
| 生产 Compose 与服务环境不含退役标识 | 新生产只读 SSH 扫描 | 高 | 只检查发布相关 Compose 和服务环境 |
| 发布历史已迁移 | `.release-history-migrations.json` 本机回执，replacementCount `1040` | 高 | 本机回执已加入 `.gitignore` |
| 完整自动化测试通过 | `npm test`，154 tests，0 failures | 高 | 未执行生产动作 |
| 游戏页面可用 | [游戏顶层](screenshots/game-final.png)、[游戏流程底边](screenshots/game-flow-bottom.png)、[游戏表单底边](screenshots/game-form-bottom.png) | 高 | 桌面视口 1280×720 |
| 论坛页面可用 | [论坛顶层](screenshots/forum-final.png)、[论坛流程底边](screenshots/forum-flow-bottom.png)、[论坛表单底边](screenshots/forum-form-bottom.png) | 高 | 桌面视口 1280×720 |
| 页面无运行错误 | Browser console warning/error 0，API 状态检查全部符合预期 | 高 | 未点击正式执行 |
| UI 边界未越界 | 游戏与论坛浏览器像素几何，面板内边距 18，按钮底部正间距 54，面板间距 20 | 高 | 外部视觉模型仅凭截断视口产生过误判 |
