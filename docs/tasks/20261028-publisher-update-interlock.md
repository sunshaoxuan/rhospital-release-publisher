# Publisher update interlock

Base candidate: `b1eb055793362d254eb4c489d0c7ad62acb2bc42`.

Only publisher process coordination changes. Original visual styling and all game/forum validation, resource, signing, migration and recovery gates are retained.

## Ownership and lifecycle

- Job creation and publisher updates acquire the same exclusive directory in the canonical Git installation's `.service`, including detached runtime worktrees. No new network administration endpoint or credentials are introduced.
- Job acquisition precedes registration. Its lease covers execution and cleanup; setup/finalization failures release the owned lease. Terminal status with an outstanding controller still blocks automatic restart.
- Updates reject new plans/jobs. Unknown, incomplete or foreign locks remain fail-closed; no PID-based stale-lock deletion.

## First update from b9b28cb1

The deployed old entrypoint does not know the new lock. `scripts/update-publisher.ps1` additionally creates a unique untracked guard in the clean old runtime. It confirms Git sees exactly that guard and the actual API reports `UNCOMMITTED_CHANGES`, the same content identity and old runtime commit. The old synchronous gate runs after the full request body and directly before job registration. A subsequent actual activity GET therefore observes any request that already passed the gate; later requests are refused. A busy observation aborts without stopping the service. Unknown legacy versions are refused.

The updater verifies service process/path identity before stopping only the publisher service, retains audit files and supplemental receipts, then validates the new commit/protocol. Rollback restores only the prior publisher path. The legacy guard and lock are removed before reopening the restored old process, with no further destructive step afterward. Contradictory active jobs, concurrent service changes or failed rollback retain the barrier for review.

## Verification scope

Run affected npm tests for operation ownership, both job/update interleavings, job setup failure, cleanup lifetime, shared installation identity, the exact old b9 entrypoint with an incomplete HTTP request, and isolated PowerShell success/busy/drift/runtime-failure/rollback-failure transactions. Service/network commands in the PowerShell fixture are doubles; they cannot update a real publisher or application.

Reuse unchanged b1eb055 transaction/maintenance/UI evidence. Its 485-case evidence is combined coverage, not a single all-green full run. The new tests do not execute an application release. Final delivery must separately record the final commit, actual test results, remote/CI observations and actual publisher runtime identity. A loopback UI fixture is never production idle evidence.
