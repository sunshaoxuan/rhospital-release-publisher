# Evidence Index

| Claim | Evidence | Confidence | Limitation |
|---|---|---|---|
| 故障 Compose 会把服务缩容为 0 | 生产 `docker compose config` 的 `deploy.replicas=0` | high | 故障文件已由安全副本保留在生产主机 |
| 运行规格丢失主要 Secret | 当前服务最初仅有 2 个业务 Secret，故障前 inspect 保存 22 个映射 | high | 未记录任何 Secret 内容 |
| 数据库失败由密码未注入引起 | 容器日志 `SCRAM-based authentication, but no password was provided` | high | 日志已过滤敏感内容 |
| 0825 镜像能够运行 | 唯一生产容器镜像为 `hospital-backend:20260825` 且 healthy | high | Swarm 延长观察状态可能继续显示 updating |
| 页面运行版本已同步 | 登录态 `/run/newGame` 返回 HTTP 200，`window.GAME_VERSION` 和页脚版本均为 `20260825` | high | WebGL 场景渲染探针受 framebuffer 失败阻塞 |
| SSH Base64 故障由 CRLF 引起 | PowerShell stdin 在远端产生 CR，真实 OpenSSH 探针修复后返回 PASS | high | 探针只执行无破坏输出命令 |
| 修复后的 Compose 可供下次部署 | `docker compose config` 和 `docker stack config` 均通过 | high | 本次没有再次 Stack deploy |
