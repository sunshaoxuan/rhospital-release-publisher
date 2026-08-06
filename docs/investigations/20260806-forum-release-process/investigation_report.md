# 论坛升级发版流程调查

调查时间：2026-08-06 JST

## 结论

当前论坛升级无法进入正式发布计划。发布器在构建、上传、备份和生产切换之前失败关闭，直接错误为 `targets.forum.databaseImpact` 不符合固定枚举约束。

修正该字段后仍有两项发版流程缺口需要处理：

1. `validate-forum-source` 没有执行 `ForumSearchMigrationContractTest`，与影响评估声称覆盖迁移幂等和回滚契约的内容不一致。
2. 论坛容器替换没有设置切换提交状态。替换生产 Compose 或论坛容器之后发生失败、取消或发布器重启时，任务会记录为 `ERROR`、`CANCELLED` 或 `INTERRUPTED`，无法像游戏流程一样进入 `RECOVERY_REQUIRED`。

生产论坛目前仍运行 `rhospital/flarum-sso:20260724`。论坛容器、MySQL 容器和公网访问正常。MySQL 8.4.9 的 ngram 插件处于可用状态，现有 `posts.content` 与 `discussions.title` 全文索引尚未使用 ngram 解析器，符合升级未切换的状态。

## 行为路径

1. 发布器从最近一次成功论坛发布历史确定生产基线 `c893961f`，镜像 TAG 为 `20260724`。
2. 当前目标 `e7b67154` 相对基线包含 13 个 `integrations/flarum/` 运行文件变化。
3. `createForumPlan` 从目标提交读取 `release/release-impact.json`。
4. `normalizeReleaseImpactTarget` 要求 `databaseImpact` 为固定枚举。
5. 目标提交使用带说明的长字符串，计划生成立即失败。
6. 若字段修正，源码门禁只运行两个 Maven 测试类，专用搜索迁移契约测试不会被执行。
7. 镜像启动时运行 Flarum migration，随后执行 `validate-runtime.php`。validator 会检查搜索扩展、MySQL 类型和两个索引审计注释，失败时不会生成新的就绪标记。
8. 最终运行检查等待就绪标记，再检查核心版本、SSO、中文资源、Secret、公网 HTTP、缓存属主和权限错误日志。

## 发现

### P0 发布计划被影响评估字段阻止

目标提交中的论坛 `databaseImpact` 值为：

```text
schema-change: Flarum扩展迁移把...
```

发布器只接受 `none`、`query-change`、`schema-change`、`data-change`、`configuration-change`。实际计划生成结果为：

```text
PLAN_ERROR=targets.forum.databaseImpact 必须为 none、query-change、schema-change、data-change、configuration-change
```

影响：正式论坛发布无法创建计划，升级不会进入构建或生产操作。

### P1 迁移契约测试没有进入源码门禁

发布步骤运行：

```text
ForumFlarumImageAssetTest,ForumDeploymentConfigTest
```

ngram 索引替换、幂等跳过和 down 回滚契约位于 `ForumSearchMigrationContractTest`。该测试单独运行通过，发布器生成的命令没有选择它。

影响：以后迁移实现发生回归时，完整应用测试可能发现问题，论坛发版专用门禁无法独立保证发现。

### P1 论坛切换后的恢复状态表达不足

`executePlan` 只在游戏 `deploy-stack` 与 `commit-game-cutover` 路径维护切换状态。论坛的 `update-remote-compose` 和 `deploy-forum-compose` 没有 `cutoverCommit` 标记。通用异常分支对论坛返回 `ERROR`，取消分支返回 `CANCELLED`。服务重启恢复逻辑只有在 `job.cutoverCommitted === true` 时记录 `RECOVERY_REQUIRED`。

影响：生产 Compose 已替换或新论坛容器已经启动后，发布器中断可能被显示为普通中断，值班人员无法从任务状态直接判断生产处于需要恢复复核的阶段。

### 已覆盖的安全措施

1. 发布前检查 Compose、论坛容器、MySQL、Secret 元数据和磁盘空间。
2. 切换前备份 MySQL、data、Compose、环境文件、容器与镜像证据，并生成 SHA256SUMS。
3. 新容器只替换 Flarum 服务，MySQL 和持久数据保持原位。
4. 运行 validator 对搜索扩展和两个 ngram 索引执行失败关闭。
5. 最终检查包含公网 HTTP、中文资源、缓存属主和 Secret 权限错误日志。
6. 回滚命令可以恢复上一份 Compose，数据库完整恢复仍需人工确认。

## 建议处理顺序

1. 将目标提交的论坛 `databaseImpact` 改为精确枚举 `schema-change`，说明文字保留在 `codeImpact`、`summary` 或新增的正式说明字段中。
2. 把 `ForumSearchMigrationContractTest` 加入 `validate-forum-source` 命令，并增加发布器成功与失败测试。
3. 为论坛 Compose 更新和容器替换定义明确的切换状态，覆盖执行失败、用户取消和服务重启三种场景，并增加恢复状态测试。
4. 修复完成后重新生成论坛 dry run，确认 13 个运行路径精确覆盖、三个必需检查进入计划、生产操作顺序为预检、备份、Compose 更新、容器替换、最终验收。

## 调查边界

本次执行了本地只读代码分析、计划生成、测试和生产只读状态查询。没有构建或上传论坛镜像，没有修改生产 Compose、数据库或容器。

## 修复续验

修复完成时间：2026-08-06 JST

1. `databaseImpact` 现在支持固定分类或 `固定分类: 详细说明`。规范分类与说明分别进入计划和发布历史。未知分类继续失败关闭。
2. `validate-forum-source` 已加入 `ForumSearchMigrationContractTest`。
3. `update-remote-compose` 已成为论坛恢复边界。进入该步骤后发生失败、取消或发布器重启，任务进入 `RECOVERY_REQUIRED`。
4. 使用真实生产基线和当前提交 `e7b67154` 生成论坛计划成功，13 个论坛运行路径和三个必需检查全部进入计划。
5. 使用同一目标生成游戏计划成功，16 个游戏运行路径、数据库迁移步骤和全部游戏基础检查保持完整。
6. 本次修复没有执行论坛或游戏生产发布。

## Git Bash 续修

正式论坛任务在 `validate-forum-source` 阶段调用 PATH 中的 `C:\Windows\System32\bash.exe`，该 Windows Bash 入口返回 `Bash/Service/0x8007274c`。任务在本地校验阶段终止，完成步骤 6 个，生产步骤 0 个。

发布器现在从 `Get-Command git` 的首个应用结果解析 `bin\bash.exe`，使用当前 Git 安装自带 Bash 检查两个目标提交脚本。显式选择首个结果可以适配服务 PATH 中同时存在系统 Git 和捆绑 Git 的环境。系统 Bash 与 WSL 状态不再影响论坛发布门禁。

## 阶段色块同步续修

论坛发布 `rhospital/flarum-sso:20260806` 于 2026-08-06 08:20 JST 完成，18 个步骤全部通过。运行观察发现顶部阶段映射没有包含 `backup-forum-release`，该步骤被追加到恢复阶段之后显示，造成色块变绿顺序与实际执行顺序不一致。正常发布还会完成非执行型的 `forum-rollback-command`，使“致命故障恢复”在没有发生故障时变绿。

阶段映射现已把论坛备份归入“数据安全与迁移”，论坛正常流程的恢复证据阶段显示为“记录论坛恢复入口”。阶段颜色仍按组内全部步骤完成后变绿，运行中的组保持运行色。

## 中文搜索生产故障与修复

论坛升级完成后，公网讨论搜索对 `至尊勋章`、`勋章` 和 `医院` 均返回空结果。生产数据库中帖子与主题数据完整，`LIKE` 可以找到中文内容，两个 FULLTEXT 索引的表结构也显示 `WITH PARSER ngram`，因此故障位于全文索引的实际 token 内容。

使用 `INFORMATION_SCHEMA.INNODB_FT_INDEX_TABLE` 检查发现，主题索引把 `周更新内容` 作为完整词条保存，预期的 `周更`、`更新`、`新内`、`内容` 二元 token 不存在。相同 DDL 在隔离的 MySQL 8.4.9 和 8.4.10 上复现：将 `DROP INDEX` 与同名 `ADD FULLTEXT INDEX ... WITH PARSER ngram` 合并在一条 `ALTER TABLE` 中，结构元数据会显示 ngram，实际查询仍返回 0。拆分成两条独立 DDL 后，两版 MySQL 均能产生二元 token 并命中中文。

生产修复在完整数据库备份和 SHA256 校验通过后执行。仅重建 `flarum_posts.content` 与 `flarum_discussions.title` 两个索引，未修改业务行、游戏容器或游戏数据库。修复后帖子数保持 2502，主题数保持 237，当前镜像要求的 `rhospital-ngram-v1` 标记保留，运行 validator 通过。

源码提交 `63de6fce` 增加第二个幂等迁移，为已记录旧迁移的实例重新构建索引，并把新审计标记升级为 `rhospital-ngram-v2`。首装迁移也改为两条独立 DDL。新运行 validator 会从真实标题和正文提取中文二字样本并执行 `MATCH ... AGAINST`，避免只凭索引类型和注释放行。
