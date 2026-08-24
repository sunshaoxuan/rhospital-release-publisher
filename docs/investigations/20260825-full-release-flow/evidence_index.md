# Evidence Index

| Claim | Evidence | Confidence | Limitation |
|---|---|---|---|
| 游戏 34 步计划通过 | `full-flow-acceptance.json`, target `game` | high | 破坏性动作使用隔离替身 |
| 论坛 17 步计划通过 | `full-flow-acceptance.json`, target `forum` | high | 破坏性动作使用隔离替身 |
| 超长 SSH 脚本不再进入 argv | `test/releasePublisherCore.test.js`, SSH runner test | high | Windows 平台测试 |
| 最长远程脚本 24768 字符通过 Bash 语法检查 | `full-flow-acceptance.json`, `toolTraceSummary` | high | 没有在生产主机执行脚本正文 |
| 生产运行状态未改动 | 验收安全标志与隔离 PATH 工具链 | high | 需要额外生产只读检查确认最终现场 |
