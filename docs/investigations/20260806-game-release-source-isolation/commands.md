# 命令记录

```powershell
git status --short
Get-Content .release-history.json -Raw | ConvertFrom-Json
node --check server.js
node --check src/releaseWorktree.js
node --test test/releaseWorktree.test.js
npm test
git worktree add --detach <隔离路径> 7d8aeae72fc00882f317cd29d7266853a5c69de0
# 在隔离工作树执行 validate-game-sso-source 的真实命令
git worktree remove --force <隔离路径>
ssh ... docker service inspect hospital_stack_hospital-backend
Invoke-WebRequest https://rhospital.cc/run/newGame
```

真实隔离工作树续验只执行本地发布源门禁。没有构建、上传、数据库修改、Swarm 更新或生产发布。
