# 最终验收回执

| 用户意图 | 最终证据 | 结果 |
|---|---|---|
| 新检查可由业务 release-impact 引用 | 已知检查注册和正向影响评估计划测试 | PASS |
| 新检查进入正式游戏计划 | `createPlan` 实跑，新步骤位于静态交付后、交易池检查前 | PASS |
| 最终验证顺序固定 | 契约测试要求最终运行、静态交付、关系图、交易池、清理依次执行 | PASS |
| 复用受控 auth token | 发布命令仅传 token 文件路径，运行测试确认日志不含 token | PASS |
| 使用 CDP 和双前置 | 每个配置前置启动独立 Chrome profile，测试确认 Riven 与 VMISS 均执行 | PASS |
| 实际访问 `/relations` | 生产检查实现通过 Page.navigate 打开该路由并等待 3D 图与查询控件就绪 | PASS |
| 医院搜索 API 的三种字段均可定位医院 | 同一医院分别按邮箱、医院名和院长名查询，均要求匹配同一 nodeId | PASS |
| 查询结果必须明确点击后才成为主节点 | 页面表单提交邮箱查询，结果出现后主节点仍为空；点击对应结果后才选择 | PASS |
| 搜索与图加载状态一致 | 初始加载和刷新完整 pending 窗口持续取样，实际提交查询仍无搜索请求、结果或主节点变化，图就绪后才可用 | PASS |
| 搜索响应含邮箱，图响应不含任何邮箱 | 图中任意含 email 的键、任意邮箱形态值及选中医院实际邮箱值均失败关闭 | PASS |
| 所选医院是唯一原点主节点 | x/y/z/fx/fy/fz 全零且 fixedNodeIds 只有主节点 | PASS |
| 全关关系、隐藏孤立、刷新后保持 | 页面按钮和复选框真实交互，刷新前后快照失败关闭 | PASS |
| 捕获 console/runtime/network 错误 | CDP Network、Runtime、Log 监听与失败测试 | PASS |
| 不泄露 token 和邮箱 | Node 返回值与日志仅包含计数、状态、节点 ID 和布尔结果 | PASS |
| 补成功和失败单测 | 关系检查 7 项、聚焦 87 项、全量 134 项全部通过 | PASS |
| README 和变更记录完整 | `README.md`、`CHANGELOG.md` | PASS |
| 发布控制台页面检查 | 本地 HTTP 200、浏览器错误数 0、`release-console-dirty-guard.png` | PASS |

最终结果：PASS。

限制：生产双前置真实回执将在目标版本正式发布时由本检查生成。本次没有执行生产访问或发布动作。
