# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 任务未触及生产 | 发布历史显示完成 7/31，失败步骤 `productionAction=false`，此前步骤均非生产动作 | 高 | 依据发布器历史记录 |
| 失败由开发工作区脏文件触发 | 失败日志列出两张妙手仁心图片和 `TopInfoPanel.js` | 高 | 只说明门禁原因 |
| 线上游戏持续正常 | Swarm inspect、service ps 和公网 HTTP 200 | 高 | 未执行登录后完整玩法验收 |
| 隔离工作树排除脏文件 | 真实目标 `7d8aeae7` 的隔离工作树 `git status` 为空，原失败步骤退出码 0 | 高 | 只执行发布源门禁，没有构建或生产发布 |
| 开发改动保持原样 | 验证前后 `git status --short` 完全一致 | 高 | 按路径和状态比较 |
| 任务目录自动清理 | 真实验证输出 `isolated_removed=true` | 高 | 服务异常终止时依赖后续人工或启动清理 |

## 主要文件

1. `C:\workspace\rhospital-release-publisher\src\releaseWorktree.js`
2. `C:\workspace\rhospital-release-publisher\server.js`
3. `C:\workspace\rhospital-release-publisher\test\releaseWorktree.test.js`
4. `C:\workspace\rhospital-release-publisher\.release-history.json`
