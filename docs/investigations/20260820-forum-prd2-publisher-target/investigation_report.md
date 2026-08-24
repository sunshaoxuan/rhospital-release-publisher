# 论坛 Prd2 发布目标调查

日期：2026-08-20 JST

## 结论

最近一次成功论坛发布提交 `e7b67154625f4ec1021c82c01067c14a9c516f47` 到当前 `origin/master` 之间有 3 个论坛运行路径变化，均来自提交 `63de6fcefe5601089a202827ddfc39a560a019ea`。

1. `2026_08_06_000001_enable_chinese_ngram_fulltext.php` 将删除旧索引和创建新索引拆成两条 `ALTER TABLE`，避免组合 DDL 导致重建异常。
2. `2026_08_06_000002_rebuild_chinese_ngram_fulltext.php` 新增幂等的 ngram v2 重建迁移，校验 MySQL ngram 插件，并重建帖子正文与主题标题全文索引。
3. `validate-runtime.php` 将运行时标记校验升级到 `rhospital-ngram-v2`，并使用真实中文双字样本验证索引可搜索。

论坛已迁移到 `RHospital.OrangeVPS.Prd2`。现场只读验证确认 `92.113.124.185` 可通过既有密钥访问，目录 `/opt/1panel/apps/flarum/flarum` 存在，`flarum` 容器运行镜像 `rhospital/flarum-sso:20260817-prd2`，端口映射为 `40020:8000`。

本报告记录论坛迁移时点。游戏目标的历史连接细节已从发布器仓库清除，不作为当前发布依据。当前游戏与论坛目标统一由仓库 `release-publisher.config.json` 管理，页面配置请求使用序号门禁，较早响应无法覆盖当前目标。

## 发布边界

本次只修改发布器并生成 dry run 计划。没有上传镜像、备份数据库、修改 Compose、重建容器或执行论坛发布。

## 外部草案状态

DeepSeek 草案调用因上下文超过 200000 字符安全上限停止，没有产生代码或文件。实现、复核和测试由主 Agent 完成。
