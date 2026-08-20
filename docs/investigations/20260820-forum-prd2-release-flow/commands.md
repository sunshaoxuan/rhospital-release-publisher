# 命令记录

本次使用以下类别的命令：

```text
git fetch --prune origin
git diff <forum-baseline>..<target> -- integrations/flarum
git show <target>:release/release-impact.json
GET /api/version
GET /api/config?releaseTarget=forum
GET /api/remote-tag?releaseTarget=forum
POST /api/plan
POST /api/execute with dryRun=true
GET /api/jobs/1787206437715-4247502f72bcd8
ssh root@92.113.124.185 <read-only preflight and runtime checks>
git worktree add --detach <temporary-path> d2fd6f03
mvnw -Dtest=ForumFlarumImageAssetTest,ForumSearchMigrationContractTest,ForumDeploymentConfigTest test
bash -n for 04-rhospital-secret.sh and 05-rhospital-env.sh
docker version
docker manifest inspect <pinned-base-image>
npm test
```

生产备份、Compose 写入、镜像上传和容器替换命令均未执行。
