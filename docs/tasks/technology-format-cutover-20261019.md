# Technology Format Cutover

## Objective And Boundary
Support the hospital technology catalog and supervision snapshot format migrations with an explicit offline writer boundary and vulnerable-image rollback refusal. Only the two named technology migrations activate this path. Keep ordinary game/forum releases and their existing checks unchanged. No production commands or deployment are authorized in this task.

## Method
Preserve the existing pre-release service snapshot. Before DDL, bind target image ID and SQL hashes, record recovery intent, stop the game service, verify all service tasks and containers have stopped, reject other database client sessions, and take a full custom-format database dump with checksum and pg_restore readability verification. Bind subsequent migration, pre-deploy and deployment checks to the stopped service snapshot and target image. Failures after the stop boundary require recovery review without automatic old-image restoration. Later rollback checks inspect the actual PreviousSpec and its immutable image for the new format classes before any mutation.

## Verification
Test positive and negative plan selection, protective trigger validation, command order, missing/stale receipts, live writers, altered image/source identities, rollback compatibility and recovery state. Execute generated guard commands against local mocks, retain ordinary-release and forum regression, then run npm test. Final review must identify code/policy evidence and remaining production-only checks. No release-console UI changes.

## Final Review
Overall Result: PASS

2026-10-19 local implementation acceptance on the existing main branch. The final complete npm test run reports369 tests,369 passed,0 failed,0 skipped in403.676 seconds. Six cutover shell tests execute generated commands against isolated local mocks. The Windows shell harness writes a temporary script file so command-line truncation cannot manufacture a partial successful run. No production command was executed.

| Intent | Evidence inspected | Result |
| --- | --- | --- |
| Activate only the complete paired technology migration | Registered step, missing-pair and missing-assessment checks, ordinary game/forum regressions | PASS |
| Stop old writers before backup and DDL | Actual generated shell with service replicas, terminal task states, local containers and database-session negatives; full dump/readability and hash-bound receipts | PASS |
| Bind migration, pre-deploy and deploy to the same offline state | Image and SQL hashes, original/quiesced snapshots, backup checksum, application-role capture and stale/missing-receipt negatives | PASS |
| Failures after the stop boundary require reviewed recovery | Failure and cancellation state tests retain RECOVERY_REQUIRED and prohibit automatic vulnerable-image restoration | PASS |
| Reject unsafe rollback before mutation | Actual PreviousSpec immutable image checked offline for both format classes; unknown database floor and incompatible image refuse | PASS |
| Keep other features independent | Ordinary availability probe retained; no feature validator, screenshot inheritance, external business evidence or UI change introduced | PASS |

Primary review covered gameTechnologyFormatCutover.js, its integration in releasePublisherCore.js, the scoped snapshot helper and their tests. External Claude was unavailable; canonical deepseek-flash high supplied text-only advisory. Primary agent retained all implementation and acceptance responsibility. Exact source digests and test output are retained in technology-format-cutover-20261019-evidence.json and technology-format-cutover-20261019-tests.txt beside this document.

## Production Boundary
This accepts publisher implementation and local tests only. Actual production writer shutdown, database identity, backup completeness, migration application, image rollout and post-release runtime checks must execute in a separately authorized release. The application assessment must select technology-offline-cutover. The publisher refuses the unverified standby path for this format change. No deductions, sanctions, production migration or deployment occurred.

