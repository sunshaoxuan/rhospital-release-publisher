# 测试结果

## 聚焦测试

`blocks diverged` 两项用例通过，覆盖游戏和论坛构建计划的分叉门禁。

## 全量测试

第一次全量执行得到 149 项通过和 1 项失败。失败发生在 `publisherVersion.test.js` 的临时 Git 仓库 `index.lock` 竞争。进一步复核确认测试服务器的版本轮询和夹具提交会并发运行，因此测试服务器进程已设置 `GIT_OPTIONAL_LOCKS=0`，只读状态检查不会再刷新和锁定夹具索引。

修正测试夹具后执行项目规定的完整测试：

```text
tests 150
pass 150
fail 0
duration_ms 113778.5342
```

## 真实数据验证

原问题提交返回可操作的分叉诊断，消息中没有 `does not exist`。当前医院主线成功生成 dry run 计划。
