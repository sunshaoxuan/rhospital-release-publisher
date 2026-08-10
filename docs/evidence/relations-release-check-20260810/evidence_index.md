# 证据索引

| 证据 | 路径或命令 | 用途 |
|---|---|---|
| 发布检查实现 | `scripts/verify-relations-release.mjs` | 双前置、CDP、API、UI 状态和错误检查 |
| 复用浏览器基础能力 | `scripts/verify-game-static-delivery.mjs` | 导出的 Chrome target 与 CDP evaluate 辅助函数 |
| 发布计划注册 | `src/releasePublisherCore.js` | 已知检查、正式步骤、受控 token 文件参数 |
| 流程阶段显示 | `public/app.js` | 将新步骤归入全链路观察阶段 |
| 检查正反测试 | `test/relationsReleaseVerifier.test.js` | 三字段查询、显式选择、连续 pending 加载门禁、邮箱键和值隔离、主节点、刷新、错误和日志脱敏 |
| 计划门禁测试 | `test/releasePublisherCore.test.js` | 可引用性、可执行性、顺序、命令和 UI 阶段 |
| 使用说明 | `README.md` | 检查范围、命令、凭据和失败边界 |
| 全量测试 | `$env:GIT_OPTIONAL_LOCKS='0'; npm test` | 134 项通过 |
| 本地页面检查 | `docs/evidence/relations-release-check-20260810/release-console-dirty-guard.png` | 页面加载成功，浏览器错误数 0，脏工作区保护生效 |
