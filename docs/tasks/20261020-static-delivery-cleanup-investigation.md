# Static Delivery Cleanup Investigation 2026-10-20

## Objective And Request

Explain the supplied `verify-game-static-delivery.mjs --app-tag 2026102001` failure. Identify the failing stage, browser/profile lifecycle, and what the preceding browser PASS proves. Distinguish confirmed facts from unresolved runtime causes.

Follow-up authorization: fix publisher-owned Chrome shutdown and temporary-profile cleanup, preserve original probe errors, add regression tests, run required checks, and commit. No release, production access or production-state mutation. The implementation section below supersedes the earlier diagnosis-only scope for these local changes only.

## Original Investigation Method And Boundaries

- Main agent performs this bounded root-cause investigation directly.
- Trace the supplied stack through `useChromeTarget`, `runValidatedChromeProbe`, and `runStaticDelivery`, including process shutdown and cleanup exception handling.
- Inspect focused tests, publisher timeout/success contracts, and sanitized persisted runtime evidence if needed.
- Consult official runtime documentation for child-process termination and filesystem retry semantics.
- Read-only runtime inspection. No production release, authenticated production probe, process termination, secret-file reads, or product-code edits.
- Keep any necessary temporary artifacts inside this repository and remove them before delivery.

## Completion Criteria And Verification

- Identify the exact failing operation and its effect on the overall validation result.
- Explain the scope of the browser PASS and whether complete delivery acceptance is established.
- Establish the strongest supported explanation for the Windows cleanup error and state evidence limitations.
- Record the smallest appropriate repair direction without changing release gates or rerunning production validation.
- Check documentation accuracy, citations, scope consistency, and `git diff --check`. Documentation-only changes do not require publisher code tests.
- Final review records PASS, FAIL, or UNVERIFIED per criterion. Commit this task's documentation after its checks pass.

## Findings And Evidence

- Publisher source reviewed at commit `f9ddb1f34747fb168f80f19f401c920dec8e7528`. Verifier SHA-256: `741b001e76aaf7704d07d422f989f011fa150df82470c77fc1eca7e3bfc28573`. Local-check policy SHA-256: `8fc5ca10bf651eb9d67dce1e8aca77884bc7b9ed798d22acf039e307e7b42e7d`.
- Confirmed failure: `scripts/verify-game-static-delivery.mjs:402` synchronously removes the per-probe Chrome profile in `finally`; Windows returned `EPERM`. The supplied profile `rhospital-release-smoke-2vgLwj` still exists during this investigation. No directory contents or authentication files were read.
- The stack at line 844 identifies the Steam probe (`/run/newGameSteam`). The log does not identify which gateway iteration failed. Each gateway runs cold, warm, then Steam probes; receipts are printed only after every gateway completes (lines 797-865).
- `game_static_delivery_browser=PASS` is emitted after the separate offline WebGL capability probe (lines 773-778). It does not certify static resources, Steam loading, or all six delivery probes.
- `useChromeTarget` awaits its action and then runs cleanup (lines 393-402). An uncaught cleanup exception replaces either an action result or an action exception. `runValidatedChromeProbe` awaits that combined result before `summarizeProbe` and `assertProbe` (lines 735-738). The failing Steam result therefore never reaches its delivery assertions, and any preceding action error is unavailable.
- Lifecycle weakness: `stopChrome` first calls `child.kill`, waits only for the root child's close event or three seconds, and can return without a process-tree stop when the root has an exit code. Its Windows tree-stop fallback discards the command status and has no independent descendant/profile-handle release check (lines 355-367). Residual browser handles or filesystem access restrictions remain plausible explanations. The supplied failure does not establish the exact lock owner or ACL cause.
- Current read-only process inspection found no Chrome command line containing the exact failed profile path. This is a later observation, not proof of the state when deletion failed, and it does not exclude other processes or descendants without that argument.
- A plain `EPERM` has no recognized browser-infrastructure classification (lines 19 and 708-717); the configured isolated browser retry does not run for this error. Node's documented `force` option tolerates a missing path, not arbitrary permission failures. The existing recursive removal already sets ten retries with a 100 ms linear-backoff base. Official reference: `https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrmsyncpath-options`.
- Local persisted release history matches the supplied failure: history `2026-10-20T08:47:20.092Z-2026102001`, created at 17:47:20 JST, application candidate `5bb17701dbb184f3977bc79c5b931782d3dedbb4`, formal release, status `RECOVERY_REQUIRED`, 33/39 completed steps. `verify-game-static-delivery` failed after 77,474 ms. `deploy-stack`, `commit-game-cutover`, `final-runtime-check`, and `game-prd2-runtime-contract` are done; relations/trade-pool checks and normal container cleanup remain pending. The fatal rollback decision records `fatal_threshold_not_met` and `HOLD_TARGET`. These are historical receipts; current production health was not queried.
- Repair direction: provide verified bounded shutdown of this probe's browser/process tree, bounded asynchronous profile cleanup, and separate preservation of probe evidence/primary errors and cleanup errors. Keep ownership restricted to this probe. Preserve every delivery assertion and fail-closed release behavior. Cleanup failure must not be converted into overall delivery PASS or automatic production rollback without evidence.

## Actual Verification

- PASS: nine source-isolated mock assertions on the current verifier under local Node.js `v24.19.0`. Covered already-exited roots, root-only shutdown, ignored tree-stop failure, normal action return, cleanup replacing success, cleanup replacing a primary error, EPERM propagation, one-attempt behavior, and error classification. Output: `source_isolated_mock_checks=PASS checks=9 production_requests=0 real_chrome_runs=0 filesystem_writes=0`.
- PASS: persisted-history error and call-site correlation; source/policy identities recorded; exact failed directory existence and bounded Chrome-process query.
- Not executed: real Chrome fault reproduction, production delivery probes, feature acceptance chains, full `npm test`, deployment or rollback. No executable code, UI, check policy, business data, or production configuration changed. No task temporary artifacts were created.

## Original Investigation Final Review

- PASS: exact failing operation, stage, PASS-marker scope, error propagation, and repair direction identified.
- PASS: lifecycle limitations distinguished from the unconfirmed operating-system cause; historical release state distinguished from current production health.
- UNVERIFIED: exact permission/handle owner at failure time, the failing Steam page's original result, and current production health. These limitations do not prevent explaining the supplied failure.
- PASS: affected scope is publisher browser-probe cleanup; feature selection and all mandatory safety checks remain unchanged; no cross-feature dependencies were added or removed.
- Diagnosis was committed as `23dd201`. The later authorization and implementation scope below govern the repair.

## Authorized Local Implementation

- Objective: reliable bounded shutdown of the probe-owned Chrome process, asynchronous profile removal after shutdown, and original-error/evidence preservation across cleanup failures. Cleanup-only failure must remain blocking.
- Main agent owns design, implementation, review, commands and acceptance. Attempt one bounded Claude advisory review for asynchronous process lifecycle risks through the existing Sub2API runner; use the authorized fallback chain on failure and send only sanitized lifecycle code and requirements. External advice grants no project control.
- First inspect shared consumers of `useChromeTarget` and `runChromeProbe`, current Node/CDP APIs and existing test patterns. Keep the helper in its current module unless a concrete boundary requires separation; introduce no new dependency or runtime compatibility layer.
- Validate shutdown ordering and ownership, asynchronous directory retries, exhausted retries, startup/connection/action failures, already-exited processes, timeout/forced termination, preserved primary errors, preserved probe evidence, and blocking cleanup failures with focused positive/negative tests.
- Double Check round one: review unchanged check keys, commands, timeouts and entrypoints. Round two: inspect transitive callers (relations and fatal rollback) and cleanup/error data flow; run their smallest relevant unit regressions, without feature acceptance chains or production evidence reads.
- Run one real local Chrome verification session on `about:blank` using repository-local temporary storage and no production credentials/requests. Cover normal return, original action failure and forced shutdown with separate owned browsers. Verify exit, profile removal, returned results and primary-error preservation. No product UI is changed; UI screenshot acceptance is inapplicable.
- Run focused tests, `npm test`, syntax checks and `git diff --check`. Fix task-related failures, remove task temporary artifacts, review the final diff, update README/CHANGELOG and this record, then commit only this task's changes.
- Acceptance: original probe error identity/stack and useful evidence remain available; cleanup cannot produce false PASS or unsafe retry; all bounded local tests and required project checks pass; no owned Chrome/profile leftovers or production actions; final review records actual results and unresolved risks.

## Implementation Results

- Implemented: browser-endpoint `Browser.close`, early close observation, bounded asynchronous owned-tree termination and status checking, close confirmation, then asynchronous `fs.promises.rm` with ten retries and 100 ms linear-backoff base. Unconfirmed shutdown retains the profile and fails closed; no global/name-based process termination.
- Original action error object, message, stack and attached evidence survive cleanup failure. Cleanup-only errors retain the completed action result. Separate cleanup diagnostics block PASS and infrastructure retry. Browser stderr remains separate from the original error. Capability-only evidence formatting cannot replace the cleanup error. Relations preserves its sanitized evidence and shared fail-closed classification; fatal rollback conditions are unchanged.
- External advice: the highest exposed Claude model's minimal request returned HTTP 503 twice. The configured DeepSeek fallback returned bounded text-only advice. Main-agent review retained early close observation, bounded waits, tree ownership, asynchronous removal and primary-error preservation. An exit code without close remains blocking to avoid deleting a possibly live profile or targeting a reused PID. No external model edited the project, ran tests or received credentials/production configuration.
- Initial regressions exposed startup-error classification at the deadline and a blocking test lock fixture. The deadline loop now checks spawn/signal exit before reporting timeout. The Windows lock fixture uses a fixed holding period and bounded startup; its actual `EBUSY` and modeled `EPERM` cases are covered.
- PASS: 69 focused tests before the final evidence-formatting additions. Covered lifecycle success/failure, signal exit, startup/connection/action failures, forced termination failure/timeout, retry isolation and actual Windows exclusive-file-lock release. Final required suite results follow below.
- PASS: real local Chrome verification session with three `about:blank` probes: normal return with WebGL 2, original Error/stack preservation, and actual Windows forced process-tree termination. All three root PIDs exited and all three profiles were removed. Production application requests: zero.
- Double Check round one: `src/localCheckPolicy.js` SHA-256 remains `8fc5ca10bf651eb9d67dce1e8aca77884bc7b9ed798d22acf039e307e7b42e7d`; no selected keys, commands, timeouts, registered entrypoints or success protocols changed. Round two: inspected static-delivery, relations and fatal-evaluator transitive calls. Only owned browser shutdown/error reporting changed. No feature-validator/evidence dependencies added; no feature acceptance chain or production operation executed. Their scoped unit tests are included in the focused/full checks.
- First required `npm test`: 394 tests, 393 PASS, one FAIL, zero skipped/cancelled. The unmodified `gameStandbyCandidate` lock test encountered Windows `EPERM` in `renameSync(candidate.json.tmp, candidate.json)` before its expected lock refusal. Its source does not import the changed Chrome helper. The exact failed test then passed alone (one test, zero skipped). The operating-system cause was not established. Repeat the required full suite to obtain a complete passing receipt without changing this independent module or relaxing its assertion.
- PASS: both changed verifier modules passed `node --check`; `git diff --check` passed. No Chrome process command line matched this task's owned profile directory after real-browser validation.
- Candidate-only learning retained at `C:\workspace\codex-selfimp\20261020-chrome-probe-lifecycle\TASK_LEARNING_RECEIPT.md`; no global rule or skill installation.
- PASS: final `npm test` completed with 394/394 passing, zero failures, cancelled, skipped or TODO tests; duration 215646.8403 ms. This includes all final lifecycle, receipt-formatting and shared-caller regressions. The initial independent rename failure and its successful targeted rerun remain recorded above.
- Candidate identity: changes based on publisher commit `23dd201`. Final static-delivery verifier SHA-256 `2bac500de543c0d3b40b0f0e70c5912111c5f4cae1edc0aa2a89d1aec7b62e08`; relations verifier `8cc0afe10c8c74f773f91dc3a93eadb241a5e7a08ecbd61c3187fd2772e33665`. Policy identity is unchanged as recorded above.
- PASS: final source/data-flow review retained business assertions, registered commands, success markers, release safety checks and fatal rollback thresholds. No runtime compatibility branch or new dependency was introduced. Both verifier syntax checks and staged `git diff --check` passed. README and CHANGELOG match the implementation and its fail-closed behavior.
- PASS: final owned Chrome process count is zero; real-probe profiles were removed by the repaired lifecycle. No production application probe, deployment, rollback, production configuration change or historical profile deletion occurred.
- INCOMPLETE: deletion of other local test artifacts at `C:\workspace\rhospital-release-publisher\.qa\chrome-cleanup-20261020` was rejected by execution policy, including a literal-path PowerShell Remove-Item attempt after resolving and verifying the directory inside this repository. The ignored directory remains. No alternative shell or deletion API was used to bypass that restriction. Test results are retained here before eventual artifact removal.
- Final acceptance: code repair, original-error/evidence preservation, behavior regressions, real local Chrome validation and required checks PASS. Task-artifact cleanup remains INCOMPLETE due to execution policy. The original production failure's exact lock/permission owner and the first full-suite rename failure's operating-system cause remain unverified. Commit the eight scoped files with these limitations recorded; no production action is authorized.

## Authorized Cleanup Follow-Up

- User authorization on 2026-10-20: continue removing only this task's temporary artifacts in `.qa/chrome-cleanup-20261020` and confirm no task-owned process remains. Implementation commit `279b7a9` and its passing test receipts above remain unchanged.
- Method and boundary: resolve and verify the exact repository-local directory, inspect its contents and reparse points, confirm no tracked files are included, and query local processes using task-path and test-fixture identities. Stop a process only after current ownership is established; never target unrelated Chrome instances or historical PIDs. Remove only the verified task directory with native literal-path PowerShell operations. Preserve `.qa` siblings and all production state.
- Acceptance: the exact task directory is absent and no identifiable task-owned Chrome, test or lock-fixture process remains. Record actual results and any policy/ownership limitations. Check the documentation diff and commit this scoped record; executable code is unchanged, so the previously completed behavior tests do not need repetition. No republishing, production probe, service change or production operation is authorized.

## Cleanup Follow-Up Results

- PASS: the resolved target exactly matches `C:\workspace\rhospital-release-publisher\.qa\chrome-cleanup-20261020`. Inventory found 6,437 files and 6,243 subdirectories, zero reparse points, and zero Git-tracked files. Top-level contents match this task's test fixtures, compile cache, local-browser verification directory and two test logs. No sibling directory was selected for removal.
- INCOMPLETE: the newly authorized literal-path PowerShell removal was rejected by execution policy before process creation. No deletion ran, no process was terminated, and no alternate shell/API or permission change was attempted. The task directory still exists; cleanup acceptance remains incomplete.
- PASS: current process queries before and after the rejected deletion found zero matches for the exact task path, the four affected test entrypoint names or the exclusive-lock fixture marker. Final observation: `2026-10-20T19:30:49+09:00`. Chrome and Node command lines in the queried process snapshot were readable. This verifies the identifiable task-owned process scope; unrelated browser sessions were left untouched.
- Scope review: executable code and release-check policy are unchanged. Existing 394/394 passing tests and three real local Chrome probe results remain recorded above; no behavior tests were rerun for this documentation-only follow-up. No republishing, production request, service action or production-state change occurred.
- PASS: documentation scope, evidence, historical-versus-current status and consistency with the authorized method were reviewed. `git diff --check` passed; Git reported only its existing LF-to-CRLF normalization warning. Only this task record changed. Final acceptance: process verification PASS; task-directory removal INCOMPLETE because the execution-policy rejection persists.
