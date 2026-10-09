# Active release incident investigation

## Objective

Identify the current release job, its first abnormal step, the underlying log evidence, and whether production actions have occurred. Report the immediate safe next action.

## User constraints and scope

- The user reports that a release is currently running and may have failed.
- Read publisher status, persisted jobs, history, and relevant code or logs only.
- Do not cancel, restart, retry, deploy, alter production, or edit the game product during diagnosis.
- Preserve unrelated work and active jobs. If a product change is required, provide a product-team prompt under the existing publisher-only boundary.

## Method and acceptance

1. Correlate the live job ID, status, step, timestamps, and candidate identity with persisted records.
2. Find the first failure or stalled operation in raw logs, then identify its owning component and impact.
3. Verify whether production mutation has started using completed step evidence.
4. Report confirmed facts, uncertainty, and the smallest safe next action. Do not label a running step failed without evidence.

## Final review

- Objective: PASS for diagnosis. Job `1791531605681-de3d4459a32dc` attempted game tag `20261009` from commit `5a719e00da23f46b75b5aa7768deccfc5c357523`. Step 36, `commit-game-cutover`, failed when Swarm rollout entered `paused` with no healthy target task. The underlying reason for the Swarm pause remains unproven. New containers eventually opened port 8090, then shut down during the failed rollout.
- Read-only boundary: PASS. Only publisher state, production Docker inspection and logs, and HTTP probes were read. No release, cancellation, restart, or manual recovery was initiated by this investigation.
- Recovery evidence: PASS for automatic rollback. The latest release history records `ROLLED_BACK` at `2026-10-09T08:13:44Z`; the rollback command logged `automatic_rollback_validation=PASS`. Production Swarm reports `rollback_completed`, image `hospital-backend:20261007`, replicas `1/1`; origin HTTP on port 8190 returned 200 and Compose again names `hospital-backend:20261007`.
- Residual risk: Two database migrations completed before deployment. Automatic rollback suspended ACTIVE ADMIN listings before returning to old code. The number of affected listings and authenticated client workflows were not independently checked. Do not retry this candidate until the rollout pause and business-data effects are reviewed.
