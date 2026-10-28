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

## Windows delivery compatibility follow-up

The e280334 installation exposed two updater defects. Evidence directories now use same-target NTFS junctions: Git treats directory symbolic links as files, so directory-only ignore patterns do not cover them. The updater checks its prepared runtime is Git-clean before stopping the existing service. It does not broaden ignore rules or ignore source drift.

Service command comparisons now preserve argument identity while allowing whole-argument quotes to be added or removed. Quoted whitespace remains part of one argument; losing that grouping, changing an argument or adding a flag is a mismatch. Unsupported escaping fails closed. Root selection uses the parsed argument array and rejects duplicate/missing roots. PID/state checks and operation ownership remain mandatory; rollback verifies the restored command identity before releasing guards and reopening the old process.

Use `scripts/update-publisher.ps1` from the commit containing this follow-up for the next publisher update, with that next candidate's full `-CandidateCommit`. Do not reuse the older temporary UI deployment script. This source-only follow-up does not restart the already healthy e280334 runtime. Existing administrator execution is still required for file links and service management; no elevation or account/ACL changes are added to the updater.

Regression coverage includes 13 isolated service transactions, command-identity positive/negative cases, and a real temporary Git repository proving junctions retain existing directory-ignore behavior. Service/network operations remain doubles. Do not wrap the Windows PowerShell updater in a parent `ErrorActionPreference=Stop` / `*>` native-output pipeline: normal Git stderr progress can become a false parent error. Use a direct administrator terminal or raw native stdout/stderr capture.
