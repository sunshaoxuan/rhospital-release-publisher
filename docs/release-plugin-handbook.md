# 发版插件操作手册

本手册配套[发版插件标准 v1](design/release-plugin-producer-v1.md)，用于游戏和论坛发版方。每次操作明确目标、完整候选 SHA、版本、环境和授权边界。本文命令和请求仅为以后在相应授权下使用的模板；文档整理只做文档检查，不授权测试、构建、服务更新或生产发布。

## 一、交付物

交付应用插件、业务叶子和完整输入声明；提供任务差异与直接消费者、适用发布评估、版本化 SQL、功能/视觉等必要验收、原生门禁证据和产物摘要。任务记录写明有界路径、检查并集、预算、冻结点、最小重跑范围和最终意图矩阵。普通业务变化使用已有能力时，只提交应用修改。

## 二、一次性机器配置

以标准工作区布局为例，先确认可信发布器 CLI、实际可启动工具和锁文件依赖，再配置应用本地 Git：

```powershell
git -C C:/workspace/hospital-backend config --local release.publisherExecutable C:/workspace/rhospital-release-publisher/scripts/validate-plugin-candidate.mjs
git -C C:/workspace/hospital-backend config --local release.pluginContextFile C:/workspace/hospital-backend/.git/release-plugin-context.json
```

第二条是可信文件位置示例，先创建和审阅实际文件。worktree 共用公共 Git 配置，`.git` 可能是文件；公共目录用 `git rev-parse --path-format=absolute --git-common-dir` 查询。配置不提交应用仓库，不含任何生产凭据。

可信文件示意，所有占位路径须换成本机实际路径，未使用工具可省略：

```json
{
  "tools": {
    "node": "C:/approved-tools/node.exe",
    "git": "C:/approved-tools/git.exe",
    "powershell": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "java": "C:/approved-jdk/bin/java.exe",
    "cmd": "C:/Windows/System32/cmd.exe",
    "python": "C:/approved-python/python3.13.exe",
    "docker": "C:/approved-tools/docker.exe"
  },
  "dockerHost": "npipe:////./pipe/dockerDesktopLinuxEngine",
  "dependencyRoot": "C:/workspace/hospital-backend/node_modules",
  "environment": {
    "SystemRoot": "C:/Windows",
    "TEMP": "C:/approved-temp",
    "TMP": "C:/approved-temp",
    "LANG": "C.UTF-8",
    "TZ": null,
    "NODE_ENV": null,
    "MAVEN_OPTS": null,
    "MAVEN_ARGS": null,
    "MAVEN_SKIP_RC": null
  }
}
```

原生门禁使用当前 Node，正式命令可使用配置的 Node 绝对路径，必须核对两入口工具身份一致。其他工具只由实际请求者消费。核心创建无凭据 Docker 配置；工具可启动性由现有准入检查，文件存在不能代替它。不要为了诊断 Python 路径先重跑 Maven。

`--context-file`、`RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE` 和 Git 配置同时存在时必须解析到同一文件。持久配置贯穿原生门禁与服务，避免仅在交互终端注入变量。等待已有验证结束后再修改配置，冻结相关工具及消费者。

## 三、业务修改与冻结

1. 确定任务基线、专用 `codex/<task-slug>` 分支和其他工作保护范围。
2. 追踪业务变化及直接消费者，补必要断言，更新应用映射、完整输入、工具、依赖及迁移声明。
3. 更新适用发布评估和 CHANGELOG。发布评估被单元拥有时也须显式映射。
4. 先核对 JSON、路径/导入、能力、工具、结果字段和选中集合。未知影响先补分析，不扩大到全产品回归。
5. 合批完成全部修改并冻结实际暂存候选、依赖、命令和语义环境。门禁拥有的检查交给原生门禁，不预跑副本。

现行游戏使用 `source`。接入其他阶段或直接 `maven-test` 前核对标准支持表，字段能解析不能证明正式阶段已接线。

## 四、提交、Source、推送

| 阶段 | 基线与职责 |
| --- | --- |
| 原生提交 | 默认实际 HEAD 到精确暂存树，执行或复用相关检查，结束核对暂存输入 |
| 开发 Source | 明确任务祖先基线到精确暂存候选，共用通用执行器 |
| 推送 | 实际远端基线到待推送完整提交，核对真实回执和远端；缺证据即拒绝，不补跑业务检查 |
| 推送后 | 核对远端 master 精确交付 SHA；游戏 `--validate-remote` 当前只做身份核对 |
| 正式 Source | 实际生产基线到冻结发布提交，以累计差异选择并复用匹配证据 |

保留原生钩子，核对 `core.hooksPath=.githooks`。普通 `git commit` 和推送均保持钩子启用。游戏工作区洁净时可用 `scripts/Push-VerifiedMaster.ps1`；有其他活动修改时先保护原工作，不为满足洁净条件清理他人文件。推送后身份核对模板：

先将 `$deliveredCommit` 设置为已交付的真实 40 位 SHA，再执行：

```powershell
node scripts/validate-release-candidate-commit.mjs --validate-remote $deliveredCommit
```

身份核对不重复完整预检。禁止跳过钩子、更改钩子路径、制造回执或改写旧 PASS。

已授权开发 Source 时使用通用 CLI，先将变量替换为真实路径和完整任务基线：

```powershell
& $node $publisherCli --repository-root $applicationRoot --phase source --baseline $taskBaseline --target game --manifest release/publisher/game.json --context-file $trustedContextFile
```

CLI 还支持 `--commit`、`--remote`、`--workspace`、`--receipts`、`--dependencies-root`、`--artifact-root`。`source` 验证暂存树，正式精确提交使用 `release-source`。旧独立预检聚合不能替代当前入口。

## 五、生产动作前验证

仅在已授权发版前验证时执行，包含必要本地构建及现场只读检查；本次文档整理不得启动。确认服务实际版本、能力、空闲状态、可信配置和生产基线。服务更新是独立维护动作，需要相应授权及系统权限。

用 `POST /api/plan` 读取计划，核对候选、版本、必需步骤、唯一迁移集合和首个 `productionAction`。请求模板：

```json
{
  "releaseTarget": "game",
  "appTag": "<本次版本号>",
  "gitBranch": "origin/master",
  "gitCommit": "<冻结的40位提交SHA>",
  "includeStackDeploy": true,
  "dryRun": false,
  "boundary": "before-production"
}
```

替换占位值且计划审阅完成后，才将同一请求交给 `POST /api/execute` 并记录唯一 job。`dryRun=false` 使前缀真实执行，必须保留 `boundary=before-production`。当前游戏首个生产动作通常为 `publish-image`，每次以实际计划核对，不写死目标或绕过步骤。

跟踪原 job，超时报告实际卡点，不并行重启同输入。最终核对 `BEFORE_PRODUCTION_PASS`、`productionActions=0`、实际 `stoppedBefore`、检查 `selected/executed/reused/pending`、取消/失败及隔离树清理。必需单元 pending 不能判为通过。

正式 Source 复用拥有输入匹配的回执。现行游戏 `test-game-backend` 在 scoped Source 通过后只编译打包，不重复测试；镜像、迁移包、现场只读准入和生产门禁保持独立职责。全产品回归仅允许有全局影响证据或明确用户要求。

## 六、生产授权与交付

前缀通过后交付候选、版本、job、计数、产物摘要、风险和待执行步骤。前缀 PASS 不授予生产权限。获得明确生产授权后，按当前正式计划和环境手册执行上传、备份、迁移、切换、回滚保护及上线后验收，重新核对时效条件。离线结果不能替代数据库执行、备份和现场运行。环境记录归 `C:/workspace/rhospital`。

最终意图矩阵逐项核对用户目标及后续纠正，引用真实证据，区分代码推送、局部通过、生产前前缀通过和生产已部署。保留源码、迁移、正式证据及必要归档，清理自身临时资源，保护其他任务与唯一测试环境。

## 七、失败处理

### 游戏发布后的冷备镜像

只有正式游戏发布的全部正常步骤完成后，发布器才执行 GreenCloud 冷备。它读取 A 已完成更新的健康实例镜像 ID，核对发布机上的同名镜像，经严格 SSH 上传归档。B 在现有 staging 锁内核对归档 SHA-256 和载入后的镜像 ID，再以精确仓库标签清理旧版，回读确认本次标签是唯一保留项。只处理 `hospital-backend` 仓库，遇到容器引用时保留旧镜像并报告异常。未标记且归属无法确认的镜像、其他仓库、容器、卷和服务原样保留。

论坛、镜像导出、预演、生产前停止和失败后恢复均不执行冷备。灾备步骤失败时，发布历史显示未验收告警，已完成的游戏发布保持成功，也不会触发回滚。下一次正式发版核对步骤的 `game_disaster_recovery_image=PASS` 回执及 B 容器状态。

### 本次候选的资材身份

首次生成计划前先读取实时生产版本和对应提交，按该基线到目标提交计算本目标运行路径，并将应用影响评估及插件迁移声明收敛到这份差异。旧版本已应用的SQL不得继续作为新候选迁移。资材应同时保存版本、生产基线、候选提交与树、评估标识、插件及发布器版本，禁止沿用其他候选报告。

前链报告和生产执行各自记录实际镜像身份。OCI索引或清单摘要、镜像配置ID、归档SHA256属于不同对象，分别绑定。BuildKit证明变化可能使索引摘要改变；保留前链归档原身份，另存实际上传归档，并逐镜像比较平台、配置与有序层摘要。只有这些输入完全一致时可保留相关业务PASS，不能将新索引冒称旧索引，也不能凭相同tag宣称等价。现场镜像及静态资源门禁仍须执行。

旧服务使用标签时，备份阶段解析唯一同仓库摘要，核对其镜像ID并绑定完整服务快照。上线前检查和恢复检查共用该回执；后续标签、摘要或服务配置变化拒绝。恢复提交固定已复核摘要并携带实时服务版本，拒绝并发冲突，禁止降级为可变标签恢复。当前版本已健康且用户明确保留时不得回滚。

切换确认仅对明确的瞬时SSH断连只读重试一次，沿用原总时限。持续连接未知时保留目标现场并进入恢复复核，不据此判断应用失败，不重新部署。明确运行失败仍须符合原有恢复决策。历史失败保持原记录；后续现场健康证据作为独立记录，不能把未完成的整个任务改写为成功。

| 现象 | 最小处理 |
| --- | --- |
| `UNMAPPED_PLUGIN_CHANGE` | 应用补真实映射和输入，拥有的文档同样覆盖，不在发布器登记业务路径 |
| `PLUGIN_TOOL_NOT_CALLABLE` / 工具缺失 | 核对实际绝对路径、角色和版本，只更新相关配置，保留无关消费者回执 |
| `PLUGIN_CONTEXT_SOURCE_MISMATCH` | 统一持久配置与显式来源，不私补正式入口没有的环境 |
| 能力不支持/未授予 | 核对支持表，确需新通用能力时独立适配，禁止伪造授权 |
| `MISSING_PLUGIN_RECEIPT` / `MISSING_DOCUMENT_RECEIPT` | 回到原生提交或已授权 Source 补对应缺失结果，推送不补测 |
| 结果不完整、失败、取消或超时 | 保留原始失败和有界诊断，修复真实叶子，不把部分成功写成 PASS |
| 输入/依赖/产物漂移 | 记录失效输入、依赖关系、受影响检查、最小重跑命令及可复用结果，只重跑实际消费者 |
| 生产步骤失败 | 停止后续动作，按实际恢复边界处理，前缀缓存不能代替现场恢复证据 |

用现有 `identityParts` 区分定义、输入、内核、工具、依赖、上下文和产物。提交身份单独核对，整体 SHA 变化、写回执和无关文档变化不自动废弃所有业务 PASS。历史证据保留原身份，禁止重绑后声称验证新行为。

今后统一遵循标准与本手册。历史任务及固定提交只作为原范围证据，不成为全部发版通用前置条件。纯文档变更仅做文档静态检查，不为验证规则文字运行产品测试。

## 八、本机发布器服务启用

源码与相关原生门禁完成并交付后，核对服务空闲，使用现有scripts/update-publisher.ps1和已验收的精确CandidateCommit更新。本机管理员执行和日志管道使用PowerShell7；Windows PowerShell5.1在重定向原生stderr时可能将Git普通进度视作终止错误。此类错误先核对服务是否停止、锁是否释放及候选工作树是否实际生成，不盲目重放更新；仅在确认本次未启用目录干净且未被服务引用时清理它。

更新后核对ACQUIRE/BARRIER/UNBARRIER/RELEASE完整、historyPreserved=true、实际运行提交、UP_TO_DATE和空闲。文档回执提交晚于运行候选，二者分别记录；不为启用相同代码重跑测试。发布器服务更新不能触发游戏重新部署、回滚或改写历史失败。

## 九、业务发布策略与准备工具

应用维护 release/publisher/game-policy.json 及声明源文件。策略缺失、文件未声明或协议不支持均在计划前拒绝。规范见[应用发布策略 v1](design/application-release-policy-v1.md)。通过应用 scripts/validation/release/prepare-plugin.mjs 生成或检查业务叶子；--add-node-tests 接收显式ID、tests、timeoutSeconds、extraInputs、dependencies、tools和coverage，--write yes经SDK校验后安装到应用清单。已有单元用--unit检查，--baseline与--candidate进行精确提交离线比对。动态访问文件必须显式列入extraInputs。该工具不会启动生产链、重跑产品全量或更改历史证据。
