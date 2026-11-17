# 发版插件文档入口

现行协议为 `release-plugin/v1`，以后发版统一遵循：

1. [中文发版插件标准](release-plugin-producer-v1.md)：字段、能力、输入、结果、回执、迁移及支持边界。
2. [中文操作手册](../release-plugin-handbook.md)：配置、业务变更、候选交付、生产前验证和故障处理。

[JSON Schema](release-plugin-v1.schema.json)与[最小结构示例](release-plugin-v1.example.json)是结构参考。当前解释器执行闭合 v1 语义准入，Schema 未动态加载；能力以标准中的当前支持表为准。

历史事故、设计取舍和实现验收保存在[改造任务记录](../tasks/20261117-release-plugin-architecture.md)及[事故证据](../evidence/release-plugin-20261117/incident.json)。这些记录保留原时点和身份，当前标准不再重复迁移阶段待办或过时就绪结论。
