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
- 显示发布器产品版本、运行提交、仓库提交和同步状态

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

## 本地测试

发布器本地验证使用普通 Node 单元测试：

```powershell
npm test
```

该命令串行验证计划生成、状态流转、历史记录、静态资源交付判定和命令文本。串行模式避免 Windows Bash 超时用例争用共享进程资源。执行类测试必须注入内存命令运行器，测试模式会阻止启动真实 PowerShell 发布命令。`npm test` 不执行 Docker build、Docker run、docker save、SCP、SSH、数据库迁移、生产部署或自动回退。镜像制作与上传只属于页面明确启动的正式发布流程。

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

服务名为 `RHospitalReleaseConsole`，显示名为 `RHospital Release Console`。服务由 Windows Service Control Manager 以 `LocalSystem` 自动启动，再枚举本机 Windows 会话，优先使用与安装用户匹配的活动会话令牌创建隐藏的 PowerShell 和 Node 子进程。活动 RDP 会话与物理控制台会话均受支持；同一用户会话断开后仍可用于受控重启。发布操作继续使用当前用户的 GitHub 凭据、SSH 配置和 Docker 配置，运行期间不会创建控制台窗口。

安装过程需要管理员权限，并会在新服务通过 HTTP 健康检查后删除旧的 `RHospital Release Console` 计划任务。服务日志写入：

```text
C:\workspace\rhospital-release-publisher\.service\release-console.log
C:\workspace\rhospital-release-publisher\.service\service-host.log

正式执行任务会在发布器仓库的 `.release-worktrees/<任务ID>` 下创建目标提交的隔离 Git 工作树。源码校验、测试和 Docker 构建只读取该干净工作树，开发目录中的未提交游戏或论坛文件不会进入镜像，也不会阻断已提交版本的发布。任务成功、失败或取消后都会通过 `git worktree remove` 清理隔离目录。计划生成和变更分析继续读取开发仓库及其远端引用。
```

启动脚本会守护 Node 进程，Node 退出后等待 10 秒重新启动。服务宿主监控隐藏 runner，并处理用户会话切换与 Modern Standby 恢复。服务宿主退出时，SCM 会按 5 秒、15 秒、30 秒的间隔重启。

安装脚本会创建 Windows 防火墙入站规则 `RHospital Release Console TCP 8787`，只允许 `LocalSubnet` 访问 `192.168.20.218:8787`，并限定在域和专用网络配置文件。发布控制台包含生产执行能力，不应放行到公网、Tailscale 或 Hyper-V 虚拟网段。

发布器固定使用 8787 端口。若端口已被占用，服务会直接退出并在日志中提示，不会自动改到其他端口，避免页面连接到非预期实例。

## 发布器版本

页面右上角显示发布器自身版本。产品版本来自 `package.json`，运行提交和文件指纹在 Node 进程启动时固定记录；页面每 10 秒重新读取当前仓库提交、工作树状态和运行文件指纹。

版本格式示例：

```text
0.2.0+f6481bb
```

状态含义：

1. `执行环境与仓库一致` 表示运行提交、运行文件指纹和当前仓库完全相同，工作树干净。
2. `仓库已更新，需要重启发布器` 表示当前仓库已经提交了运行文件变化，Node 进程仍在使用启动时加载的旧代码。
3. `仓库存在未提交修改` 表示当前仓库无法对应到可复现的提交版本。
4. `版本状态无法确认` 表示 Git 提交信息不可用。

只读接口 `GET /api/version` 返回产品版本、运行提交、仓库提交、文件指纹、进程号和启动时间。产品版本用于标记发布器功能代次，Git 提交和文件指纹用于判断执行环境差异。

后台每 10 秒检查一次发布器运行版本。仓库出现新的干净提交且当前没有活动发布任务时，Node 进程会以受控退出码结束，由 Windows 服务看门程序在 10 秒后重新加载当前代码。存在活动任务时会等待任务结束，再执行受控重启。版本状态处于 `RESTART_REQUIRED`、`UNCOMMITTED_CHANGES` 或无法确认时，变更分析、计划生成、TAG 写入和正式执行接口全部闭锁，并返回明确的版本状态提示，避免旧进程继续解析新的发布协议。首次升级到包含此监视机制的版本时，需要手动重载一次发布器服务，后续干净提交才会触发自动重载。

## Dry Run

页面默认勾选 `dry run`。普通模式只做以下动作：

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

### 远程前置演练

服务配置 `RELEASE_PUBLISHER_REHEARSAL_GATEWAY_STATIC_CONFIG` 后，页面会启用 `远程前置演练` 复选项。此选项只能与 `dry run` 同时使用，正式执行请求会被拒绝。普通演练清单必须设置 `environment: rehearsal`，声明两台与生产身份不同的前置，并将 `remoteAssetRoot` 限定在 `/tmp/rhospital-release-rehearsal` 下。发布器会真实使用 SSH 和 SCP，先构建 `frontend-assets`，再在每台前置执行对象创建、逐文件完整 SHA-256 校验、删除一个对象确认验证失败、恢复对象、再次校验和临时根目录清理。生产清单会作为对照输入，重复生产主机、端口或域名会闭锁普通演练。

经明确授权后，也可以使用生产双前置做一次临时根目录演练。此时清单必须同时设置 `allowProductionHosts: true` 和 `scope: production-temp-root`，并且两台主机、端口、域名、用户和密钥必须逐项匹配生产清单。脚本仍只接受 `/tmp/rhospital-release-rehearsal`，不会写入生产静态对象根目录，也不会执行 Nginx/OpenResty reload、Compose、Swarm 或镜像池操作。演练会只读检查已加载的 `/assets/` 路由、对象根目录和响应头；已有生产清单时再通过本机 HTTPS 探针确认 HTTP 200、`X-Cache=LOCAL` 与 `X-Asset-Source=gate-object`。演练结束会删除运行目录、上传归档和空的临时根目录。

远程演练不会调用生产 Compose、Swarm、镜像池或生产静态对象目录。演练清单没有配置时，复选项保持禁用，普通 dry run 继续保持完全无远端副作用。隔离前置如果没有可读的 Web 路由会明确标记为跳过，生产主机演练必须通过已加载路由检查；发布器仍会在正式发布的应用切换前逐文件直连验证目标对象。

演练清单的最小结构如下，实际 `host`、SSH 用户、密钥和域名必须来自隔离环境：

```json
{
  "environment": "rehearsal",
  "allowProductionHosts": false,
  "scope": "isolated-frontends",
  "gateways": [
    {"id": "stage-a", "host": "stage-a.example", "username": "tester", "port": "22", "domain": "stage.rhospital.test", "remoteAssetRoot": "/tmp/rhospital-release-rehearsal"},
    {"id": "stage-b", "host": "stage-b.example", "username": "tester", "port": "22", "domain": "stage.rhospital.test", "remoteAssetRoot": "/tmp/rhospital-release-rehearsal"}
  ]
}
```

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
11. 备份生产编排、交易池数据和迁移前完整数据库
12. 执行目标提交新增或修改的数据库迁移
13. 同步替换生产镜像与 `IMAGE_TAG`
14. 执行 Docker Stack 热发布
15. 等待滚动完成并执行最终运行校验

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

每一步都有动作命令和校验命令。正式执行时，带有校验命令的步骤会在动作命令成功后立即执行校验命令；校验命令失败会中断本次发布并写入构造历史。游戏发布先运行完整 Maven 测试，再确认目标提交包含已上线的 SSO 基线。发布器从已经锁定的目标提交读取 Catalog `MARKER_VERSION`，把它作为本次发布的预期版本，并检查构建镜像内的 SSO、同版本 Catalog 迁移和管理员交易池代码。生产编排更新会同时替换 `hospital-backend:<TAG>` 和 `IMAGE_TAG=<TAG>`，并要求 `FORUM_SSO_ENABLED=true`、Secret 路径和 Secret 声明保持完整。最终运行校验会等待 Swarm 更新状态完成，逐个确认运行容器的镜像、`IMAGE_TAG`、SSO 开关、Secret 和健康状态，并要求旧版本运行任务归零。

游戏发布会比较目标提交和最近一次成功游戏发布提交。差异中的 `scripts/migration/*.sql` 属于运行时变更，发布器会从已经锁定的目标提交读取路径，并在统一 CRLF 为 LF 后计算预期 SHA256。所有迁移脚本必须构建进目标镜像 `/app/migrations`，镜像必须包含可完整验证的 `SHA256SUMS`。发布器禁止把本地 Git SQL 正文编码后注入生产机；它会在目标镜像加载后创建不启动的临时容器，从镜像复制迁移包，依次核对镜像清单、目标提交预期 SHA256 和实际脚本 SHA256，再执行迁移。迁移脚本必须包含 `ON_ERROR_STOP`、事务、锁等待上限、语句执行上限和提交后的只读验收查询，并禁止删除表、字段、索引、约束及其他破坏旧版本兼容性的操作。数据删除默认失败关闭；当前仅允许先固化到任务专用临时表、完成重复匹配检查、按日志主键锁行后，再通过临时表中的唯一日志主键删除三类原玩家日志，其他持久表删除和未受控日志删除均会被拒绝。存在迁移时，发布器会在镜像切换前额外执行完整 `hospital` 数据库自定义格式备份，并保存目标镜像 ID、脚本校验和及执行回执。JPA 实体持久化结构发生变化却没有迁移脚本时，计划生成会直接失败。

热滚前设置独立的 `发布前 CheckList 总验收`。该步骤统一确认目标镜像、当前健康服务、备份文件及 SHA256、迁移执行回执和回滚 Compose，所有检查输出 PASS 后才允许修改生产 Compose。热滚开始后的检查失败会先执行只读的自动回滚最小触发复核。只有目标镜像不健康、运行版本不符或仍有旧版本并行运行等明确证据时，任务才进入 `RECOVERING`，自动暂停在售 ADMIN 挂单、恢复发布前 Compose，并等待旧版本重新健康。目标版本仍满足最小健康条件或复核自身异常时，发布器禁止自动回滚，保留目标版本与现场并记录为 `RECOVERY_REQUIRED`。恢复成功记为 `ROLLED_BACK`，恢复本身失败也记为 `RECOVERY_REQUIRED`。

自动恢复中的 ADMIN 挂单暂停 SQL 先编码为 Base64，再通过标准输入交给数据库容器内的 `psql`。该路径避免 Windows PowerShell、SSH 和 Bash 多层命令解析改写 SQL 字符串引号；发布器测试必须解码并核对表名、字段名和枚举值字符串完整。

固定 CheckList 之外，业务仓库通过 `release/release-impact.json` 保存逐次发版影响评估。发布器比较最近一次成功生产发布提交和目标提交，检测游戏或论坛运行路径变化。存在运行变化时，评估文件必须同时更新并使用新的 `assessmentId`，`coveredRuntimePaths` 必须与 Git 差异完全一致。评估还必须说明代码影响、数据库影响、风险等级、现有检查是否足够，并引用发布器已注册的可执行步骤。`databaseImpact` 接受固定分类，也接受 `固定分类: 详细说明`，发布历史会分别保存规范分类和说明。遗漏评估、沿用旧标识、路径覆盖不完整、数据库影响未声明或检查步骤不存在时，发布计划生成直接失败。

游戏发布固定执行 `validate-game-static-delivery-prerequisites`，并至少保留 `test-game-backend`、`verify-game-static-assets-predeploy`、`pre-deploy-checklist`、`final-runtime-check` 和 `verify-game-static-delivery`。正式游戏部署计划还会执行 `verify-relations-release`，该步骤已注册为业务影响评估可引用的检查。论坛构建发布至少保留 `validate-forum-source`、`forum-preflight` 和 `final-runtime-check`，源码门禁包含论坛镜像、搜索迁移和部署配置契约测试。实体、Repository、DAO 或迁移脚本变化时必须声明数据库影响；存在游戏迁移脚本时还必须选择 `apply-database-migrations`。现有步骤无法覆盖新增风险时，应先在本仓库增加可执行检查和测试，再由业务仓库的影响评估引用该步骤。论坛生产 Compose 修改开始后，失败、取消或发布器重启会进入 `RECOVERY_REQUIRED`，保留备份与回滚入口供人工复核。

游戏静态资源采用应用切换前交付：

1. `build-game-static-assets` 从业务仓库 `frontend-assets` Docker 目标生成清单与内容寻址对象。
2. `stage-game-static-assets` 按 `C:\workspace\rhopital\release\game-static-gateways.json` 向 Riven 与 VMISS 增量安装对象，远端逐文件复算完整 SHA-256，保留全部旧对象。需要使用其他受管清单时可设置 `RELEASE_PUBLISHER_GATEWAY_STATIC_CONFIG`。
3. `verify-game-static-assets-predeploy` 直连两台前置，对清单每个 `/assets/**?h=` 地址执行 HTTPS HEAD，全部要求 HTTP 200、`X-Cache=LOCAL` 与 `X-Asset-Source=gate-object`。
4. 上述步骤全部完成后才进入生产 Compose 更新和 Swarm 热滚。任一节点、任一文件或 TLS 检查失败时流程停止。

启用生产双前置远程演练时，演练还会读取两台节点当前加载的 Nginx/OpenResty 配置，确认 `/assets/`、不可变对象根目录和本地响应头规则已经生效；节点已有静态清单时会再从本机 HTTPS 入口抽取一个对象执行 200、`LOCAL` 和 `gate-object` 探针。路由缺失会在演练阶段失败，发布器不会把它当成文件预置成功。

双前置 Nginx 的本地对象优先规则属于一次性基础设施配置，由 `C:\workspace\rhopital` 维护并经过独立生产变更授权安装。以后每次应用发布的资源预置与逐文件验证由本发布器自动完成。

## 游戏静态资源交付验收

`verify-game-static-delivery` 在应用最终运行校验之后执行，使用 Chrome DevTools Protocol 完成以下检查：

1. 分别直连 Riven 与 VMISS 前置，绕过负载均衡随机分配。
2. 每个前置使用本次应用 TAG 和节点名组成独立探针查询参数，第一次产生冷缓存，第二次验证暖缓存。
3. 网页域名必须真实登录并进入 `FirstFloor`，加载状态达到 100%。
4. 全部 `/assets/**` 请求必须零 4xx/5xx、零网络失败并包含 `X-Cache`，暖缓存不得出现 MISS。
5. 冷缓存 MISS 响应体总量不得超过默认 240 MiB 源站预算。预算可以通过 `RHOSPITAL_RELEASE_ORIGIN_BUDGET_BYTES` 调整。
6. Steam 域名使用同一前置独立加载，必须枚举到至少一个 ES 模块，并要求全部 JavaScript 模块成功且包含缓存状态。
7. 游戏页面的浏览器运行时错误、控制台错误和加载器错误均会阻止发布完成。主机名精确匹配 `bam.nr-data.net` 的 New Relic 上报失败会单独计数和保留证据，不参与游戏健康判定；其他第三方或应用错误继续阻止发布。
8. 每个 CDP 请求使用独立硬超时。`Framebuffer Unsupported`、CDP 超时、目标关闭和浏览器进程异常会使用全新 Chrome profile 隔离复测一次。复测会记录失败证据和尝试次数。重复基础设施异常、应用运行错误、资源错误和网络错误继续失败关闭。

登录 token 只从本地受控文件读取。正式发布计划优先把 `release-publisher.config.json` 中 `gameStaticDelivery.authTokenFile` 配置的文件路径作为 `--auth-token-file` 参数显式传给前置检查和发布后验收，避免 Windows 服务用户配置单元未加载时丢失用户级环境变量；独立命令仍可使用 `RHOSPITAL_RELEASE_AUTH_TOKEN_FILE`。文件可以保存原始 token 或 `token=<value>`，脚本不会输出 token。token 必须符合游戏服务签发格式，并在检查时至少保留两小时有效期。缺少文件、格式错误、临近到期、Chrome、前置地址或任一验收证据时检查失败关闭。节点 IP、网页域名和 Steam 域名可分别通过 `RHOSPITAL_RIVEN_GATE_IP`、`RHOSPITAL_VMISS_GATE_IP`、`RHOSPITAL_GAME_HOST` 与 `RHOSPITAL_STEAM_HOST` 覆盖。

正式游戏发布在代码切换、完整 Maven 测试、构建和全部生产动作之前强制执行 `validate-game-static-delivery-prerequisites`。该步骤检查 Node.js、登录 token 文件与有效期、Chrome、两台前置地址、网页域名、Steam 域名和数值限制，并使用正式 Chrome 参数执行离线 WebGL 2 framebuffer 探针。探针输出 renderer、WebGL version、viewport、devicePixelRatio、纹理尺寸和 framebuffer 状态，不访问生产环境。任一条件缺失时发布立即停止，因此环境缺失不会把工作区留在指定提交的 detached HEAD。令牌值不会写入命令、日志或发布历史。CDP 单次超时默认 15 秒，可通过 `RHOSPITAL_RELEASE_CDP_TIMEOUT_MS` 调整；浏览器基础设施隔离复测默认 1 次，可通过 `RHOSPITAL_RELEASE_BROWSER_INFRASTRUCTURE_RETRIES` 调整为非负整数。

查看本地参数说明不会访问生产：

```powershell
node scripts\verify-game-static-delivery.mjs --help
node scripts\verify-game-static-delivery.mjs --app-tag 20260803 --check-prerequisites
```

## 管理员关系图发布验收

`verify-relations-release` 在游戏最终运行校验之后执行，并复用静态交付检查的受控管理员 token 文件、Chrome DevTools Protocol、WebGL 能力探针、双前置 IP 和目标域名。检查分别直连 Riven 与 VMISS，真实打开 `/relations`，不会通过负载均衡随机选择节点。

每个前置依次执行以下检查：

1. 等待关系图页面、3D 图和医院查询控件进入可用状态。debug 全局句柄不可用时读取页面序列化的 dataset 快照；初始加载和刷新都通过实际请求周期、控件状态、dataset 更新和场景同步状态判定完成。刷新快照的更新序号必须晚于成功关系图响应的序号，响应前残留的动画帧或引擎回调不能完成验收。
2. 捕获页面首次 `/api/admin/relations` 响应的克隆载荷，要求返回非空 JSON 图数据，并直接用这份驱动页面渲染的同一响应完成交叉校验，避免 24 小时时间窗自然过期使独立请求产生计数漂移。每个医院节点必须按唯一 `hospitalId` 使用 `hospital:<hospitalId>` 标识，节点类型只允许医院与公会，院长和具名角色不得恢复为独立节点，`DIRECTOR_OF` 与 `HERO_OF` 不得恢复为关系类型或实际连线。初始完整场景的渲染节点、渲染连线、概览逻辑连线和实际几何线段必须分别与该首次响应的 API 总数相等，场景中恰好保留一个批量概览线对象。实际 Sprite 标签数必须等于预期标签数，并且不超过 `120 + 公会节点数 + 1 个主节点`。任一场景证据缺失都会失败关闭。检查还会递归拒绝键名包含 `email` 或值形似邮箱的整图响应内容，相关隔离证据缺失同样失败。
3. 从图数据选择一家至少有一条明确关系且同时具备医院名和院长名的医院，分别按医院名、院长名和搜索响应中的邮箱请求 `/api/admin/relations/hospitals/search`，三种查询均须返回同一医院。检查还确认搜索响应存在邮箱，该邮箱值没有出现在图接口响应中。
4. 从 `DOMContentLoaded` 到图就绪持续观察搜索控件，整个 pending 窗口必须保持禁用；pending 期间点击禁用的查询按钮，要求浏览器没有产生搜索请求、结果或主节点变化。该检查使用与用户操作一致的禁用控件点击，不直接调用表单提交 API。图就绪后通过页面表单提交邮箱查询，结果出现后主节点仍须为空；明确点击对应结果后，所选医院才成为唯一固定节点，`x`、`y`、`z`、`fx`、`fy` 和 `fz` 全部为 `0`。
5. 明确点击结果后，验收会持续等待所选节点、概览对象、聚焦连线、方向箭头和标签全部进入同一份同步快照。逻辑聚焦连线数必须等于所选医院的逻辑关系数，实际精细线对象、方向箭头对象和详情关系条数必须分别与对应逻辑计数相等。随后通过页面控件关闭全部关系类型、启用隐藏孤立节点并点击刷新。刷新 pending 窗口持续观察搜索控件并点击禁用的查询按钮，要求控件始终禁用、没有搜索请求且主节点不变；刷新必须观测到一次成功关系图请求，以及发生在成功响应之后的新 dataset 场景快照。筛选后与刷新后的画布都只保留主医院，概览几何线段、逻辑聚焦关系、实际精细线对象和方向箭头对象全部为零，单个空概览对象、主节点标签、筛选状态和原点固定状态继续保持。
6. 捕获 HTTP 4xx/5xx、网络加载失败、控制台错误、未捕获运行时异常和浏览器错误日志。除现有明确隔离的 New Relic 遥测失败外，任一错误都会使检查失败。

检查日志只输出医院节点数、公会节点数、连线数、匹配数量、查询字段类型和布尔验收结果。失败时额外输出当前 URL、页面就绪状态、关系页文档响应次数、关系图响应次数与状态、网络错误数和运行时错误数，并在页面尚未就绪时停止后续业务断言，避免级联错误遮蔽首个失败原因。管理员 token、医院邮箱和查询值不会写入发布日志或历史。浏览器基础设施错误沿用隔离 profile 重试预算，页面、接口和业务断言失败保持失败关闭。

独立执行命令如下：

```powershell
node scripts\verify-relations-release.mjs --app-tag 20260810 --auth-token-file C:\ProgramData\RHospital\secrets\game-smoke-token.txt
```

包含管理员交易池的游戏发布还会执行以下门禁：

- 部署前通过当前健康容器做只读数据库盘点，并在同一个 PostgreSQL `REPEATABLE READ` 快照中将 Compose、服务、镜像证据以及 `t_backend_upgrade_markers`、`t_toilet_market_listing`、`t_toilet_market_transaction` 导出到 `/opt/1panel/backup/game-release-<UTC>`。
- 镜像上传前反编译 Catalog 升级类，要求镜像中的 `MARKER_VERSION` 与锁定提交中的预期版本完全一致，并确认三个目标字段和四个目标索引的迁移内容已经进入镜像。
- 数据库预检会输出当前版本到预期版本的升级范围；当前版本高于预期版本时阻止降级，当前版本等于预期版本时要求状态已经是 `COMPLETED`。
- 部署后要求 `catalog_item_store_v1` 标记严格等于预期版本且状态为 `COMPLETED`，三个新增字段和四个新增索引全部存在。
- 部署后检查 Catalog 升级日志不存在失败记录，匿名访问 `/admin/tradepool` 必须跳转登录，匿名访问管理员 API 必须被拒绝。
- 生成的旧版回滚命令会先把所有 `ACTIVE` 的 `ADMIN` 挂单改为 `SUSPENDED`，随后恢复发布前 Compose。该回滚命令只记录在流程中，不会自动执行。

点击 `执行流程` 后，服务端会创建一个后台执行任务，页面会轮询任务状态并持续刷新：

- 总进度流程会标出 `执行中`、`已完成` 或 `失败`
- 步骤底色只表示执行状态：待执行为中性色，执行中为浅蓝色，已完成为浅绿色，失败、取消或中断为浅红色；`最终校验` 仅表示步骤类型
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
- 构造历史会同时保存发版影响评估标识、风险等级、数据库影响、CheckList 决策、运行路径和实际选择的检查步骤
- 发布后从当前健康目标容器读取本次发布开始后的完整日志，并设置 20 秒上限。达到上限时，发布器保留并解析已经返回的日志；日志含明确完成标记且没有失败标记时继续匿名访问验收。任务持久化日志保留最近 200 行，单步骤保留最近 80 行，避免大日志阻塞取消和状态查询
- 运行状态栏每秒显示当前步骤、步骤用时、心跳时间和已设置步骤的剩余超时，`CANCELLING` 与 `RECOVERING` 状态继续轮询到最终结果

页面首次加载和重新生成计划时，流程区会显示转圈状态并明确提示“正在生成发布流程”。流程生成后，顶部的“本次计划发布镜像”表示当前输入和选择将要构建、上传及部署的目标镜像；“生产编排当前镜像”来自通过 SSH 读取的生产 `docker-compose.yml`，用于和计划目标区分。发布参数中的“本地发布配置镜像”和“本地发布配置 APP_TAG”来自 IDEA 运行配置。

页面根滚动区固定保留纵向滚动槽。只要页面内容超过当前窗口高度，右侧会持续显示高对比度滚动条，便于确认下方仍有步骤详情或构造历史。

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

Dry run 只在当前页面展示结果，不写入构造历史。`.release-jobs.json` 只持久化仍在执行或正在取消的任务；任务结束后由构造历史保存审计摘要，完整任务日志不会继续堆积在任务文件中。执行中的状态写入按 250 毫秒合并，持久化前会压缩日志行数和单行长度。服务重启时只会把当时仍处于执行状态的任务记录一次 `INTERRUPTED`，已经结束或已经中断的旧任务不会重复生成历史。

## 正式执行

正式编译和远端镜像池写入由页面 `dry run` 勾选状态控制。勾选时只预览，取消勾选后会执行真实动作。

代码来源按两级选择：

- `发布分支`：页面从本地仓库读取分支列表，包含本地分支和 `origin/*` 远端分支
- `发布提交`：选择分支后，页面读取该分支最近提交，默认是 `最新提交`
- `刷新提交`：点击发布提交右侧刷新按钮，发布器会更新 `origin` 远端引用并重新加载当前分支的提交列表；原选择仍存在时会继续保留

执行流程会先显示 Git 状态检查节点，再执行 `git fetch --prune origin`。如果选择 `最新提交`，发布器会切换到所选分支的最新提交；如果选择具体提交，发布器会执行 `git checkout <commit>`，并用 `git merge-base --is-ancestor <commit> <branch>` 校验该提交属于所选分支。

当前发布配置中的 `server-name="SSH178"` 是游戏发布 Docker Server 名称。发布器会优先读取仓库内的 `release-publisher.config.json`，并通过 `releaseTargets` 为游戏与论坛选择各自的生产主机：

```json
{
  "dockerServers": {
    "SSH178": {
      "host": "178.239.117.99",
      "username": "root",
      "port": "22",
      "keyPath": "C:\\workspace\\Secure\\sunsxaws.pem"
    },
    "FORUM_PRD2": {
      "host": "92.113.124.185",
      "username": "root",
      "port": "22",
      "keyPath": "C:\\workspace\\Secure\\sunsxaws.pem"
    }
  },
  "releaseTargets": {
    "game": {"dockerServer": "SSH178"},
    "forum": {"dockerServer": "FORUM_PRD2"}
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

如果本机存在同名 Docker CLI context，发布器也会显示该 context 信息。若需要手工指定 Docker 目标名称，可在页面里修改 `Docker context`，也可以通过目标专用环境变量指定。全局变量用于未配置 `releaseTargets` 的兼容场景：

```powershell
$env:RELEASE_PUBLISHER_DOCKER_CONTEXT='SSH178'
$env:RELEASE_PUBLISHER_GAME_DOCKER_SERVER='SSH178'
$env:RELEASE_PUBLISHER_FORUM_DOCKER_SERVER='FORUM_PRD2'
```

页面会用只读命令解析 Docker CLI context：

```powershell
docker context inspect SSH178
```

如果本机 Docker 没有这个 context，页面会显示 `Docker 未找到 context SSH178`。这只表示 Docker CLI context 不存在。只要发布 Docker Server 能解析到 SSH 主机和密钥，发布器仍可执行镜像上传和热发布。

SSH 热发布默认使用当前发布目标对应的 Docker Server。页面切换目标时会同步刷新该值。如果 SSH 目标不同，可在页面里修改 `SSH 目标`，也可以通过目标专用或全局环境变量指定：

```powershell
$env:RELEASE_PUBLISHER_SSH_TARGET='SSH178'
$env:RELEASE_PUBLISHER_GAME_SSH_TARGET='SSH178'
$env:RELEASE_PUBLISHER_FORUM_SSH_TARGET='FORUM_PRD2'
```

页面会显示 SSH 目标来源。默认来源顺序如下：

1. 页面请求中的显式目标
2. `RELEASE_PUBLISHER_GAME_SSH_TARGET` 或 `RELEASE_PUBLISHER_FORUM_SSH_TARGET`
3. `releaseTargets` 选中的 Docker Server
4. `RELEASE_PUBLISHER_SSH_TARGET`
5. Docker Server 解析结果或本地发布配置文件里的 `server-name`

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

热发布使用 `start-first` 时，新旧任务会在健康观察期内短暂并存。发布器持续核对目标镜像、服务与容器 `IMAGE_TAG`、SSO 开关、Secret、健康副本数和旧镜像运行任务；目标副本全部健康且旧版本运行任务为零时输出 `game_cutover_observation=PASS`，页面立即显示“新版本已生效，安全观察中”并刷新生产镜像。此时仍允许基于致命故障证据回退。普通失败会连续三轮检查Riven、VMISS、发布器直连生产入口、生产主机本地认证业务心跳以及数据库读写探针；只有全部业务心跳失败且数据库读写正常时输出`fatal_rollback_decision=ROLLBACK_CONFIRMED`。任一链路可用、数据库异常、探针信息不足、发布器自身网络异常、用户取消或发布服务重启都保留目标版本并进入`RECOVERY_REQUIRED`。Swarm `update_config.failure_action` 必须为 `pause`，让回退只受发布器证据门禁控制。最终运行校验继续等待 `UpdateStatus=completed`。默认等待上限为1800秒，可通过 `RELEASE_PUBLISHER_ROLLOUT_TIMEOUT_SECONDS` 调整；恢复也使用1800秒默认上限，可通过 `RELEASE_PUBLISHER_ROLLBACK_TIMEOUT_SECONDS` 调整。

最终运行、双前置静态资源和管理员交易池验收全部通过后，发布器定向删除标签 `com.docker.swarm.service.name=hospital_stack_hospital-backend` 且状态为 `Exited` 的历史容器。该步骤不会执行全局 container prune，也不会删除旧镜像。单个容器删除失败输出 `WARNING` 并保留在发布历史中，随后仍复核目标服务镜像、`UpdateStatus=completed`、运行副本数和健康副本数。目标服务复核失败会停止流程。失败、取消、回退和 `RECOVERY_REQUIRED` 路径保留现场，不执行该清理步骤。

发布总览按八个阶段展示，原始检查与日志仍保留在步骤详情中。恢复判断和命令只在真正触发时显示。游戏Docker构建目标会在一次构建中运行完整Maven测试并生成产物，运行镜像与静态资源目标复用该层缓存，避免本机测试完成后再次完整编译。

## 论坛发布

论坛目标不修改游戏 IDEA Run Configuration。TAG 只用于论坛不可变镜像，例如：

```text
rhospital/flarum-sso:2026071501
```

“构建并上传新镜像”用于论坛源码、扩展、初始化脚本或基础镜像发生变化的发布。“复用生产已有镜像”用于重新创建容器、重新加载运行时 Secret、应用 Compose 参数变化或回到某个已经上传的不可变 TAG。复用模式不会重新打包论坛。

论坛源码校验会先确认整个 `integrations/flarum/` 相对发布提交没有内容改动，再从当前 Git for Windows 安装目录解析 Git Bash，直接读取 Git 提交中的 LF 脚本执行 Bash 语法检查。Windows 系统 Bash 与 WSL 入口不会进入发布命令。Windows 工作区的 CRLF 检出格式不会造成误报，任何未提交的论坛镜像内容都会阻止发布。派生镜像直接固定安装 `flarum-lang/chinese-simplified 1.6.0`、`rhospital-search` 和 `rhospital-sso`，镜像校验会确认中文包文件、Composer 锁定版本、搜索迁移与 SSO Secret 边界。

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
- 发布器产品版本、运行提交、仓库提交、文件指纹和重启状态
- 下一个 TAG 建议
- 镜像 TAG 与 `APP_TAG` 联动更新
- Git 变更自动识别、未变化目标拦截和历史提交降级拦截
- 游戏 SSO 最低提交、镜像类、生产开关和 Secret 契约
- 游戏 Maven 测试门禁、交易池镜像内容、数据库备份、Catalog 动态版本双向校验和匿名鉴权契约
- dry run 命令计划
- dry run 不改写真实文件
- dry run 不写入本地构造历史或持久任务文件
- 持久任务文件只保留运行中和取消中的任务
- 正式执行后运行步骤校验命令
- SSH 热发布命令计划
- 论坛目标 TAG、镜像构建、Secret 运行时校验、生产预检、备份、Compose 发布和回滚命令计划
- 论坛 dry run 不修改游戏 IDEA Run Configuration
- 非法 TAG 拦截
