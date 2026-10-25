# 证据索引

| 证据 | 路径或对象 | 结论 |
| --- | --- | --- |
| 核心实现 | `src/releasePublisherCore.js` | 计划读取目标提交内容前执行方向门禁 |
| 回归测试 | `test/releasePublisherCore.test.js` | 覆盖游戏分叉 migration 缺失场景、论坛构建分叉和论坛镜像复用 |
| 原失败目标 | `19199bfacee6e172b95b99d834b0e7ecd8c1f435` | 相对生产基线方向为 `diverged` |
| 生产基线 | `72bb8c036248fd0dd4857ae8036cf89a7e94df58` | 来自发布器历史记录 |
| 当前医院主线 | `bd34111dd473b33a118da9b1727368ffad20f1cb` | 方向为 `forward`，22 个运行路径，14 步计划生成成功 |
| 全量测试 | `npm test -- --test-concurrency=1` | 150 项通过，0 项失败 |
| 最终验收 | `docs/investigations/20260820-diverged-release-direction-gate/FINAL_RECEIPT.md` | 所有用户意图通过 |
