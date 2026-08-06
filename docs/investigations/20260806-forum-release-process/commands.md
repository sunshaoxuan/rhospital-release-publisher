# 命令记录

以下命令均为只读调查或测试。SSH 查询没有输出 Secret 内容。

```powershell
git status --short
git branch --show-current
git log -10 --date=iso --pretty=format:'%h`t%ad`t%s'
```

```powershell
rg -n -i "forum|flarum|release-impact|baseline|validate-forum|preflight|final-runtime" README.md src test server.js
```

```powershell
node -
```

Node 脚本调用 `analyzeReleaseChanges` 和 `createPlan`，目标为 `origin/master` 的 `e7b67154`，论坛模式为 build，包含生产切换步骤。

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=15 -i <key> root@178.239.117.99 <read-only-script>
```

远端脚本读取 Compose 镜像、容器状态、就绪标记、MySQL 版本、ngram 插件、全文索引定义和磁盘空间。

```powershell
Invoke-WebRequest -Uri 'https://bbs.rhospital.cc/' -Method Head -TimeoutSec 20
```

```powershell
npm test
```

```powershell
.\mvnw.cmd -q "-Dtest=ForumFlarumImageAssetTest,ForumDeploymentConfigTest" test
```

```powershell
.\mvnw.cmd -q "-Dtest=ForumSearchMigrationContractTest" test
```
