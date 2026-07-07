# rhospital-release-publisher

本地网页版本发布器，用于替代 IDEA 中的 `148.135.9.123` Docker Run Configuration。

## 作用

- 读取开发环境中的 `hospital-backend/.run/148.135.9.123.run.xml`
- 解析当前 `hospital-backend:<TAG>` 和 `APP_TAG`
- 建议下一个 `APP_TAG`
- 同步更新 IDEA 配置中的镜像 TAG 和 `APP_TAG`
- 生成应用编译命令
- 生成 Docker 镜像制作命令
- 使用 Docker context 确认镜像写入生产 Docker 镜像池
- 通过 SSH 预览生产端 `hospital-stack/docker-compose.yml` 的 TAG 替换
- 生成进入生产编排目录后执行 `docker stack deploy` 的热发布命令
- 默认只执行 dry run

## 启动

默认假设仓库目录结构如下：

```text
C:\workspace\hospital-backend
C:\workspace\rhospital-release-publisher
```

启动发布器：

```powershell
cd C:\workspace\rhospital-release-publisher
npm start
```

打开：

```text
http://127.0.0.1:8787
```

如果 `hospital-backend` 在其他位置，启动前指定：

```powershell
$env:RHOSPITAL_PROJECT_ROOT='D:\dev\hospital-backend'
npm start
```

## Dry Run

页面默认勾选 `dry run`。此模式只做以下动作：

- 读取配置
- 建议 TAG
- 生成命令计划
- 预览配置写入结果
- 预览 SSH 更新生产 `docker-compose.yml` 的命令
- 预览 SSH 执行 `docker stack deploy` 的命令
- 在总进度流程中把每一步标记为 `dry run 已校验`

不会执行 Docker build，不会写入生产镜像池，不会登录生产终端，不会修改生产 `docker-compose.yml`。

页面右上角状态显示当前执行模式：

- 勾选 `dry run` 时显示 `dry run 模式`
- 取消勾选 `dry run` 时显示 `正式执行模式` 或 `正式执行未授权`
- `正式执行未授权` 表示页面已切到非 dry run 请求，但服务端没有设置 `RELEASE_PUBLISHER_ALLOW_EXECUTE=true`，会拦截真实编译、上传和发布动作

页面按发布流水线展示：

1. 读取配置并校验 TAG
2. 更新本地 IDEA 发布配置
3. 编译应用产物
4. 制作 Docker 镜像
5. 发布到目标镜像池
6. 确认 SSH 连接配置
7. 读取生产编排当前镜像
8. 备份并替换生产编排 TAG
9. 执行 Docker Stack 热发布
10. 最终运行校验

每一步都有动作命令和校验命令。最终运行校验会检查 stack 服务、任务状态和服务镜像是否指向本次 `hospital-backend:<TAG>`。

## 正式执行

正式编译和远端镜像池写入需要显式打开执行开关：

```powershell
$env:RELEASE_PUBLISHER_ALLOW_EXECUTE='true'
npm start
```

当前 IDEA 配置中的 `server-name="SSH178"` 会作为 Docker context 使用。若本机 Docker context 名称不同，可在页面里修改 `Docker context`，也可以通过环境变量指定：

```powershell
$env:RELEASE_PUBLISHER_DOCKER_CONTEXT='SSH178'
```

SSH 热发布默认也使用 `SSH178` 作为 SSH 目标。如果你的 SSH 目标不同，可在页面里修改 `SSH 目标`，也可以通过环境变量指定：

```powershell
$env:RELEASE_PUBLISHER_SSH_TARGET='SSH178'
```

页面会显示 SSH 目标来源。默认来源顺序如下：

1. `RELEASE_PUBLISHER_SSH_TARGET`
2. `RELEASE_PUBLISHER_DOCKER_CONTEXT`
3. IDEA 配置文件里的 `server-name`

页面还会执行本地只读解析：

```powershell
ssh -G SSH178
```

这个命令只展开本机 SSH 配置，不会登录生产机。页面会显示解析出的 `HostName`、`User`、`Port`、`IdentityFile` 和 `~/.ssh/config` 是否存在。如果没有 `~/.ssh/config`，页面会明确显示该文件不存在，并展示 `ssh -G` 能展开的默认值或系统配置。

生产编排目录默认是：

```text
/opt/1panel/docker/compose/hospital-stack
```

也可以通过环境变量覆盖：

```powershell
$env:RELEASE_PUBLISHER_REMOTE_COMPOSE_DIR='/opt/1panel/docker/compose/hospital-stack'
```

当前 `Dockerfile` 是多阶段构建。第一阶段使用 Maven 编译，第二阶段制作运行镜像。由于 IDEA 配置使用 Docker context，镜像会直接写入该 Docker context 对应的目标 Docker 环境。页面会把它拆成三个独立节点显示。

当 `APP_TAG=2026070702` 时，编译应用产物命令类似：

```powershell
docker --context SSH178 build --target build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702-buildcheck .
```

制作 Docker 镜像命令类似：

```powershell
docker --context SSH178 build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702 .
```

发布到目标镜像池校验命令类似：

```powershell
docker --context SSH178 image inspect hospital-backend:2026070702 --format '{{.Id}} {{.RepoTags}}'
```

勾选 SSH 热发布计划时，会追加远端检查命令：

```powershell
ssh SSH178 'cd /opt/1panel/docker/compose/hospital-stack && grep -nE ''^[[:space:]]*image:[[:space:]]*hospital-backend:'' docker-compose.yml'
```

远端 TAG 替换命令：

```powershell
ssh SSH178 'cd /opt/1panel/docker/compose/hospital-stack && cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d%H%M%S) && sed -i -E "s#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\\1hospital-backend:2026070702#" docker-compose.yml && grep -nE ''^[[:space:]]*image:[[:space:]]*hospital-backend:'' docker-compose.yml'
```

远端热发布命令：

```powershell
ssh SSH178 'cd /opt/1panel/docker/compose/hospital-stack && docker stack deploy -c docker-compose.yml hospital_stack'
```

## 测试

```powershell
npm test
```

测试覆盖：

- IDEA 配置解析
- 下一个 TAG 建议
- 镜像 TAG 与 `APP_TAG` 联动更新
- dry run 命令计划
- dry run 不改写真实文件
- SSH 热发布命令计划
- 非法 TAG 拦截
