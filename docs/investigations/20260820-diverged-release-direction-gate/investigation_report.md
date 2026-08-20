# 分叉发布目标提前门禁调查报告

## 问题

选择预测市场分支提交 `19199bfacee6e172b95b99d834b0e7ecd8c1f435` 生成游戏发布计划时，发布器报错：

```text
fatal: path 'scripts/migration/20260813_add_toilet_preference_penalties.sql' does not exist in '19199bfacee6e172b95b99d834b0e7ecd8c1f435'
```

生产发布基线是 `72bb8c036248fd0dd4857ae8036cf89a7e94df58`。目标提交和生产基线处于分叉关系。

## 根因

`/api/plan` 会先生成变化分析，再调用 `createPlan`。原实现进入 `createPlan` 后先读取 Catalog、变化列表中的 migration 和发版影响评估。分叉方向只在正式执行前通过 `assertReleaseTargetChanged` 检查。

变化列表来自生产基线到目标提交的 Git diff，其中包含生产基线一侧新增、目标一侧不存在的 migration。发布器随后对目标提交执行 `git show <target>:<migration>`，因此底层 Git 文件缺失错误先于方向诊断出现。

## 修复

游戏计划和论坛构建计划在读取目标提交内容前统一调用提交方向门禁：

1. 目标早于生产基线时，明确阻止降级发布。
2. 目标与生产基线分叉时，明确提示选择生产基线的后续提交。
3. 论坛复用生产镜像继续允许，因为该模式不会构建目标源码镜像。
4. 正式执行继续复用相同方向判断，计划预览和执行保持一致。

## 影响范围

检查了游戏计划、游戏执行、论坛构建计划、论坛复用生产镜像、Catalog 读取、migration 解析和发版影响评估。修改只影响发布目标方向检查顺序和错误信息，没有修改生产应用、数据库或部署步骤。

## 结论

真实分叉提交重放得到方向错误，不再得到 migration 文件缺失错误。当前医院 `origin/master` 仍被识别为向前发布，发布计划正常生成。
