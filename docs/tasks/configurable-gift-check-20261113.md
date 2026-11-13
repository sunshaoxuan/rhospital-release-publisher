# 可配置礼包的局部提交检查

服务于已授权的79医院补偿功能交付。本阶段仅在发布器注册礼包局部JVM叶子检查，不执行应用发版或修改生产数据。应用任务记录为 C:/workspace/hospital-backend/docs/tasks/configurable-compensation-gift-pack-20261113.md。

复用既有工具身份及Surefire完整结果解析，新增独立gift-pack类型，绑定编译所需源码、资源和指定测试。检查包含配置校验、开包、已有固定礼包、后台保存、商城和交易限制。提交阶段由原生门禁运行一次并签名复用，正式发版保留完整后端与生产门禁。

冻结范围：giftPackCheck.js、giftPackCheckInputs.json、changeValidationPolicy.js、changeValidationRunner.js、changeValidationGit.js、独立回归测试、CHANGELOG及本文。预计局部门禁3分钟；完成标准为选择正负例、协议不完整拒绝、失败拒绝、源码漂移失效与无关证据隔离通过，原生提交推送通过。无关.task-tmp文件为既有任务产物，保持原样。

首轮门禁：独立礼包检查4项通过，runner的Git隔离夹具遗漏新策略闭包导致失败。最小修复仅补齐夹具的两个依赖；失效项为依赖该夹具的runner检查，原生门禁复用输入未变检查，其余按签名判定。候选冻结后再次提交，不预跑相同检查。
