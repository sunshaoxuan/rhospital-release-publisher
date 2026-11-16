# 编辑器奖励页签检查登记

主目标见 C:/workspace/codex-work/editor-reward-tab/docs/tasks/editor-reward-tab-20261116.md。仅为奖励页签变更补齐现有影响选择器的叶子检查登记，不修改调度、认证、生产环境或完整测试策略。

基线 88b4496，分支 codex/editor-reward-tab-policy；原发布器仅有无关未跟踪审计与临时目录，独立工作树保留它们。

冻结路径：src/currentBehaviorInputs.json、test/editorRewardSelection.test.js、CHANGELOG.md、本记录。直接消费者：game Source/commit/push 的影响选择。预期 3 分钟，原生门禁负责对应策略验证。正例选择奖励叶子与受影响机关检查，反例未知路径拒绝，无关页面不选奖励；不读取历史截图或回执。通过后仅集成发布器代码供 Source 使用，不启动游戏生产发布。

验收：待执行。
