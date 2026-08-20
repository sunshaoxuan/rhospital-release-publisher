# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 发布器运行版本有效 | `/api/version` 返回 `49f364b7` 与 `UP_TO_DATE` | 高 | 检查时点为 2026-08-20 |
| 论坛目标为 Prd2 | `/api/config`、`/api/remote-tag`、`/api/plan` | 高 | 正式执行仍以页面最终输入为准 |
| 目标提交和影响评估有效 | `origin/master=d2fd6f03`、3 个论坛路径、目标 `release-impact.json` | 高 | 发布前 fetch 可能得到更新提交 |
| 远端前置条件通过 | Prd2 SSH 只读脚本输出 `forum_remote_readonly_preflight=PASS` | 高 | 未创建真实备份 |
| 当前运行态通过 | readiness、Secret、缓存属主、公网与语言资源检查 | 高 | 验证当前 `20260817-prd2` 镜像 |
| 迁移会幂等复核 | ngram v2 索引、两条迁移记录与目标迁移源码 | 高 | 未启动目标镜像重跑 migration |
| 发布编排可完成 dry run | job `1787206437715-4247502f72bcd8` 状态 `DRY_RUN`，18 步完成 | 高 | dry run 不执行命令正文 |
| 发布器回归正常 | `npm test` 152 项通过 | 高 | 不覆盖外部网络瞬时故障 |
