# Migration Workflow Correction, 2026-10-25

## Objective And Request

Current delivery authorization (2026-10-25): complete publisher-only changes, acceptance, push to publisher origin/master and publish the publisher to its existing runtime endpoint. No game/application edits, production data changes, game plans, game publication, cutover or rollback. The repository hard execution boundary governs all following work. Earlier production sections below are historical records only.

Delivery batch: retain publisher migration workflow and role resolution fixes, repository hard boundary and audit correction. Reconcile current publisher main/task/master histories without absorbing unrelated work, freeze executable/test/dependency identities and run a fresh npm test for the combined candidate, push a fast-forward to origin/master, deploy a clean publisher checkout and verify version/hash, endpoint HTTP behavior, idle job state and service health. No visible UI code change is included in this batch. Preserve the previous publisher runtime identity for publisher-only rollback.

Acceptance criteria: origin/master equals accepted publisher commit; existing endpoint 192.168.20.218:8787 serves that same clean commit and content hash with UP_TO_DATE; publisher process is supervised and idle; mandatory npm test evidence is valid for identical executable/test/dependency inputs; unrelated dirty files and all application/production state remain untouched in this delivery. Any service-management permission limitation must be reported without bypassing the publisher version gate.

Adjust publisher workflow for plan-generation rejection of
`scripts/migration/20261025_finalize_guild_status.sql` with `ALTER COLUMN`.
Diagnose the actual SQL and preserve release and rollback safety.

## Scope And Boundaries

- Publisher policy, plan orchestration, regression tests, docs and changelog.
- Read application migration and evidence only as required for diagnosis.
- Preserve original checkout and its five existing unpushed commits.
- No game/application production release, database mutation or application edits. Publisher-only remote push and service update are authorized by the current delivery request.
- A verified fast-forward may trigger the existing idle publisher auto-reload.
- Work in the isolated publisher worktree based on initial HEAD.
- No visible UI change planned; browser acceptance required if UI changes.

## Method And Batch

1. Inspect selected migration, policy and rollback/execution dependencies.
2. Classify complexity; obtain bounded external advice if repository rules require it.
3. Implement the smallest evidence-supported correction and regression tests.
4. Update README and changelog with the contract and remaining restrictions.
5. Run cheap syntax/diff checks; reuse focused assertions in the full suite, freeze executable inputs;
   run `npm test` once for the unchanged candidate.
6. Independently review check selection, transitive execution, evidence and final intent.

Batch: migration classification, any required plan ordering, tests and docs.
Shared checks: syntax, migration/plan assertions in the full publisher test suite.
Split if actual SQL requires application changes, migration redesign or new authorization.

## Historical Initial Acceptance Matrix

| Item | Required Evidence | Status |
| --- | --- | --- |
| Root cause | Local publisher lacked verified upstream support 7de0c95 | PASS |
| Allowed migration | Exact Guild B clause and fixed-commit offline plans | PASS |
| Safety restrictions | Game/forum and unsafe SQL negative regressions | PASS |
| Workflow invariants | Generated-shell prerequisite, drain, backup and rollback tests | PASS |
| Independent review | Command/selection and transitive-call/isolation review | PASS |
| Verification | Final `npm test`: 430/430, no skips; frozen hashes unchanged | PASS |
| Documentation | README, changelog, boundaries and evidence review | PASS |
| Local runtime | 6888056d loaded cleanly; two HTTP 200 plans and browser evidence | PASS |
| Production readiness | Live prepared A and scheduler prerequisites | OUT OF SCOPE, UNVERIFIED |

## Evidence And Decisions

### Publisher-Only Final Delivery Batch

- Final combined-candidate npm test: PASS, 434 tests, 434 passed, zero failures/skips, 518448.54 ms. Frozen executable/test/dependency index SHA256 remains 0a1d366e47b984dd71b68d4892d083c598856752e60b523dd261b41536063efc. Evidence: docs/evidence/20261025-migration-workflow/publisher-delivery-acceptance.json and publisher-delivery-npm-test.log. Independent review retains mandatory checks, forum reuse, current config reader, immutable A/migration protection and role resolution fail-closed behavior. Push and publisher service deployment are subsequent acceptance items.

- First combined-candidate npm test: 432 tests, 394 PASS and 38 FAIL, all failing in Git fixture reads with Windows Filename too long. Preserve the failed log. Shorten the task-local temporary directory and enable core.longpaths through process-local Git environment only; no global Git configuration or product source change. The failed full gate requires a fresh full npm test with the corrected environment.

- Live publisher before delivery: 0.2.0+85ac7a4b, port 8787, Windows service RHospitalReleaseConsole. Main source is 7daeb209 with unrelated untracked orchestration-audit documents. Preserve those files exactly; do not hide them or relax dirty-version checks.
- origin/master has independent commit d526b3d, absent from main. Merge it while preserving current readReleaseConfig behavior, selected-check budgets and existing tests. The combined candidate retains the early direction guard for both game and forum fixture plans. No live plan request is needed.
- This integration changes src/releasePublisherCore.js and its tests, invalidating the prior 432-test evidence for the final combined candidate. Freeze executable inputs after syntax/diff/conflict checks and run mandatory npm test once. Extra broad game/backend checks are outside scope.
- Deployment method: install a clean publisher checkout under the publisher project .service directory; point only the publisher Windows service to that checkout, retaining canonical publisher history/jobs and protected diagnostics through publisher-local links. Preserve old service configuration for publisher-only rollback. Require idle job API and no persisted active jobs before service update. No application or remote-production command is permitted.

- Initial primary checkout: clean `main`, five commits ahead of `origin/main`.
- Screenshot: plan creation stopped before release actions, image label
  `hospital-backend:20261023`. User evidence only, no fresh production probe.
- Source lookup locates rejection in `src/releasePublisherCore.js`.
- Historical incident memory informs evidence discipline only: inspect failed
  stage and downstream obligations; local tests and dry runs are separate from production.

## Integration Finding And Revised Method

- Actual application candidate `f62422f9b1c878913a37b4ec639db2d7e4dea7dc` contains
  the reported migration. Its handoff points to publisher support commit
  `7de0c9545426287d099cbd4350367f68aab113bf`. A read-only Git fetch confirms it
  is current `origin/main`; local main lacks this commit.
- Existing publisher at `192.168.20.218:8787` reports runtime/repository
  `a626424e`, clean and idle. Its UP_TO_DATE label compares local runtime to local
  repository only, and does not establish synchronization with origin.
- Merge existing remote support into the isolated branch, preserving all five
  local documentation commits. Review and validate the existing contract rather
  than creating a second implementation.
- Reuse source-bound upstream evidence only after exact identity checks; run the
  required full publisher test suite for the integrated candidate before commit.
- Integrate the verified local candidate into original main with fast-forward
  only while it remains clean and unchanged. Existing idle auto-restart may load
  the updated publisher. No explicit service restart is planned.
- Fresh live acceptance is limited to publisher version, busy state and pure plan
  generation. No /api/execute, production SQL, scheduler calls or application edits.
- Ordinary ALTER COLUMN refusals remain. The Guild B exception requires prepared
  A, archived/drained scheduling, stopped writers and bound verified full backup.
- PostgreSQL official ALTER TABLE documentation confirms defaults affect future
  writes and NOT NULL constrains stored rows. This informs the retained A boundary.
  Reference: https://www.postgresql.org/docs/current/sql-altertable.html

## Review And Frozen Candidate

- Bounded external review used callable `claude-opus-5-5-high`; main agent retains
  all decisions. Accepted checks: exact remote-source identity, local full suite,
  side-effect-free plan, narrow SQL exception, stopped-writer and receipt binding,
  post-stop failure preservation, compatible immutable rollback and idle reload.
- Existing tests already execute generated shell with Docker stubs for both the
  success path and failures before/after stop, scheduler recheck, image/SQL/floor/
  snapshot/dump drift, and incompatible rollback. Real class files and scheduler
  observations are validated independently by Python fixtures.
- Direct transitive review: `gameCodegraphCutover` uses path-scoped script/source
  helpers, snapshot checks, fixed database identity and stopped-writer checks.
  Its two remote checks are excluded from local feature-preflight selection.
  No other feature validator or historical screenshot is invoked. Core game and
  forum gates and `src/localCheckPolicy.js` are unchanged.
- `assert_no_database_writers` excludes only its own PostgreSQL backend PID and
  rejects every other client backend. Scheduler is read again after stopping.
- Existing clause exception matches the exact case/spacing and migration path;
  unrelated ALTER COLUMN remains rejected. No broader SQL policy change added.
- A prior isolated probe had no history baseline and is excluded from acceptance.
  Corrected probe reads original `.release-history.json` without changing it:
  baseline `6bf869bcc1a0b19a5a178236c60aff6789885637`, target
  `f62422f9b1c878913a37b4ec639db2d7e4dea7dc`, 38 runtime paths, 43 planned steps.
  Prerequisites precede offline cutover, which precedes migrations.
- Publisher rollback target is `a626424e36eb0c567d3883c6b137a30c60ff905f`.
  No automatic rollback is authorized by this task.

## Validation Failure And Bounded Rerun

- First local `npm test`: 424 total, 423 passed, one failed, no skips;
  `docs/evidence/20261025-migration-workflow/npm-test.log`.
- Failure: `missing helper capability and conflicting CAS fail closed` in
  `test/gameStandbyCandidate.test.js:225`, Windows EPERM while atomically replacing
  its task-local `candidate.json` at `src/gameStandbyCandidate.js:142`.
  This path is unchanged from the original checkout and upstream support.
- Evidence establishes an OS-level rename failure; its cause is not established.
  No migration assertion failed. No source or policy input changed.
- Smallest diagnostic rerun: the one failing test, then its complete test file
  if it passes. A repeat failure requires scoped diagnosis before another full run.
- The mandatory pre-commit full-suite result is currently FAIL. After targeted
  validation, one additional unchanged-candidate full run is justified by this
  failed gate. Preserve both logs; do not replace or describe the first as PASS.
- Targeted rerun passed: 1/1, `standby-rename-recheck.log`. Its entire test file
  passed 29/29, `standby-file-recheck.log`. EPERM did not recur; the external
  cause remains unknown. No retry/fallback was added to production code.
- Second mandatory full run uses unchanged executable inputs and the same
  `npm test` command; result retained separately in `npm-test-rerun.log`.

## Gate Blocker Repair Within This Batch

- Second full run: 423/424, one failure in a different standby test at line 103,
  again `candidate.json` replacement EPERM at the same source write boundary.
  Both failed full runs are retained. No service update has occurred.
- Repeated OS-level rename refusal blocks the mandatory publisher gate and can
  also interrupt local candidate journaling. Its external lock owner is unknown.
- Minimal scope extension: `gameStandbyCandidate.js` and its test file only.
  Retain same-directory atomic replacement and the existing candidate lock; on
  Windows retry EPERM/EACCES/EBUSY for at most one second, yielding between tries.
  Permanent/unknown errors still reject, preserve the old receipt and release the
  operation lock. No destination unlink or non-atomic write is permitted.
- Existing dependencies are Node built-ins only. The established Windows rename
  backoff pattern is documented by graceful-fs; no package or global patch is
  needed for this narrow write boundary. Reference:
  https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js
- Add deterministic transient, permanent and unknown-error regressions, including
  old receipt preservation, local lock occupancy, temporary-file cleanup and no
  duplicate remote acceptance. Run the complete affected test file first.
- This local two-file fix is main-agent work. It does not alter migration policy,
  scheduler reads, production operations, or the already reviewed Guild B flow.
- After focused PASS, freeze changed inputs and run one new full `npm test` gate.
  Earlier full results cannot validate this new candidate.
- Focused implementation attempt: 31/34; three new transient assertions compared
  JSON key order across two distinct valid saves. Corrected assertions to inspect
  the acceptance save and compare receipt values; no acceptance threshold relaxed.
  Original output retained in `standby-replacement-fix.log`.
- Final affected file passed 35/35, no skips: `standby-replacement-final.log`.
  Added cleanup-error preservation coverage. All five save call sites await atomic
  replacement; the outer exclusive candidate lock spans the wait.
- Migration source/test content remains identical to upstream. Only standby
  journaling and its regressions differ from upstream executable/test content.
- Frozen final inputs and environment: `validation-inputs.json`. New mandatory
  full run writes `npm-test-final.log`; live service acceptance remains pending.

## Final Candidate Gate

- Final full `npm test` exited 0: 430 tests passed, zero failures, skips,
  cancellations or todo, duration 324645.7541 ms. All 14 frozen input hashes
  match. `validation-inputs.json` binds source, environment and log SHA-256.
- Latest fixed application tip `931bad014c1e9356e13652df608704cfda8ec514`
  also generates a pure offline plan: 41 covered runtime paths, 43 steps.
  `offline-plan-current-tip.json` retains exact target and baseline identities.
- Syntax checks and `git diff --check` pass. The final local code extension
  remains the two-file atomic receipt fix; upstream migration logic is intact.
- Earlier failed runs remain recorded as failures. The new source invalidated
  those candidate results; the final full gate validates the repaired candidate.
- Next: commit the integrated candidate, fast-forward clean original main,
  observe existing idle auto-reload, then check live pure-plan API and browser.
  No production actions or remote push are included.

## Local Delivery Acceptance

- Integrated merge commit: `6888056d43fe14f5e9e4e1e131365d21ee763b40`,
  parents initial `a626424e` and upstream `7de0c954`. The original clean main
  fast-forwarded and the existing idle watchdog reloaded without manual restart.
- `/api/version`: runtime and repository 6888056d, clean, UP_TO_DATE;
  content hash `68ae9fdcb410f34e6c7f29f07d58118dfdcaec4adf121c88ec73bf84e01b9ffe`.
- All 14 tested and installed inputs match after CRLF normalization. Raw bytes
  differ only for unchanged `server.js` and `src/localCheckPolicy.js`; exact raw
  and normalized identities are retained in `live-publisher-acceptance.json`.
- Live POST `/api/plan` returned HTTP 200 for both f62422f9 and 931bad01,
  each 43 steps, against recorded baseline 6bf869bc. Exact paths remain 38/41.
  Prerequisite, offline cutover, migration, pre-deploy and final checks are present.
- Browser reload and fixed 931bad01 selection display the normal workflow,
  new Guild checks and pending execution state. All observed HTTP responses are
  successful, no new console warning/error or network failure, no execute request.
  Desktop screenshot and `browser-acceptance.json` record the existing UI state.
  No UI source/style changes or new layout/responsive certification are claimed.
- Release history SHA-256 remains
  `bd59e211ea1638d3cbf5891fdc59b737fcdae02b2051aa108c8dbc3715831dc8`;
  active job null, busy false. No build, migration, cutover or production release
  executed. Remote-tag display is a read-only production image observation.
- Existing prepared A and scheduler archival/drain prerequisites still require
  live evidence at formal release. Plan generation does not certify readiness.
- Final intent: publisher workflow correction PASS; production readiness
  UNVERIFIED and out of scope. Follow-up commit contains evidence/docs only,
  with unchanged executable inputs, so no additional full test run is needed.
- Windows receipt learning remains candidate-only at
  `C:/workspace/codex-selfimp/20261025-publisher-atomic-receipt/TASK_LEARNING_RECEIPT.md`.
  No global rule, skill, provider, authentication or memory change was installed.
- Final whitespace check excludes captured `*.log` only. The unmodified Node
  assertion output in `standby-replacement-fix.log` has six whitespace-only
  lines flagged by the unrestricted diff check. Keep raw diagnostic evidence;
  code, configuration, documentation and JSON diff checks pass.

## Follow-up: immutable A predecessor failure

- User reports formal release failure after current service snapshot PASS,
  with `ERROR: immutable A predecessor required`.
- Goal: identify the recorded job, first failed step, immutable image input
  and actual production effects; repair any confirmed publisher defect.
- Method: inspect job/history, runtime identity and source call flow, then
  apply the smallest justified correction and relevant regression tests.
- Boundaries: production investigation is read-only. No release retry, SQL,
  writer stop, scheduler modification or prerequisite bypass.
- Acceptance: evidence-backed cause and effects, preserved recovery guards;
  code corrections require focused tests and mandatory `npm test`.
- Previous plan-generation PASS is distinct from this release failure.

### Follow-up findings and acceptance

- Job `2026-10-25T05:27:58.790Z-20261025`, candidate `931bad01`,
  failed at `verify-codegraph-prerequisites` after 25 completed steps.
- Live service references `hospital-backend:20261023` without a digest.
  Read-only inspection of its running JAR confirms the required
  `normalizeLegacyStatusBeforeWrite` callback is absent. Digest pinning alone
  cannot satisfy the prepared A contract. Image identity is in the receipt.
- New image upload, two-gateway static staging and release backup completed.
  Writer stop, migration, compose replacement, deployment and rollback remain
  pending. Live service has one healthy replica; recovery floor is absent.
- Evidence: `docs/evidence/20261025-migration-workflow/immutable-a-incident.json`.
- Diagnosis and production-effect boundary: PASS. Release readiness: BLOCKED.
  Prepared A deployment requires explicit production authorization; scheduler
  archival/drain remains unverified. No release retry or production mutation
  was performed during this follow-up. No executable source was changed.
- Existing guard remains enforced. Further workflow enhancement can move
  independent live predecessor checks ahead of build/upload, retaining the
  final pre-cutover recheck; this is not implemented or claimed as verified.

## Authorized A release and B prerequisite validation

- User authorizes preparing and accepting A, running formal release gates,
  publishing A only after they pass, then verifying B release prerequisites.
- Split phases because A is the required independently accepted predecessor.
  B deployment and B contraction SQL are outside this authorization.
- Method: inspect A source/impact assessment and current baseline, freeze a
  scoped candidate, use publisher-owned formal gates, publish A, inspect its
  exact live JAR/image/tasks and final runtime checks, then read B prerequisites.
- Acceptance A: exact-baseline impact coverage, required checks PASS, compatible
  prepared A callback in the live immutable image, healthy rollout and runtime
  acceptance. B: image/SQL identity plus scheduler archive/drain and predecessor
  checks, with unresolved conditions explicitly recorded.
- Preserve unrelated work and existing recovery floors. Do not bypass safety
  checks or silently archive/delete production scheduler data to satisfy B.

### A frozen candidate and dispatch

- Candidate `96193ca1825389bf920ad93a5f11b0a77e73cde1`, tag `20261025-a`.
  Existing A product and portrait receipts reviewed. Source includes constructor
  and lifecycle normalization, retains weekly chain, excludes B contraction.
- Formal plan HTTP 200, baseline `6bf869bc`, 28 covered runtime paths,
  39 steps, no new migration. Core backend/predeploy/final runtime gates retained.
- Dispatched once at 2026-10-25T05:50:41.383Z, job
  `1792907441383-9e7b412f4d5cd8`. Transport timed out during synchronous Git
  checkout; persisted job and subsequent live status confirmed the same run.
  No duplicate dispatch. Plan and dispatch evidence saved beside incident receipt.
- Existing dirty application master/index left untouched. Publisher creates
  its own detached exact-commit worktree and owns normal cleanup.

### A immutable runtime acceptance method

- The running publisher deploys a tag-only reference. After the same formal
  job completes, verify the live A callback, exact uploaded image, all tasks
  and healthy completed rollout before binding the accepted digest.
- Remote Docker resolves the verified A tag plus digest to image
  `sha256:2422d371f0c99aecab57fbaae49eb8a38bc5b89bd836809ad0d6a1a245a50aec`.
  Preserve the existing start-first/pause policy and all non-image Spec fields.
- This binding may replace the task. Recheck the affected final runtime gates
  against the same immutable artifact; do not repeat unchanged build/tests.
- Any drift fails closed. B remains validation-only, with no scheduler writes,
  writer stop, migration or deployment in this phase.

### A formal result and B read-only conditions

- A formal history `2026-10-25T06:27:34.371Z-20261025-a` is EXECUTED,
  exact commit `96193ca1825389bf920ad93a5f11b0a77e73cde1`. All 36 normal
  steps completed; three recovery-only steps remain unexecuted as expected.
- Preflight completed in 6m44s, including 472/472 and 51/51 test groups.
  Backend gate reused candidate-keyed BuildKit COPY/package cache. Retained
  Surefire reports: 1896 tests, 0 failures, 0 errors, 91 skipped. This run
  did not freshly execute Maven tests. No publisher executable changed.
- Both gateways staged and HTTP-verified 1411 assets. Backup, pre-deploy
  CheckList, rollout, PRD2, browser delivery (six probes), relations and
  tradepool runtime checks passed. Formal job owns and completed its cleanup.
- Existing Meelok marker belongs to another release. Before this job, web
  desired=1/running=0 while the other four services were running. Pause and
  restore emitted ownership warnings and preserved the marker/snapshot.
  No recovery of that unrelated maintenance state is claimed or attempted.
- Read-only live JAR inspection verifies prepared A callbacks and exact JAR
  SHA-256 `53e69d23289ac32b5604395fbfc30b0ca6cbc0117e2f60680aa77dc2b19aa4dc`.
  Initial rollout completed, replica=1 healthy, every older task terminal.
- Accepted digest pin submitted after formal completion. Service Spec
  comparison proves Image was the only changed field; start-first/pause and
  720-second monitor retained. Original five final runtime commands are bound
  by hashes and executed once against the pinned reference. All five passed.
- B plan now fails closed (HTTP 400): assessment contains 25 excess paths
  already released in A; actual A-to-B runtime/migration diff has 16 paths.
  A fresh B assessment and candidate are required before formal B gates.
- B scheduler read-only guard FAIL: jobs 18 and 20 have job_status=0 and
  deleted=0. Tasks=0, batches=0, active workflow references=0. Archival is
  outstanding. No scheduler records were modified.
- Actual B image equals the local inspected artifact. B JAR contract PASS;
  delivered migration matches commit 931bad01, SHA-256
  `46e90290d49473bb5a4f152673a7836f043c6e91199a428a82cdbfdb987f4d2b`.
- B offline writer stop, fresh full backup, migration and deployment are
  unexecuted. Condition validation is BLOCKED with explicit evidence, not
  release approval. Receipts: `a-formal-release-result.json`,
  `a-immutable-pin.json`, `b-plan-after-a.json`,
  `b-scheduler-prerequisites.json`, `b-image-contract.json`,
  `b-readiness-after-a.json` in the existing evidence directory.

### Authorized follow-up final acceptance

- Immutable A rollout completed at 2026-10-25T06:41:21.491042987Z.
  One replica is healthy; all prior tasks are terminal. Live JAR callback
  verification passes and its SHA-256 matches the accepted pre-pin artifact.
- Original final-runtime, PRD2, static delivery (six browser probes), relations
  (two gateways) and tradepool checks all pass after digest pinning. Static
  delivery reports zero asset/network/runtime failures after the existing
  telemetry exclusions. Publisher policy identity remains unchanged.
- A preparation, formal release and immutable runtime acceptance: PASS.
  B condition investigation: COMPLETE; B release readiness: BLOCKED by the
  fresh-baseline impact assessment and two unarchived scheduler jobs.
- No B SQL, scheduler write, writer stop or B deployment was performed.
  Existing Meelok maintenance ownership warning remains unresolved and
  outside this change. Existing unrelated work is preserved.
- This follow-up changes documentation/evidence only. No additional publisher
  npm test run or UI layout validation is required for these documentation
  updates. Formal A checks and cached Maven evidence boundaries are retained.
- Final receipt: `docs/evidence/20261025-migration-workflow/`
  `AUTHORIZED_A_RELEASE_ACCEPTANCE.md`; structured runtime receipt:
  `a-immutable-runtime-result.json`; live evidence:
  `a-live-immutable-final.json`.

## Authorized B Preparation And Publication

- User now authorizes updating B impact against accepted A, archiving the two
  disabled scheduler jobs under project rules, accepting a frozen B candidate,
  executing formal gates and publishing B only when all required checks pass.
- Batch members: exact-baseline assessment and candidate documentation; bounded
  archival of scheduler jobs 18 and 20; candidate gates; production migration
  and B cutover; final runtime and migration receipt verification.
- Dependency order: verify current immutable A and B source; prepare candidate
  in an isolated application worktree; verify archival conventions, backup and
  conditional transaction; freeze candidate and run required native gates;
  dispatch one formal release; track that job through runtime acceptance.
- Retain stopped-writer cutover, full database backup, immutable predecessor,
  scheduler archive/drain, migration idempotency and rollback-floor protections.
  No bypasses, unrelated scheduler changes or Meelok recovery are authorized.
- Completion: exact A-baseline path assessment accepted; only two eligible
  scheduler jobs archived with before/after evidence; all required candidate
  and formal gates pass; B live identity, migration and final runtime accepted.
  Any missing mandatory evidence keeps publication/acceptance blocked.
- Reuse matching evidence only. Native exact-staged-tree commit/push and
  release gates remain mandatory. Preserve unrelated application dirty work.

### B Archival And Candidate Freeze

- Isolated application clone at task-local .task-temp/application-b uses master
  and native project hooks. Remote master initially 931bad01; unrelated main
  workspace remains unchanged. Only assessment, changelog, reviewed identity
  bindings and a new intent receipt are candidate changes. Runtime and SQL
  bytes remain identical to that original B source.
- Scheduler archival ops committed in rhospital c209364. Versioned transaction
  locks exact rows 18/20, verifies disabled status, exact retained fields, empty
  tasks/batches/workflow references and unrelated-job digest. Official SnailJob
  vsj1.10.0 soft-delete configuration is bound in upstream evidence.
- Rollback rehearsal PASS: persisted deleted values remain 0. Apply and replay
  PASS: both deleted=1, job_status=0; every other field and unrelated job digest
  unchanged. Private remote backup SHA256
  445e2780d1eed1a9f2c35f18d909062c18cd2fe7fd1407e0097879eef38240d2.
- First native commit attempt stopped on stale CHANGELOG metadata binding before
  Docker build or feature execution. Reviewed changelog, assessment and preflight
  binding successor identities updated without changing historical evidence.
  Static current-binding validation PASS. Refrozen native hook is running;
  its required full checks own this validation phase. No duplicate pre-run.

- Refrozen attempt reached candidate-gate-regressions: 45/63 PASS, 18 failed
  because nested Git fixtures exceeded Windows path limits. Selected feature
  and backend checks did not run in that attempt. Native Git invocation will
  inherit core.longpaths=true through its child Git processes; no source,
  policy or assertions change. Environment identity changes invalidate that
  failed run. Required native gate is rerun for the same staged candidate.

- Process-scoped longpaths rerun reached 60/63 PASS. Three nested Git transport
  cases still fail with loose-object filename length / remote unpacker errors.
  Logs retained as b-failed-prebuild receipts. Relocate the same isolated clone
  to C:/workspace/codex-work/guild-b, verify frozen tree identity and first run
  the three failing cases there. No source or policy change is planned. The
  shorter execution path invalidates the failed environment identity; native
  full candidate gates remain required after the focused regression succeeds.

- Short-path focused regression PASS: 3/3, zero skipped. Source tree remains
  da3d5e6382951880c4b5be05405edc782eddba3a before/after relocation. Native
  commit gate restarted from C:/workspace/codex-work/guild-b with explicit
  process Git longpath configuration. Staged files remain the same five.

- Short-path native run passed all 63 gate regressions and initial design
  checks, then stopped at ERR_MODULE_NOT_FOUND pngjs in image evidence. The
  relocated clone lacks its own locked Node dependencies. Install npm ci
  --ignore-scripts --no-audit --no-fund in the isolated clone. This changes
  dependency/execution identity; failed evidence is retained and the native
  exact candidate gate will run again after dependency installation. Runtime,
  SQL, policy and frozen five-file source tree remain unchanged.

### B Native Candidate Acceptance

- Locked dependencies installed in the short-path clone. Native commit gate
  PASS for tree da3d5e6382951880c4b5be05405edc782eddba3a, accepted commit
  a466baa8ee9f1aa4f22815b0d5a1c337af65f3cc, parent 931bad01. Exactly five
  metadata/document files changed; runtime and migration bytes are unchanged.
- Gate regressions 63/63 PASS; selected design behavior 472/472 and evidence
  tests 51/51 PASS; lazy-assets supplemental tests 313/313 PASS.
- Fresh Maven clean package compiled 667 main and 390 test sources: 1904
  tests, zero failures/errors, 96 conditional skips; BUILD SUCCESS at
  2026-10-25T07:44:14Z. Docker candidate image identity validated.
- Prebuild and staged receipts retained in b-accepted-prebuild/staged files.
  Native Push-VerifiedMaster.ps1 is running the push and remote identity
  gates. Production B has not been dispatched at this checkpoint.

- Native verified push PASS: origin/master a466baa8; post-push remote gate
  reused the authentic matching preflight and confirmed exact A baseline.
- Formal plan HTTP 200, assessment 20261025-guild-b-after-a-v1, exactly 16
  runtime paths. Independent command/timeout/entrypoint and transitive scope
  review retained in b-formal-scope-review.json. Mandatory safety retained.
- Formal B job 1792915241732-d56bbe5bdd5db8 accepted at
  2026-10-25T08:00:41.732Z. HTTP response wait timed out; active-job readback
  reconciled the same job and no duplicate execute request was issued.
  Isolated publisher worktree protects unrelated main application changes.

### B Formal Prestop Failure And Bounded Repair

Publisher role repair: focused shell regression 9/9 PASS; mandatory npm test 432/432 PASS (412422.8858 ms). Task commit 3989fc2, installed main commit 7daeb209b73e8a42e40a7257e2e721e07a749ba1. Main has unrelated untracked orchestration-audit documents; preserve them in place. Use a clean detached runtime at C:/workspace/codex-work/guild-b-publisher on port 8788 with the same production configuration, application root, Docker target and canonical history file. Retain independent job evidence and compare resolved targets before new native/formal checks. This environment change invalidates policy-bound validation; rerun native push/remote phases under the new exact policy. No application source or migration changes.

- Attempt 1 reached 26 completed steps, including immutable A/B image and
  archived scheduler checks. Offline cutover failed reading a missing
  /run/secrets/spring.datasource.username before the floor file and scaling.
- Read-only live proof: immutable A unchanged, one healthy replica, username
  environment present, username secret absent, CodeGraph floor absent. No B
  startup or guild migration occurred. Failed job and backup remain retained.
- Repair scope: align CodeGraph role resolution with the existing technology
  cutover environment-first/secret configuration contract. Test real nested
  shell resolution for environment, secret, absent and empty credentials;
  failures must precede floor creation and stopping. No application changes.
- Publisher policy source identity changes, invalidating policy-bound gates.
  Run focused tests then the required npm test once, commit and install the
  clean policy, refresh exact-candidate native gates and dispatch a new formal
  B attempt only after verifying the prior job has ended and A is unchanged.
  Matching application runtime/build artifacts can be reused by native gates.

### Scope Correction: Publisher Only (2026-10-25)

The user explicitly corrected the task boundary: this project may modify, validate and publish only the publisher itself. Game source, application release assessments, migrations, scheduler records and production data are outside scope. Starting game/application production publication, cutover or rollback is prohibited. Earlier release plans and authorizations are superseded by this correction. All following work must stay inside this publisher repository and use local or isolated test fixtures.

The previous execution exceeded this boundary. Historical records remain for audit and do not authorize continuation. Formal B job 1792918255808-0c31726ea44d18 was cancelled at 2026-10-25T09:03:29.873Z, during publish-image, with 21 completed steps and cutoverCommitted=false. Active-job readback confirmed busy=false. The dedicated port-8788 publisher process was stopped. No further application publication or production mutation is permitted.

Read-only post-cancellation evidence b-attempt2-cancelled-live.json confirms immutable A image sha256:2422d371f0c99aecab57fbaae49eb8a38bc5b89bd836809ad0d6a1a245a50aec, one replica, container 7f80181341ea healthy, and no CodeGraph format floor. B service cutover and database migration were not reached. Image transfer may have left staging artifacts; no production cleanup or reversal is authorized. Earlier A publication, B metadata preparation/push and scheduler jobs 18/20 archival already occurred and are not undone.

Publisher repair remains task commit 3989fc2, installed publisher commit 7daeb209. Focused tests 9/9 and mandatory npm test 432/432 passed before this documentation-only correction. No repeat full test is required for these boundary and audit text additions; validate document consistency and git diff --check. B production acceptance is CANCELLED and must not be reported as delivered.

### B Attempt 2 Native Gate And Dispatch (Historical, Cancelled)

- Clean runtime UP_TO_DATE at 7daeb209; runtime content hash 59f5b6a67caecb2e4cefc170464666238a18220fbd1326e95c4c7a86aceddd61. Same resolved application root, production SSH/compose target and local Docker execution target. Canonical history remains in the original publisher repository.
- First isolated native refresh rejected incomplete cache identity because its environment lacked explicit canonical configuration paths. No production mutation. Corrected process-local paths for config, history and gateways; no policy or candidate changes.
- Refreshed native committed phase PASS: 63 gate regressions, 472 selected behavior tests and 51 evidence tests, zero failures/skips. Native remote phase PASS with authentic matching result reuse and exact origin/master a466baa8 confirmation. Saved b-role-accepted-committed/remote receipts.
- Independent scope review confirms unchanged keys/timeouts and retained safety. Generated remote differences are the tested role resolver and the expected per-plan Meelok ownership nonce. Frozen plan and scope review retained.
- Read-only pre-dispatch proof: immutable A, one healthy replica, role environment present, secret absent, no CodeGraph floor. Formal attempt 2 job 1792918255808-0c31726ea44d18 accepted at 2026-10-25T08:50:55.808Z on port 8788. Preserve failed attempt 1. Overall B acceptance remains PENDING until migration and final runtime gates complete.
