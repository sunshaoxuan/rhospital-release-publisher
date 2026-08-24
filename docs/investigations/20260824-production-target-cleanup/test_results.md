# 测试结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 完整 Node 测试 | PASS | 154 passed，0 failed，0 skipped |
| 核心成功路径 | PASS | 游戏与论坛目标、镜像、Compose 路径和计划均解析到当前生产 |
| 核心失败路径 | PASS | 缺失映射、未注册服务器、非当前主机、请求目标覆盖和远端镜像覆盖全部失败关闭 |
| 历史 migration | PASS | apply 清理 1040 处；第二次 apply 为 0；测试验证 rollback |
| tracked-file 清扫 | PASS | 三个退役连接标识均为 0 matches |
| 生产现场只读扫描 | PASS | 游戏 Compose、Swarm 环境和论坛 Compose 均为 0 matches |
| API 网络检查 | PASS | 5 个正常端点 HTTP 200，1 个覆盖请求 HTTP 400 |
| 浏览器控制台 | PASS | warning 0，error 0 |
| 游戏 UI | PASS | 10 个流程节点，当前生产镜像读取成功，无目标编辑字段 |
| 论坛 UI | PASS | 7 个流程节点，当前生产镜像读取成功，无目标编辑字段 |
| UI 最终几何 | PASS | 面板内边距 18，按钮底部正间距 54，面板间距 20 |

测试为 dry run、只读生产检查和本地 migration。没有执行真实发布。
