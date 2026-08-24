# Evidence Index

| Claim | Evidence | Confidence | Limitation |
|---|---|---|---|
| 游戏 34 步计划通过 | `full-flow-acceptance.json`, target `game` | high | 破坏性动作使用隔离替身 |
| 论坛 17 步计划通过 | `full-flow-acceptance.json`, target `forum` | high | 破坏性动作使用隔离替身 |
| 超长 SSH 脚本不再进入 argv | `test/releasePublisherCore.test.js`, SSH runner test | high | Windows 平台测试 |
| 最长远程脚本 24768 字符通过 Bash 语法检查 | `full-flow-acceptance.json`, `toolTraceSummary` | high | 没有在生产主机执行脚本正文 |
| 生产运行状态未改动 | 只读 SSH：服务版本索引 128，任务 `i0nb3c4v7p4e`，容器 `797904b18c26...`，健康状态 healthy | high | 检查时点为 2026-08-25 |
| 发布器已加载修复提交 | `/api/version` 返回 `cf156a36` 且 `UP_TO_DATE` | high | 检查时点为 2026-08-25 |
