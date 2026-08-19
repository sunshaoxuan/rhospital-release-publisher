# 测试结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 发布器完整单元测试 | PASS | `npm test`，152 项通过，0 失败 |
| Prd2 SSH 与 Compose 目录 | PASS | 主机名 `RHospital.OrangeVPS.Prd2`，目录存在 |
| Prd2 论坛容器 | PASS | `flarum` 为 running，镜像 `20260817-prd2` |
| 论坛配置 API | PASS | `FORUM_PRD2` 解析到 `92.113.124.185:22` |
| 论坛远端镜像 API | PASS | 返回 `rhospital/flarum-sso:20260817-prd2` |
| 论坛 dry run 计划 | PASS | 目标提交 `d2fd6f03`，精确列出 3 个论坛路径，上传命令包含新主机 |
| 快速目标切换 | PASS | 较早配置响应未覆盖论坛目标 |
| 游戏目标回切 | PASS | Docker Server 与 SSH 目标恢复 `SSH178` |
| 浏览器控制台 | PASS | 0 个 warning，0 个 error |
| 浏览器视觉检查 | PASS | 字段、摘要、镜像标签和流程卡片无重叠、裁切或边界挤压 |

执行类型：本地真实发布器、真实 Prd2 只读探测、dry run 发布计划。生产发布未执行。
