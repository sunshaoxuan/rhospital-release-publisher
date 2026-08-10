# 测试结果

## 聚焦测试

- 命令：`node --test --test-concurrency=1 test/relationsReleaseVerifier.test.js test/releasePublisherCore.test.js`
- 结果：87 项通过，0 项失败。
- 覆盖：成功数据、邮箱键和值泄露、邮箱/医院名/院长名查询、查询提交自动选择、初始和刷新 pending 窗口持续取样与受保护提交、搜索响应缺少邮箱、主节点偏移、多个固定节点、刷新丢失、HTTP 错误、网络失败、浏览器运行错误、双前置和日志脱敏、影响评估引用与精确计划顺序。

## 全量测试

- 首次普通 `npm test`：132 项中 131 项通过，1 项失败。失败发生在已有 `publisherVersion` 自动重启测试的临时 Git 仓库，错误为并行 `git status` 与 `git commit` 竞争 `index.lock`。此前一条一秒超时命令遗留并行测试进程，放大了该竞争。
- 单独复测：设置 Git 官方的 `GIT_OPTIONAL_LOCKS=0` 后，`publisherVersion.test.js` 9 项全部通过。
- 最终命令：`$env:GIT_OPTIONAL_LOCKS='0'; npm test`
- 最终结果：134 项通过，0 项失败，0 项跳过。
- 说明：该环境变量只关闭 `git status` 的可选索引刷新锁，不改变被测发布逻辑、断言或测试集合。

## 浏览器检查

- 本地发布控制台 HTTP 200，页面标题为 `RHospital 发布控制台`。
- 浏览器错误日志 0 条。
- 页面结构和当前样式正常显示。
- 截图：`docs/evidence/relations-release-check-20260810/release-console-dirty-guard.png`。
- 发布器检测到自身未提交运行代码后按设计锁定计划生成，因此该轮截图记录页面加载和脏工作区保护。新步骤归入全链路观察阶段及其精确顺序由源代码契约测试覆盖，最终提交后再执行正式 dry-run。

## 生产检查

未执行。当前生产版本尚未包含本次医院查询与主节点功能，直接运行会验证旧版本并产生无效失败。正式发布计划会在目标版本切换、最终运行校验和静态交付检查之后执行该步骤。
