# Evidence Index

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 失败由旧式 SwiftShader 启动路径触发 | 20260828 与 20260907 发布历史中的 `Framebuffer Unsupported`，现场复现退出码 1 | 高 | 属于受控 Chrome 环境 |
| SwANGLE 可加载真实游戏 | Riven 与 VMISS 单节点真实探针均到达 FirstFloor | 高 | 验证时间为 2026-09-07 |
| 完整发布后探针恢复 | 修改后六探针输出 `game_static_delivery_validation=PASS probes=6` | 高 | 只执行验收，没有执行生产发布 |
| 发布门禁没有降级 | `assertProbe` 保持原有全部断言，代码差异只涉及 Chrome 参数和参数测试 | 高 | 浏览器厂商未来仍可能调整参数 |
