# Active release incident investigation

## Objective

Identify the current release job, its first abnormal step, the underlying log evidence, and whether production actions have occurred. Report the immediate safe next action.

Follow-up objective: determine why Swarm paused the `20261009` rollout. Correlate Docker task, health, daemon, and application evidence before assigning a root cause. Record any remaining uncertainty explicitly.

Current follow-up: explain why host memory was exhausted during cutover. Reconstruct concurrent JVM and other workload memory demand, deployment overlap, host capacity and swap, and resource policy from read-only evidence. Distinguish measured usage from estimates and identify the remaining evidence needed for exact attribution.

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
5. For the follow-up, reconstruct the failed rollout timeline and distinguish an application failure from a health, host, or Swarm update failure using read-only production evidence.
6. For the memory follow-up, compare time-correlated kernel and container records with JVM settings, Swarm update policy, and host memory capacity. State the trigger and preventable configuration conditions without asserting unavailable per-process history.

## Findings and final review

- Incident identity: job `1791531605681-de3d4459a32dc` attempted game tag `20261009` from commit `5a719e00da23f46b75b5aa7768deccfc5c357523`. Step 36, `commit-game-cutover`, failed when Swarm rollout entered `paused`.
- Immediate cause: production kernel `journalctl -k` at `2026-10-09 08:00:40 UTC` records a global OOM and kill of Java PID `3384448`, anonymous RSS `3365356 kB`. The kernel cgroup maps to old game container `10b91d2f...`; `docker inspect` reports image `hospital-backend:20261007`, `OOMKilled=true`, finished at `08:00:41 UTC`. Docker manager heartbeat errors and task replacement followed in the same incident window. This explains the Swarm pause with high confidence.
- Capacity trigger: old game container and new `20261009` container overlapped from `07:58:20` until the OOM under the configured `start-first` policy. At OOM the kernel task table reports old game anonymous RSS about `3.21 GiB` and new Java about `0.90 GiB`; other Java services, MySQL, databases, and infrastructure were also resident. `sar -r -f /var/log/sysstat/sa09` records available host memory of about `1.19 GiB` at `07:50 UTC` and `0.33 GiB` at `08:00:40 UTC`. The host has about `7.75 GiB` RAM and no Swap. Both game containers have `JAVA_OPTS=-Xms512m -Xmx3g`; the game service has no memory reservation or limit. The publisher configuration guard checks configuration identity but no memory headroom. The overlap therefore had insufficient proven capacity before cutover.
- Attribution limit: the kernel table lists five Java processes, including SnailJob and two other Java services. PostgreSQL RSS includes shared pages and cannot be summed as unique memory. The old game logged no application-level `OutOfMemoryError` in the 15 minutes before the kill. No pre-incident heap dump or process-memory time series was found in this investigation. RSS near `3.21 GiB` does not prove a full 3 GiB live heap, a memory leak, or which application feature drove growth. Current `jcmd 7 GC.heap_info` on the restored game shows about `1.36 GiB` heap used with about `1.97 GiB` committed, which is a later sample, not incident-time proof.
- Objective: PASS for explaining host OOM and rollout failure; exact application heap-growth attribution remains UNVERIFIED. Production `docker stats`, `free`, `sar`, kernel logs, container inspect/logs, and service inspect were read only. No release, cancellation, restart, configuration change, or manual recovery was initiated by this investigation.
- Recovery evidence: automatic rollback history records `ROLLED_BACK` at `2026-10-09T08:13:44Z`; its command logged `automatic_rollback_validation=PASS`. Production Swarm reports `rollback_completed`, image `hospital-backend:20261007`, replicas `1/1`; origin HTTP on port 8190 returned 200 and Compose again names `hospital-backend:20261007`.
- Residual risk: two database migrations completed before deployment. Automatic rollback suspended ACTIVE ADMIN listings before returning to old code. The number of affected listings and authenticated client workflows were not independently checked. Do not retry this candidate until capacity is proven for old and new game JVMs plus other workloads, and the business-data effects are reviewed. Preserve `start-first` availability semantics unless a separately approved deployment design changes them.
