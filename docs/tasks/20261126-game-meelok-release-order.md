# 游戏正式发布与 Meelok 维护顺序

用户要求发布器先停止 Meelok，再发布游戏，游戏稳定后恢复 Meelok。发布器掌握环境维护顺序，游戏资材继续只声明游戏自身事项。本任务仅修改发布器，使用隔离夹具验收。

核对现有计划、稳定验收和中断恢复，复用已实现的 Meelok 快照及恢复协议。验收覆盖正式游戏计划顺序、生产前停止边界、非正式计划、游戏资材越界拒绝，以及失败与取消后安全恢复。先完成静态检查，再交原生门禁执行受影响测试，门禁通过后交付。

本批基线为 `3b4f732`。冻结范围包括 `src/releasePublisherCore.js`、`src/gameMeelokMaintenance.js`、`server.js`、`test/releasePublisherCore.test.js` 和本次更新的手册、协议、变更日志及任务文档。直接消费者为正式游戏计划、生产前验证、发布任务历史及中断处理。原生提交门禁预计选择 documents、publisher-console、publisher-recovery、publisher-plan 和 publisher-source，预计数分钟；通过后核对提交与远端身份。服务未停、游戏结果未知或恢复未确认时不得写成维护成功。

复核采用当前 Sub2API 模型目录。目录无 Claude，使用 `deepseek-flash` 复核停机、回滚、未知状态和测试边界。纳入原备份绑定、停机失败阻断和不确定交接保留三项；发布器沿用既有游戏与 Meelok 健康协议。

首轮原生门禁 documents 通过，publisher-console 因计划仍调用旧通知分类函数失败。修复输入 `src/releasePublisherCore.js` 中步骤投影；复用其他有效输入，重新执行原生 `git commit` 入口，由门禁按输入选择复用及剩余检查。

第二轮 publisher-console、publisher-recovery 通过。publisher-plan 共 155 项，153 项通过，2 项仍断言旧的资源探测和双节点末步。更新这两处断言，并在 `server.js` 持久化中断历史的 Meelok 待恢复标记。原生 `git commit` 重跑受影响的计划、控制台及尚未通过的门禁，恢复组复用该组有效输入证据。

## 运行环境启用

用户已授权将 `842e34ebbad5e96b65a7577fa81fd9a88da4d439` 启用到发布器运行环境。提交和推送五项门禁已通过并核对远端。核对服务空闲后，由原生更新脚本启用精确候选。验收核对运行版本、更新屏障释放、历史保留、空闲状态及同一游戏资材的只读计划顺序。范围为发布器服务更新，游戏与 Meelok 仅用于只读计划复验。

启用结果通过。原生更新输出 `ACQUIRE`、`BARRIER`、`UNBARRIER`、`RELEASE`、`historyPreserved=true` 和 `ACTIVATION_FINISHED`。运行接口回报 `842e34ebbad5e96b65a7577fa81fd9a88da4d439`、`UP_TO_DATE`，Windows 服务为 `Running`，任务队列空闲。

使用原游戏资材候选 `cc535088b12a4ba4305f02fadb352fcb6a697102` 只读生成 37 步正式计划。第 24 步备份，第 25 步暂停 Meelok，第 28 步切换游戏，第 29 步进入新版本观察，第 30 步最终运行检查，第 32 步静态交付验收，第 33 步恢复 Meelok。全部最终检查位于恢复之前。所有步骤均为 pending，现场生产动作执行数为 0。
