# Docker Build Failure Investigation

## Recovery Extension (2026-10-22 JST)

User now authorizes local Docker investigation/recovery, publisher-owned bounded Linux readiness preflight, regression tests, original build and image inspect. This supersedes the diagnosis-only action boundary below. No production execution/retry, context switch, remote build fallback, reset, pruning or game changes.

Method: verify publisher identity/environment and selected target; inspect startup and disk/WSL dependencies; recover using the established local startup path; add fail-closed preflight using the build target/environment. Preserve Maven tests, cache, inspect and mandatory release checks. Primary agent owns execution-boundary decisions.

Acceptance: live Linux server in publisher identity; startup cause evidenced or explicitly unresolved; available/unavailable/timeout/non-Linux/target-consistency tests and npm test; original build/inspect separately recorded; final intent review and scoped commit/push after checks. Environment facts belong in rhospital. Existing game changes remain untouched. Publisher baseline clean. No release started.

## Goal And Scope (Original Diagnosis)

Investigate reported step 12 and deliver a bounded game-side implementation prompt. Read-only runtime investigation; no service start, image build or production action. No publisher behavior changes authorized.

## Method And Acceptance

Trace command generation and existing prerequisites, inspect local Docker endpoint and availability, distinguish observations from unverified causes, and identify repository ownership. Deliver an evidence-backed explanation and prompt preserving mandatory checks and repository boundaries.

## Evidence And Results

- PASS: src/releasePublisherCore.js:532 generates test-game-backend with docker build --target build and image inspect validation.
- PASS: src/releasePublisherCore.js:3458 and :3470 select an explicit local context when available, otherwise the local Docker CLI target. README.md:446 and :470 document local build and SSH image delivery. Targeted source search found no Docker daemon readiness step in the plan generator.
- Reproduced failure: docker info --format returned exit 1 with the same missing dockerDesktopLinuxEngine named-pipe error. No Maven execution or build success is established.
- Observed: docker context ls selected desktop-linux at npipe:////./pipe/dockerDesktopLinuxEngine. com.docker.service was Stopped/Manual; WslService was Running. Process lookup found no Docker Desktop/backend process. Service state alone does not prove the WSL backend cause.
- Official Docker docs reviewed: daemon troubleshooting recommends docker info; Windows permission docs distinguish privileged service from the WSL backend. https://docs.docker.com/engine/daemon/troubleshoot/ and https://docs.docker.com/desktop/setup/install/windows-permission-requirements/
- Conclusion: selected local build engine is unavailable. Evidence is consistent with Docker Desktop not running. The reason it stopped or did not start is unverified. No evidence supports editing Maven or the game Dockerfile.

## Modification Prompt Scope

Game-side agent should read this diagnosis and inspect the actual build host without modifying business code by assumption. Recover the designated local engine only within authorization, verify Linux server availability in the publisher execution identity, and coordinate a publisher-owned fail-closed readiness gate before costly checks/builds. Preserve full Maven tests, cache reuse, explicit target identity, image inspection, all mandatory release gates and production boundaries. No automatic context switching, remote production build fallback, daemon reset, pruning or production retry.

## Original Diagnosis Review

- PASS: failure layer, source ownership and evidence established; bounded prompt delivered in chat.
- PASS: documentation-only validation uses git diff --check and manual scope/reference review.
- Not performed: Docker startup, actual Maven/build execution, publisher implementation or UI verification. These are outside this diagnosis-only request.
- Remaining: determine why Docker Desktop was unavailable and verify recovery in the actual publisher identity.

## Final Recovery Acceptance (2026-10-22 JST)

Implementation stays inside the original test-game-backend command chain: bounded helper first, explicit PowerShell nonzero exit guard, unchanged Docker build arguments, unchanged inspect validation. No new UI step, controls, layouts or numbering changes remain. public/app.js has no final diff. Core dockerCommand and helper derive target arguments from the same dockerCommandParts function; the helper inherits cwd and process environment and never mutates context or starts Docker.

Affected consumers reviewed: game backend build gains the fail-closed probe; subsequent game image/static-asset build commands retain existing cache and target semantics; forum commands retain the same shared Docker-prefix behavior; mandatory backend, migration, pre-deploy and final runtime checks remain intact. This is publisher orchestration, with no game runtime, pom.xml, Dockerfile, business code, database or release-impact change.

Evidence:
- Final npm test: 416 tests, 416 passed, 0 failed/cancelled/skipped/todo, duration 224371.1697 ms. Includes 15 helper/target cases and the command-chain failure integration case. Earlier test assertions were corrected; only this final run establishes final-candidate acceptance.
- Real engine probe uses publisher child identity and captured environment: same Docker executable, desktop-linux, linux 29.8.2. Environment values were not logged. Recovery details: C:/workspace/rhospital/docs/investigations/20261022-local-docker-build-engine/RECOVERY_RECEIPT.md.
- Failed release source 1e620acabc08d41b798f938509de704c417343a1 reproduced in a detached worktree. Original docker build --target build -f Dockerfile --build-arg APP_TAG=20261022 -t hospital-backend:20261022-buildcheck . exited 0 at 08:13:41 JST.
- Final helper + original build + image inspect chain exited 0 at 08:21:25 JST. Image sha256:510ec8112493e80615ddc3609701778275e1986fbd53f43eaa2308ed10631157, tag hospital-backend:20261022-buildcheck. Maven clean package layer was CACHED. Cached Surefire reports: 376 suites, 1833 tests, 0 errors, 0 failures, 73 skipped. No fresh Maven test execution is claimed.
- Real PowerShell missing-pipe negative exited 1, reported connection reason, never reached the subsequent build sentinel. No context switch occurred.
- Existing console was inspected read-only with no console warnings/errors. Its dirty-worktree publication lock remained intact. This is environment inspection only, with no UI change acceptance claim and no release execution.

Final runtime source SHA-256 (local bytes before staging; final EOF whitespace cleanup passed syntax and 15 focused regressions, with full-suite behavior unchanged):
- src/releasePublisherCore.js: 95d3eba7337c09a0d8fee9b3c50a3623d14835fe9bbf3a275b1f18538ed58bf8
- scripts/check-docker-engine.cjs: 08144d715a7984fc5b86fb91e0ab5f354ccc1b6be4ff5bc45d76e3785a1c4f99
- test/dockerEngineReadiness.test.js: d67c146196786c2869866b4e70ce1fa7970e969618c974ca4bc044eee408bfc0
- test/releasePublisherCore.test.js: 540c7dd3010d2c134c08eabe2d015b399d9d8e1e2329d26786ba1bfcac13ce99

| User intent | Final evidence inspected | Result |
| --- | --- | --- |
| Restore local build engine in actual publisher environment | Fixed-X startup script PASS; same-environment Linux info; unchanged context endpoint | PASS |
| Evidence-based cause and ownership | Missing pipe plus absent Desktop/backend established; historical exit reason unverified and explicitly retained as a limitation; environment facts in rhospital | PASS |
| Same-target bounded Linux preflight and fail-closed behavior | Shared target builder, inherited environment/cwd, execFile timeout 30000, exact linux requirement, real negative chain and 16 regressions | PASS |
| Preserve full Maven build, cache, inspect and safety gates | Narrow source diff, 416 passing publisher tests, real cached Docker build/inspect | PASS |
| No prohibited mutation or production retry | No context change/reset/prune/production command; no application edits | PASS |
| Documentation and final candidate consistency | README, CHANGELOG and this receipt reviewed against final code and real results; runtime/test identities unchanged; whitespace checked before staging | PASS |

Limitations: the reason Desktop previously exited could not be established from inspected logs/events; future uptime is not guaranteed. Readiness covers the probe instant, so a later engine loss still causes the normal build failure. This task verifies cached build success and cached test reports, not a new Maven run or production release acceptance.

Delivery method: retain publisher's existing main branch and origin/main history; no feature branch or divergent origin/master merge. The hospital repository master-only release gate is not invoked because its source and staged work are unchanged. Environment-only receipt is scoped independently on rhospital master, which has no configured remote. Existing environment startup-script and documentation edits belong to other active tasks and remain untouched.

Cleanup: detached reproduction worktree and .task-tmp/docker-engine-20261022 removed after verification. The separate ignored .task-tmp/dual-node-validation directory belongs to another task and remains untouched. Retain the buildcheck image and pre-existing Docker cache, with no image data cleanup. Publisher rollback is a scoped revert of this change; it does not modify Docker or production state.
