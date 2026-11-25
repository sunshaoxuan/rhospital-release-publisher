# 游戏正式发布与 Meelok 维护顺序

用户要求发布器先停止 Meelok，再发布游戏，游戏稳定后恢复 Meelok。发布器掌握环境维护顺序，游戏资材继续只声明游戏自身事项。本任务仅修改发布器，使用隔离夹具验收。

核对现有计划、稳定验收和中断恢复，复用已实现的 Meelok 快照及恢复协议。验收覆盖正式游戏计划顺序、生产前停止边界、非正式计划、游戏资材越界拒绝，以及失败与取消后安全恢复。先完成静态检查，再交原生门禁执行受影响测试，门禁通过后交付。

本批基线为 `3b4f732`。冻结范围包括 `src/releasePublisherCore.js`、`src/gameMeelokMaintenance.js`、`server.js`、`test/releasePublisherCore.test.js` 和本次更新的手册、协议、变更日志及任务文档。直接消费者为正式游戏计划、生产前验证、发布任务历史及中断处理。原生提交门禁预计选择 documents、publisher-console、publisher-recovery、publisher-plan 和 publisher-source，预计数分钟；通过后核对提交与远端身份。服务未停、游戏结果未知或恢复未确认时不得写成维护成功。

复核采用当前 Sub2API 模型目录。目录无 Claude，使用 `deepseek-flash` 复核停机、回滚、未知状态和测试边界。纳入原备份绑定、停机失败阻断和不确定交接保留三项；发布器沿用既有游戏与 Meelok 健康协议。

首轮原生门禁 documents 通过，publisher-console 因计划仍调用旧通知分类函数失败。修复输入 `src/releasePublisherCore.js` 中步骤投影；复用其他有效输入，重新执行原生 `git commit` 入口，由门禁按输入选择复用及剩余检查。

第二轮 publisher-console、publisher-recovery 通过。publisher-plan 共 155 项，153 项通过，2 项仍断言旧的资源探测和双节点末步。更新这两处断言，并在 `server.js` 持久化中断历史的 Meelok 待恢复标记。原生 `git commit` 重跑受影响的计划、控制台及尚未通过的门禁，恢复组复用该组有效输入证据。
