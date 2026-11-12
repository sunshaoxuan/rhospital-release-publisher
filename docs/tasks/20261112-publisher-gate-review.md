# Publisher gate review, 2026-11-12

## Reopened silent artifact protocol and scoped dry-run admission

Actual job2026-11-12T14:24:58.411Z-20261112 failed in local preflight because localCheckLeaves required nonempty stdout from build-server-validator.mjs --check, whose successful documented implementation exits silently. Remove that unnecessary stdout gate; retain exit/signal/error failures and full Node test completion. This is a publisher regression, missed by the previous isolated smoke coverage.

Necessity review: Java BacteriaLevelValidator actually loads src/main/resources/bacteria-level-validator.js for server-side validation. Comparing this current build artifact to its current bundled source manifest protects against missed rebuilds; historical evidence is not involved. Existing Node behavioral suites do not verify this entire artifact/source identity. Keep the existing CLI check in formal preflight. Only selected design-package dry runs additionally inspect the selected candidate's current manifest/source/bundle using read-only source reads, without running product tests, target scripts, builds, archive audits or adding a new universal release step. Unrelated plans select no such read. This is a cheap admission check; formal actual-candidate artifact validation retains its own authority.

Frozen batch: localCheckLeaves.js, releasePublisherCore.js, their existing leaf/whole-plan tests and documentation. Native hook owns direct preflight/leaves/plan tests once; no full npm/Maven/game suite. Execute actual silent --check once with current guard, verify real target dry-run admission once, push master, then protected publisher-only service activation. No game release retry or database action. Existing operational guidance/evidence stays in C:/workspace/codex-work/test-impact-audit-20261112/TASK.md.

## Objective and limits

Personally review all source-defined game/forum release steps, local feature entrypoints and Git/formal gates. Remove archive audit coupling and unrelated product acceptance from routine delivery. No external model, production execution, service activation or database engine upgrade. Existing dirty work is excluded. Task guidance: `C:/workspace/codex-work/test-impact-audit-20261112/TASK.md`.

## Evidence and decisions

Source baseline publisher f89e50185d8ad0d11c553e12a000eba87c9f239b; game 390c153d2f5d7418588fbe2328d5aba32af47f95. Timings below are existing completed step records in 51 retained jobs, not new benchmarks. Zero durations can mean already-covered steps. Missing timing is unmeasured. This table inventories static step definitions including conditional/recovery branches; it is not a claim that every branch ran. Dynamic local keys are listed separately.

| Target / key | Source line | Decision | Existing median / max seconds (samples) |
| --- | ---: | --- | --- |
| game / `git-status-before-update` | 432 | KEEP | 2.635 / 79.244 (48) |
| game / `validate-release-input` | 444 | KEEP | 0.0 / 0.082 (49) |
| game / `validate-game-static-delivery-prerequisites` | 452 | KEEP | 5.502 / 12.373 (27) |
| game / `game-meelok-readiness` | 464 | KEEP | 1.762 / 2.046 (12) |
| game / `validate-game-release-resources` | 474 | KEEP | 1.764 / 1.773 (3) |
| game / `git-fetch` | 484 | KEEP | 3.954 / 11.756 (48) |
| game / `git-update` | 493 | KEEP | 1.243 / 13.218 (48) |
| game / `capture-release-commit` | 502 | KEEP | 1.362 / 25.765 (49) |
| game / `validate-game-sso-source` | 515 | REPLACE_HISTORICAL_ANCESTRY | 2.26 / 30.062 (37) |
| game / `install-game-release-node-dependencies` | 532 | COMBINE_CURRENT_ONLY | 25.492 / 42.05 (21) |
| game / `validate-game-release-preflight` | 539 | COMBINE_CURRENT_ONLY | 373.459 / 1432.63 (20) |
| game / `test-game-backend` | 548 | KEEP | 80.045 / 334.49 (36) |
| game / `verify-game-epidemic-flow` | 571 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.296 / 1.692 (4) |
| game / `verify-game-medical-contest-entry` | 578 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.107 / 1.107 (1) |
| game / `verify-game-client-fingerprint` | 585 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.088 / 1.088 (1) |
| game / `verify-game-hospital-skin-fallback` | 592 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.158 / 1.158 (1) |
| game / `verify-game-void-rewards` | 599 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 0.001 / 1.911 (3) |
| game / `verify-game-doorplate-ui` | 606 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 2.141 / 2.238 (2) |
| game / `verify-bacteria-result-ui` | 612 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | None / None (0) |
| game / `verify-bacteria-entry-style` | 620 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.356 / 1.356 (1) |
| game / `verify-bacteria-region-covers` | 636 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 52.538 / 88.72 (7) |
| game / `verify-game-steam-auth` | 643 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 0.0 / 0.0 (2) |
| game / `verify-game-special-clinic-atlas` | 650 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 0.729 / 1.457 (2) |
| game / `verify-design-level-packages` | 657 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 0.001 / 514.706 (12) |
| game / `verify-game-potion-lab` | 665 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.969 / 2.129 (3) |
| game / `verify-game-emergency-guard` | 673 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | None / None (0) |
| game / `build-image` | 681 | KEEP | 39.239 / 153.113 (46) |
| game / `build-game-static-assets` | 706 | KEEP | 186.259 / 273.778 (25) |
| game / `rehearse-game-static-assets` | 723 | KEEP | None / None (0) |
| game / `validate-game-image` | 741 | KEEP | 4.252 / 44.709 (35) |
| game / `verify-game-tomcat-image` | 752 | REPLACE_ARCHIVE_WITH_CURRENT_BEHAVIOR | 1.828 / 1.828 (1) |
| game / `publish-image` | 761 | KEEP | 43.017 / 88.847 (46) |
| game / `resolve-ssh-target` | 804 | KEEP | 0.415 / 6.614 (46) |
| game / `game-prd2-migration-readiness` | 818 | KEEP | 2.585 / 10.797 (24) |
| game / `game-steam-preflight` | 838 | KEEP | 4.729 / 8.322 (2) |
| game / `read-remote-compose` | 849 | KEEP | 1.7 / 7.036 (47) |
| game / `game-database-preflight` | 865 | KEEP | 4.489 / 14.51 (36) |
| game / `validate-game-database-migration-compatibility` | 877 | KEEP | 1.582 / 2.769 (14) |
| game / `validate-game-startup-contract` | 891 | KEEP | 6.52 / 6.727 (2) |
| game / `stage-game-static-assets` | 903 | KEEP | 183.516 / 296.573 (25) |
| game / `verify-game-static-assets-predeploy` | 914 | KEEP | 114.343 / 211.316 (26) |
| game / `backup-game-release` | 924 | KEEP | 8.713 / 30.163 (35) |
| game / `verify-codegraph-prerequisites` | 943 | KEEP | 6.299 / 6.299 (1) |
| game / `codegraph-offline-cutover` | 950 | KEEP | 48.604 / 48.604 (1) |
| game / `technology-offline-cutover` | 959 | KEEP | 49.87 / 49.87 (1) |
| game / `apply-database-migrations` | 970 | KEEP | 3.468 / 12.768 (28) |
| game / `pre-deploy-checklist` | 989 | KEEP | 1.667 / 2.28 (36) |
| game / `update-remote-compose` | 1001 | KEEP | 3.547 / 13.698 (46) |
| game / `pause-meelok-services` | 1036 | KEEP | 1.515 / 234.503 (11) |
| game / `deploy-stack` | 1046 | KEEP | 5.258 / 10.916 (42) |
| game / `commit-game-cutover` | 1097 | KEEP | 45.872 / 85.911 (25) |
| game / `final-runtime-check` | 1115 | KEEP | 725.781 / 945.652 (47) |
| game / `verify-game-tomcat-runtime` | 1128 | KEEP | 2.716 / 2.716 (1) |
| game / `game-prd2-runtime-contract` | 1144 | KEEP | 3.447 / 5.756 (24) |
| game / `verify-game-steam-runtime` | 1159 | KEEP | 3.994 / 6.512 (2) |
| game / `verify-game-emergency-guard-runtime` | 1171 | KEEP | None / None (0) |
| game / `verify-game-smtp-sender` | 1184 | KEEP | 7.255 / 9.96 (2) |
| game / `verify-game-static-delivery` | 1198 | KEEP | 70.851 / 119.116 (25) |
| game / `verify-relations-release` | 1209 | SELECT_BY_IMPACT | 27.378 / 35.731 (23) |
| game / `verify-tradepool-release` | 1220 | SELECT_BY_IMPACT | 5.029 / 14.919 (35) |
| game / `retire-design-image-settings-file` | 1233 | KEEP | 1.646 / 1.646 (1) |
| game / `cleanup-game-release-containers` | 1243 | KEEP | 1.846 / 2.724 (22) |
| game / `game-config-compensation` | 1256 | KEEP | None / None (0) |
| game / `game-rollback-decision` | 1268 | KEEP | 0.0 / 0.0 (4) |
| game / `game-fatal-rollback-decision` | 1280 | KEEP | 125.574 / 125.574 (1) |
| game / `game-rollback-command` | 1297 | KEEP | 0.0 / 0.0 (11) |
| game / `restore-meelok-services` | 1314 | KEEP | 2.049 / 887.944 (10) |
| game / `verify-game-standby-candidate` | 1327 | KEEP | None / None (0) |
| game / `accept-game-standby-candidate` | 1339 | KEEP | None / None (0) |
| forum / `git-status-before-update` | 1570 | KEEP | 2.635 / 79.244 (48) |
| forum / `git-fetch` | 1579 | KEEP | 3.954 / 11.756 (48) |
| forum / `git-update` | 1588 | KEEP | 1.243 / 13.218 (48) |
| forum / `capture-release-commit` | 1597 | KEEP | 1.362 / 25.765 (49) |
| forum / `validate-release-input` | 1612 | KEEP | 0.0 / 0.082 (49) |
| forum / `validate-forum-source` | 1624 | KEEP | 59.917 / 79.044 (4) |
| forum / `build-image` | 1636 | KEEP | 39.239 / 153.113 (46) |
| forum / `validate-forum-image` | 1648 | KEEP | 3.394 / 4.488 (4) |
| forum / `publish-image` | 1657 | KEEP | 43.017 / 88.847 (46) |
| forum / `validate-existing-forum-image` | 1674 | KEEP | 2.526 / 2.526 (1) |
| forum / `resolve-ssh-target` | 1687 | KEEP | 0.415 / 6.614 (46) |
| forum / `read-remote-compose` | 1700 | KEEP | 1.7 / 7.036 (47) |
| forum / `forum-preflight` | 1712 | KEEP | 1.851 / 2.791 (5) |
| forum / `backup-forum-release` | 1724 | KEEP | 19.566 / 22.291 (5) |
| forum / `update-remote-compose` | 1734 | KEEP | 3.547 / 13.698 (46) |
| forum / `deploy-forum-compose` | 1759 | KEEP | 14.674 / 21.821 (5) |
| forum / `final-runtime-check` | 1777 | KEEP | 725.781 / 945.652 (47) |
| forum / `forum-rollback-command` | 1789 | KEEP | 0.0 / 0.077 (5) |
| forum / `validate-release-impact-checklist` | 3342 | KEEP | 0.0 / 0.001 (39) |

## Full-path review findings

1. Current local policies register 21 feature keys. Most combine current tests with archived receipt/source/screenshot audits. The design key expands 84 manifest tests plus fixtures and recursively traverses historical validators. Daily `design-evidence` snapshots include 1,647 files, about 154 MB. These are concrete historical coupling, not current gameplay inputs. Move old commands to explicit manual audit; current selection must execute current behavior and current-source reuse only.

2. Local feature steps marked `coveredByPreflight` are already deduplicated within a release. Keep that protection and finite leaf dedup. The formal candidate path still runs opaque parent commands and five gate regression suites each time, separate from the streaming leaf path. Unify selected execution, scope tooling regressions to tooling changes, and retain exact candidate identity and genuine complete output.

3. `verify-relations-release` is unconditional even on unrelated changes; introduction eec7d58 (2026-08-10). `verify-tradepool-release` is also unconditional. Select these by current production-baseline impact or explicit assessment, including shared authentication/catalog dependencies. Preserve current health/auth admission for every deployment.

4. `validate-game-sso-source` pins ancestor e54c5fba and source presence; introduction 983c1ae (2026-07-16). An ancestor cannot establish current behavior. Remove ancestry as a prerequisite; retain clean exact candidate, current build/image SSO contract and actual candidate startup/secret checks.

5. Most recent successful job 2026-11-01T01:25:35.763Z: local preflight 1432.630s, backend build/test 39.637s, runtime image 146.084s, frontend-assets 241.049s, asset stage 187.203s, predeploy delivery 115.056s, final runtime 728.341s. These are separate observations; timings do not prove all build stages were recomputed. Docker backend/image/frontend commands share build cache.

6. Final runtime waits for actual Swarm `UpdateStatus=completed`; application Compose explicitly sets `update_config.monitor: 12m` and rollback monitor 12m. The 728s observation is consistent with this configured safety interval. Keep current deployment semantics in this batch. Do not silently shorten production rollback observation or declare it duplicate of initial healthy cutover.

7. Static artifact generation, content-addressed staging and pre-switch HTTP verification cover different boundaries. Post-switch authenticated browser checks cover actual game boot. Keep integrity and availability checks. Narrow future browser scenarios by affected functionality without treating archived screenshots as live validation. Remote rehearsal is explicitly requested and isolated; do not add it to normal delivery.

8. Database identity, actual engine admission, writable state, owner/schema compatibility, target-image SQL checksums, backup, migration ordering/receipts and predeploy rollback snapshot are live safety boundaries. Keep them; no database version installation/upgrade belongs to a routine code release. Offline technology/guild cutovers activate only for their migrations.

9. Compose CAS, deployment transaction lock, start-first old healthy instance, cutover identity, recovery-only decisions and standby B acceptance protect data/availability. Keep recovery guards. Meelok pause releases shared-host memory and records/restores exact prior service state; keep until measured host resource policy changes under an independent infrastructure decision. Restore warnings do not redefine a successful game deployment.

10. Forum source/image/secret permissions, Compose/MySQL admission, backup and final runtime cover independent current risks. No historical archive audit found in the forum step chain. Keep these boundaries. Composer external audit has network availability cost; it is a current dependency security scan, not historical proof. Document rather than silently remove it.

## Bounded cleanup batch

A. Replace all registered local historical-audit commands with explicit current behavior ownership; preserve manual opt-in archive audit commands. Selected current evidence reuse binds only the explicitly selected current inputs and artifacts, with no predecessor traversal. Unrelated archive corruption/missing files must not block routine selection/execution.

B. Remove historical/global coupling in daily and formal candidate checks; retain signed current check receipts, complete-output checks, selection integrity and exact candidate identity. No blanket full-product fallback.

C. Select relations/trade-pool runtime acceptance by actual affected paths or explicit assessment; remove ancestry-only SSO prerequisite. Preserve build, migration, backup, cutover, runtime and recovery safety keys.

D. Targeted controlled plans/negative fixtures and actual changed behavior only. Native hooks run their selected union once and push reuses valid exact-input evidence. No full release run for timing. No historical checksum repairs.

## Acceptance status

IN PROGRESS. Matrix above is source review and historical timing evidence. Implementation, candidate acceptance and remote delivery are not yet complete.

## Current local behavior ownership

| Check | Current test entrypoints | Extra current checks |
| --- | --- | --- |
| `verify-toilet-market` | `src/test/js/toiletMarket.test.mjs` |  |
| `verify-bacteria-authoritative-challenges` | `src/test/js/bacteriaAuthoritativeChallenge.test.mjs`, `src/test/js/bacteriaCoverReveal.test.mjs`, `src/test/js/bacteriaConcurrentSelection.test.mjs`, `src/test/js/bacteriaSpeed.test.mjs`, `src/test/js/bacteriaSettlementTiming.test.mjs` |  |
| `verify-bacteria-gates` | `src/test/js/bacteriaGateAnimation.test.mjs`, `src/test/js/bacteriaVisibilityMechanics.test.mjs` |  |
| `verify-game-loading` | `scripts/tests/game-loading-recovery.test.mjs`, `scripts/tests/emergency-fetch.test.mjs` |  |
| `verify-hospital-hud` | `src/test/js/hospitalHudCurrent.test.mjs`, `src/test/js/mobileModalChat.test.mjs`, `src/test/js/mobileLogActions.test.mjs` |  |
| `verify-game-fault-reports` | `src/test/js/bacteriaDiagnostics.test.mjs` |  |
| `verify-bacteria-ranking` | `src/test/js/bacteriaRankingLifecycle.test.mjs` |  |
| `verify-game-epidemic-flow` | `src/test/js/epidemicBossSweep.test.mjs` |  |
| `verify-game-medical-contest-entry` | `src/test/js/medicalContestEntry.test.mjs` |  |
| `verify-game-client-fingerprint` | `src/test/js/clientFingerprint.test.mjs` |  |
| `verify-game-hospital-skin-fallback` | `src/test/js/hospitalSkinTexture.test.mjs` |  |
| `verify-game-steam-auth` | `src/test/js/steamLogin.test.cjs` |  |
| `verify-game-void-rewards` | `src/test/js/voidRewardCaptcha.test.mjs`, `src/test/js/voidRewardPopup.test.mjs`, `src/test/js/voidRewardEntry.test.mjs` |  |
| `verify-bacteria-region-covers` | `src/test/js/bacteriaRegionCovers.test.mjs`, `src/test/js/bacteriaCoverReveal.test.mjs`, `src/test/js/bacteriaMobileLayout.test.mjs`, `src/test/js/bacteriaConcurrentSelection.test.mjs`, `src/test/js/bacteriaNormalStartup.test.mjs`, `src/test/js/bacteriaSpeed.test.mjs`, `src/test/js/bacteriaQueueDistribution.test.mjs`, `src/test/js/bacteriaComplexSearch.test.mjs`, `src/test/js/bacteriaSharedRules.test.mjs` |  |
| `verify-game-doorplate-ui` | `scripts/tests/empty-hospital-ui.test.mjs`, `scripts/tests/doorplate-countdown.test.mjs`, `scripts/tests/world-chat.test.mjs` |  |
| `verify-bacteria-result-ui` | `src/test/js/bacteriaResultDialog.test.mjs` |  |
| `verify-bacteria-entry-style` | `src/test/js/bacteriaLabEntry.test.mjs` |  |
| `verify-game-special-clinic-atlas` | `src/test/js/specialClinicAtlasMutation.test.mjs` |  |
| `verify-design-level-packages` | `src/test/js/bacteriaPathDifficulty.test.mjs`, `src/test/js/designLevelPackage.test.mjs`, `src/test/js/designWorker.test.mjs`, `src/test/js/bacteriaSharedRules.test.mjs`, `src/test/js/bacteriaStallMonitor.test.mjs`, `src/test/js/bacteriaUnstartedSelection.test.mjs` | `scripts/bacteria-lab/build-level-catalog.mjs --check`, `scripts/bacteria-lab/build-server-validator.mjs --check` |
| `verify-game-potion-lab` | `src/test/js/potionRecipeEditor.test.mjs`, `src/test/js/potionBatchSynthesis.test.mjs`, `src/test/js/potionModalHistory.test.mjs`, `src/test/js/potionHistory.test.mjs` |  |
| `verify-game-emergency-guard` | `scripts/tests/emergency-fetch.test.mjs` |  |

Historical entrypoints remain in `src/manualArchiveChecks.json` and are available only through explicit `node scripts/audit-historical-evidence.mjs --check <key>` from the game source directory. That result is labeled manual archive audit and does not establish current runtime, migration, UI or production readiness. No archive bytes, predecessor hash or screenshot threshold was repaired in this batch. Pure current geometry constraints retain their previous budgets; their module imports no longer traverse archive validators. User-provided 60x60 business input was copied byte-for-byte into test resources.

The current registered local tests are offline. Necessary result reuse retains signed owned-input receipts at commit/push and exact candidate/policy/environment cache validation for formal checks. Historical screenshot assertions are not reported as current UI validation. The emergency frontend leaf covers transport behavior; backend policy/settlement/concurrency remain owned by the retained backend suite and selected runtime protocol.

Runtime scope omission is limited to a known unrelated diff. Unknown impact and backend Java changes remain conservative, and explicit required checks always win. This batch does not remove core checks based on an unproved impact assumption.

## Swarm observation and proposed API readiness

Source: application `docker-compose.yml` healthcheck requests homepage only, start_period 8m; update/rollback monitor 12m, failure_action pause, start-first. Publisher cutover commits after target health and old running tasks zero, then waits for Swarm completion. Docker monitor is a task failure-accounting interval, not an old-container retention guarantee. Official semantics: https://docs.docker.com/reference/compose-file/deploy . These source facts reveal a useful improvement: bounded direct-candidate readiness and rapid recovery, rather than treating a long passive wait as business validation.

User requests coverage for homepage, login, payments, resources and frequent game APIs. Batch B must map real paths, prove requests reach the selected candidate rather than service VIP/old container, prevent duplicate background work, and bound no-charge/read-only probes. Payments may test missing/invalid authentication and signature rejection; no actual charge. Gameplay probes must not settle, spend or grant. A successful aggregate HTTP 200 is insufficient. 3-5 minutes is a proposed readiness budget, not an applied production setting. The existing rollout monitor and production routing remain unchanged in batch A.

## Frozen batch A check union

Publisher: exact staged source selection runs 5 scoped gate suites (policy, result/cache/identity, leaves, contract, whole-plan boundary). Controlled fixture plans include game/forum admission and recovery keys. No full npm/Maven/Docker run. Application: 2 current tooling suites, 11 directly affected current behavior files, static syntax for split manual archive tests, and documentation. Immutable snapshots omit all historical receipts/screenshots. Full design 84-file audit and all other product feature suites are excluded. No production/runtime service activation or engine action.

## Batch A1 acceptance

PASS: 27 targeted tests across five independent publisher leaves. Native immutable source validation passed. The first two plan-fixture failures were local-config dependency in the tests; fixtures now own complete nonsecret config and do not read machine config. Failed test output is retained in errors. Future plan-only edits select publisher-plan, not the 36.949s Git-receipt fixture group. Current source acceptance is recorded in docs/evidence/20261112-gate-review.

Split criterion: application A2 hooks intentionally consume committed publisher policy, so accepted publisher A1 must enter master first. This is a validation dependency, not permission expansion. Publisher source push does not activate the running service. Required exact-candidate commit/push remain executable. If Git hook environment differs from the preparatory shell, only evidence whose environment identity changes is rerun; never forge a cache match.

## Control plane and publisher service gates

Additional current control paths reviewed: `server.js` checks actions after request-body receipt and drains only idle restarts; `src/publisherVersion.js` compares executing content; `scripts/update-publisher.ps1` locks updates, blocks in-flight actions, checks idle state, preserves canonical history/jobs/supplemental evidence, activates a pinned detached candidate, validates health/commit/protocol and rolls back on failure. Service host installation checks administrator rights, port/process identity and health. These protect actual execution and stay. The updater itself does not run a hidden product-wide test suite. `validate-full-release-flow.mjs` is an explicit isolated acceptance CLI; supplemental verification is a separately requested recovery audit, not a routine new-release prerequisite.

A3 finding and repair: version admission used whole-worktree Git dirtiness, including unrelated docs/task files, and content identity omitted executable scripts/service files. Scope admission to actual runtime paths; exclude explicit manual archive metadata/tooling. Documentation-only commits with identical executing bytes do not force restart. Preserve the explicit root `publisher-update-*.guard` barrier used by the protected updater; omission would weaken in-flight action safety. Retain commit identities for traceability. A changed current script/service/contract, newly committed changed runtime, missing Git identity or owned update barrier still blocks as appropriate.

A3 acceptance is limited to the version/admission contract and policy selection. It does not update the installed service, issue production probes or alter Swarm rollout semantics. Native Git hook owns focused checks once; subsequent commit/push reuses exact receipts.

## Final bounded review and acceptance

The control-plane review also found the application CI workflow automatically queued a missing Windows runner, installed dependencies for a remote-identity-only operation, then required an output artifact that operation does not produce. Per the user's existing local-validation decision it is now manual identity diagnosis only. YAML/trigger/step checks pass; no CI runner is required for normal delivery. Current release assessment descriptions replace duplicated historical inheritance prose while retaining the193 runtime paths and unchanged required safety keys.

Final transitive review removed the stale designEvidenceInputs archive manifest from normal publisher inputs. The explicit manual CLI validates its selection before reading archive configuration. Current protocol tests now cover current command bounds, true completion, deadline/error behavior, streaming progress and real controlled CLI success/failure. An actual R34-shaped five-check plan verifies identical registered commands and preflight coverage without historical validators. Historical archive files and images remain unchanged.

Routine current behavior ownership is now per test consumer rather than an11-file cross-feature group: independent immutable snapshots passed169 tests. The45 current toilet behavior tests completed in0.784s in this scoped run; the previous90-test mixed behavior/archive run took89.118s. These are different workloads and environments, not a benchmark of total release time or in-game performance. Each modified source invalidates only its direct owned checks; unknown impact still requires registration, with no full-product fallback.

Final source cleanup acceptance is PASS; native exact-candidate commit/push remain mandatory. Installed service remains864c645, UP_TO_DATE, idle. New source has not been activated. API readiness, its direct-candidate health integration and shortening/replacing passive monitor waiting remain unimplemented. There was no production or engine operation.

## 用户要求的验证停止强规则

已在全局 AGENTS 与本仓库 AGENTS 落实六项强约束：冻结范围与预算；正式验证后独立问题留待下一批；重跑先写明具体失效输入和最小范围；复用有效证据；跟踪原运行并控制超时扩张；达标立即交付。规则本身只做静态格式、冲突和正反场景核对，不新增可执行门禁或运行产品测试。原文件、安装哈希和回滚说明保存在 C:/workspace/codex-selfimp/acceptance-gate-performance-20261023/installations/20261112-validation-stop-rules/INSTALLATION_RECEIPT.json。收益需后续任务持续观察，本次不作速度保证。
