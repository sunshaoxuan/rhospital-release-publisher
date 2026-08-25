# 2026-08-25 游戏生产发布事故调查

## 结论

`hospital-backend:20260825` 镜像能够正常启动。事故由生产 Stack deploy 使用不完整 Compose 重建服务规格引起。故障 Compose 把游戏服务设置为 0 副本，只保留 2 个 Secret，并替换了故障前的生产环境变量集合。服务恢复到 1 副本后依次出现 New Relic Secret 缺失和 PostgreSQL SCRAM 无密码，证明阻塞位于运行规格。

Windows PowerShell 通过真实 OpenSSH stdin 发送 Base64 时附加 CRLF，生产端 `base64 -d` 将 CR 识别为非法输入。这是发布步骤的第二个独立故障。

## 恢复结果

1. 从故障前 `service.inspect.json` 恢复 22 个 Secret 映射和生产环境变量集合。
2. 旧健康镜像恢复为 healthy 后，使用 Swarm `start-first` 切换到 `hospital-backend:20260825`。
3. 同步 `IMAGE_TAG=20260825`，等待新任务 healthy 后关闭旧任务。
4. 重建生产 Compose 为 1 副本、0825 镜像、22 个 Secret 映射和文件型凭据配置。
5. Compose 修改通过 `docker compose config` 与 `docker stack config`，安装后没有再次执行 Stack deploy。

## 发布器修复

1. SSH stdin Base64 在远端移除 CR 和 LF 后解码。
2. 镜像上传前解析生产 Compose，精确验证副本、更新策略、profile、文件型凭据环境和 22 个 Secret 映射。
3. 最终 Prd2 运行合同精确验证同一组 Swarm Secret 映射。

## 安全边界

调查和回执只记录 Secret 名称与目标文件名。Secret 内容、认证信息和明文凭据没有写入仓库。
