# 测试结果

| 测试 | 结果 | 说明 |
|---|---|---|
| Node 语法检查 | PASS | `server.js` 与 `releaseWorktree.js` |
| 隔离工作树聚焦测试 | PASS | 2 项通过，覆盖脏开发文件隔离、清理、任务 ID 和提交号校验 |
| 发布器完整测试 | PASS | 122 项通过，失败 0 |
| 真实脏工作区门禁续验 | PASS | 目标 `7d8aeae7`，隔离状态为空，原失败步骤退出码 0 |
| 开发工作区保护 | PASS | 验证前后 8 项修改与未跟踪文件状态一致 |
| 隔离目录清理 | PASS | `isolated_removed=true` |
| 生产动作 | NOT RUN | 本次验证没有执行生产动作 |
| 服务接口 dry run | PASS | 任务状态 `DRY_RUN`，31 步计划生成，隔离路径清空且目录不存在 |

完整测试在一次运行中遇到既有 `publisherVersion` 测试清理 Windows 临时目录时的 `EBUSY`，相同代码立即完整重跑后 122 项全部通过。该临时目录锁与发布工作树实现无关。

## 第二次任务修复续验

| 测试 | 结果 | 说明 |
|---|---|---|
| 失败任务范围 | PASS | 8/31，失败步骤非生产动作，已完成生产动作 0 |
| 广告牌源码核对 | PASS | 点击锁、await 刷新和 finally 解锁均存在 |
| 换行符根因 | PASS | Git 系统配置 `core.autocrlf=true`，测试原先没有归一化 CRLF |
| 阶段顺序契约 | PASS | `save-run-config` 已归入构建阶段，发布器完整测试覆盖分组顺序 |
| 游戏聚焦测试 | PASS | `BillboardConcurrencyUiContractTest` 1 项通过 |
| 游戏完整测试 | PASS | 干净工作树 Maven 919 项通过，失败 0，跳过 2 |
| 真实 Docker 构建 | PASS | 与失败任务相同的 `docker build --target build` 成功，容器内 919 项测试通过 |
| 发布器重启稳定性 | PASS | `publisherVersion` 聚焦测试连续两轮通过 |
| 发布器完整测试 | PASS | 123 项通过，失败 0 |
| 浏览器阶段分组 | PASS | 运行版本 `7591c3ad`，准备发布源 8 项，批量测试与构建 5 项 |
| 浏览器控制台 | PASS | error/warning 0 |
| 浏览器截图 | INCOMPLETE | 页面 DOM 与控制台读取成功，CDP 截图连续两次超时，未取得新截图证据 |
