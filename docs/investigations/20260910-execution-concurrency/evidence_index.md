# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 页面轮询两个任务 | 当前标签页 Network 记录、`.release-jobs.json` 的两条活动任务摘要 | 高 | 运行记录随任务变化 |
| 旧响应可恢复旧轮询 | `public/app.js` 原 execute/pollJob 调用路径 | 高 | 未推断第二次点击的具体用户操作 |
| 新提交在后台受互斥保护 | `server.js` createExecutionJob、`test/executionConcurrency.test.js` | 高 | 浏览器测试不启动生产发布 |
| 按钮运行中禁用，结束后恢复 | `running-desktop.png`、`finished-desktop.png`、浏览器 DOM | 高 | 隔离模拟任务 |
| 窄屏布局正常 | `running-mobile.png`，390×844 浏览器视口 | 高 | 外部 Gemini 无可用账户 |
