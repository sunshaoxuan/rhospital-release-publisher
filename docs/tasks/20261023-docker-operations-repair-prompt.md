# Operations Repair Prompt: Local Docker Desktop Availability

## Goal

Investigate and repair recurring loss of the local Docker Desktop Linux build engine. Work in C:/workspace/rhospital for environment scripts, runbooks and tests. Publisher C:/workspace/rhospital-release-publisher already has a fail-closed engine preflight. Preserve it. Do not edit game code or run a production release.

## Verified Evidence

Read C:/workspace/rhospital-release-publisher/docs/tasks/20261022-docker-build-failure-investigation.md first. On 2026-10-23 JST, the last retained backend response was 07:38:35, VM log activity ended at 07:38:42, and Windows recorded WSL NIC removal at 07:40:14-15. At 08:04:30 the release failed because dockerDesktopLinuxEngine was absent. The existing startup script restored the engine at 08:12:51. Exit trigger remains unproven. Do not infer causality from a nearby application update. Last night's Docker upgrade resumed successfully and ran until morning.

Existing RHospital-Docker-Login is login-triggered and its script returns after readiness. Relevant entrypoint: C:/workspace/rhospital/scripts/Start-DockerAfterStaticDisk.ps1. Data must stay at X:/DockerDesktopWSL/disk/docker_data.vhdx; startup.paused remains authoritative. AutoStart=false is part of the guarded disk-first startup design.

## Required Work

1. Record task scope and acceptance in the existing environment investigation document. Preserve sanitized relevant logs before rotation. Correlate Desktop host/VM logs, WER/Application/System/TaskScheduler records, installed update history and available process-exit evidence. Label observations, inference and unavailable evidence separately. No automatic diagnostic upload or disclosure of tokens/account details.
2. Add the smallest local diagnostic mechanism needed to identify the next exit, including UTC/JST timestamps, Desktop/backend PID and lifecycle, endpoint readiness transitions and existing WSL/disk state. Prefer established Windows facilities. Record whether exit status/caller attribution is actually available. Avoid global command-line auditing that could collect credentials; broader audit changes require separate approval.
3. Extend the existing guarded startup/recovery mechanism with runtime-loss detection. Reuse existing helpers; choose a single owner and prevent concurrent starts. Use the actual Desktop user/session, bounded probes, consecutive-failure confirmation, cooldown and attempt limits. Leave a healthy engine untouched. Never automatically restart/kill an existing but unresponsive Desktop/WSL instance. Respect startup.paused, maintenance/update windows and intentional shutdown, and stop recovery until explicit resume when paused. Persist failure evidence before any permitted ordinary start. Missing/wrong X disk or data location must block recovery without creating replacement data.
4. Verify the current Docker version's supported lifecycle/update controls using official documentation before changing settings. Keep maintenance updates controlled without blanket disabling security updates. Do not enable native auto-start in a way that bypasses disk-first checks. Do not treat com.docker.service Automatic as sufficient proof of Linux engine readiness.
5. Retain desktop-linux endpoint semantics, Maven tests, build cache, image verification and every release safety gate. No reset, prune, WSL unregister/shutdown, VHD move, context switch, TCP API exposure or forced restart. Ask before any disruptive reproduction, Docker upgrade/rollback, reboot or global audit change.

## Acceptance

- Positive and negative behavior tests: healthy engine is untouched; lost process can request a bounded ordinary start when allowed; pause/maintenance/incorrect disk blocks action; hung existing process produces evidence and alert without restart; concurrent triggers serialize; cooldown/attempt exhaustion stops loops.
- Exercise the real scheduled task in its intended user/session with the healthy engine, then run the exact original helper: node C:/workspace/rhospital-release-publisher/scripts/check-docker-engine.cjs W10=. Require exit 0 and docker_build_engine=PASS OSType=linux. No production release retry.
- Do not kill the live engine to demonstrate recovery without separate approval. Mark fault-injection tests versus real runtime verification distinctly. An unperformed disruptive test remains an explicit limitation.
- Update operations runbook, evidence retention, maintenance/pause procedure, rollback and actual test receipt. Rollback only this change; preserve Docker data and functioning startup. Commit scoped changes after project-required checks. If notification is added, verify real delivery or report delivery as incomplete. Report historical cause as unresolved unless new evidence establishes it.
