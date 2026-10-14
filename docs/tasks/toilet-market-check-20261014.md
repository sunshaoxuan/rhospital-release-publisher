# Toilet Market Independent Release Check

## Objective And Boundary

Register `verify-toilet-market` in the publisher, prove exact independent selection
and complete result validation, commit the scoped change, and verify that the
existing idle-reload mechanism loads it in the running publisher.

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
