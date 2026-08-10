# 管理员关系图发布检查调查报告

## 目标

为游戏正式发布增加可执行检查 `verify-relations-release`，使业务仓库的 `release/release-impact.json` 可以引用它，并在发布后从 Riven 与 VMISS 两台前置真实验收管理员关系图。

## 行为链路

1. `src/releasePublisherCore.js` 将检查注册到游戏已知检查集合，并在正式 Swarm 发布计划的最终运行校验后创建可执行步骤。
2. 发布命令只传递受控 token 文件路径。`scripts/verify-relations-release.mjs` 复用静态交付检查的 token 读取、有效期校验、Chrome、CDP、WebGL 能力探针、双前置地址和域名解析能力。
3. 每个前置使用独立 Chrome profile，直接访问 `https://<game-host>/relations`。
4. 浏览器内读取图接口，从同一医院构造医院名、院长名和邮箱三种查询并调用医院搜索接口。返回给 Node 的结果只保留状态、计数、布尔值和节点 ID。
5. 浏览器从 `DOMContentLoaded` 到图就绪持续取样搜索控件，pending 期间实际提交查询并确认没有搜索请求或主节点变化；图就绪后通过页面表单提交邮箱查询并确认主节点仍为空，再明确点击结果选择医院。刷新阶段再次持续取样并提交查询，确认没有搜索请求、控件提前启用或主节点变化。
6. `window.__relationsGraphDebug.getSnapshot()` 只读提供节点位置、固定节点集合、关系类型集合和渲染计数，发布检查据此完成主节点断言。

## 验证事实

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| `verify-relations-release` 可被游戏影响评估引用 | `src/releasePublisherCore.js` 已知检查注册；`test/releasePublisherCore.test.js` 正向评估测试 | 高 | 只适用于正式游戏部署计划 |
| 正式游戏计划包含可执行最终检查 | `createPlan` 实跑回执显示 `executable=true`、`finalCheck=true`、900 秒超时 | 高 | 未执行生产发布 |
| 检查直连两台前置并使用受控凭据 | `scripts/verify-relations-release.mjs` 与双前置日志脱敏测试 | 高 | 真实生产运行等待该业务版本发布 |
| 图接口任意含 email 的键或邮箱形态值都会失败，搜索接口邮箱存在为正向断言 | `assertRelationsProbe` 与正反单元测试 | 高 | 运行时验证依赖管理员 token 有效 |
| 三字段查询、显式选择、连续 pending 加载门禁和主节点筛选刷新通过真实页面控件执行 | 浏览器交互表达式、网络计数与状态快照断言 | 高 | 本次未对未发布代码执行生产双前置检查 |
| 发布控制台页面无浏览器控制台错误 | 本地 8789 页面检查，错误数为 0 | 高 | 脏工作区保护按设计阻止计划生成，因此没有最终已提交状态截图 |

## 风险与边界

- 检查不会输出 token、邮箱和查询正文。失败日志只包含脱敏原因和计数。
- New Relic `bam.nr-data.net` 遥测失败沿用现有静态交付规则单独计数。其他 HTTP、网络、控制台和运行时错误均阻止检查通过。
- 本次没有访问生产关系图，也没有执行发布动作。双前置真实结果只能在包含关系图搜索功能的目标镜像完成切换后产生。
- 发布器要求自身工作区干净才生成计划。任务明确要求不提交，所以本地 UI 验证只能确认页面加载、脏工作区保护和零控制台错误；步骤排序由计划契约测试和 `createPlan` 实跑验证。
