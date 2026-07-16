# RHospital Release Console

RHospital 发布控制台，用于替代 IDEA 中的 `148.135.9.123` Docker Run Configuration。

## 作用

- 读取开发环境中的 `hospital-backend/.run/148.135.9.123.run.xml`
- 在同一控制台选择“游戏后端”或“论坛”发布目标
- 对比目标提交与游戏、论坛各自最近一次成功生产发布提交，自动识别需要发布的目标
- 支持从分支列表选择发布分支，并从该分支提交列表选择最新提交或指定提交
- 发布提交下拉框旁提供刷新按钮，执行 `git fetch --prune origin` 后重新读取当前分支提交
- 解析当前 `hospital-backend:<TAG>` 和 `APP_TAG`
- 默认把页面 TAG 输入框初始化为建议 `APP_TAG`
- 同步更新本地发布配置中的镜像 TAG 和 `APP_TAG`
- 生成应用编译命令
- 生成 Docker 镜像制作命令
- 使用 `docker save`、`scp`、`docker load` 发布到生产 Docker 镜像池
- 通过 SSH 预览生产端 `hospital-stack/docker-compose.yml` 的 TAG 替换
- 生成进入生产编排目录后执行 `docker stack deploy` 的热发布命令
- 论坛目标可选择构建并上传新镜像，或复用生产镜像池中已有的 `rhospital/flarum-sso:<TAG>`，随后生成 MySQL、data、Compose 和镜像证据备份，再用 Docker Compose 只替换 Flarum 容器
- 默认只执行 dry run
- 记录正式执行历史，并在页面中展示最近执行记录

## 按变更发布

发布器分别维护游戏和论坛的成功生产发布基线。选择分支和提交后，页面会计算运行文件差异：

- `src/main/`、根 `Dockerfile`、`pom.xml`、`entrypoint.sh`、`docker-compose.yml` 和 `newrelic/` 归入游戏镜像。
- `integrations/flarum/` 归入论坛镜像。
- 文档、测试和其他非运行文件不会触发镜像发布。
- 只有一个目标发生变化时，页面自动切换到该目标。
- 游戏和论坛同时变化时，页面标明两个目标，分别执行两条现有发布流水线。完成第一个目标后，重新检测只会保留尚未发布的目标。
- 目标没有运行文件变化时，正式执行会被拒绝。论坛“复用生产已有镜像”保留为明确的运维例外。
- 目标提交早于最近成功生产发布提交或与其分叉时，正式执行会被拒绝，防止误选历史提交降级。
- 选择“最新提交”时，任务创建阶段立即解析并固定完整提交号，后续 fetch 不会改变本次构建内容。

## 启动

默认假设仓库目录结构如下：

```text
C:\workspace\hospital-backend
C:\workspace\rhospital-release-publisher
```

手工启动发布器：

```powershell
cd C:\workspace\rhospital-release-publisher
npm start
```

打开：

```text
http://192.168.20.218:8787
```

如果 `hospital-backend` 在其他位置，启动前指定：

```powershell
$env:RHOSPITAL_PROJECT_ROOT='D:\dev\hospital-backend'
npm start
```

推荐安装为原生 Windows 系统服务，固定监听物理局域网地址 `192.168.20.218:8787`：

```powershell
cd C:\workspace\rhospital-release-publisher
npm run service:install
```

查看系统服务、进程链和 8787 健康状态：

```powershell
npm run service:status
```

移除系统服务：

```powershell
npm run service:uninstall
```

服务名为 `RHospitalReleaseConsole`，显示名为 `RHospital Release Console`。服务由 Windows Service Control Manager 以 `LocalSystem` 自动启动，再通过当前登录用户令牌创建隐藏的 PowerShell 和 Node 子进程。发布操作继续使用当前用户的 GitHub 凭据、SSH 配置和 Docker 配置，运行期间不会创建控制台窗口。

安装过程需要管理员权限，并会在新服务通过 HTTP 健康检查后删除旧的 `RHospital Release Console` 计划任务。服务日志写入：

```text
C:\workspace\rhospital-release-publisher\.service\release-console.log
C:\workspace\rhospital-release-publisher\.service\service-host.log
```

启动脚本会守护 Node 进程，Node 退出后等待 10 秒重新启动。服务宿主监控隐藏 runner，并处理用户会话切换与 Modern Standby 恢复。服务宿主退出时，SCM 会按 5 秒、15 秒、30 秒的间隔重启。

安装脚本会创建 Windows 防火墙入站规则 `RHospital Release Console TCP 8787`，只允许 `LocalSubnet` 访问 `192.168.20.218:8787`，并限定在域和专用网络配置文件。发布控制台包含生产执行能力，不应放行到公网、Tailscale 或 Hyper-V 虚拟网段。

发布器固定使用 8787 端口。若端口已被占用，服务会直接退出并在日志中提示，不会自动改到其他端口，避免页面连接到非预期实例。

## Dry Run

页面默认勾选 `dry run`。此模式只做以下动作：

- 读取配置
- 生成 Git 状态检查、fetch、pull 或 checkout 命令
- 建议 TAG
- 生成命令计划
- 预览配置写入结果
- 不写入构造历史或持久任务文件
- 预览 SSH 更新生产 `docker-compose.yml` 的命令
- 预览 SSH 执行 `docker stack deploy` 的命令
- 在总进度流程中把每一步标记为 `dry run 已校验`

不会执行 Docker build，不会写入生产镜像池，不会登录生产终端，不会修改生产 `docker-compose.yml`。

页面右上角状态显示当前执行模式：

- 勾选 `dry run` 时显示 `dry run 模式`
- 取消勾选 `dry run` 时显示 `正式执行模式`

页面按发布流水线展示：

1. 检查本地代码状态
2. 获取远端代码
3. 更新到分支最新提交或切换到指定提交
4. 读取配置并校验 TAG
5. 更新本地发布配置
6. 编译应用产物
7. 制作 Docker 镜像
8. 发布到目标镜像池
9. 确认 SSH 连接配置
10. 读取生产编排当前镜像和运行版本
11. 备份并同步替换生产镜像与 `IMAGE_TAG`
12. 执行 Docker Stack 热发布
13. 等待滚动完成并执行最终运行校验

论坛目标使用独立流水线。代码发生变化时选择“构建并上传新镜像”：

1. 检查、获取并切换 Git 提交
2. 执行论坛镜像契约测试和初始化脚本语法检查
3. 构建 `rhospital/flarum-sso:<TAG>`
4. 在一次性本地容器中验证 root-only Secret 转存、Flarum 用户读取、PHP 语法和 Composer 安全公告
5. 上传镜像到生产 Docker 主机
6. 只读检查论坛 Compose、Flarum、MySQL、Secret 元数据和磁盘空间
7. 备份论坛 MySQL、`data`、Compose、环境文件、容器和镜像证据，并生成 SHA256 校验和
8. 替换论坛 Compose 镜像 TAG并执行 `docker compose config`
9. 只重建 Flarum 服务，MySQL、网络和持久数据保持不变
10. 校验镜像、Flarum 版本、`rhospital-sso`、Secret 读取、公网 HTTP 和错误日志
11. 记录回滚命令，流程不会自动执行回滚

镜像已经存在于生产 Docker 镜像池时选择“复用生产已有镜像”。该模式只读执行 `docker image inspect` 确认指定 TAG 存在，跳过 Git 更新、Maven、Docker build、镜像运行验证、docker save、SCP 和 docker load，随后继续执行生产预检、备份、Compose 容器替换和最终运行验收。

每一步都有动作命令和校验命令。正式执行时，带有校验命令的步骤会在动作命令成功后立即执行校验命令；校验命令失败会中断本次发布并写入构造历史。游戏发布先运行完整 Maven 测试，再确认目标提交包含已上线的 SSO 基线，并检查构建镜像内的 SSO、Catalog 第 15 版迁移和管理员交易池代码。生产编排更新会同时替换 `hospital-backend:<TAG>` 和 `IMAGE_TAG=<TAG>`，并要求 `FORUM_SSO_ENABLED=true`、Secret 路径和 Secret 声明保持完整。最终运行校验会等待 Swarm 更新状态完成，逐个确认运行容器的镜像、`IMAGE_TAG`、SSO 开关、Secret 和健康状态，并要求旧版本运行任务归零。

包含管理员交易池的游戏发布还会执行以下门禁：

- 部署前通过当前健康容器做只读数据库盘点，并在同一个 PostgreSQL `REPEATABLE READ` 快照中将 Compose、服务、镜像证据以及 `t_backend_upgrade_markers`、`t_toilet_market_listing`、`t_toilet_market_transaction` 导出到 `/opt/1panel/backup/game-release-<UTC>`。
- 镜像上传前反编译 Catalog 升级类，确认第 15 版标记、三个目标字段和四个目标索引的迁移内容已经进入镜像。
- 部署后要求 `catalog_item_store_v1` 标记达到版本 15 且状态为 `COMPLETED`，三个新增字段和四个新增索引全部存在。
- 部署后检查 Catalog 升级日志不存在失败记录，匿名访问 `/admin/tradepool` 必须跳转登录，匿名访问管理员 API 必须被拒绝。
- 生成的旧版回滚命令会先把所有 `ACTIVE` 的 `ADMIN` 挂单改为 `SUSPENDED`，随后恢复发布前 Compose。该回滚命令只记录在流程中，不会自动执行。

点击 `执行流程` 后，服务端会创建一个后台执行任务，页面会轮询任务状态并持续刷新：

- 总进度流程会标出 `执行中`、`已完成` 或 `失败`
- 每个步骤下方的 `本步日志` 会持续追加该步骤的命令输出
- 每个步骤和顶部流程节点都会显示计时，运行中为 `已运行`，结束后为 `用时`
- 每步日志会记录 `[START]`、`[RUN]`、`[DONE]` 或 `ERROR`
- 长命令 10 秒内没有输出时会追加 `[RUNNING] ... 已运行 N 秒`，用于确认构建仍在执行
- Docker 编译和镜像制作固定在本机 Docker 执行，不会在生产 Docker 主机上 build
- 发布镜像时会把本机镜像 `docker save` 成 tar，通过 SSH 上传到生产 Docker 主机后执行 `docker load`
- 执行中可以点击 `取消执行`，发布器会停止当前 PowerShell 进程树并把任务记录为 `CANCELLED`
- 如果服务进程在执行中被停止，下次启动会把本地任务记录中仍处于运行状态的任务标为 `INTERRUPTED`
- 页面轮询刷新不会重置步骤日志滚动位置，手动查看日志中段时不会被拉回第一行
- `汇总执行日志` 默认折叠，仅用于快速查看全部输出
- 命令失败也会写入构造历史，记录已完成节点数和错误摘要
- 构造历史会记录总耗时和最慢步骤，便于对比 Docker build、SSH 和本地 Git 的耗时差异
- 构造历史会记录实际发布提交、提交时间、提交说明、镜像上传目标和每步命令摘要，用于事后审计

页面首次加载时会优先读取配置并渲染总进度流程。分支列表、提交列表和历史记录在流程图出现后继续后台加载，避免 Git 列表查询拖慢首屏流程图。

页面的 `发布参数` 只保留常用发布信息。Docker context、发布 Docker Server、SSH HostName、IdentityFile 等连接解析细节放在 `连接与解析详情` 折叠区，需要排查连接问题时再展开。

页面中的步骤徽标按动作性质区分：

- `本地代码`、`本地配置`、`本地校验`：只影响本机仓库、配置或读取本机状态
- `构建动作`：编译应用产物或制作 Docker 镜像
- `生产动作`：从发布到目标镜像池开始，包含生产编排 TAG 替换和 `docker stack deploy`
- `远端只读校验`、`最终校验`：只读取生产侧状态，不标为生产动作

页面中的 `APP_TAG` 输入框就是本次发布 TAG 的来源。点击 `执行流程` 后，流程会先按当前输入值进入 `更新本地发布配置` 节点：

- dry run 下只预览写入结果，不改真实配置文件
- 正式执行时会写回 `.run/148.135.9.123.run.xml`

TAG 建议规则以当天日期为基础，例如 2026 年 7 月 9 日的基础 TAG 是 `20260709`：

- 如果本地配置和远程已上线 TAG 都早于当天基础 TAG，建议使用 `20260709`
- 如果远程已上线 TAG 已经是 `20260709`，建议使用 `2026070901`
- 如果远程已上线 TAG 是 `2026070901`，建议使用 `2026070902`
- 如果远程已上线 TAG 超过当天基础 TAG，也进入 `20260709nn` 格式，`nn` 从 `01` 开始取最新可用号码

页面首屏先按本地配置给出建议 TAG。随后后台只读 SSH 读取生产 compose 当前 `hospital-backend:<TAG>`，如果你还没有手动修改输入框，页面会自动按远程已上线 TAG 修正建议值并刷新流程图。

页面底部的 `构造历史` 会展示最近执行记录。历史文件保存在发布器本地：

```text
C:\workspace\rhospital-release-publisher\.release-history.json
```

该文件是本地运行记录，已加入 `.gitignore`，不会提交到 Git。

构造历史支持分页、单条删除和清空。删除只影响本地 `.release-history.json`，不会改目标项目代码或生产环境。

Dry run 只在当前页面展示结果，不写入构造历史。`.release-jobs.json` 只持久化仍在执行或正在取消的任务；任务结束后由构造历史保存审计摘要，完整任务日志不会继续堆积在任务文件中。服务重启时只会把当时仍处于执行状态的任务记录一次 `INTERRUPTED`，已经结束或已经中断的旧任务不会重复生成历史。

## 正式执行

正式编译和远端镜像池写入由页面 `dry run` 勾选状态控制。勾选时只预览，取消勾选后会执行真实动作。

代码来源按两级选择：

- `发布分支`：页面从本地仓库读取分支列表，包含本地分支和 `origin/*` 远端分支
- `发布提交`：选择分支后，页面读取该分支最近提交，默认是 `最新提交`
- `刷新提交`：点击发布提交右侧刷新按钮，发布器会更新 `origin` 远端引用并重新加载当前分支的提交列表；原选择仍存在时会继续保留

执行流程会先显示 Git 状态检查节点，再执行 `git fetch --prune origin`。如果选择 `最新提交`，发布器会切换到所选分支的最新提交；如果选择具体提交，发布器会执行 `git checkout <commit>`，并用 `git merge-base --is-ancestor <commit> <branch>` 校验该提交属于所选分支。

当前发布配置中的 `server-name="SSH178"` 是发布 Docker Server 名称。发布器会优先读取仓库内的 `release-publisher.config.json`：

```json
{
  "dockerServers": {
    "SSH178": {
      "host": "178.239.117.99",
      "username": "root",
      "port": "22",
      "keyPath": "C:\\workspace\\Secure\\sunsxaws.pem"
    }
  }
}
```

这个文件只保存连接参数和私钥路径，不保存私钥内容。私钥文件仍应放在本机安全目录中，例如 `C:\workspace\Secure\sunsxaws.pem`。

如果仓库配置文件不存在，发布器才会兜底读取 JetBrains 用户配置：

```text
%APPDATA%\JetBrains\IntelliJIdea2026.1\options\remote-servers.xml
%APPDATA%\JetBrains\IntelliJIdea2026.1\options\sshConfigs.xml
```

如果能解析到发布 Docker Server，镜像上传会使用 `scp` 和 `ssh docker load`。构建始终使用本机 Docker，例如：

```powershell
docker build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702 .
```

如果本机存在同名 Docker CLI context，发布器也会显示该 context 信息。若需要手工指定 Docker 目标名称，可在页面里修改 `Docker context`，也可以通过环境变量指定：

```powershell
$env:RELEASE_PUBLISHER_DOCKER_CONTEXT='SSH178'
```

页面会用只读命令解析 Docker CLI context：

```powershell
docker context inspect SSH178
```

如果本机 Docker 没有这个 context，页面会显示 `Docker 未找到 context SSH178`。这只表示 Docker CLI context 不存在。只要发布 Docker Server 能解析到 SSH 主机和密钥，发布器仍可执行镜像上传和热发布。

SSH 热发布默认也使用 `SSH178` 作为 SSH 目标。如果你的 SSH 目标不同，可在页面里修改 `SSH 目标`，也可以通过环境变量指定：

```powershell
$env:RELEASE_PUBLISHER_SSH_TARGET='SSH178'
```

页面会显示 SSH 目标来源。默认来源顺序如下：

1. `RELEASE_PUBLISHER_SSH_TARGET`
2. `RELEASE_PUBLISHER_DOCKER_CONTEXT`
3. 本地发布配置文件里的 `server-name`

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

论坛生产编排目录默认是：

```text
/opt/1panel/apps/flarum/flarum
```

也可以单独覆盖：

```powershell
$env:RELEASE_PUBLISHER_FORUM_REMOTE_COMPOSE_DIR='/opt/1panel/apps/flarum/flarum'
```

当前 `Dockerfile` 是多阶段构建。第一阶段使用 Maven 编译，第二阶段制作运行镜像。发布器会在本机 Docker 完成构建，再把镜像保存为 tar，通过 SSH 上传到目标 Docker 主机并执行 `docker load`。页面会把它拆成三个独立节点显示。

当 `APP_TAG=2026070702` 时，编译应用产物命令类似：

```powershell
docker build --target build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702-buildcheck .
```

制作 Docker 镜像命令类似：

```powershell
docker build -f Dockerfile --build-arg APP_TAG=2026070702 -t hospital-backend:2026070702 .
```

发布到目标镜像池命令类似：

```powershell
docker save -o $env:TEMP\hospital-backend-2026070702.tar hospital-backend:2026070702
scp -i C:\workspace\Secure\sunsxaws.pem -P 22 $env:TEMP\hospital-backend-2026070702.tar root@178.239.117.99:/tmp/hospital-backend-2026070702.tar
ssh -i C:\workspace\Secure\sunsxaws.pem -p 22 root@178.239.117.99 'docker load -i /tmp/hospital-backend-2026070702.tar && rm -f /tmp/hospital-backend-2026070702.tar'
```

勾选 SSH 热发布计划时，页面会生成 SSH 远端脚本投递命令。命令外层形如：

```powershell
ssh SSH178 'printf %s "<base64-script>" | base64 -d | bash'
```

这样可以避免 Windows PowerShell、本机 OpenSSH 和远端 bash 三层引号转义互相干扰。解码后的远端读取脚本类似：

```bash
set -e
cd /opt/1panel/docker/compose/hospital-stack
grep -nE '^[[:space:]]*image:[[:space:]]*hospital-backend:' docker-compose.yml
```

解码后的远端 TAG 替换脚本会同时更新镜像和运行版本，类似：

```bash
set -e
cd /opt/1panel/docker/compose/hospital-stack
cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)
sed -i -E 's#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\1hospital-backend:2026070702#' docker-compose.yml
sed -i -E 's#^([[:space:]]*-[[:space:]]*IMAGE_TAG=).*$#\12026070702#' docker-compose.yml
grep -nE '^[[:space:]]*image:[[:space:]]*hospital-backend:2026070702$' docker-compose.yml
grep -nE '^[[:space:]]*-[[:space:]]*IMAGE_TAG=2026070702$' docker-compose.yml
docker stack config -c docker-compose.yml >/dev/null
```

解码后的远端热发布脚本类似：

```bash
set -e
cd /opt/1panel/docker/compose/hospital-stack
docker stack deploy -c docker-compose.yml hospital_stack
```

热发布使用 `start-first` 时，新旧任务会在健康观察期内短暂并存。发布器会持续轮询 `UpdateStatus`、目标镜像、服务与容器 `IMAGE_TAG`、SSO 开关、Secret、健康副本数和仍处于运行目标态的旧镜像任务。只有更新状态为 `completed`、目标副本全部通过版本与 SSO 契约且旧版本运行任务为零时，最终节点才会完成。默认等待上限为 900 秒，可在远端通过 `RELEASE_PUBLISHER_ROLLOUT_TIMEOUT_SECONDS` 调整。

## 论坛发布

论坛目标不修改游戏 IDEA Run Configuration。TAG 只用于论坛不可变镜像，例如：

```text
rhospital/flarum-sso:2026071501
```

“构建并上传新镜像”用于论坛源码、扩展、初始化脚本或基础镜像发生变化的发布。“复用生产已有镜像”用于重新创建容器、重新加载运行时 Secret、应用 Compose 参数变化或回到某个已经上传的不可变 TAG。复用模式不会重新打包论坛。

论坛源码校验会先确认整个 `integrations/flarum/` 相对发布提交没有内容改动，再直接读取 Git 提交中的 LF 脚本执行 Bash 语法检查。Windows 工作区的 CRLF 检出格式不会造成误报，任何未提交的论坛镜像内容都会阻止发布。派生镜像直接固定安装 `flarum-lang/chinese-simplified 1.6.0` 和 `rhospital-sso`，镜像校验会确认中文包文件、Composer 锁定版本和 SSO Secret 边界。

本地构建使用：

```powershell
docker build --pull=false -f integrations/flarum/Dockerfile `
  -t rhospital/flarum-sso:2026071501 integrations/flarum
```

正式执行并勾选“执行论坛 Compose 发布”时，发布器会先完成在线备份。备份目录格式为：

```text
/opt/1panel/backup/forum-release-YYYYMMDDTHHMMSSZ
```

备份包含论坛 MySQL 单事务导出、`data` 归档、Compose、环境文件、当前容器和镜像证据以及 `SHA256SUMS`。备份目录路径写入编排目录的 root-only `.last-forum-release-backup`，供生成的回滚命令定位。

论坛容器替换命令为：

```bash
docker compose up -d --no-deps --force-recreate flarum
```

该命令只替换 Flarum 容器。论坛当前为单实例 Compose，切换期间会有短暂连接中断。容器进入 `Running` 后，最终校验还会等待最多 180 秒，直到初始化脚本以 `flarum` 用户完成语言目录预热、Secret 可读、Flarum 与 SSO 扩展可用，并写入运行时就绪标记。发布器只读取该标记，随后检查缓存所有权、公网访问和 `zh-Hans` 资源内容；禁止在验收阶段以 root 运行会生成 Flarum 缓存的 CLI 命令。最终校验失败时，页面会保留恢复上一个 Compose 的回滚命令；MySQL 和 `data` 的完整恢复仍需要人工确认，发布器不会自动执行破坏性恢复。

## 测试

```powershell
npm test
```

测试覆盖：

- 本地发布配置解析
- 发布器仓库 Docker Server 配置解析
- 下一个 TAG 建议
- 镜像 TAG 与 `APP_TAG` 联动更新
- Git 变更自动识别、未变化目标拦截和历史提交降级拦截
- 游戏 SSO 最低提交、镜像类、生产开关和 Secret 契约
- 游戏 Maven 测试门禁、交易池镜像内容、数据库备份、Catalog v15 结构和匿名鉴权契约
- dry run 命令计划
- dry run 不改写真实文件
- dry run 不写入本地构造历史或持久任务文件
- 持久任务文件只保留运行中和取消中的任务
- 正式执行后运行步骤校验命令
- SSH 热发布命令计划
- 论坛目标 TAG、镜像构建、Secret 运行时校验、生产预检、备份、Compose 发布和回滚命令计划
- 论坛 dry run 不修改游戏 IDEA Run Configuration
- 非法 TAG 拦截
