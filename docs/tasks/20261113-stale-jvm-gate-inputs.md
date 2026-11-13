# 过期 JVM 门禁清单修复

主目标：修复阻断菌落补充机会后重入修复交付的过期清单，验证后将发布器和应用修复分别提交推送master。应用主指导记录为C:/workspace/hospital-backend/docs/tasks/bacteria-reentry-fix-20261113.md。

授权：用户本次明确要求修复过期门禁清单、验证、提交与推送master，包含两仓库必要代码交付。生产发布、服务重启、部署状态和运营数据不在范围。

## 批次与冻结

1. 核对bacteriaOperatorCheckInputs、skinAdminCheckInputs、giftPackCheckInputs引用的已删除ResidentRewardPolicyConfiguration源码/测试与当前替代依赖。
2. 修改最小相关清单及定向测试，保留缺失输入、缺失测试结果、失败、跳过、陈旧报告和未知路径的拒绝行为。配置测试类仍然存在，现调用SkinPolicyService数据库策略，保留其输入和必跑选择。
3. 同步CHANGELOG，由原生提交门禁执行影响并集。预计2至5分钟，仅跟踪原运行；通过后提交推送，应用使用已提交的新策略完成原生门禁。

直接消费者：changeValidationPolicy选择、changeValidationGit精确暂存快照导出、changeValidationRunner身份及签名回执、三个JVM叶子的测试选择。检查：JSON/路径/依赖闭包静态核对，策略选择与缺失输入正反例及三个叶子的既有协议/隔离测试。具体测试由现有原生门禁选择并去重，不预跑重复测试。出现直接阻断时最小修复，独立问题单列。

初始发布器分支master，HEAD=9bdb4ca；已存在大量.task-tmp过程文件及20261025审计文档，均归其他任务，不纳入本批。

## 完成标准

选定清单可完整导出当前源码；移除的历史运行配置类不再作为触发或编译输入；当前数据库配置实现及原有测试保持绑定。明确成功和拒绝例通过；两仓库原生门禁通过，实际提交存在于各自origin/master。最终复核保留正式后端、数据库与生产现场发布门禁，不执行部署。

## 实施与廉价前检

实际缺口：菌落输入包含1个已删除源码，遗漏16个当前Java源码/测试；皮肤触发列表包含同一已删除源码，编译输入遗漏3个礼包Java文件；礼包清单全部存在且Java闭包完整，保持原样。已移除两个过期引用、补齐闭包。ResidentRewardPolicyConfigurationTest真实文件仍存在且验证数据库策略，完整保留。未增加执行类集合，未改变验证协议、回执、触发优先级或缺失输入阻断。

使用当前应用git ls-files的src/main/java和src/test/java逐项核对三个清单，无缺失、遗漏或重复，PASS。两份测试node --check及git diff --check通过。新增正反例由原生提交门禁执行，覆盖现代依赖绑定、过期运行源码拒绝、保留数据库配置测试及编译输入不扩大测试集合。原有失败/跳过/陈旧/丢失报告和回执漂移测试保持。

最终冻结为两份JSON清单、两份既有测试、本任务及CHANGELOG共6个文件。原生门禁依当前策略选取publisher-bacteria-operator、publisher-skin、相关策略/runner/contract/leaves/plan及文档检查；其共享测试由现有门禁执行，不另开全量。

## 最终候选复核

原生精确暂存门禁退出0：CHANGE_GATE_PASS phase=commit paths=6 checks=10。documents、publisher-gift-pack、publisher-bacteria-operator、publisher-skin、publisher-preflight、publisher-policy、publisher-runner、publisher-contract、publisher-leaves、publisher-plan全部真实PASS。测试执行后仅补充本记录，源码及测试输入不变；正式git commit由原生hook复用有效签名回执，文档按新内容静态核对。

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| 修复实际阻断与当前依赖闭包 | 两清单精确diff；三清单路径和全部当前Java源码/测试覆盖核对 | PASS |
| 正例与负例 | 原生菌落/皮肤测试通过，现有协议、失败/跳过、回执漂移及隔离回归保持 | PASS |
| 无权限或验证范围扩张 | 测试类集合未变；礼包清单未变；缺失输入仍阻断；未知旧运行路径拒绝 | PASS |
| 精确暂存验证 | 六文件原生门禁十检查全部PASS | PASS |
| 用户主目标兼容 | 应用仅需引用已提交发布器策略；保留原菌落修复和106项测试事实 | PASS |

实现验收总体PASS。正式提交推送身份由实际Git命令核对，结果在应用主任务中绑定本提交；不为记录交付身份重复运行产品测试。其他任务untracked文件完整保留，本批没有临时构建或运行环境产物。
