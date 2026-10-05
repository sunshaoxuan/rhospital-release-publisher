# A-Only Release Policy Verification, 2026-10-05

## Requirement Change

Normal formal game releases use the original A-only publisher path. B candidate
distribution, verification, helper cutover and acceptance require the explicit
boolean request `requireStandbyCandidate: true`. The ordinary console request
omits it. A-only releases leave B acceptance metadata unchanged.

Core source, build, production configuration, database, CheckList, final runtime
and rollback gates remain in place. Assessment-declared checks remain mandatory;
an unavailable selected B check is not silently removed from an assessment.

The existing draft had moved `formalComposeSource` inside the B-only condition
while A Compose generation still used it. Focused tests reproduced
`ReferenceError: formalComposeSource is not defined`. The shared source is now
resolved for either formal mode, with image-only behavior unchanged.

## Local Checks

- Ten focused A-only, explicit dual-node, A rollback, B gate, dry-run command and
  phase mapping regressions passed.
- Core and affected test JavaScript syntax checks passed.
- Final `npm test`: 293 passed, 0 failed, 0 skipped, exit code 0;
  duration 571338 ms (approximately 9.5 minutes).
- Document scope/links, the single `2026-10-05` CHANGELOG section and staged
  whitespace checks passed.

The first full run exposed two assertions retaining the former default-B policy.
It was stopped after that evidence. Default command and validation assertions now
verify the original A image delivery; standby phase mapping uses an explicitly
dual-node plan. The final full run uses these corrected tests.

Execution tests inject command runners and never issue production commands. A-only
success explicitly checks that no B CLI is invoked and that backend tests, static
predeploy checks, CheckList, image publication, deployment, final runtime, static
delivery and container cleanup all complete. Explicit dual-node tests still enforce
B failures and ambiguous acceptance recovery.

## Live Publisher Observation

Read-only requests used the actual listener `192.168.20.218:8787`. Before this
change was committed, `/api/version` reported `UNCOMMITTED_CHANGES`, loaded runtime
`0.2.0+c9788a6b`, repository commit `d263185`. `/api/jobs/active` reported `busy: false`.
The repository also contains previously preserved SMTP changes in README, core and
core tests. Those changes require separate authorization before review/commit.

A-only engine tests do not establish live release readiness. Publisher version
consistency remains mandatory. No publisher restart, production release, B start,
database mutation/promotion or traffic switch was performed by this verification.

## Cleanup Limitation

Temporary full-suite logs were removed after recording the results. Recursive
cleanup of `.qa/a-only-validation` stopped on read-only Git fixture objects.
Those task-local residues remain; no unrelated files were removed. The earlier
dual-node task's cleanup limitation is recorded separately in its verification.
