# 普通业务与发布器边界收敛

## 目标与授权

2026-11-18用户要求梳理并修复残留业务耦合、身份契约及插件准备工具，使普通业务只修改应用与插件。复用已有验收，只做必要定向验证，禁止触碰当前线上游戏。本任务仅本地实现、隔离fixture、原生提交推送；不启动游戏发布、生产SSH、迁移、切换、回滚、容器构建或产品全量。

## 批次与基线

发布器基线80a7da398c7799b83f436ac7314494018bc3fa93，分支codex/plugin-boundary-publisher-20261118；应用基线70b93feac166adb362b088f43a8496a5554a918d，分支codex/plugin-boundary-app-20261118。复用两处上一任务已清理的独立工作树，根工作区原未提交任务全部保留。发布器、应用各有对应CHANGELOG和交付身份，本文为主指导。

批次成员：1.逐项盘点发布器里的业务路径、类名、SQL、特定迁移和业务检查，迁移到应用拥有的版本化声明或检查程序；2.统一候选、插件、拥有输入、产物和恢复身份的生产消费契约，阶段之间不自行猜测或混比对象；3.提供可复用的插件准备/预检工具，提前拒绝结果协议、缺失传递依赖、过时生产基线与迁移声明。迁移依赖须按通用消费者先可验收、应用声明随后匹配的顺序，禁止保留长期旧业务fallback。

## 方法与边界

采用engineering-investigation-evidence，先查代码与真实失败证据，列当前所有者、调用者、目标归属和修复路径。高级实现用sub2api-agent取得最小匿名文本建议，主Agent负责设计、代码和验收。先完成最小端到端声明消费，再迁移同契约成员；保留互斥、备份、身份、权限、迁移和现场安全强约束，不把全部生产执行权限交给任意插件。既有协议足以表达的内容不得加发布器业务登记。普通业务增量用合成应用fixture证明可在发布器源码不变时完成准备、选择与隔离执行。

## 完成标准与验证冻结

提交前形成耦合清单和最终归属；每个移除项保留等效真实约束。新增普通业务fixture只改应用插件并通过，缺依赖、错误协议、未知输入、过时基线、身份漂移与无关功能故障隔离负例正确拒绝或隔离；游戏与论坛兼容边界明确。已有匹配PASS复用，受影响消费者按原生门禁取并集，只运行一次。廉价语法/闭包/绑定/计划前检先过，再冻结精确路径、选中检查、预计耗时与停止条件。超过预计先定位原进程，不追加全量。失败只修最小失效输入并记录重跑范围。全部必需项通过后合并推送、核对远端、删除已合并分支和自身临时产物，线上游戏保持原状。

## 初始证据

业务Source插件已使用通用candidate/worker，真实准备遗漏为run-leaf结果协议及SaveTools传递依赖、评估路径和已上线SQL。生产适配仍含gameTechnologyFormatCutover的业务迁移/类名，Core里的Catalog/交易池SQL及业务专用检查，不能仅把文件改名判为解耦。先检查各直接消费者和当前可执行能力，再确定最小正式契约。

## 冻结范围与必要验证

2026-11-18 02:41 UTC本机启用完成：运行3bed315、0.2.0+3bed315d、UP_TO_DATE、busy=false、无job。更新脚本historyPreserved=true及四段锁屏障完整，原服务宿主复制身份检查通过。独立活动GET首次出现本机socket错误，仅补该只读请求并验证busy为布尔false后接受回执；不重放更新。测试重跑0、游戏动作0。后续只有启用文档静态门禁、合并推送和本分支清理。

用户已明确重新授权发起Windows管理员确认。本次仅启用已验收3bed315，本机服务现为441b4b3、UP_TO_DATE、busy=false、无job。复用原验收及固定更新脚本，更新后检查运行候选、空闲、锁屏障释放和历史保留；不重跑产品或发布器测试，不操作线上游戏。通过后仅更新启用回执与日志并执行文档静态门禁。

本机管理员启动被Windows返回用户取消，未创建进程、未产生更新日志，未停止服务。之后GET确认仍运行441b4b3、UP_TO_DATE、busy=false、无job。保留3bed315待启用，不盲目重放管理员请求。应用实际准备CLI已通过：27个候选输入与f4ef7845一致、13拥有文件及3入口闭包完整，基线8eb540a9之后运行差异和迁移均为空。源码与本机启用分别验收，游戏未操作。

最终原生门禁七组通过，计划组159项、恢复31项，source适配组首次执行49.8秒通过。应用三单元通过。发布器3bed315d60dd35707a2a96834f579d553a2bc996及应用f4ef7845238e8f0430a051ded7e3c7ea8a46df00已分别交付origin/master，推送全部复用PASS。为了使本次通用能力实际可用，交付阶段仅用现有受控update-publisher.ps1启用本机发布器，管理员引擎PowerShell7；更新前确认旧服务UP_TO_DATE、busy=false且无job。该本机启用不启动任何游戏作业、生产探测或容器操作，记录实际新版本与历史保留后验收。

plan再次执行154秒，Core130项及策略/读取器全部通过，Chrome生命周期两项集成样例仍从通用host导入已归应用的runValidatedChromeProbe。仅修该测试导入，显式注入相同host到应用黄金fixture；保留清理失败不得重试、证据及原错误身份断言。失效输入仅chromeTargetLifecycle.test.js，当前原生最小拥有单元为publisher-plan，需重新验证该组；其他四组有效结果保持复用，不追加诊断或产品检查。

紧凑诊断完成：Core 130项中127通过、3项失败，均为本次迁移直接影响的测试契约。修正通用precondition错误文案断言；分叉样例提交真实应用策略后再验证方向拒绝；业务webhook断言读取应用规则并保留Core消费者绑定断言。生产代码不变，最小重跑publisher-plan，其他四个有效组继续复用；随后首次执行source。诊断耗时377秒，受影响计划组原预算420秒，后续只跟踪原生门禁，不再新开诊断。

plan组失败，错误摘要被旧源码整串断言占满，完整失败名单丢失。已知为业务源码迁移后断言及模拟提交身份不匹配。仅对失败文件releasePublisherCore.test.js使用紧凑失败reporter取得逐项错误，排除已通过的Node策略、Chrome生命周期及读取器文件；不启动全产品或重复恢复组。诊断结束后只修本批直接受影响fixture并由原生门禁复验；有效policy/runner/console/recovery继续复用。

恢复组31项中30项通过，旧Guild回滚样例未模拟已统一的不可变恢复回执且未设置backup_dir。修复仅test/gameCodegraphCutover.test.js的依赖fixture。console/policy/runner输入未变继续复用；最小重跑publisher-recovery，随后执行尚未运行的plan/source。未改变真实回滚代码和安全阈值。

2026-11-18首次原生提交：documents、publisher-policy、publisher-runner通过；console样例缺少新必需应用策略，尚未执行后续组。仅补齐该测试项目的声明，不改生产代码。同期清除迁出Java源的文件末尾空行，语义不变，尚未通过的拥有输入组用最终字节验证；已通过policy/runner保持复用。最小重跑仍由同一原生提交门禁执行，禁止额外产品检查。

生产边界保持禁止。本批只改发布策略消费、通用Node/浏览器执行、格式与迁移消费者、应用准备工具、对应测试和说明。完整归属矩阵见docs/design/application-release-policy-v1.md。业务Java/Python/SQL与shell迁出保持原约束，测试fixture仅作黄金样例，无运行时fallback。

发布器原生提交选择documents、publisher-policy、publisher-runner、publisher-console、publisher-recovery、publisher-plan、publisher-source，预计6至9分钟。recovery补入直接受影响的fatal/supplemental消费者，plan补入Node策略及Chrome生命周期。应用只选producer、plugin-preparation、runtime-verifiers及文档，预计1至3分钟。不运行npm全套、Maven、Docker、生产探测或新游戏环境。开始正式门禁后冻结代码和暂存区，只跟踪原进程；失败只修失效输入、记录最小重跑。

廉价准备工具预检曾发现自定义requirePublisher被错误当作相对项目require，改为显式SDK加载名称；本次闭包工具只静态追踪相对import与标准require，动态SDK路径和业务读取均须显式声明。既有游戏功能和现场验收保持原身份，无相关输入变化，不重跑。
