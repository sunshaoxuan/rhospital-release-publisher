# Release Result Investigation 2026-10-16

## Objective And User Request

Determine whether the most recent relevant release succeeded and explain why the release console contains failed items. Match the job, target, candidate, step outcomes, rollback or recovery, and observed production identity before reporting success.

Follow-up authorization: investigate the cause and fix confirmed publisher-owned gaps. Do not edit game code. Provide an implementation Prompt for any necessary game-code changes. Production deployment, retry, recovery, scaling and configuration mutations remain outside this task.

## Scope And Method

- Read-only diagnosis of the release publisher, persisted release records, relevant runtime logs, and designated production state.
- Identify the current or latest formal release from the live API and persisted job/history records. Separate earlier attempts and dry runs.
- Trace each relevant failure to its first error, then establish whether deployment, rollback, final checks, and recovery completed.
- Inspect only the source and release runbooks needed to interpret observed records. Do not release, retry, cancel, restart, scale services, or modify production or product code.
- Main agent owns investigation, implementation, decisions and validation. For a cross-module lifecycle fix, obtain bounded Claude advice through the existing Sub2API runner while continuing independent evidence collection. Send only sanitized state logic, no production addresses, credentials or full logs.
- Keep secrets and authentication details out of outputs and this report.

## Acceptance And Verification

- Record exact job IDs, timestamps, target and candidate identities for the release being discussed.
- Explain failed items using observed step logs and distinguish historical, blocking, rollback and recovery outcomes.
- Correlate release outcome with read-only live runtime evidence when available. Explicitly report missing evidence.
- Check this document for factual accuracy, scope consistency and formatting. Run no broad feature chains or production acceptance commands merely to inspect status.
- Final review records PASS, FAIL or UNVERIFIED for each requirement and any remaining risk.
- For confirmed publisher fixes, add focused positive and negative behavioral tests, execute `npm test`, check documentation and the final diff, then commit only this task's changes.
- The readiness step must be explicitly assigned to the existing source phase. No CSS, control, font or layout changes. Verify the real console renderer with isolated release data at 1440x1100 and 390x844, covering pending, running, done and failed readiness. Preserve existing dimensions; require no horizontal overflow or clipped step text, correct phase status, clear failure evidence, no console/network errors and no production execution. Capture full pages and native-size phase/detail regions. No changed control requires a new geometry budget.

## Evidence And Findings

- Latest formal job: `1792082575706-7912af2a77a7e8`, started `2026-10-16 01:42:55 JST`. History `2026-10-15T17:04:52.453Z-20261016` was written at `2026-10-16 02:04:52 JST`, game image `hospital-backend:20261016`, 37/52 completed steps, terminal status `RECOVERY_REQUIRED`. Active API returned `job=null,busy=false`.
- Candidate capture logs identify `adf40d3f42c9b4e5bbc74753f2b8dbac1519eb61`. History releaseCommit is empty, requiring separate identity review.
- First failure: `pause-meelok-services` reports `ERROR: prior Meelok pause requires recovery`. Controlled restore then reports `ERROR: meelok_web did not become healthy`. `deploy-stack`, cutover and final runtime steps remain pending.
- Image publication, static asset staging, database migration and production Compose TAG update completed before the failure. Production cannot be described as unchanged.
- Previous `20261011` history has completed cutover and final runtime check, followed by the same Meelok web restoration failure. Live marker inspection confirms the previous release's backup path.
- Live read-only observation at `2026-10-15T17:22:48Z` (`2026-10-16 02:22:48 JST`): game `hospital-backend:20261011`, one healthy running container, Swarm update completed; Compose image and IMAGE_TAG are `20261016`. Marker points to `game-release-20261011T070610Z/meelok-replicas.json`; current backup pointer points to `game-release-20261015T170112Z`.
- Meelok API, worker, Redis and object storage are `1/1`; web is `0/1` with desired replicas 1 and no retained running/stopped container. Its retained tasks are shutdown/failed, including an older unhealthy-container error. Exact original web healthcheck failure cannot be recovered from missing container logs. Do not infer an application defect or force an unrelated service restart.
- Final read-only corroboration at `2026-10-16 02:39:49 JST` and `02:40:42 JST`: game remains healthy `20261011`, Compose remains `20261016`, old pause marker and new backup pointer are unchanged; Meelok web remains desired 1 / actual 0 and the other four services remain `1/1`.

## Confirmed Repair Scope

1. Add a mandatory read-only Meelok readiness gate for game cutovers before builds and production writes. Reject any recovery marker, wrong replica counts, absent/multiple tasks and unhealthy services. Repeat immediately before pausing for drift. Forum and image-only plans remain unaffected.
2. Bind pause snapshot and controlled restore to an immutable per-plan identity persisted with the plan, including restart recovery. A foreign marker must be retained and rejected before any scaling. Preserve all game health, memory, original-image and replica gates. Timeout diagnostics must state observed desired/running/health evidence.
3. Buffer arbitrary Git output chunks and parse multiline output correctly so candidate identity survives both successful and failed release histories. Preserve command-text exclusion and verify malformed/non-capture evidence rejection.
4. Keep existing production history untouched. Do not clear the stale marker, restore services, change Compose or rerun migrations in this task. No game-code change is justified by current evidence.

External advice: Claude model directory queried; exact `claude-opus-4-8` minimal request and `claude-opus-4-7` bounded review returned upstream errors. Configured `deepseek-flash` text-only fallback returned advice. Adopted immutable ownership, early checks, repeated ownership checks and chunk buffering. Existing global execution mutex and fixed five-service scope remain unchanged. No gateway or authentication configuration changed.

First full test run: 351/352 passed. One failure identified the missing explicit UI phase assignment. Added the source-phase assignment and pending/running/done/failed regression coverage. Repeat the full suite after this correction and the final Git chunk-buffer change.

## Final Review

### Independent Scope Review

- Candidate application identity: `adf40d3f42c9b4e5bbc74753f2b8dbac1519eb61`. Publisher parent: `e1c5357`. Unchanged local policy Git blob: `10bb9cc85fb632ed38247a3872c9e3cf113e1eb6` (`src/localCheckPolicy.js`). The final publisher revision is the commit containing this report.
- Round 1: formal game cutovers alone select the new 60-second read-only gate before Git update/build and every production action. Both pause and restore commands contain the same persisted per-plan UUID. Forum and image-only plans select no Meelok steps. Existing backend, migration, pre-deploy, static delivery, final runtime, rollback and resource gates remain mandatory.
- Round 2: traced generated shell calls and controlled-exit/restart handling. Early checks call only file/Docker reads. Recovery executes the persisted command, rejects a foreign snapshot before Docker access, checks ownership again during restoration and before removal, and retains markers on failure. No business feature validator, historical screenshot, feature hash helper or external model is called by the new gate. Existing global serialization and five-service inventory are unchanged.
- Removed dependency: a new release no longer depends on recovering another release's snapshot during its own failure handling. Existing legacy marker recovery requires a separately authorized operation; no legacy bypass was added.

### Verification Results

- PASS: final `npm test` on stable source, 354 tests / 354 passed, zero failures, cancelled or skipped, 157.949 seconds. The earlier 351/352 run exposed missing phase registration; its result was superseded after correction. A chunk-failure regression was added before the final run.
- PASS: dedicated Bash behavior fixtures cover healthy readiness, stale markers, desired/actual replica faults, unhealthy/failed reads, owned lifecycle success, foreign ownership, drift, missing web tasks and preserved recovery markers. Fixtures execute generated shell with mocked Docker/jq/memory and no production mutations.
- PASS: history tests cover multiline output, single-character chunks splitting SHA/CRLF/details, command exclusion and failed-capture output retention. Existing success, cancellation, rollback, restoration failure, forum and image-only regressions passed.
- PASS: one live execution of the new read-only readiness gate refused the existing recovery marker before any write. This verifies safe refusal in the observed production state, not release completion.
- PASS: actual console assets in loopback fixture, Playwright, 1440x1100 and 390x844, eight state/viewport combinations, correct source phase and pending downstream stages, refresh interaction, zero console and network errors. No execute request occurred. See [browser evidence](../evidence/20261016-meelok-readiness/browser.json).
- PASS: primary-agent review of full-page desktop/mobile screenshots, native-size failure details and all pending/running/done phase crops. No clipping, overlap, broken frame, misleading stage status or horizontal overflow in the changed regions. No control geometry or CSS was modified. Timers and blank configuration fields in fixtures are synthetic, not production runtime evidence. Gemini `gemini-3.1-pro-high` and `gemini-3.8-flash` image probes both returned `No available accounts`; no external visual PASS is claimed.
- PASS: final diff whitespace checks and documentation cross-checks; all official screenshot evidence retained in `docs/evidence/20261016-meelok-readiness`.
- UNCOMPLETED, scratch cleanup: both `.qa/20261016-test` and `.qa/20261016-ui` were verified as ordinary task-local directories without link targets. Native PowerShell recursive removal was denied by the execution policy, including explicit literal paths. They remain ignored task scratch; no alternate deletion mechanism was used. The fixture server and browser were closed.

### Remaining State And Boundaries

- FAIL, release outcome: `20261016` did not cut over. Current production Meelok web remains unavailable; production Compose and live game version disagree. This task does not certify production readiness.
- UNVERIFIED: original Meelok web healthcheck failure, whose container/log evidence is no longer retained. No evidence supports a necessary game-code change, so no game-code patch or speculative game Prompt is produced.
- NOT PERFORMED: production recovery, marker deletion, Compose reconciliation, database rollback, service force update, deployment retry or new release. These require explicit authorization and fresh runtime verification.
- PASS, ownership boundary: no files in the game or production runbook repositories were changed. Historical release/job records were preserved.
