# 命令记录

```powershell
node --check scripts/verify-relations-release.mjs
node --check test/relationsReleaseVerifier.test.js
node scripts/verify-relations-release.mjs --help
node --test --test-concurrency=1 test/relationsReleaseVerifier.test.js test/releasePublisherCore.test.js
$env:GIT_OPTIONAL_LOCKS='0'; node --test --test-concurrency=1 test/publisherVersion.test.js
$env:GIT_OPTIONAL_LOCKS='0'; npm test
git diff --check
```

计划结构实跑使用 `createPlan` 读取 `C:\workspace\hospital-backend`，只输出新步骤的 key、执行标记、最终检查标记、超时、相邻步骤和是否使用受控 token 文件参数。没有输出 token 文件内容。

本地 UI 验证在任务目录内启动临时 8789 端口发布控制台，通过应用内浏览器读取 DOM、截图和错误日志。验证完成后关闭页面与临时服务，并删除过程日志。
