# 20261117发布失败检讨与插件化结构设计

## Batch A Implementation, 2026-11-17

### Compatible Follow-up Requests

The source chat owns hospital-backend producer migration B. After A delivery and B readiness, this chat owns C: real formal release entry consumes plugin/context/shared executor up to before-production, removes replaced legacy registration/root lookup atomically, and retains core production safety. Fixture-only A is not whole-chain completion. No production actions are authorized. Service activation requires separately reported command, necessity and rollback followed by coordination; source push is not activation. Maven capability must be provided if selected by the actual migrated chain, with owned-input reuse.

The user additionally requested UI restructuring and faster plan generation. Queue separate batch D after core contract delivery: measure plan-generation latency, inspect its direct data flow, move per-step checks/logs into a separate on-demand tab, and avoid eagerly rendering/loading hidden detail. Freeze actual UI paths/checks/time budget before D; real browser, console, network, responsive, screenshots and Gemini review are required. Do not expand A verification to UI or start a duplicate check.

Authorization: implement and deliver publisher source on a dedicated codex branch; no service activation, application edits or production actions. Baseline d9655439ccdb8497fd43ac9840c980a5d3dcb917. Preserve the original incident conclusions and static evidence below.

Goal: a versioned, application-owned manifest consumed by a generic core, explicit ReleaseContext, the same executor for precheck and before-production execution, owned-input identity and authentic receipt reuse. New fixture business checks require data changes only. This batch is a consumer contract with isolated end-to-end execution; application migration B and atomic activation/removal C remain separate.

Frozen implementation paths: src/releasePlugin.js, src/releasePluginRunner.js, src/changeValidationPolicy.js, src/changeValidationGit.js; existing test/releaseWorktree.test.js and test/changeValidationPolicy.test.js; this document, docs/design/release-plugin-v1.md, docs/design/release-plugin-producer-v1.md, CHANGELOG.md and docs/evidence/release-plugin-20261117/implementation.json. The existing design schema remains the reference; the closed v1 validator does not claim a general JSON Schema engine. No server/UI/legacy runtime switching in A. Direct consumers: the generic plugin executor and isolated fixture callers; the local hook must export/register these exact generic core inputs. No new business IDs in core dispatch.

Before verification freeze, producer feedback added explicit manifest-metadata baseline selection: compare changed unit definitions/coverage rules instead of selecting every unit for every metadata edit. A fixture covers this. Controlled Java/Maven/Python/Docker, pngjs closure, staged-tree adapter and real server integration remain C dependencies; no hidden environment patch is permitted. Claude catalog exposed claude-opus-5-5-high, but its actual request failed with no available accounts. The exact canonical deepseek-flash/high request succeeded; primary review retained admission-before-cache, committed bytes, relocated exports and mutation isolation advice. Its sandbox suggestion is not an existing security guarantee.

Producer measured a maximum current compile closure of 2,086 inputs. Before formal verification, the generic input limit was set to 4,096 per unit and Git object reads batched; per-file/total limits remain explicit. This avoids both admission truncation and thousands of per-file Git subprocesses. The exact native union is documents + publisher-plugin (existing releaseWorktree file) + publisher-policy + publisher-runner. No business suite/Maven/npm full test is selected. Missing native PASS after 6 minutes is a stop/report condition, not permission to start another run.

Rerun record A1: native publisher-plugin failed 2/4 (9.78s); normal TAP todo=0 was misclassified as a directive and the real child exited 2. Invalidated inputs: releasePluginRunner.js and its fixture; direct dependency: publisher-plugin; minimum rerun: native git commit hook, which reuses any unchanged authentic PASS; documents static PASS remains valid until this record changes, policy/runner have not yet executed. No whole-suite escalation. Diagnose the child with one minimal environment-key probe, never secret values.

The environment-key probe confirmed Windows supplies PATH and user/system defaults even when an empty child environment is requested. The minimal fix is a core-owned --import bootstrap that loads the explicit JSON, clears ambient environment before leaf code, and propagates into Node test workers. This does not provide a malicious-code sandbox or OS isolation. TAP directive rejection now checks directives on ok/not-ok lines and preserves normal todo=0 totals. A1 revalidation changes only the runner/related docs and the native selected union; no unrelated inputs or check scope changed.

### A Acceptance And Delivery

Native commit 1a3347899c277a94b5cc679875587e0708e2c00d passed documents plus the three existing focused test files: 4/4 plugin/worktree, 20/20 policy, 12/12 runner. Times: 1.305s static, 21.896s plugin, 0.494s policy, 36.192s runner. All local signatures were read back successfully without executing tests again. [Implementation matrix](../evidence/release-plugin-20261117/implementation.json) records positive/negative cases, exact selected/executed/reused fixture counts and remaining B/C/D requirements. A is implemented and fixture-accepted. Whole-chain, current real application and service readiness remain NOT_COMPLETE.

Only this acceptance record and evidence changed after A's source PASS. They consume documentation checks only; the source input identities and 36 genuine test PASS remain reusable. Native commit/push may statically validate a different document-set union; that does not authorize rerunning source tests. Integrate/push A on master using native gates, preserve unrelated root dirtiness, then continue C as a separately frozen batch after producer readiness. Service activation remains excluded.

## Batch C Formal Consumer Integration

A was delivered as master/origin/master 48d9be5207e087e95cf6a78aad518246c28a7d49. Its final native commit reused the three test receipts and checked the final documentation union; native push reused all four groups. The development branch was deleted only after merge/push/remote verification. C continues in codex/release-plugin-formal-20261117 from that exact baseline.

Objective: the real formal publisher entry must load application plugin data and create the same explicit context/executor as precheck, stopping before every production action when boundary=before-production. Integrate source staging/baseline, core document admission, controlled tools/dependency identity and remove the replaced registrations/root inference after producer B is fixed. The application owner alone changes hospital-backend; fixture-only or an extra endpoint is insufficient for overall completion.

Provisional C path budget before implementation freeze: existing releasePlugin/Runner, changeValidation Git/policy/runner, localCheck policy/leaves and currentBehavior data consumers, releasePublisherCore, server and corresponding existing focused tests; producer/design/task/change/evidence documents. First trace actual current consumers and producer data, then freeze exact changes/check union/time estimates before native validation. Add no full-suite chain and no unrelated feature work. Preserve fixed safety state machine, concurrency/cancel, migration/image/backup/runtime/rollback requirements. No real application test, Docker build, production request or service operation from this task. The source chat owns actual cross-project acceptance after publisher delivery.

Known producer requirements: 2,086-file maximum existing compile closure; Java/mvnw/Python/Docker, pngjs and vm modules; catalog icon is an atomic leaf already owning its JVM/isolated PostgreSQL checks, so do not add a duplicate Maven run. Dynamic changed docs need genuine core static validation without a fake empty leaf. Manifest changes select the unit/coverage delta against an explicit baseline. Native staged tree must be represented honestly with separate Git commit/tree identity. These requirements are to be implemented or accurately blocked in C before whole-chain PASS.

C delivery dependency requires two source checkpoints: C1 freezes/delivers the generic native CLI, tool/dependency context and staged/document adapter so producer B can commit against a committed consumer; C2 switches the existing formal entry and removes replaced registrations after B's candidate is available. This split is required by cross-project version pinning, not an extra product goal. C1 paths are releasePlugin/Runner/Context/Candidate/Documents, the CLI, policy/Git exact export list, existing releaseWorktree test, contract/schema/task/changelog/evidence documents. Selected native union remains documents + publisher-plugin + publisher-policy + publisher-runner, expected 2-4 minutes, stop/report at 6 without duplication. Syntax/selection/JSON checks first, then native commit owns the run.

C1 incorporates real producer scale (605,170-byte manifest, 2,092 maximum inputs) within the measured limit. local-tools and node-dependencies are explicit capabilities; images/dependencies are data. Dynamic documentation validates genuinely before business execution. Workers use private declared-input exports; no malicious-code sandbox is claimed. Candidate/loader admission and actual Git identities remain fresh, while individual receipts depend on execution-kernel code rather than unrelated old business export-list changes. New immutable C1 source is needed before producer native checks; do not start any application suite here.

C1 source candidate 112937a passed the native union: documents 1.096s, worktree/plugin 6/6 in 39.589s, policy 20/20 in 0.390s, runner 12/12 in 34.882s. No application/tool/Docker/Maven command ran. Read back all four authentic signatures. Actual local-tool positive acceptance remains with the producer's real C2 chain; C1 proves precise negative admission and controlled contract only. CLI output is release-candidate-validation/v1 PASS scoped before-production, with separate PREFIX_PASS and actual unit/document counts. Record/evidence-only updates do not invalidate these 38 owned-input PASS; final native delivery reuses them.

### C2 Active Work

C1 is delivered as master/origin/master f62ede2daf5c212b9df0f83ca9c8ad089cadc094, native final commit/push reused all three test receipts (38 tests). The C1 branch was deleted after merge/push/remote verification. C2 branch is codex/release-plugin-cutover-20261117 at this baseline. The root worktree's original .task-tmp and old audit files remain untouched; service remains on its installed version.

Producer B has drafted 33 units, 373 exact coverage rules, 605,170 bytes and max 2,092 inputs. It owns the local-tools and PNG business code. B's client uses explicit repository Git config release.publisherExecutable and snapshots committed generic consumer files. The C1 stdout protocol/argv is frozen in the producer contract. C2 additionally needs per-unit tools (node/git/powershell for game-gate; actual java/python/docker/cmd subsets for other leaves), with Node/PowerShell absolute paths and selected-only identity. This is a concrete producer blocker: the previous all-tools PATH omitted Node/PowerShell and would unnecessarily bind Docker to game-gate. The worker stays context-controlled; business code must not repair process.env.

Next C2 implementation: (1) finish generic tool-subset data/identity and corresponding existing fixture; (2) route the actual core Source step through the committed generic CLI, preserve first-production boundary in executePlan, parse its scoped result and retain fixed safety; (3) atomically stop consuming/delete migrated business registration/modules after producer ownership confirmation, adapting publisher-native mapping and obsolete business-specific tests to generic protocol fixtures; (4) freeze exact changed paths/check union and run only the native impacted gate once. No application tests are run here. Any historical deletion record used by publisher development scope is audit-only and cannot execute or register application business checks. Actual application before-production acceptance belongs to the source chat after B/C source pins are fixed. D UI work remains separate.

Producer is ready to run its expensive native gate, so first freeze/deliver the C2 worker kernel before that run. Scope: releasePlugin.js, releasePluginContext.js, releasePluginRunner.js, existing releaseWorktree.test.js, schema/producer/task/evidence/changelog documents. Direct consumer is generic worker execution, especially game-gate's node/git/powershell subset. Native selection is documents + publisher-plugin only; policy/runner unchanged PASS remain valid. Expected under 90s, stop/report at 180s, no duplicate invocation. Added one positive Node-tool-subset fixture and retained remote Docker rejection; no real Docker or application command. Source app validation must wait for this kernel pin, then C2 plan/legacy work must not change it without a concrete failed input and agreed minimum rerun.

Method: read existing policy/runner/receipt contracts; obtain one bounded Claude advisory review; implement the smallest context-bound committed-manifest chain, then schema/path/capability/result rejection cases. Reuse the existing signed receipt store. The repository currently has no runtime dependencies; prefer a closed v1 validator over adding a schema engine plus dependency-copy machinery solely for this bounded contract. Keep the JSON schema and executable validator aligned through fixture cases.

Verification budget: cheap Node syntax and JSON/selection/reference checks first. The native staged commit hook owns the union of applicable policy/runner and releaseWorktree fixture checks; do not manually pre-run that same union. Expected focused hook duration 2-4 minutes; stop at 6 minutes and report the original process, with no duplicate execution or broadened suite. New fixture child processes may invoke only Node and fixture-local Git, never application, Docker, SSH, deployment or production commands. If a native gate selects additional checks, report the concrete selection and reason before execution. Reuse native PASS on push/integration when owned inputs match. No npm full suite, Maven, build, game replay or service update.

Acceptance: data-only new fixture unit; missing context rejected before receipt lookup; temporary exported root uses the same entrypoint/context as precheck; same unit reused across phases; exact selected/executed/reused counts; reject unsupported version/runner/capability, duplicates, unmapped scope, input drift, escape/symlink paths, incomplete success and attempts to alter fixed safety. JSON admission is not a sandbox. Record the application producer fields and remaining B/C work. Final status is pending implementation and native verification.

## 目标与边界

用户要求先检讨预检查通过后正式流程失败的问题，调整业务功能频繁牵动发布器主程序的结构，并保持日常测试负担不增加。方向为发版方输出插件数据，发布器解释并执行发布及相应检查。

本轮交付为有证据的事故检讨、插件数据协议设计及迁移验收条件。主指导记录位于C:/workspace/codex-work/publisher-plugin-review-20261117/TASK_GUIDE.md。应用前次就绪判断受到本次失败反证，发布器正式执行等价性结论撤回；原产物和局部功能证据保持原范围。

基线771205872ca149ca0d2e4394c4f3b03f8100403b，分支codex/publisher-plugin-architecture-20261117。原有.task-tmp及20261025审计三项未跟踪内容保留。当前阶段只修改本仓库文档、设计示例与CHANGELOG，不改运行逻辑，不修改应用、发布评估、生产数据或服务，不重试游戏发布，不更新发布器服务。

## 检查冻结

范围：本记录、docs/design/release-plugin-v1.md、设计schema与示例、docs/evidence/release-plugin-20261117/incident.json、CHANGELOG。直接消费者是后续发布器及应用迁移任务的实施者，当前没有运行消费者。

验证：证据摘要与原始历史记录及固定提交源码对应；文档引用、规则冲突、JSON结构与示例核对；使用已有JSON Schema库时记录真实校验，否则明确仅完成静态检查。原生提交/推送门禁仅选择documents，不跑npm/Maven全套、不构建镜像。预计15分钟；失败只修正本范围静态问题。已存在的20261025历史审计不纳入本任务。

## 当前事实与结论

失败发布记录2026-11-16T23:07:43.079Z-20261117，目标c16f104461b5766374562adf3888e4a3171f9a86。43步中11步完成，第12步validate-game-source-impact失败。game-gate组37个测试36通过、1失败，错误为Committed local release publisher repository not found，发生于导出临时目录中的releaseCandidateCommitGate.test.mjs:315。生产上传、迁移、切换均为pending。

局部预检查曾显式提供RHOSPITAL_RELEASE_PUBLISHER_ROOT；正式server入口传process.env，Source导出后的测试又从process.cwd()搜索发布器。这个未声明的跨仓库上下文依赖解释了执行失败。environment身份字段没有纳入该变量；日志证明该组正式执行时没有复用PASS，具体造成缓存失配的字段尚未由日志确定，禁止推定为唯一某个PATH值。

主Agent责任：使用自建预检查启动器补齐了隐藏环境依赖；复用了正确拥有输入的局部PASS，却没有证明正式入口的上下文等价；将范围受限的检查结果表述为可以进入实际发布的就绪结论。业务规则持续进入发布器目录也造成重复耦合。详见[结构设计与完整检讨](../design/release-plugin-v1.md)和[证据](../evidence/release-plugin-20261117/incident.json)。

## 交付验收

最终静态结果写入同目录证据中的review.json。必须分别说明调查/设计完成与运行改造尚未实施，不能宣称故障已经修复或插件机制已经生效。无需为写回执重跑历史业务验收。

实际静态结果：已有Python jsonschema完成2020-12 schema核对，三类runner正例与九项结构反例全部符合预期；示例ID、引用和入口输入关系核对通过。详见[静态回执](../evidence/release-plugin-20261117/review.json)。这些结果仅覆盖设计数据，运行改造状态NOT_IMPLEMENTED。文档评审将“循环依赖”表述收窄为v1独立叶子，匹配schema没有unit依赖图的实际范围；该文字修正不使schema/example的已通过结果失效，仅做相关文档静态检查。
