# rhospital-release-publisher

本地网页版本发布器，用于替代 IDEA 中的 `148.135.9.123` Docker Run Configuration。

## 作用

- 读取开发环境中的 `hospital-backend/.run/148.135.9.123.run.xml`
- 解析当前 `hospital-backend:<TAG>` 和 `APP_TAG`
- 建议下一个 `APP_TAG`
- 同步更新 IDEA 配置中的镜像 TAG 和 `APP_TAG`
- 生成 Docker 镜像编译命令
- 使用 Docker context 将镜像写入生产 Docker 镜像池
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

不会执行 Docker build，不会写入生产镜像池，不会登录生产终端，不会修改生产 `docker-compose.yml`。

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

生产编排目录默认是：

```text
/opt/1panel/docker/compose/hospital-stack
```

也可以通过环境变量覆盖：

```powershell
$env:RELEASE_PUBLISHER_REMOTE_COMPOSE_DIR='/opt/1panel/docker/compose/hospital-stack'
```

当 `APP_TAG=2026070702` 时，核心命令类似：

```powershell
docker --context SSH178 build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702 .
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
