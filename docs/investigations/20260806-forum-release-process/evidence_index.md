# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 当前目标包含论坛运行升级 | `analyzeReleaseChanges` 输出，基线 `c893961f`，目标 `e7b67154`，13 个运行路径 | 高 | 依据本地发布历史和当前 `origin/master` |
| 正式计划当前无法创建 | 使用真实基线分析调用 `createPlan`，返回 `databaseImpact` 枚举错误 | 高 | 没有进入后续构建步骤 |
| 迁移测试未进入源码门禁 | `src/releasePublisherCore.js:857` 与 `src/releasePublisherCore.js:2471` 生成的 Maven 测试选择 | 高 | 完整 Maven 测试可能在其他流程执行该类 |
| 迁移契约测试有效 | `ForumSearchMigrationContractTest` 单独运行，退出码 0 | 高 | 属于契约测试，不等同生产迁移执行 |
| 新镜像运行 validator 覆盖搜索门禁 | 目标提交 `integrations/flarum/rhospital-sso/validate-runtime.php` 检查扩展、MySQL 和两个索引注释 | 高 | 最终运行命令没有逐行断言两个搜索标记，依赖就绪标记生成过程 |
| 论坛切换没有恢复提交状态 | `src/releasePublisherCore.js:982`、`src/releasePublisherCore.js:1310`、`src/releasePublisherCore.js:1468` 与 `server.js:510` | 高 | 未执行生产故障注入 |
| 生产仍运行旧论坛镜像 | SSH 只读查询返回 Compose 和容器镜像 `rhospital/flarum-sso:20260724` | 高 | 查询时间为 2026-08-06 |
| 生产基础状态正常 | 容器运行、MySQL 8.4.9、可用空间 56,403,688 KB、公网 HTTP 200 | 高 | 未执行登录态业务搜索验收 |
| 生产具备 ngram 前置条件 | `INFORMATION_SCHEMA.PLUGINS` 返回 ngram 插件 1，现有索引定义没有 `WITH PARSER ngram` | 高 | 只读结构检查 |

## 主要文件

1. `C:\workspace\rhospital-release-publisher\src\releasePublisherCore.js`
2. `C:\workspace\rhospital-release-publisher\server.js`
3. `C:\workspace\hospital-backend\release\release-impact.json`
4. `C:\workspace\hospital-backend\integrations\flarum\05-rhospital-env.sh`
5. `C:\workspace\hospital-backend\integrations\flarum\rhospital-sso\validate-runtime.php`
6. `C:\workspace\hospital-backend\integrations\flarum\rhospital-search\migrations\2026_08_06_000001_enable_chinese_ngram_fulltext.php`
7. `C:\workspace\hospital-backend\src\test\java\com\zly\hospital\ui\ForumSearchMigrationContractTest.java`
