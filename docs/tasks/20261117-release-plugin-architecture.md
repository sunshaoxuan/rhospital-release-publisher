# 20261117发布失败检讨与插件化结构设计

## 目标与边界

用户要求先检讨预检查通过后正式流程失败的问题，调整业务功能频繁牵动发布器主程序的结构，并保持日常测试负担不增加。方向为发版方输出插件数据，发布器解释并执行发布及相应检查。

本轮交付为有证据的事故检讨、插件数据协议设计及迁移验收条件。主指导记录位于C:/workspace/codex-work/publisher-plugin-review-20261117/TASK_GUIDE.md。应用前次就绪判断受到本次失败反证，发布器正式执行等价性结论撤回；原产物和局部功能证据保持原范围。

基线771205872ca149ca0d2e4394c4f3b03f8100403b，分支codex/publisher-plugin-architecture-20261117。原有.task-tmp及20261025审计三项未跟踪内容保留。当前阶段只修改本仓库文档、设计示例与CHANGELOG，不改运行逻辑，不修改应用、发布评估、生产数据或服务，不重试游戏发布，不更新发布器服务。

## 检查冻结

范围：本记录、docs/design/release-plugin-v1.md、设计schema与示例、docs/evidence/release-plugin-20261117/incident.json、CHANGELOG。直接消费者是后续发布器及应用迁移任务的实施者，当前没有运行消费者。

验证：证据摘要与原始历史记录及固定提交源码对应；文档引用、规则冲突、JSON结构与示例核对；使用已有JSON Schema库时记录真实校验，否则明确仅完成静态检查。原生提交/推送门禁仅选择documents，不跑npm/Maven全套、不构建镜像。预计15分钟；失败只修正本范围静态问题。已存在的20261025历史审计不纳入本任务。

## 当前事实与结论

失败发布记录2026-11-16T23:07:43.079Z-20261117，目标c16f104461b5766374562adf3888e4a3171f9a86。43步中11步完成，第12步validate-game-source-impact失败。game-gate组37个测试36通过、1失败，错误为Committed local release publisher repository not found，发生于导出临时目录中的releaseCandidateCommitGate.test.mjs:315。生产上传、迁移、切换均为pending。

局部预检查曾显式提供RHOSPITAL_RELEASE_PUBLISHER_ROOT；正式server入口传process.env，Source导出后的测试又从process.cwd()搜索发布器。这个未声明的跨仓库上下文依赖解释了执行失败。environment身份字段没有纳入该变量；日志证明该组正式执行时没有复用PASS，具体造成缓存失配的字段尚未由日志确定，禁止推定为唯一某个PATH值。

主Agent责任：使用自建预检查启动器补齐了隐藏环境依赖；复用了正确拥有输入的局部PASS，却没有证明正式入口的上下文等价；将范围受限的检查结果表述为可以进入实际发布的就绪结论。业务规则持续进入发布器目录也造成重复耦合。详见[结构设计与完整检讨](../design/release-plugin-v1.md)和[证据](../evidence/release-plugin-20261117/incident.json)。

## 交付验收

最终静态结果写入同目录证据中的review.json。必须分别说明调查/设计完成与运行改造尚未实施，不能宣称故障已经修复或插件机制已经生效。无需为写回执重跑历史业务验收。

实际静态结果：已有Python jsonschema完成2020-12 schema核对，三类runner正例与九项结构反例全部符合预期；示例ID、引用和入口输入关系核对通过。详见[静态回执](../evidence/release-plugin-20261117/review.json)。这些结果仅覆盖设计数据，运行改造状态NOT_IMPLEMENTED。文档评审将“循环依赖”表述收窄为v1独立叶子，匹配schema没有unit依赖图的实际范围；该文字修正不使schema/example的已通过结果失效，仅做相关文档静态检查。
