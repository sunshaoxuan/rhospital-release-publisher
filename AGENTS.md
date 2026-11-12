# RHospital Release Publisher Rules

## Bounded Impact-Based Testing Rule (Mandatory)

- 改哪里就测哪里。日常开发、提交和推送以本次任务基线到候选的实际变更选择检查；生产基线到发布候选的累计差异用于正式发版，禁止把全部未发版功能自动带入每次局部修改。
- 执行前写明变更路径、受影响行为与公共契约、直接消费者、选中检查、扩展理由、预计耗时和停止条件。共享契约变化可扩展到明确受影响的消费者；测试脚本互相调用、历史回执相互引用不能成为产品影响范围扩张的依据。
- 每个功能验收器必须是有明确输入和成功协议的叶子检查。禁止调用其他功能的完整验收、递归启动预检、为了获取源码哈希而运行其他验收器，或把无关历史截图和回执变成当前修改的前置条件。共享源码身份读取使用纯函数。
- 先检查选中范围的语法、配置、绑定、依赖和计划，再编译或执行耗时测试。纯文档、注释和不改变行为的格式修改只做相关静态检查；不默认触发 Maven 全套、npm 全套、Docker 构建或游戏功能验收。
- 开发阶段运行必要的针对性测试；提交阶段验证受影响行为与必要编译；推送阶段核对实际提交、有效证据、范围覆盖与远端身份。同一稳定输入的昂贵检查取并集执行一次，禁止按子任务、提交阶段和推送阶段重复执行。
- 证据复用须匹配检查拥有的源码及测试输入、依赖、命令、策略和相关环境，并验证完整真实 PASS。暂存候选与实际提交的相关输入一致时保留对应结果；无关文档或其他功能变化不使该结果失效。提交、树、基线和远端身份仍分别核对，禁止伪造或改写历史 PASS。
- 正式发版保留候选范围内的完整后端测试、选中业务验收和发布现场门禁，按稳定候选及必要目标环境执行一次。全产品回归另仅允许有证据的全局影响或用户明确要求，并须提前记录理由。数据库执行、备份、部署和现场运行结果不可用离线测试替代。
- 失败后只修复并复测受影响检查，保留其他有效结果。新增需求、新发现的真实依赖或输入变化先更新有界计划；超时或未知影响应停止并定位，禁止自动追加测试直到覆盖全产品。
- 测试选择必须有正例和反例：应选项不遗漏，无关测试失败不牵连当前验收，重复项只执行一次，未映射影响不能被当成无须测试；无法确定时先补齐影响分析。
- 本规则优先于本文件旧的无条件全量条款。现存可执行门禁的适配属于单独实现范围；规则写入仅做静态核对，不启动旧全量验证规则文字，不临时使用跳过钩子或伪造证据的方式提交。尚未适配时明确报告规则与实现的差距。

## Repository Boundary

0. HARD EXECUTION BOUNDARY: Work in this repository may modify, validate and publish only the release publisher itself. Never modify game/application repositories, application release assessments, migrations, scheduler records or production data. Never start a game/application production release, cutover or rollback from this task. Publisher verification uses local tests and isolated fixtures; it must not trigger application publication. A dependency or gate failure does not expand this scope. Stop and report any work requiring another repository or production mutation. Earlier task plans or release authorizations do not override this boundary.
1. This repository owns the release publisher engine, release-state behavior, CheckList validation, release UI, and publisher tests.
2. Application-specific impact assessments belong in `C:\workspace\hospital-backend\release\release-impact.json`.
3. Production environment facts and runbooks belong in `C:\workspace\rhospital`.

## Release Impact CheckList Rule

1. A game or forum runtime change must not enter a formal release plan unless the target commit contains a fresh release impact assessment that exactly covers the production-baseline diff.
2. The publisher must validate the assessment identifier, changed paths, code impact, database impact, risk level, CheckList decision, required checks, and reasons before any build or production action.
3. Core checks remain publisher-owned and mandatory. Business commits cannot remove or replace the game backend test, game pre-deploy CheckList, game final runtime check, forum source validation, forum preflight, or forum final runtime check.
4. Any new or renamed executable validation step that can be referenced by an assessment must be added to the registered check set and covered by tests.
5. Database-related runtime changes must declare database impact. Changed migration scripts must keep the migration safety gate and select `apply-database-migrations`.
6. Release history must retain the assessment identifier, risk, database impact, decision, covered runtime paths, and selected checks for audit.
7. Missing, stale, incomplete, excessive, unknown, or unavailable CheckList declarations must fail closed during plan creation.

## Verification Rule

1. Publisher changes must pass the tests selected from their actual module and public-contract impact before commit. Full `npm test` is reserved for formal publisher release, evidenced global impact or an explicit user requirement; documentation-only changes use static checks. Apply the bounded rule and record the selection.
2. CheckList-gate changes must include successful and failing tests for game and forum paths where applicable.
3. UI changes require a running release console, browser inspection, console inspection, and screenshot evidence before completion.

## Independent Validation And Double Check (Mandatory)

1. Select feature checks from actual candidate impact under the bounded rule. Empty applicable feature selection is valid. At formal release, backend, migration, pre-deploy and final runtime checks retain their safety requirements; routine commit/push checks use their own bounded responsibilities.
2. A feature validator owns its business evidence. It must not invoke another feature's full acceptance, inherit its PASS, require its historical screenshots, or acquire current source hashes by running its validator. Source identity helpers must be pure, path-scoped and read-only.
3. Historical integration commits, local container IDs, captured image IDs, test ports and developer-machine state must never become universal release prerequisites. A runtime check must target the selected candidate in the designated release environment.
4. Register each local check's exact entrypoints and success protocol in src/localCheckPolicy.js. Broad npm aggregates, recursive preflight calls, unknown checks, extra inputs and duplicate inputs must fail closed. Shared-behavior regression tests require a concrete caller/data-flow reason and the smallest sufficient scope.
5. Double Check has two rounds. First compare selected keys, commands, timeouts and registered entrypoints before execution. Then independently review transitive calls and evidence reads, and verify success plus unrelated-feature failure isolation. A second execution of the same broad test chain does not satisfy Double Check.
6. Add positive and negative regression tests for every changed check: exact selection, missing/extra/duplicate selection, success-protocol completeness, relevant-source drift and unrelated-evidence unavailability. Registering an entrypoint alone does not prove transitive independence.
7. Execute an applicable expensive check once for unchanged owned inputs across development/commit/push. Changes invalidate only results that consume those inputs. Commit/push/remote identity and coverage checks stay explicit; authentic scoped evidence may be reused, and runtime/production checks retain their separate authority. Never rerun a feature chain merely to reread source hashes.
8. Final review must record candidate and policy identities, affected features, retained safety checks, removed dependencies, actual test results and unresolved risks. Automated green results do not waive the independent scope review.
