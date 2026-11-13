# 生化交换动效定向检查登记

主任务：C:/workspace/hospital-backend/docs/tasks/resident-exchange-motion-fix-20261113.md。
授权：用户答复“只要不拖慢发版，带坏游戏，都允许”，用于补齐本次三个前端模块的定向检查映射及必要测试。
范围：登记独立Node叶子检查和精确输入，复用现有TAP成功协议、源码身份和提交/推送回执，不改变发布顺序、生产数据、权限或全量后端门禁。
验收：三个运行路径及四个相关测试选择一次本项，文档静态检查、未知路径拒绝、无关特性隔离；拒绝缺项、重复、失败、跳过和源码漂移。静态核对传递依赖，实际运行由原生提交门禁负责，避免重复完整产品检查。预计定向发布器测试数秒，原生门禁按选中范围执行；失败最小修复。
工作区既有其他任务文件完整保留，最终仅提交本次路径。本批无发布器UI修改或生产操作。

冻结路径：src/currentBehaviorInputs.json、src/currentBehaviorChecks.json、src/releasePublisherCore.js、test/changeValidationPolicy.test.js、test/localCheckPolicy.test.js、test/changeValidationRunner.test.js、test/releasePublisherCore.test.js、CHANGELOG.md及本文档。
首轮定向策略/成功协议/叶子去重检查20项PASS。后续增加本项源码漂移和无关档案隔离负例、正式计划登记与独立选择测试，相关验证交原生提交门禁一次执行。传递依赖复核：本项仅导入角色图层、会话、材料成本、轮廓、主题、provider和动画模块；相关测试读取的release-impact.json属于显式输入，不读取历史截图或运行其他功能验收。普通/稀有时序功能验证属于游戏主任务，发布器登记不代替运行视觉验收。
最终矩阵：精确选择与去重PASS；文档静态和未知路径拒绝PASS；成功协议及失败/跳过拒绝PASS；新源码漂移和正式计划用例由原生钩子执行并在提交前阻断失败。提交完成即代表该门禁真实通过，推送复用原签名结果。本次无生产操作。

2026-11-13重验输入：首轮原生门禁在fullGateScope固定21项计数失败（新增后22）。失效输入为test/fullGateScope.test.js及currentBehaviorInputs.json中清理的重复顶层主题路径；依赖当前策略清单的门禁按其身份重验，最小命令为原生git commit，其他有效游戏Node结果与唯一进行中的本地Maven构建继续复用。增加的注册检查不启动游戏构建或数据库任务。冻结清单补入test/fullGateScope.test.js。
