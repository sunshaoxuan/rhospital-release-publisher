# 发版插件标准 v1

协议标识：`release-plugin/v1`。本文件是游戏及论坛发版方的现行插件标准，日常操作遵循[发版插件操作手册](../release-plugin-handbook.md)。[JSON Schema](release-plugin-v1.schema.json)和[最小结构示例](release-plugin-v1.example.json)供结构核对。运行时由闭合的 v1 解释器执行语义准入，Schema 未由发布器动态加载，结构可描述的内容不代表执行能力已经授予。

## 1. 职责与交付

| 所有者 | 必须维护的内容 |
| --- | --- |
| 发版方 | 已提交清单、业务检查程序、影响映射、完整输入闭包、业务断言、迁移 SQL、发布影响评估及功能验收证据 |
| 发布器 | 通用协议、候选身份、能力准入、显式上下文、去重、回执、互斥、取消、超时及固定生产安全步骤 |
| 环境维护方 | 受控目标、凭据引用、数据库角色、备份、上传、切换、回滚及现场运行条件 |

新增普通业务检查使用现有能力时，只修改应用清单与程序，无须改动或更新发布器服务。新增通用 runner、协议或阶段适配能力时，双方分别交付兼容候选。禁止在发布器重新登记游戏道具、玩法、Java 类名或业务路径。

游戏清单固定为 `release/publisher/game.json`，论坛为 `release/publisher/forum.json`。检查程序及迁移均在应用仓库。发布器从精确的 40 位 Git 提交对象读取输入；原生门禁把实际暂存树表示为独立候选对象，并在结束时复核 HEAD 和暂存树。交付明确目标、版本、完整候选 SHA、基线和实际差异，清单不嵌入自身 SHA。

插件不能替换固定安全步骤，不能携带凭据、远程目标或内联脚本正文。脚本属于受信任仓库可执行代码；路径和 argv 校验不构成操作系统级安全沙箱。

## 2. 清单字段

根对象必须且只能有以下六个字段：

| 字段 | 约束 |
| --- | --- |
| `apiVersion` | 固定 `release-plugin/v1` |
| `pluginId` | 稳定应用命名空间，例如 `hospital.game` |
| `target` | 与调用方目标一致，现行发布目标为 `game`、`forum` |
| `coverage` | 非空影响映射数组 |
| `units` | 1 至 128 个独立检查单元 |
| `migrations` | 本次正式生产差异涉及的已提交 `.sql` 路径；无迁移填 `[]` |

ID 长度 1 至 100，仅使用小写字母、数字、点和连字符，首字符须为字母或数字。字段和协议值区分大小写，禁止额外字段。

### 2.1 影响映射

每个 `coverage` 项必须有 `paths`、`prefixes`、`units`。前两者分别为精确 Git 文件路径和以 `/` 结尾的目录前缀，至少一个非空；`units` 非空并引用已定义 ID。覆盖路径/前缀不能重复，多个规则命中时取并集，每个单元只选一次。

未知变化立即拒绝，不能推断为无须检查或自动扩大到全产品回归。单元拥有的文档/元数据也须有映射，例如游戏的 `release/release-impact.json` 映射到 producer 合同。检查程序不得借文档分类逃避其真实拥有输入。

没有被单元拥有的根 `AGENTS.md`、`README.md`、`CHANGELOG.md`，以及 `docs/`、`release/evidence/` 内 Markdown/JSON，可交给核心静态文档检查；`docs/evidence/` 内 PNG/JPG/JPEG 可作为静态证据。运行图片必须显式映射，其他路径不能仅凭扩展名认定已被文档门禁接纳。

清单自身变化使用元数据增量选择，必须有明确祖先基线。首次引入选中全部单元；随后按单元定义、覆盖规则差异选择，并选中显式拥有清单的消费者。禁止用覆盖清单自身的总规则触发所有业务检查。当前解释器拒绝直接删除单元，删除或重命名须独立设计原子迁移并先确认通用准入支持。

### 2.2 单元与完整输入

| 字段 | 必需性与含义 |
| --- | --- |
| `id` | 必需；稳定且唯一 |
| `phase` | 必需；见阶段支持表 |
| `requires` | 必需；能力列表，含 `engine-context@1` 及对应 runner 能力 |
| `inputs` | 必需；完整、非空、无重复的已提交文件闭包 |
| `run` | 必需；执行种类、入口/参数、超时及结果协议 |
| `tools`、`images` | 使用 `local-tools@1` 时必需；不用镜像也填 `images: []` |
| `dependencies` | 使用 `node-dependencies@1` 时必需；精确包名 |

输入包含入口、传递导入、测试、资源、配置和实际消费的锁文件。每个 worker 仅获得本单元声明的源码与依赖导出，禁止依赖其他单元偶然带入文件。单元是具有独立成功协议的叶子，不调用其他功能完整验收、递归预检或其他验收器获取摘要。共享检查使用同一 ID 去重；编译、迁移等独立失败域分别签名，避免单项失败重复重检查。

### 2.3 当前阶段与 runner 支持

| 阶段 | 当前边界 |
| --- | --- |
| `source` | 现行游戏接入阶段，执行或复用检查 |
| `artifact` | 共用执行器可消费显式 `artifactRoot`。当前正式 Source 默认新建空产物目录，未提供本次后续构建产物；接入前必须确认受控产物阶段和目录已接线 |
| `pre-deploy`、`post-deploy` | 在生产动作前执行器中保持 `pending`。使用前须完成对应受控阶段接入，不能凭前缀 PASS 宣称这些单元通过 |

| `run.kind` | 专有字段 | `protocol` | 当前支持 |
| --- | --- | --- | --- |
| `node-test` | `entrypoints`，精确测试文件数组 | `tap-v1` | 可用，要求 `node-test@1` |
| `node-module` | `entrypoint`、字符串数组 `args` | `check-result-v1` | 可用，要求 `node-module@1` |
| `maven-test` | `testClasses` | `junit-xml-v1` | 仅结构预留；当前不授予 `maven-test@1`，执行前拒绝 |

`run` 还须有整数 `timeoutSeconds`，范围 1 至 3600。入口必须属于本单元输入。`args` 为字面 argv，最多 64 项，每项最多 4096 字符，无控制字符。Node 测试由核心提供 VM modules、TAP reporter 和文件串行执行。现行 JVM 检查使用应用自有 `node-module` 包装 Maven wrapper，并核对完整 Surefire 结果。

### 2.4 工具、依赖和资源限制

当前能力目录为 `engine-context@1`、`node-test@1`、`node-module@1`、`local-tools@1`、`node-dependencies@1`。声明不等于授予，选中集合的准入先于文档/业务回执读取。

`tools` 是 `node`、`git`、`powershell`、`java`、`python`、`docker`、`cmd` 的非空唯一子集，只列实际消费者。核心构造所选工具 PATH 和 Java/cmd 环境，先做最小可调用检查。未使用工具的变化不使其他单元失效。工具文件可读不能代替实际可启动证明。

非空 `images` 要求 Docker 工具，镜像为明确的本地测试引用。核心绑定本地 Linux daemon 及镜像 ID，创建无凭据 Docker 配置。禁止任意远程 endpoint。

Node 依赖要求输入包含 `package.json`、`package-lock.json`，从显式 `dependencyRoot` 读取已安装且锁文件版本匹配的包。核心递归复制其 `dependencies` 闭包并绑定字节，拒绝链接或版本漂移。

| 资源 | 上限 |
| --- | --- |
| 清单 | 1 MiB |
| 覆盖规则 / 单元 | 1024 / 128 |
| 每单元输入 / 不同导出文件 | 4096 / 16384 |
| 单个拥有文件 / 导出总内容 | 8 MiB / 128 MiB |
| 路径 | 512 字符，仅字母、数字、下划线、点、连字符和 `/`；禁止绝对路径、空段、`.`、`..`、通配符和链接 |
| Node 依赖闭包 | 最多 128 包；每包最多 64 MiB、16384 文件 |

超限应修正实际闭包或独立评估通用能力，禁止截断输入或以全量测试代替准入。

## 3. 显式上下文

程序从核心创建的绝对路径 `RELEASE_CONTEXT_FILE` 读取 `release-context/v1` JSON。worker 字段为 `apiVersion`、`candidateRoot`、`checkRoot`、`artifactRoot`、`target`、`unitId`、`inputDigest`、`environment`、`tools`。当前候选根和检查根须一致。脚本不从临时目录名推导业务，不搜索或导入本机发布器，不修改候选输入。

可信主机配置由应用本地 Git 配置 `release.pluginContextFile` 指向。`--context-file` 和 `RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE` 是显式来源断言，多个来源必须指向同一真实文件；歧义、无效文件、链接或冲突拒绝。配置留在机器受控位置，不提交应用仓库，不含凭据。

配置内容为 `tools` 的绝对工具路径、本地 `dockerHost`、已安装依赖 `dependencyRoot` 及 `environment`。环境仅允许 `SystemRoot`、`TEMP`、`TMP`、`TZ`、`LANG`、`NODE_ENV`、`MAVEN_OPTS`、`MAVEN_ARGS`、`MAVEN_SKIP_RC`。可信文件可用 `null` 清除继承值，最终 worker 只得到准入后的字符串；空值和缺失状态不可擅自互换。

核心清除隐含环境，构造所选工具设置。外部 `NODE_OPTIONS` 不被接纳，核心 bootstrap 自身的设置用于嵌套 Node 传播。TEMP/TMP 和导出目录属于临时位置，相关语义环境、工具及能力绑定回执。业务程序不得自行修补环境掩盖缺少授权。该机制不承诺文件系统或网络强隔离。

## 4. 结果与回执

`node-test` 须有唯一完整 TAP 汇总：`tests=pass>0`，`fail/skipped/cancelled/todo` 全为 0，且无真实 SKIP/TODO 指令或失败项。

`node-module` stdout 只能是一个 JSON 对象，且只能有以下十个字段；诊断写 stderr：

```json
{
  "protocol": "check-result-v1",
  "unitId": "feature.contract",
  "state": "PASS",
  "inputDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "checks": 3,
  "passed": 3,
  "failed": 0,
  "skipped": 0,
  "cancelled": 0,
  "todo": 0
}
```

这只是字段形状，真实 ID/digest 取自上下文，计数来自实际检查，不能照抄签发 PASS。要求安全整数 `checks=passed>0`，其他计数全为 0。非零退出、信号、超时、额外字段、缺失结果或身份不匹配均失败。

回执绑定单元定义、拥有输入、执行内核、相关工具/依赖/语义环境及适用产物。整体清单摘要、候选 SHA 和阶段是审计信息，不能单独使不相关单元失效。HMAC 只用于受信任本地存储，不承诺跨机器移植；禁止复制密钥、改写旧 PASS 或把未签名部分成功伪造为完整结果。工具可调用性始终重新准入。

| 结果 | 证明范围 |
| --- | --- |
| 计划预览 / `DRY_RUN` | 计划或相应只读检查，没有真实完整发布链执行证明 |
| `PREFIX_PASS` | 共用插件执行器的受限前缀，仍须核对 `pending` |
| CLI `release-candidate-validation/v1` | `state=PASS`、`scope=before-production`、`prefixState=PREFIX_PASS`；记录身份和 `selected/executed/reused/pending` |
| `BEFORE_PRODUCTION_PASS` | 正式引擎完成生产前步骤，`productionActions=0` 且记录 `stoppedBefore` |
| 正式生产发布 | 另有生产授权，并完成实际备份、迁移、上传、切换及上线后门禁 |

## 5. 迁移和发布评估

`migrations` 与正式计划从真实生产差异解析的列表必须一致，不能列入全部历史迁移或漏掉本次 SQL。声明不授权执行。数据库相关变化还须更新应用 `release/release-impact.json`：新评估 ID、精确累计运行路径、代码/数据库影响、风险、检查决策及必需检查理由。引用须解析为固定安全步骤或已准入插件单元。

游戏业务运行检查由本次评估 `requiredChecks` 显式声明。游戏资材描述游戏候选产物、逻辑发布类型、迁移和检查。游戏评估和插件使用 Meelok 维护、历史容器清理或灾备镜像轮转步骤 ID 时拒绝准入。发布器通过受控环境配置解析生产源站、网关和凭据引用，负责同机主生产源站的 Meelok 停机与恢复顺序，并保留游戏发布的身份、备份、迁移、切换与恢复安全门禁。

SQL 须版本化、幂等、可验证，满足实际引擎、短期切换/回滚与对象归属要求。保留 `apply-database-migrations`、备份、现场兼容性和最终运行门禁。生产游戏关卡以生产数据库为权威，本地目录和种子不得覆盖已初始化目录。环境细则归 `C:/workspace/rhospital`。

## 6. 最小清单示例

```json
{
  "apiVersion": "release-plugin/v1",
  "pluginId": "example.game",
  "target": "game",
  "coverage": [
    {"paths": ["src/feature.mjs", "src/test/js/feature.test.mjs"], "prefixes": [], "units": ["feature.contract"]}
  ],
  "units": [
    {
      "id": "feature.contract",
      "phase": "source",
      "requires": ["engine-context@1", "node-test@1"],
      "inputs": ["src/feature.mjs", "src/test/js/feature.test.mjs"],
      "run": {"kind": "node-test", "entrypoints": ["src/test/js/feature.test.mjs"], "timeoutSeconds": 60, "protocol": "tap-v1"}
    }
  ],
  "migrations": []
}
```

使用前替换为真实已提交路径并补齐闭包，不能直接作为游戏完整清单。完整实例在 `C:/workspace/hospital-backend/release/publisher/game.json`。

## 7. 生效与维护

以后发版必须遵循本标准和操作手册。普通业务变化在应用更新清单、程序、适用评估和日志；协议或通用能力变化同步维护标准与手册并独立验证兼容性。纯文档整理只做相关静态检查，不修改 Schema、清单、执行器、历史回执或生产状态。

静态实现依据：`src/releasePlugin.js`、`releasePluginContext.js`、`releasePluginRunner.js`、`releasePluginCandidate.js`、`releasePublisherCore.js` 和 `scripts/validate-plugin-candidate.mjs`。历史事故及取舍见[改造任务记录](../tasks/20261117-release-plugin-architecture.md)，历史阶段说明不作为当前操作指令。

## 8. 应用业务发布策略

生产业务声明和程序由精确应用候选的 game-policy.json 拥有，闭合契约、归属、输入及结果身份见[应用发布策略 v1](application-release-policy-v1.md)。普通业务使用既有通用能力只改应用；协议新增能力单独升级发布器。准备工具、候选输入、产物等价与现场安全结论分别保留身份。
