# 菌落实验室运营权限定向门禁

主目标：使已授权的运营任意关测试变更能通过原生 master 提交与推送，在下一次正式发版使用。

本批仅增加六个菌落 Java 文件的显式触发映射、JVM 叶子与其输入及工具身份、协议校验和回归测试。禁止吸收皮肤配置任务或扩大为产品全量。应用独立 master 检出按原生门禁执行一次选中的 Maven 测试；publisher 提交钩子执行新增检查选择、完整协议、缺失/跳过/错误、相关漂移及无关功能隔离测试和直接门禁消费者测试。预计各 3 至 8 分钟，失败只最小修正直接阻断项。用户授权依据为本聊天“推master，下一次发版就要用”。

变更路径：src/bacteriaOperatorCheck.js、src/bacteriaOperatorCheckInputs.json、src/changeValidationPolicy.js、src/changeValidationRunner.js、src/changeValidationGit.js、test/bacteriaOperatorCheck.test.js、CHANGELOG.md、本文。无生产执行或服务重启。最终验收记录实际钩子和推送结果。

## 最终验收

源提交 `0361db0` 的原生 pre-commit：9 个检查全部 PASS，范围为 documents、publisher-bacteria-operator、publisher-skin、publisher-preflight、publisher-policy、publisher-runner、publisher-contract、publisher-leaves、publisher-plan。包括定向选中与重复去重、无关功能隔离、完整 JVM 结果、缺失/跳过/执行错误拒绝、相关源码漂移及原生 staged snapshot/回执复用测试。未执行全产品或全 npm 测试。

原生 pre-push 对同一输入复用 9 个 PASS，没有再次执行；`origin/master` 从 eac67c9 前进到 0361db0。主 Agent 已检查叶子：只调用 Maven 选中测试，Surefire 读取为已有纯解析 helper，不调用皮肤功能验收、迁移或历史截图。新增 helper 复用既有 toolIdentity，含 Java、Python 版本和 Maven 环境身份，不接触认证信息。应用编译源输入绑定与功能触发路径分离。

|要求|证据|判定|
|运营权限变更有显式原生门禁映射|六个触发路径只选择 bacteria-operator，五个具名 Java 测试|PASS|
|跳过和不完整结果不能宣称通过|四个新增测试及直接门禁消费者测试通过|PASS|
|源/工具变化失效，无关功能不牵连|输入签名回执漂移与无关证据测试、原生推送复用|PASS|
|提交推送与边界|0361db0 已经原生钩子推送 master，无服务重启或生产操作|PASS|

本次仅补写最终回执，失效输入为本文，相关检查仅 documents；上述实现和测试证据继续有效。临时 prepare.cjs 在交付清理时移出仓库，其余原有 .task-tmp 与审计文件保留原归属。
