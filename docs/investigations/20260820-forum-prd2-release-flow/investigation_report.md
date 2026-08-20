# 论坛 Prd2 发版流程走通调查

日期：2026-08-20 JST

## 结论

当前论坛发版流程具备走通条件，调查状态为 `READY_WITH_LIMITATIONS`。

发布器运行提交 `49f364b7` 已将论坛目标解析到 `FORUM_PRD2`，正式命令使用 `root@92.113.124.185`、指定密钥和 `/opt/1panel/apps/flarum/flarum`。目标提交 `d2fd6f03` 相对论坛成功基线包含 3 个论坛运行路径，目标提交中的影响评估精确覆盖这些路径，并声明 `validate-forum-source`、`forum-preflight` 和 `final-runtime-check`。

真实端到端 dry run 创建并清理隔离 worktree，18 个步骤全部进入 `dry-run-checked`。目标提交的论坛 Maven 契约测试和两个初始化脚本语法检查通过。发布器全量测试 152 项通过。

Prd2 只读预检确认 Compose 可渲染，Flarum 与 MySQL 容器运行，Secret 权限为 `600|0|0`，备份目录和 data 目录可用，`mysqldump` 与数据库凭据环境满足备份命令，公网返回 HTTP 200。MySQL 版本为 8.4.9，ngram 插件为 ACTIVE，两个全文索引已经使用 `rhospital-ngram-v2`，两条 rhospital-search 迁移已经登记，因此目标镜像启动时的迁移属于幂等复核。

## 流程判断

| 阶段 | 状态 | 依据 |
|---|---|---|
| 目标选择 | PASS | 论坛配置、远端 TAG 和计划命令均指向 Prd2 |
| 变更与 CheckList | PASS | 3 个运行路径与目标评估完全匹配 |
| 源码门禁 | PASS | 3 个 Maven 契约测试和 2 个 shell 语法检查通过 |
| 本机构建条件 | PASS | Docker 29.7.2 可用，固定基础镜像清单和 Packagist 可访问 |
| 镜像 TAG | PASS | `20260820` 在本地和 Prd2 均未占用 |
| 生产前置 | PASS | Compose、容器、Secret、磁盘、备份路径和 mysqldump 条件通过 |
| 数据库迁移 | PASS | ngram v2 索引和迁移记录已存在，目标迁移具备幂等分支 |
| 切换与最终校验 | PASS_BY_CONTRACT | dry run 与当前运行态检查通过，目标镜像尚未正式构建和切换 |
| 回滚入口 | READY_WITH_MANUAL_DATA_RESTORE | Compose 回滚指针有效，数据库和 data 完整恢复需要人工确认 |

## 限制与风险

1. 本次没有执行镜像构建、镜像上传、生产备份、Compose 修改或容器重建，生产动作仍需正式发版时验证。
2. 固定基础镜像当前未缓存，正式构建会先下载固定 digest，首次构建时间可能增加。
3. 发布器成功历史的论坛基线仍为 `20260806`，Prd2 当前镜像为 `20260817-prd2`，数据库已经包含 ngram v2。正式发版会把这 3 个变化作为待发布内容再次审计和部署，数据库迁移会幂等跳过。
4. 论坛回滚步骤只恢复 Compose 并重建 Flarum。完整数据库和 data 恢复保留为人工操作。

## 生产动作状态

本次执行类型为真实发布器 dry run、真实 Prd2 只读检查、目标提交隔离测试。生产写入动作均未执行。
