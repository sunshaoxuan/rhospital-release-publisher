# Active release incident investigation

## Objective

Identify the current release job, its first abnormal step, the underlying log evidence, and whether production actions have occurred. Report the immediate safe next action.

Follow-up objective: determine why Swarm paused the `20261009` rollout. Correlate Docker task, health, daemon, and application evidence before assigning a root cause. Record any remaining uncertainty explicitly.

Current follow-up: explain why host memory was exhausted during cutover. Reconstruct concurrent JVM and other workload memory demand, deployment overlap, host capacity and swap, and resource policy from read-only evidence. Distinguish measured usage from estimates and identify the remaining evidence needed for exact attribution.

Remediation objective: implement publisher-owned orchestration for the user's chosen no-expansion approach. Pause the exact Meelok workloads before a formal game rolling cutover, then automatically restore their original state after the old game task has exited and the new game task is healthy. Controlled failure, cancellation, and rollback must also restore Meelok. Do not initiate a release in this task.

## User constraints and scope

- The user reports that a release is currently running and may have failed.
- Read publisher status, persisted jobs, history, and relevant code or logs only.
- Do not cancel, restart, retry, deploy, alter production, or edit the game product during diagnosis.
- Preserve unrelated work and active jobs. If a product change is required, provide a product-team prompt under the existing publisher-only boundary.
- The user authorizes temporary Meelok downtime during a game release if it materially saves memory. This does not authorize stopping Meelok now, changing game product code, or initiating a release.
- The user explicitly rejects host expansion and requests Meelok pause during game rollout followed by automatic restart after old-game exit. Preserve this direction while reporting residual capacity risk; do not substitute expansion as a prerequisite.

## Method and acceptance

1. Correlate the live job ID, status, step, timestamps, and candidate identity with persisted records.
2. Find the first failure or stalled operation in raw logs, then identify its owning component and impact.
3. Verify whether production mutation has started using completed step evidence.
4. Report confirmed facts, uncertainty, and the smallest safe next action. Do not label a running step failed without evidence.
5. For the follow-up, reconstruct the failed rollout timeline and distinguish an application failure from a health, host, or Swarm update failure using read-only production evidence.
6. For the memory follow-up, compare time-correlated kernel and container records with JVM settings, Swarm update policy, and host memory capacity. State the trigger and preventable configuration conditions without asserting unavailable per-process history.
7. For remediation, inspect the exact Meelok service ownership and memory footprint, publisher execution and rollback boundaries, and current release status. Implement the smallest publisher change that preserves Meelok's original desired replicas, stops the exact services before cutover, and restores them on all controlled outcomes. Fail closed before production game mutation when pause or restore readiness is unproven.
8. Verify affected success, failure, rollback, and restoration behavior with unit tests and `npm test`; review the release plan and production impact without executing it. Commit verified publisher changes. Record any crash or host-OOM recovery limitation explicitly.

## Findings and final review

- Incident identity: job `1791531605681-de3d4459a32dc` attempted game tag `20261009` from commit `5a719e00da23f46b75b5aa7768deccfc5c357523`. Step 36, `commit-game-cutover`, failed when Swarm rollout entered `paused`.
- Immediate cause: production kernel `journalctl -k` at `2026-10-09 08:00:40 UTC` records a global OOM and kill of Java PID `3384448`, anonymous RSS `3365356 kB`. The kernel cgroup maps to old game container `10b91d2f...`; `docker inspect` reports image `hospital-backend:20261007`, `OOMKilled=true`, finished at `08:00:41 UTC`. Docker manager heartbeat errors and task replacement followed in the same incident window. This explains the Swarm pause with high confidence.
- Capacity trigger: old game container and new `20261009` container overlapped from `07:58:20` until the OOM under the configured `start-first` policy. At OOM the kernel task table reports old game anonymous RSS about `3.21 GiB` and new Java about `0.90 GiB`; other Java services, MySQL, databases, and infrastructure were also resident. `sar -r -f /var/log/sysstat/sa09` records available host memory of about `1.19 GiB` at `07:50 UTC` and `0.33 GiB` at `08:00:40 UTC`. The host has about `7.75 GiB` RAM and no Swap. Both game containers have `JAVA_OPTS=-Xms512m -Xmx3g`; the game service has no memory reservation or limit. The publisher configuration guard checks configuration identity but no memory headroom. The overlap therefore had insufficient proven capacity before cutover.
- Attribution limit: the kernel table lists five Java processes, including SnailJob and two other Java services. PostgreSQL RSS includes shared pages and cannot be summed as unique memory. The old game logged no application-level `OutOfMemoryError` in the 15 minutes before the kill. No pre-incident heap dump or process-memory time series was found in this investigation. RSS near `3.21 GiB` does not prove a full 3 GiB live heap, a memory leak, or which application feature drove growth. Current `jcmd 7 GC.heap_info` on the restored game shows about `1.36 GiB` heap used with about `1.97 GiB` committed, which is a later sample, not incident-time proof.
- Objective: PASS for explaining host OOM and rollout failure; exact application heap-growth attribution remains UNVERIFIED. Production `docker stats`, `free`, `sar`, kernel logs, container inspect/logs, and service inspect were read only. No release, cancellation, restart, configuration change, or manual recovery was initiated by this investigation.
- Recovery evidence: automatic rollback history records `ROLLED_BACK` at `2026-10-09T08:13:44Z`; its command logged `automatic_rollback_validation=PASS`. Production Swarm reports `rollback_completed`, image `hospital-backend:20261007`, replicas `1/1`; origin HTTP on port 8190 returned 200 and Compose again names `hospital-backend:20261007`.
- Residual risk: two database migrations completed before deployment. Automatic rollback suspended ACTIVE ADMIN listings before returning to old code. The number of affected listings and authenticated client workflows were not independently checked. Do not retry this candidate until capacity is proven for old and new game JVMs plus other workloads, and the business-data effects are reviewed. Preserve `start-first` availability semantics unless a separately approved deployment design changes them.

## Temporary Meelok downtime assessment

- At `2026-10-09 09:48 UTC`, read-only `docker service ls` showed all five `meelok_*` services at `1/1`. `docker stats --no-stream` reported approximately 5 MiB Redis, 110 MiB object storage, 105 MiB web, 442 MiB API, and 369 MiB worker, about 1.0 GiB total. `free -m` reported 1,676 MiB available host memory and zero Swap. The game service remained `hospital-backend:20261007`, `1/1`, and used about 2.45 GiB.
- Pausing all five Meelok services would release approximately 1.0 GiB if their memory became available. Estimated headroom would rise to about 2.6 GiB. The previous old game JVM alone reached about 3.21 GiB anonymous RSS; a new JVM configured with `-Xmx3g` can demand more than the estimated headroom during `start-first`. This estimate has no safety reserve and cannot certify another rollout. The actual release-window baseline was lower, about 1.19 GiB available at `07:50 UTC` before the new task started.
- Earlier decision: temporary Meelok downtime releases useful capacity, with a residual risk because the new JVM can consume more than the estimated headroom. The user has now selected this no-expansion approach. Implement pause and restore for the formal release while retaining a fail-closed live capacity check. A game release itself remains unauthorized in this task.
- Earlier assessment acceptance: PASS for read-only sizing. No Meelok service was scaled and no game release was started. The earlier loopback probe at `127.0.0.1:8787` was refused because the publisher listens on the LAN address; on `2026-10-11`, `http://192.168.20.218:8787/api/version` and `/api/jobs/active` returned successfully, with no active job.

## No-expansion implementation review

- Objective: PASS for publisher implementation. A formal game plan now snapshots the exact five Meelok services in the production game backup directory, verifies their running singleton and health state, pauses them sequentially before `deploy-stack`, and checks `MemAvailable >= 2 GiB` three times. The deploy command rechecks the pause marker, all five desired replica counts, and memory immediately before `docker stack deploy`.
- Restore boundary: PASS for controlled paths. Meelok remains paused through Swarm update completion, final game checks, cleanup, and any automatic rollback. Restoration requires Swarm `completed` or `rollback_completed`, exactly one healthy game container, at least 1.5 GiB available before each service, unchanged Meelok images, and original replica counts. Restore order is object storage, Redis, API, worker, web. The marker is removed only after all services are running and healthy or have no configured health check.
- Recovery: PASS for tested control flow. Pause failure, cancellation, failed cutover with rollback, and successful release all run the restore command. Restore failure returns `RECOVERY_REQUIRED` with the persistent marker. A publisher restart detects an active job that crossed the pause boundary, blocks new jobs as `RECOVERING`, and retries restoration. If the publisher never restarts or production SSH remains unavailable, automated restoration cannot complete; the marker prevents a subsequent game cutover and requires operational intervention.
- Verification: `npm test` passed all 325 tests on `2026-10-11`; focused plan and Bash syntax tests, positive and negative flow tests, read-only live Docker service structure and health checks, and `git diff --check` passed. Production was not scaled or deployed. A real game release remains unverified and requires a separate authorized execution.
- Residual capacity risk: the 2 GiB gate is based on the prior new JVM's roughly 0.9 GiB incident-time RSS plus a roughly 1.1 GiB margin. New JVM memory can grow further during overlap. User selected this no-expansion approach with temporary Meelok downtime; the gate rejects low-headroom windows but does not guarantee immunity from host OOM. Production Meelok downtime covers the complete game validation window.
