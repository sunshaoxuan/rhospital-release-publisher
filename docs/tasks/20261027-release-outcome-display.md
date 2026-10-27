# Release outcome display

The console previously displayed a retained failed run and a new pending plan,
but did not link the separately completed supplemental verification. This made
an idle publisher look like it was waiting to finish the old run.

The page now separates the next plan, original run outcome, current deployment
snapshot and supplemental acceptance. `RECOVERY_REQUIRED` is retained. The
three passed supplemental checks and deferred trade-pool audit appear as
`PARTIAL`, never full release success. The same association is shown on the
original history card.

`GET /api/release-status` reads existing history and bound supplemental receipts.
Receipts require the original full-history hash, candidate identity, exact gate
selection, image and runtime baseline. Missing/duplicate/false-PASS/unmatched
evidence is excluded. Old or changed deployment evidence is labelled explicitly.
No historical command, release plan, recovery or business validator is executed.

The runtime sampler reads selected Docker metadata only, without environment or
Secret fields. It checks service identity again after container inspection,
persists a narrow publisher-owned snapshot in `.runtime-status/`, coalesces
concurrent refreshes and caches it for 60 seconds. Failed sampling never defaults
to healthy. Snapshots older than 120 seconds and acceptance older than 24 hours
are labelled stale, including when the browser is left open. A restart can read
the persisted snapshot and receipts without an in-memory active job.

No feature entrypoint, command, timeout, release selection or production mutation
is added. Mandatory game/forum and migration safety checks are unchanged.
`src/localCheckPolicy.js` remains unchanged. The API cannot approve the deferred
trade-pool audit or convert the original failed run into success.

Validation before final gate:

- Six isolated API/view/Python-sampler tests passed, including restart, expiry,
  concurrency, evidence rejection, active/idle state and output escaping.
- Browser fixture at loopback port 18844 showed the separate state panel and
  original history association. A fake task transitioned active -> ended -> idle;
  it never loaded production configuration. Console errors: zero. Screenshot
  evidence was captured in the task during browser review.
- Read-only production metadata at 2026-10-27T05:41:08Z showed image
  `hospital-backend:20261027@sha256:fd0e654afa04542fabddce943b56d8186333cc61441eede8746d35b2e314ac45`,
  one healthy replica and the existing `PARTIAL` receipt matched the current
  runtime identity. Invalid receipts: zero. No application service was changed.

The complete `npm test` gate must pass before commit. UI/API verification is
repeated against the installed publisher after the approved publisher-only
update. The separate standby-readiness investigation remains unfinished.

The initial complete run passed 466/467; the sole failure was the existing
`pollJob` VM harness missing the new read-only `loadReleaseStatus` dependency,
which masked its intended history-read failure assertion. The harness now
provides that dependency and verifies refresh invocation. All 22 affected
concurrency/status tests passed with the original lock/error assertions intact.
The corrected complete gate is recorded separately in
`.task-tmp/final-release-outcome-ui-tests-corrected.log`; the failed run is retained.

The corrected complete run passed **467/467**, zero failures, cancellations or
skips, duration `1013946.5982 ms` (16m54s). Its SHA256 is
`298d9a32620b949560e3479cb431588ac61671f51930bd46ec23f053c9f37174`.
