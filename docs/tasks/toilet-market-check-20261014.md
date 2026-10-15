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

## Publisher Ownership Clarification: 2026-10-15

The user confirms that this task owns publisher usability and correct release
gate enforcement. The game owner supplies implementation, integration, a
committed impact assessment and candidate evidence meeting the publisher's
registered contracts. Candidate implementation and evidence repair stay with
that owner.

Publisher work covers candidate admission, exact check selection and execution,
result validation, runtime/repository identity, release safety and audit receipts.
Reject unmet implemented requirements through their applicable gates and report
the failing stage, candidate identity, reason and smallest owner action. Keep
evidence limitations distinct from conditions actually enforced by the publisher;
new gate behavior requires a scoped contract and behavioral tests.

This clarification authorizes no game edits, evidence rewriting or production
execution. Task-directory cleanup remains independent maintenance with its
existing BLOCKED result and is never a release prerequisite. Do not expand this
task into game implementation acceptance or unrelated environment governance.

For this documentation-only update, completion requires scoped diff/reference
checks, a commit containing only this task's changes, and a live idle-reload
observation showing clean matching publisher identities and the exact accepted
toilet contract. Retain the existing code-test evidence without rerunning an
unchanged candidate or policy. Record the observation in the current review
receipt and distinguish it from the earlier candidate-review timestamps.

Pre-commit scope review: PASS, only this task document and CHANGELOG are changed;
diff whitespace and five relevant reference checks pass, exit 0. At
2026-10-15T02:49:17.166Z the live policy accepts the exact toilet contract and
the publisher is idle. UNCOMMITTED_CHANGES correctly reflects these two pending
documents; runtime contentHash is unchanged. Game and production actions remain
NOT_RUN, cleanup remains BLOCKED_INDEPENDENT. Post-commit runtime verification
is recorded separately in the current review receipt.

## Publisher Usability Audit And Repair: 2026-10-15

The user requests actual publisher inspection and fixes where defects are
demonstrated, beyond documentation. Primary goal: compliant immutable game
candidates can reach the normal release workflow, and failed or incomplete
candidate checks cannot pass its safety boundaries. The publisher owns repairs;
the game process owns implementation, integration and evidence submission.

Method and observable completion criteria:

1. Trace admission, committed assessment reads, plan construction, exact local
   check execution/result validation and job/result persistence. Inspect current
   publisher availability through bounded read-only APIs. Keep the audit tied to
   normal release usability and gate correctness.
2. Reproduce concrete defects with isolated fixtures and focused regression
   tests before applying minimal publisher changes. Distinguish a product defect
   from an expected candidate rejection or an unexecuted production check.
3. Verify successful paths and relevant negative cases, then run npm test for
   code changes. Use simulated executor/remote dependencies only; never invoke
   /api/execute, production publication, migrations or image switching.
4. List the game's actual submission/evidence contract with gate names and
   failure reasons. Do not modify game sources, Git state or acceptance data.
   Temporary cleanup stays independent and its BLOCKED state is unchanged.
5. Review scoped changes, update CHANGELOG, commit verified publisher repairs,
   and use the existing idle reload without interrupting jobs or starting a
   listener/service. Confirm clean matching runtime/repository identity and live
   registered policy. Record actual results and unresolved limitations in a
   publisher audit receipt under the existing evidence directory.

Initial classification: publisher root-cause investigation and gate-boundary
review by the main agent. Choose implementation scope after evidence identifies
a defect; obtain external advisory only if the resulting implementation meets the
advanced multi-module task criteria. No UI or game implementation work is planned.

Reproduction established three publisher defects, using synthetic repositories
and plan decoding only. A permitted proposed-fast-forward dry run warms a cache
that is returned before the next request's branch admission check. A generated
combined plan selects 21 registered local checks, while decodeChecks rejects
more than 20. Its fixed 3600-second outer timeout also truncates the selected
checks' own budgets (10020 seconds in this fixture). The regression run exits 1,
with all three assertions failing; no candidate or production command runs.

Implementation scope is two small publisher runtime edits plus regression tests:
perform per-request branch admission before cached diff reuse; retain payload
byte bounds, unique keys and registry validation without the obsolete count cap;
set the outer preflight budget to at least the selected timeouts plus 60 seconds
for startup/reporting while retaining the existing 3600-second minimum. Individual
timeouts, including toilet 180 seconds, and all core/feature gates stay unchanged.
These local condition/order fixes are handled directly by the main agent.

Focused repair verification: exit 0, 5/5 tests for cached branch admission,
combined plan decoding/budget and the exact toilet plan. Policy/runner regression:
exit 0, 21/21 tests. Both runs have zero failure/skipped/cancelled/TODO counts.
The new negative payload test retains encoded size, shape, unique/known key,
command length/aggregate refusal and safe integer timeout bounds. npm test is
required before commit; its final result and post-commit live observations go in
the audit receipt, without replacing earlier candidate observations.

Independent scope review: server analysis, plan and execution preparation all
call analyzeReleaseChanges, whose per-request admission now precedes cached diff
reuse. createPlan encodes only selected registered checks, decodeChecks validates
them, runChecks validates each result and completed preflight coverage is checked
against the plan before audit-step reuse. executePlan passes the computed outer
timeout to runPowerShell without a separate 3600-second clamp. No foreign evidence
dependency or check entrypoint is added. Existing source drift/isolation evidence
remains scoped to the previously reviewed unchanged game validator; this audit
does not claim a new game implementation or production acceptance.

### Game Process Submission Requirements

1. Supply an immutable complete commit that exists in the configured game Git
   repository and belongs to the selected release branch. If using the remote
   branch, complete its authorized push/refresh handoff and verify that exact
   commit. Proposed fast-forward permission is restricted to an explicit dry-run
   request and cannot authorize formal publication. Uncommitted overlays are
   excluded from the detached release worktree.
2. Commit a fresh release/release-impact.json covering exactly the actual runtime
   diff from the publisher's production baseline. Include a new assessment ID,
   summary, risk, code/database impact, CheckList decision and reasons for unique
   registered required checks. A changed CheckList decision must match actual
   assessment changes. Missing, stale, extra or unavailable declarations reject.
3. Select only applicable feature checks and commit their entrypoints, final
   source bindings and owning evidence bundles. Toilet uses the exact command,
   three inputs, 180 seconds and marker recorded above. Exit 0 plus one complete
   positive Node summary with tests equal pass and zero fail/skipped/cancelled/
   TODO is required. Relevant source or screenshot drift invalidates evidence;
   another feature's PASS or unavailable unrelated historical screenshots cannot
   substitute for the owning bundle. No fixed test count or TTY is required.
4. Keep mandatory backend, pre-deploy, final runtime and static delivery checks.
   Database changes must declare impact; changed migrations must select
   apply-database-migrations and satisfy the existing versioned, idempotent,
   ownership, backup, safety and rollback contracts. Required local/runtime pairs
   remain paired. The game owner repairs implementation and candidate evidence.
5. Preserve real FAIL/BLOCKED/UNVERIFIED evidence. Supply candidate identity,
   selected checks, raw exit/output, evidence locations and remaining gaps.
   Previous receipts retain their timestamps and policy identities; they do not
   certify a changed candidate or current production. Production environment,
   migration readiness, image and final health checks run only in an explicitly
   authorized release. No such execution is authorized in this task.
6. Development QA cleanup is independent maintenance, currently BLOCKED. It is
   absent from the release prerequisites and must not prevent a compliant
   committed candidate from entering the normal release gates.

Final pre-commit review: PASS. npm test exits 0 with 340/340 tests, zero failures,
skips, cancellations or TODO. Focused runs remain 5/5 and 21/21, exit 0. The red
reproduction exits 1 (three defects, four reported failed test nodes including
the combined parent). git diff --check passes. Review covers the two runtime
edits, two test files, this guidance and CHANGELOG only. No new dependency, UI,
game change, cleanup retry or production action is included. Post-commit runtime
reload, exact identity/contract and read-only plan outcomes are recorded in
C:/workspace/rhospital-release-publisher/.service/evidence/toilet-market-check-20261014/PUBLISHER_AUDIT.json
and PUBLISHER_AUDIT.md; existing historical receipts retain their original scope.
