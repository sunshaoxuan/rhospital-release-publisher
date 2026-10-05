# Local Verification, 2026-10-05

## Publisher And Contract Tests

- `node --test test/gameStandbyCandidate.test.js`: 29 passed, 0 failed.
- Final `npm test` on the corrected source: 292 passed, 0 failed, 0 skipped,
  exit code 0; duration 667761 ms (approximately 11 minutes).
- `node --test --test-name-pattern='formal game dual-node|B gate failure|ambiguous B acceptance|cutover helper refusal|pipeline phases follow|three-round fatal full' test/releasePublisherCore.test.js`: 6 passed, 0 failed.
- `node --check` on all nine changed JavaScript source, script and test files: passed.
- `git diff --check`: passed.
- Six document-local links exist; CHANGELOG has one `2026-10-05` section.

The build IID receipt is mandatory before remote contact. Missing IID and mutable
tag drift fail closed. A real Windows PowerShell subprocess piped a 64 KiB cutover
script into the Node CLI and reached safe input validation without a native
command-line size failure.

Read-only infrastructure audit confirmed `prepare.py:426` acquires
`ROOT + '/stage.lock'`, with `ROOT = '/etc/rhospital-ha'`. The client capability
contract uses `/etc/rhospital-ha/stage.lock`. A regression test rejects a helper
claiming a different path. This proves the client declaration gate; actual
cross-process flock exclusion still requires deployed helper acceptance.

The initial full suite completed with 283 tests: 281 passed and 2 lifecycle fixture
failures. Isolated idle restart
passed; isolated restart drain failed with `child exit timeout` at the 30-second
deadline. Its next attempt failed at the 10-second startup-output deadline.
Server readiness follows synchronous Git runtime capture. Both lifecycle fixtures'
startup bounds were changed to 30 seconds. The drain exit bound was changed to
60 seconds because its deadline starts before synchronous Git add/commit and
the real repository version monitor;
HTTP 409, exit 75 and no persisted-job assertions remain unchanged. Publisher
runtime/restart logic was not modified. The final full-suite result is recorded below.
System Git process startup was measured at approximately 3061 ms; bundled Git
at approximately 495 ms. Final verification uses bundled Git
`2.53.0.windows.3` through this test subprocess's PATH. Global Git and system
configuration remain unchanged. An intermediate full run passed 288 tests before
the final IID/stdin and shared-lock corrections. The subsequent in-progress run
was explicitly stopped when the lock-path mismatch was found; it is not recorded
as a pass. Final verification runs the entire suite on the corrected source.
The final full run passed all 292 tests, including both lifecycle fixtures,
candidate protocol constraints, A failure/rollback ordering and game/forum
CheckList regressions. Temporary logs were removed. Read-only Git object residues
remain in `.task-tmp/dual-node-validation`: ordinary deletion failed on those
attributes, and the local execution policy rejected force/attribute-reset cleanup.
Cleanup is incomplete and requires a separately permitted removal of this exact
task-local directory. Browser screenshots and non-secret evidence remain committed.

Contract tests use mocked A/B helpers, real local archive/journal files, and injected
Docker/transport calls. The primary engine tests use injected command execution.
They prove publisher gating and ordering; they do not prove deployed helper locks,
real Docker loads, target secrets, atomic remote markers or B database state.

## Browser Fixture

Actual console HTML/CSS/JavaScript ran in a loopback-only HTTP fixture with
`STANDBY_CANDIDATE_FIXTURE=1`, `UI_FIXTURE_PORT=18789`. The fixture never loads
the release engine or production config and never executes deployment commands.

The successful browser command used bundled Playwright, the installed Chrome
executable and `scripts/verify-game-standby-ui.cjs`. Results in [browser.json](browser.json):

- Desktop viewport 1440x1100 and mobile viewport 390x844: no horizontal overflow.
- B readiness is mapped to data safety; accepted standby is a distinct final phase.
- Standby acceptance follows A final observation in displayed and execution order.
- Mock execution locks the execute button and terminal completion unlocks it.
- JavaScript page/console errors: 0. Failed requests/HTTP errors: 0.
- Production operations: 0.

Screenshots: [desktop](desktop.png), [mobile](mobile.png), [running](running.png),
[finished](finished.png). Primary visual inspection found no clipping or overlap.

The in-app browser connection was unavailable due to an authentication error.
Isolated headless Chrome completed the browser verification. Gemini image capability
requests to `gemini-3.1-pro-high` and `gemini-3.8-flash-high` both returned
`api_error: No available accounts`. External Gemini visual review is unverified;
no gateway settings or credentials were changed. Claude requests failed twice;
DeepSeek supplied abstract safety advice, with all code and acceptance owned by
the primary agent.

## Production Boundary

No production release, B application start, database promotion/migration, Gate
switch or host shutdown occurred. Real dual-node acceptance has not run.
The missing node interfaces and secure target package dependencies are enumerated
in [the candidate contract](../../GAME_DUAL_NODE_CANDIDATE.md).
