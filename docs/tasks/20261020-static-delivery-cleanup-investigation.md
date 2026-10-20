# Static Delivery Cleanup Investigation 2026-10-20

## Objective And Request

Explain the supplied `verify-game-static-delivery.mjs --app-tag 2026102001` failure. Identify the failing stage, browser/profile lifecycle, and what the preceding browser PASS proves. Distinguish confirmed facts from unresolved runtime causes.

## Method And Boundaries

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

## Final Review

- PASS: exact failing operation, stage, PASS-marker scope, error propagation, and repair direction identified.
- PASS: lifecycle limitations distinguished from the unconfirmed operating-system cause; historical release state distinguished from current production health.
- UNVERIFIED: exact permission/handle owner at failure time, the failing Steam page's original result, and current production health. These limitations do not prevent explaining the supplied failure.
- PASS: affected scope is publisher browser-probe cleanup; feature selection and all mandatory safety checks remain unchanged; no cross-feature dependencies were added or removed.
- Documentation validation and commit are recorded by the final command receipts. Diagnosis complete within the read-only operational scope; implementation is outside this request.
