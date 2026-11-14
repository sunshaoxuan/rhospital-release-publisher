# 菌落正常启动独立发布检查

## 目标及授权

统筹按用户统一候选验收要求选择有界方案B：发布器注册verify-bacteria-normal-startup，精确执行既有bacteriaNormalStartup.test.mjs，应用评估随后由原负责人更新。起点c913e1b，master工作，原有untracked材料完整保留。此前70候选正式检查中的8个相关叶子PASS保持原始身份；盖板版本5断言实际6为独立既有失败，不在本任务修改。

## 冻结范围、方法和非目标

本批只改当前检查目录、发布step注册/选择/名称、既有合同/叶子/计划测试、本文和CHANGELOG。既有local-change current-bacteria-normal-startup输入映射继续使用，不改其源码/依赖边界。直接消费者是localCheckPolicy、localCheckLeaves、createPlan及其原生发布门禁；注册单文件叶子，保持未知、篡改、遗漏、重复拒绝及共享叶子去重。不改其他组、协议、数据库、游戏源码或评估，不构建产品、不调用生产。

## 验收及检查预算

先JSON/JS语法、精确影响选择和diff廉价核对；冻结后由原生pre-commit执行publisher-contract、publisher-leaves、publisher-plan及真实影响选择的共用检查，预计3至5分钟，不预跑同一套。正例验证只选normal-startup、实际dry-run可执行且置于生产之前；反例验证未知/遗漏/额外/重复、失败/不完整TAP、无关盖板和历史证据失败隔离。论坛边界及必要生产安全step保留。原生提交后推送复用有效签名PASS，核实远端身份，清理本任务辅助脚本。服务版本评估明确记录工作仓新step与当前安装版本差异，未单独授权本轮重启服务。

完成标准：上述合同及消费者通过原生门禁、提交推送master、应用评估负责人取得准确新policy身份。正式backend等待应用更新评估后一次执行；本任务不启动该检查。

## 最终意图复核与实际验证

7文件精确暂存，原生validate-local-change.mjs退出0：documents、publisher-preflight、publisher-contract、publisher-leaves、publisher-plan共5检查全部真实PASS。包括实际隔离CLI正反例、未知/遗漏/篡改合同拒绝、重复叶子只一次、失败和历史读取拒绝，以及游戏/论坛原有生产安全边界。完整日志C:/workspace/codex-work/publisher-activation-20261114/publisher-normal-commit-gate.log。产品测试和Docker构建执行次数均0。

| 用户目标 | 最终证据 | 结果 |
| --- | --- | --- |
| 独立、可执行且仅normal-startup | 注册目录与实际createPlan/CLI测试，一文件60秒合同 | PASS |
| 与既有local-change映射一致 | localCheckPolicy测试核对原输入映射和同一测试文件 | PASS |
| 未知/遗漏/重复/篡改/失败保持拒绝 | 原生contract/leaves/plan正反例，必须backend未声明时拒绝 | PASS |
| 无关盖板和历史证据不牵连本叶子 | 真实CLI夹具放置失败盖板及损坏历史，独立叶子成功；当前失败/历史读取被拒绝 | PASS |
| 游戏/论坛安全范围不变 | 原生publisher-plan及preflight回归 | PASS |
| 不重复产品全量，不生产操作 | 本批只执行发布器5个原生检查，无产品/环境切换 | PASS |

服务版本评估：当前安装runtime仍13666881，其合同尚无新step。源代码提交推送不等于服务加载；正式发布前须由统筹安排服务更新并确认新合同可见。本轮不重启服务，不调用应用发布。原始8个产品PASS与独立旧盖板失败保持原身份，未改写历史回执。

只补本静态收尾后提交；源和测试不变，原生hook复用有效签名结果，documents按实际候选静态检查。远端与提交身份由Git现场核对后交协调者，不为写身份再重跑验证。其他任务untracked完整保留。
