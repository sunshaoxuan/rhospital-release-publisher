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
ssh -o BatchMode=yes -o ConnectTimeout=15 -i <key> root@<historical-forum-host-removed> <read-only-script>
```

远端脚本读取 Compose 镜像、容器状态、就绪标记、MySQL 版本、ngram 插件、全文索引定义和磁盘空间。

```powershell
Invoke-WebRequest -Uri 'https://bbs.rhospital.cc/' -Method Head -TimeoutSec 20

# 中文搜索故障复现与验收
docker pull mysql:8.4.9
docker pull mysql:8.4.10
docker run -d --name forum-ngram-849 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.9
docker run -d --name forum-ngram-8410 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.10

# 生产只读索引 token 检查通过 INNODB_FT_INDEX_TABLE 完成
# 修复前验证完整备份目录中的 SHA256SUMS
# 修复使用两条独立 DDL，先 DROP INDEX，再 ADD FULLTEXT INDEX WITH PARSER ngram

Invoke-RestMethod 'https://bbs.rhospital.cc/api/discussions?filter%5Bq%5D=%E8%87%B3%E5%B0%8A%E5%8B%8B%E7%AB%A0'
Invoke-RestMethod 'https://bbs.rhospital.cc/api/discussions?filter%5Bq%5D=%E5%8B%8B%E7%AB%A0'
Invoke-RestMethod 'https://bbs.rhospital.cc/api/discussions?filter%5Bq%5D=%E5%8C%BB%E9%99%A2'
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

修复续验新增：

```powershell
node --check src/releasePublisherCore.js
node --check server.js
node --test --test-concurrency=1 --test-name-pattern="forum|database impact|recovery" test/releasePublisherCore.test.js
```

```powershell
.\mvnw.cmd -q "-Dtest=ForumFlarumImageAssetTest,ForumSearchMigrationContractTest,ForumDeploymentConfigTest" test
```

```powershell
node -
```

Node 续验脚本使用真实发布历史，对当前提交分别调用论坛和游戏 `createPlan`，只输出规范数据库影响、必需检查和步骤键。
