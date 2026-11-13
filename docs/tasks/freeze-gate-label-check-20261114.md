# 与非门块类型提示检查登记

目标：hospital-backend的Editor.mjs仅修正维修提示覆盖冻结/色块堆提示，其实际renderQueues行为回归应由已有冻结叶子负责，阻止UNMAPPED_CHANGE并保持局部范围。

本批路径：src/currentBehaviorInputs.json、src/currentBehaviorChecks.json、test/changeValidationPolicy.test.js、CHANGELOG.md及本文档。依赖已提交c69a9aa的HUD映射，全部保留。方法：既有current-bacteria-freeze-editor增加Editor和bacteriaGateLabels.test.mjs输入及测试，既有verify-design-level-packages加入同一测试；不增加新检查key，不修改执行器、其他消费者或生产安全步骤。该测试仅执行实际renderQueues及受控DOM，检查普通、维修、冻结、色块堆、误标拒绝和门点击，无其他功能验收或历史证据读取。

完成标准：Editor及其测试精确选择冻结叶子一次，重复路径去重，无关Resident/Skin/Steam不选中，未知路径仍拒绝，原冻结/队列测试保持，发布入口登记同一测试。预先复核输入、测试、命令及依赖，正式检查由原生提交门禁执行一次，预计一分钟；稳定输入PASS供推送复用。无UI、数据库、部署或全产品检查。

最终复核：准确选择、重复去重、未知输入拒绝与无关功能隔离断言已加入既有测试。原生提交门禁10检查真实PASS，执行器及成功协议未改变；冻结叶子仅增加本批实际消费者和测试，历史证据无前置依赖。应用主指导为C:/workspace/hospital-backend/docs/tasks/bacteria-freeze-editor-20261113.md后续批次，应用运行验收独立负责。

收尾输入变化仅为本段结果记录，已有10检查拥有的策略/源码/测试保持，文档修改由原生门禁执行相关静态检查，其他PASS复用；最终推送核对实际提交和远端身份。没有新增功能验证或全量运行。
