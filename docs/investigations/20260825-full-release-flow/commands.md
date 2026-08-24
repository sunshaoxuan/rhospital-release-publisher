# Commands

```powershell
node --test --test-name-pattern "SSH runner streams|PowerShell runner|full-flow acceptance" test/releasePublisherCore.test.js
```

```powershell
node scripts/validate-full-release-flow.mjs --project-root C:\workspace\hospital-backend --game-commit ea21e74d261c563cf202f794176ca8bf8e096a92 --forum-commit e7b67154625f4ec1021c82c01067c14a9c516f47 --game-tag 20260825 --forum-tag 20260806 --output docs\investigations\20260825-full-release-flow\full-flow-acceptance.json
```

完整验收命令执行两轮。第一轮记录论坛 Git Bash 路径失效，并继续执行剩余步骤。修复后的第二轮全部通过。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/status-windows-service.ps1
Invoke-RestMethod -Uri http://192.168.20.218:8787/api/version
```

最终生产只读 SSH 检查了 Swarm 服务镜像、版本索引、更新状态、运行任务、容器健康和 Compose 中的镜像、`IMAGE_TAG`、`HOST_IP`。
