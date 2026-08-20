# 调查与验证命令

以下命令均在发布器隔离工作树中执行，只读取真实医院仓库和本地发布历史，不执行生产发布。

## 聚焦回归

```powershell
node --test --test-concurrency=1 --test-name-pattern="blocks diverged" test/releasePublisherCore.test.js
```

## 全量测试

```powershell
npm test
```

## 真实分叉历史重放

调用 `analyzeReleaseChanges` 分析分支 `origin/design/premonition-market` 的提交 `19199bfacee6e172b95b99d834b0e7ecd8c1f435`，再把分析结果传入 `createPlan`。历史文件使用发布器真实 `.release-history.json`。

预期并实际得到：

```text
direction=diverged
error=游戏目标提交与当前生产基线分叉，无法直接发布；请选择生产基线的后续提交
```

## 当前主线计划验证

调用相同入口分析医院 `origin/master` 最新提交并生成 dry run 计划。

实际得到：

```text
target=bd34111dd473b33a118da9b1727368ffad20f1cb
direction=forward
changedPaths=22
plan=created
steps=14
```
