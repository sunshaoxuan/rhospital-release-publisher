# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 当前有 3 个待发布论坛运行路径 | `git diff e7b67154..d2fd6f03 -- integrations/flarum` 与最终 `/api/plan` | 高 | 以发布器本地成功历史为论坛基线 |
| 3 项变化属于 ngram v2 重建与运行校验 | `git show 63de6fce` | 高 | 未在本次重新执行生产数据库迁移 |
| 新论坛生产源站为 Prd2 | SSH 只读回读主机名、Compose 目录、容器和镜像 | 高 | 仅检查发布所需路径和容器状态 |
| 论坛发布计划指向 `92.113.124.185` | `/api/config`、`/api/remote-tag`、`/api/plan` | 高 | 计划为 dry run |
| 游戏目标保持 `178.239.117.99` | 浏览器目标回切和单元测试 | 高 | 未执行游戏发布 |
| UI 最终状态一致 | [论坛计划总览](forum-plan-overview.png)、[目标字段截图](forum-target-fields.png) | 高 | 本地发布控制台，分辨率为浏览器原始截图 |
