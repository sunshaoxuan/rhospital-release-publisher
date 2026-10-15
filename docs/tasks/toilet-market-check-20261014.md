# Toilet Market Independent Release Check

## Objective And Boundary

Current user objective (2026-10-15 Asia/Tokyo): make the publisher usable for normal
game releases of candidates that satisfy the applicable release requirements.
The original scoped work registers `verify-toilet-market`, proves exact independent
selection and complete result validation, commits the change, and verifies that
the existing idle-reload mechanism loads it in the running publisher.

Read application handoff material only at
`C:/workspace/codex-work/toilet-market-blackbox-20261013/master-integration`.
Preserve existing work. Do not edit hospital-backend or application evidence, run
a game release, migrate data, switch images, change authentication/networking,
install services, start another listener, or interrupt an active publisher job.
Keep all unrelated feature and mandatory safety gates unchanged.

## Exact Contract

- Key: `verify-toilet-market`
- Command: `node --test src/test/js/toiletMarket.test.mjs src/test/js/toiletMarketEvidence.test.mjs && node scripts/validation/toilet-market/validate-evidence.mjs`
- Timeout: 180 seconds
- Inputs: exactly the two tests and validator named in the command
- Success marker: `PASS toilet market barter, hourly positions, legacy-safe migration, runtime visuals and final source binding`
- Node test counts: complete supported summary, positive tests equal pass, zero
  failures/skips/cancellations/TODO; no fixed expected test count or TTY dependence
- Process: exit code zero, no execution error or terminating signal

## Method And Acceptance

1. Trace assessment selection, plan, candidate execution, policy and result reads.
   Follow current patterns and retain registered feature isolation.
2. Round one: verify exact key/command/timeout/inputs; reject missing, extra,
   duplicate, cross-feature, aggregate and wrong selection or timeout drift.
3. Round two: read actual transitive imports/calls/evidence dependencies. Verify
   relevant source drift rejection and unrelated evidence isolation using the
   smallest sufficient read-only application evidence/tests. Separate fixtures
   and policy PASS from actual application acceptance.
4. Run focused publisher tests and `npm test`; document actual exit codes/counts,
   review final intent and diff, and commit only this task's files.
5. Recheck `/api/jobs/active`, wait for idle self-reload without killing jobs, then
   read `/api/version` and its in-process contract validation for live acceptance.
   Record runtime/repository commits and contentHash, dirty and matching status.
6. Record PASS/FAIL/incomplete by criterion and absolute evidence paths. Keep the
   game's final matrix FAIL while Docker/cleanup/evidence blockers remain.

The registered command uses shell-free fixed Node invocations for this key only,
with a shared 180-second budget and short circuit on a failed process. Existing
PowerShell checks keep their current execution path.

The handoff candidate is in an independent checkout; its commit object is absent
from the live publisher's game repository. Do not import or mutate game Git data
to manufacture a plan. Extend the existing read-only `/api/version` response with
`localCheckContracts` for exact registered contracts, including policy validation
performed by the running service. This verifies live policy acceptance without a
game execution; a real candidate plan awaits game integration.

No visible UI change is intended; browser visual acceptance is outside this
policy-only change. Runtime HTTP inspection is required.

## Initial Evidence

- 2026-10-14: git worktree clean before this task.
- Live `/api/version`: `0.2.0+cf161d3f`, runtime/repository commit
  `cf161d3faa0c42a0c9759088de780c492cc0fd26`, contentHash
  `3c6053a6aff58ef8187fa1d5480a8700f544991163625178df15e62b26ed57e6`,
  both dirty=false, status=UP_TO_DATE, processId=17540.
- Live `/api/jobs/active`: job=null, busy=false.
- `src/localCheckPolicy.js` has no toilet-market registration.

## Results

- PASS: exact policy and shell-free shared-budget execution implemented; other
  feature commands, forum behavior and mandatory safety gates retain their rules.
- PASS: focused policy/execution suite exit 0, 20/20; exact plan/mandatory ordering
  and forum rejection test exit 0, 1/1.
- PASS: separate command and transitive/evidence review is recorded in
  `docs/evidence/toilet-market-check-20261014/POLICY_REVIEW.md`.
- PASS: actual read-only application Node tests 24/24, zero failed/skipped/
  cancelled/TODO; related-source drift and unrelated-evidence isolation tests pass.
- FAIL: actual application final validator exit 1, final intent acceptance
  incomplete. Its source digest stayed unchanged across the check. Preserve the
  game's FAIL/BLOCKED matrix and Docker/cleanup blockers.
- Corrected: initial full publisher suite found a new test's shadowed step
  variable; targeted plan rerun passed. Nested test harness context and cancellation
  fixtures were corrected and real categories asserted. Final focused suite passed.
- PASS: final `npm test`, exit 0, 336/336, fail/skipped/cancelled/TODO all zero;
  `git diff --check` exit 0; frozen spec fixture exactly matches the actual sample.
- PASS: pre-commit intent review confirms the exact contract, independent calls,
  fail-closed output, mandatory safety checks and preservation of unrelated work.
  Scope is limited to policy, planning, execution, read-only version metadata,
  focused tests and related documentation. No UI or application file is edited.
- Commit and live idle-reload verification are recorded after the clean commit in
  `C:/workspace/rhospital-release-publisher/.service/evidence/toilet-market-check-20261014/VERIFICATION.md`.
  That operational receipt is the final closeout extension of this task record;
  runtime acceptance requires matching clean identities and live policy acceptance.
- NOT_RUN: formal live plan for the game handoff commit, which is absent from the
  configured game repository; game integration owns the next action.

Publisher registration and game acceptance have separate outcomes. No synthetic
fixture output is used as real game acceptance. A learning candidate for the
nested Node harness is retained under
`C:/workspace/codex-selfimp/outputs/toilet-market-check-20261014/`; no rules were
installed.

## Cleanup Continuation: 2026-10-15 Asia/Tokyo

User requested investigation of the CreateProcess cleanup rejection, compliant
task-local cleanup, updated receipts and a fresh live publisher version check.
The actual existing target is
`C:/workspace/rhospital-release-publisher/.qa/toilet-market-20261014`.
The user message's `rhospital-release-publisher.qa` path does not exist.

Method: inspect only relevant command-policy metadata and this task's rejection
records; distinguish tool-policy decisions from Windows errors. Do not bypass,
disable or edit execution rules, switch deletion tools, or change permissions.
Any permitted native cleanup must first verify the resolved exact target and
task containment. Preserve delivery evidence under `.service/evidence/`.
Do not modify game sources or evidence, start a release, interrupt active jobs,
install a service or start another publisher listener.

Acceptance: supported rejection classification, confirmed absence of this exact
temporary directory, accurate updated receipts and a clean matching runtime /
repository commit and contentHash with live toilet policy acceptance. If policy
still denies cleanup, preserve BLOCKED and the smallest required external action.
Documentation-only updates require scoped static checks and a scoped commit;
publisher/game behavior tests remain valid for unchanged code and source.

Continuation results:

- PASS: resolved exact target is contained in the task repository, with zero
  reparse points; the read-only inventory contains 6362 files.
- CLASSIFIED: both refusals are tool execution-policy rejections before process
  creation. No Windows error code or file-removal exit code was returned.
  PowerShell read commands run; observed CurrentUser and LocalMachine execution
  policies are RemoteSigned, with MachinePolicy/UserPolicy/Process undefined.
  No policy or permission setting was changed.
- LIMITED: side-effect-free `execpolicy check` on the exact original PowerShell
  wrapper and the existing local `default.rules` returned exit 0 and no matched
  rules. This does not evaluate every executor/managed guard. The internal rule
  or rejection rationale is unavailable; ACL, locks and antivirus are unproven.
- BLOCKED: one identical guarded native cleanup retry at
  `2026-10-14T15:55:55.062Z` was rejected before process creation. The exact
  directory still exists. No alternate deletion tool, shell, syntax variant,
  policy bypass, game edit or production action was attempted.
- The existing `.service/evidence/toilet-market-check-20261014/` receipt records
  the original rejection, read-only diagnostic, current retry and final live
  runtime check separately. Prior publisher tests remain valid for unchanged
  code; this continuation requires only document/JSON/reference checks.
- NEXT: the execution-policy administrator must identify the denial and permit
  this exact authorized task-local cleanup under the applicable policy. Retry
  only after that decision; verify directory absence and update the receipt.
  Maintenance closeout remains INCOMPLETE_TEMP_CLEANUP until actual removal
  succeeds. The user's subsequent usability scope below makes this independent
  of candidate acceptance and production release prerequisites.

## Publisher Usability Continuation: 2026-10-15 Asia/Tokyo

The user clarified that the primary objective is normal game publication. Keep
the completed registration and all compatible safety boundaries above. Separate
publisher usability, candidate acceptance and development-directory maintenance.
The outstanding `.qa/toilet-market-20261014` cleanup remains BLOCKED; its presence
must not be promoted into a production release prerequisite. A support feedback
draft is diagnostic material, not a prerequisite or the main deliverable.

Method and observable acceptance:

1. Read the live publisher version, activity, configured game repository and
   read-only plan path. Report only whitelisted non-secret configuration fields.
2. Trace the normal single-node game plan and cleanup dependencies. Retain exact
   candidate impact, mandatory safety checks and genuinely applicable feature
   acceptance. Do not enable standby mode or edit game declarations/evidence.
3. Check candidate availability and, where available, request only the read-only
   plan. Do not create an execution job, refresh/import game Git objects, build,
   migrate, deploy, switch images or remove evidence.
4. Fix a demonstrated publisher defect only within this repository, with focused
   regression tests and `npm test` before commit. If the blocker belongs to the
   game candidate or environment, record its owner and smallest remaining action.
5. Validate document accuracy and references, commit only this task's changes, and
   confirm the existing idle reload returns clean matching runtime/repository
   identities. Preserve the real game FAIL and the separate cleanup BLOCKED.

Completion requires a working live plan entry and a precise readiness account;
it does not claim a production release has occurred. Candidate acceptance still
requires game-owned final evidence before a production execution can be approved.

Pre-commit review and scoped results:

- PASS: source review finds no `.qa` or task-cleanup dependency in `server.js`,
  `src`, `scripts` or `public`. Production container cleanup follows final runtime
  acceptance; deletion failures warn while target service health remains checked.
- PASS: `node --test --test-name-pattern='^post-release cleanup '
  test/releasePublisherCore.test.js`, exit 0, 2/2, zero other summary categories.
- PASS: `node --test test/releaseDiagnostics.test.js`, exit 0, 13/13, zero other
  summary categories. These tests use simulated services and no production action.
- PASS: initial live runtime is `0.2.0+dcd54b27`, commit
  `dcd54b27de9ec5d04947de843b20ceefa4015654`, matching clean repository identity
  and contentHash `843e62dc43fb91d8a739b19b867f53716fc25217a758a46543a807fb5c5d2ff5`;
  live toilet policy is accepted and `/api/jobs/active` is idle.
- BLOCKED_CANDIDATE: the game's handoff commit
  `1f6138a7ffb09f884a2c573b9f99df47e0fbb05c` is still absent from the configured
  game repository. Its game-owned final report remains FAIL/BLOCKED.
- OBSERVED: latest stored game history is RECOVERY_REQUIRED, with
  `restore-meelok-services` failed. This is historical evidence, not a fresh
  production observation. No recovery operation is authorized or performed here.
- Review: only task guidance and its CHANGELOG entry change. Existing publisher
  runtime code and the completed 336/336 `npm test` evidence remain unchanged.
  The live read-only plan and post-commit identity receipt are recorded under
  `C:/workspace/rhospital-release-publisher/.service/evidence/toilet-market-check-20261014/PUBLISHER_USABILITY.md`.
  Do not reinterpret a plan PASS as game acceptance or completed publication.

## Latest Candidate Review After Docker Recovery: 2026-10-15

The user requests a fresh check of toilet candidate integration and final
acceptance, identification of actual release blockers, and resolution of
demonstrated publisher-side issues. Docker server readiness has recovered.
Task-directory cleanup is maintenance only and is never a release prerequisite.

Method and completion criteria for this continuation:

1. Read current candidate/report identities and local Git integration state in
   the handoff checkout and configured game repository. Do not fetch, merge,
   check out, alter game Git data, or modify game sources or evidence.
2. Inspect current final acceptance data and validator dependencies. Reuse valid
   unchanged results; execute a scoped validator only when freshness or missing
   evidence requires it and its execution is read-only for the game checkout.
3. Compare exact registered policy and candidate impact with a read-only live
   release plan when the target is available. Keep mandatory safety checks and
   unrelated-feature isolation. Do not execute a release job, build containers,
   migrate, switch images, or change production configuration.
4. Fix only evidenced publisher defects, with focused regression tests and
   npm test for any code change. Record source review when no publisher defect
   is established. Pure documentation changes receive relevant static checks.
5. Commit this task's scoped changes, let the existing idle reload settle, and
   confirm clean matching runtime/repository commit and contentHash plus actual
   in-process policy acceptance. Preserve all genuine FAIL/BLOCKED evidence.
6. Deliver a current blocker list with owners, evidence identities and the
   smallest remaining actions. Distinguish candidate readiness, publisher
   usability, unexecuted production gates and independent maintenance cleanup.

Initial live observation at 2026-10-15T02:27:18.759Z: runtime
0.2.0+04238953, UP_TO_DATE, runtime/repository commit
0423895380c25cfae5e9f157cf35f073845d29ca, equal contentHash
843e62dc43fb91d8a739b19b867f53716fc25217a758a46543a807fb5c5d2ff5,
both clean, toilet policy accepted, no active publisher job. Latest candidate
and acceptance conclusions remain pending this continuation's observations.

Read-only candidate review before the publisher documentation commit:

- PASS: Docker Linux server 29.8.2 responds at 2026-10-15T02:28:12.424Z.
  No service, container, context or endpoint was changed.
- PASS: handoff and configured game repository local master contain
  20b8f724b9019edc07a724a6f78ed6cf1a6945b3, tree
  f2f4f02df1b21ffec4a1da864cb39d0bcdbccc2f, parents f907b303 and 1f6138a7.
  The frozen handoff is clean. Other tasks' current game edits remain untouched;
  their worktree/index content is outside this immutable candidate's acceptance.
- PASS: the current game report/matrix records 42 candidate acceptance rows PASS.
  The standalone read-only evidence CLI exits 0 with the exact registered marker.
  Both checkouts' 45 scoped source identities equal
  c6a28f4828944b6fe172d90e22459a9cd56dfd8171eea902a512a401cb8cef18.
  This supersedes the earlier missing-candidate and 40/4 matrix observations;
  their timestamps and original failure receipts remain historical evidence.
- PASS_RETAINED: original commit hook exit 0 and all nine selected local checks
  passed for tree f2f4f02d under publisher 04238953. Toilet Node summary is
  24 tests / 24 pass with fail, skipped, cancelled and TODO zero. Counts are
  observed from complete existing output, never a fixed expected test count.
  The recorded backend suite has 1644 tests, zero failures/errors and 53
  conditional skips; this is separate from the strict Node success protocol.
- DEFAULT_REMOTE_HANDOFF_PENDING: a fresh read-only remote query at
  2026-10-15T02:29:02.111Z returns master f907b303e8645e6aca320b07867369b55556e52f.
  The accepted local merge has not been pushed. The UI's origin/master path and
  a deliberately selected local master are distinct paths; report each live plan
  result without turning remote synchronization into an invented universal gate.
- QUALITY_LIMITATION: the cumulative game's committed assessment retains Safari
  hardware UNVERIFIED and fullProductAccepted=false for compressed transport.
  The game acceptance owner must resolve its declared missing-gate disposition.
  Do not add Safari to the independent toilet policy or fabricate product PASS.
- NOT_RUN: production database readiness/migration, pre-deploy execution, cutover,
  final runtime/front-host verification and historical recovery remediation.
  The stored RECOVERY_REQUIRED item alone does not prove current production health.
- SOURCE_REVIEW: no demonstrated publisher runtime defect. Exact policy, pinned
  committed assessment reads and branch membership checks retain their existing
  boundaries. No game-source or acceptance-evidence edits are authorized here.

Only this guidance and CHANGELOG change in version control. Existing publisher
code test results remain applicable: npm test 336/336, focused policy/executor
20/20 and toilet plan 1/1, all exit 0. This documentation-only continuation uses
diff/reference checks, actual read-only evidence validation, retained-output
protocol assertions and live HTTP plan/version verification. Final post-commit
observations, precise blockers and exact contract are delivered in
C:/workspace/rhospital-release-publisher/.service/evidence/toilet-market-check-20261014/LATEST_CANDIDATE_REVIEW.md
and its JSON sibling. Existing usability receipts are marked historical and link
to that current review. No /api/execute, game publication or cleanup retry occurs.
