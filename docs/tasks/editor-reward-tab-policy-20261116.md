# 编辑器奖励页签检查登记

主目标见 C:/workspace/codex-work/editor-reward-tab/docs/tasks/editor-reward-tab-20261116.md。仅为奖励页签变更补齐现有影响选择器的叶子检查登记，不修改调度、认证、生产环境或完整测试策略。

基线 88b4496，分支 codex/editor-reward-tab-policy；原发布器仅有无关未跟踪审计与临时目录，独立工作树保留它们。

冻结路径：src/currentBehaviorInputs.json、test/changeValidationPolicy.test.js、CHANGELOG.md、本记录。直接消费者：game Source/commit/push 的影响选择。预期 3 分钟，原生门禁负责对应策略验证。正例选择奖励叶子与受影响机关检查，反例未知路径拒绝，无关页面不选奖励；不读取历史截图或回执。通过后仅集成发布器代码供 Source 使用，不启动游戏生产发布。

验收：待执行。

首次提交原生检查 11 组通过。后续补齐模块传递依赖与更新日志，失效输入为 currentBehaviorInputs.json；只重跑原生选择的发布器策略依赖检查，业务与生产验证不扩展。

门禁负例发现队列机关不应成为奖励叶子的传递输入，保留其独立机关归属。失效输入 currentBehaviorInputs.json，最小修复移除 QueueMechanicDialogs 与 FreezeEditor 的奖励登记；原生策略与依赖检查重跑，未变业务输入的现有结果复用。
