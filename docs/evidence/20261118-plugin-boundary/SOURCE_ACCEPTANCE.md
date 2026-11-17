# 发布器应用边界源码验收

发布器源码：3bed315d60dd35707a2a96834f579d553a2bc996。匹配应用：f4ef7845238e8f0430a051ded7e3c7ea8a46df00。两个候选已交付各自origin/master，原生推送复用全部已绑定结果。

| 范围 | 验证 | 源码结论 |
| --- | --- | --- |
| 契约和策略 | publisher-policy、publisher-runner | PASS |
| 直接控制台消费者 | publisher-console | PASS |
| 备份、格式、调度、恢复和致命阈值 | publisher-recovery，31项隔离检查 | PASS |
| 计划、应用策略、输入身份和Chrome生命周期 | publisher-plan，159项隔离检查 | PASS |
| Source通用适配 | publisher-source，49.8秒，首次执行 | PASS |
| 文档与真实路径 | documents | PASS |
| 普通业务仅改应用 | 合成应用新增HTTP检查并核对发布器字节不变；通用Node检查隔离执行及缺失协议拒绝 | PASS |
| 真实应用准备工具 | 应用OFFLINE_PREPARATION.json，精确候选27个输入一致，3入口闭包，零游戏运行差异/迁移 | PASS |

源码验收结果：PASS。归属、身份与升级边界见[策略规范](../../design/application-release-policy-v1.md)。数据库业务审计、业务SQL、迁移名称、兼容类、调度语义、启动业务探测及三项业务验收程序已由应用持有；测试fixture不作为生产fallback。凭据、固定步骤、现场身份、备份、阶段顺序和恢复阈值继续由发布器持有。

仅执行本地隔离验证及源码交付，无游戏发布、生产探测、数据库操作、Docker构建、Maven或产品全量。历次失败及最小修复记录保留于[主任务](../../tasks/20261118-plugin-boundary-contract.md)。候选和Node程序身份漂移、缺失拥有输入、未完成结果、错误协议、过时基线/迁移及OCI对象混比均有拒绝样例。

本机发布器启用另行记录。Windows返回用户取消，管理员进程未启动。之后实际GET核对服务仍为441b4b3、UP_TO_DATE、busy=false、无job。候选3bed315尚未启用，当前没有新服务运行PASS；重新启用需要新的UAC确认，源码通过不能代替启用结果。
