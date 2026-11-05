# Authoritative challenge combined deadline

## Finding and bounded correction

Publisher base: `bac64be4be7fed1b87d3e219723b498a752b3051`.
Read-only source evidence: RHospital's
`docs/investigations/20261105-standby-takeover-contract/HA_DISPATCH_NATIVE_GATE_OUTCOME.md`
(2026-11-05 12:37 UTC), and the referenced native failure receipt/log.
No application checkout was edited or its acceptance gate started here.

Both native attempts exhausted the same 180-second deadline with ETIMEDOUT /
SIGTERM, not a failed assertion: all 125 JS tests completed in 156.023 and
145.616 seconds. The unchanged evidence validator separately took 60.072 seconds.
The slower observed composition is 216.095 seconds before launch overhead.
Retry log hotspots include challenge successor/source-drift evidence testing
(80.214 seconds) and phase-delivery negative evidence testing (20.447 seconds).
These are elapsed times, not a CPU/IO profile; application internals were not
executed or changed. No publisher-side duplicate invocation was found: one Node
test invocation containing six inputs, followed by one final evidence validator.
Negative evidence tests do not replace the final source-bound validation.

Register a **300-second total** for this check only, rounded above 25% headroom
over the observed 216.095 seconds. This prevents the demonstrated false timeout;
it does not claim a computation speedup or guarantee future execution time.
All six test inputs, the validator, short-circuit behavior and success marker are
unchanged. Other check budgets remain unchanged. A timeout, signal, nonzero exit,
incomplete TAP, skipped test or absent marker still rejects the result.

## Contract and compatibility

`BACTERIA_AUTHORITATIVE_CHECK` is now the single exported key/command/timeout
contract. Its command exactly matches the command recorded in the failed native
receipt; the only execution-budget change is 180 to 300 seconds. Registered
metadata defensively copies the seven inputs. Plan payload, individual step and
outer summed budget use this contract. Commands or timeout declarations drifting
together still fail closed against the canonical policy.

Native consumers must import the new contract (or obtain its registered metadata)
and bind their receipt to the new policy SHA. Old hardcoded 180-second declarations
will be rejected; old native failure records must not be rewritten as PASS.
Updating publisher source does not mutate the separately installed running console.
The running 21f0999 console remains on its old policy until a separately authorized
administrator update; the historical one-time elevation is not reused.

## Independent review and evidence

- First compare key, exact command, seven unique inputs, canonical timeout, selected
  payload/step agreement and retained mandatory backend/pre-deploy/final checks.
- Then inspect the transitive publisher runner: it invokes this command once,
  retains the native test-exit guard, uses one 300000ms spawn deadline, and requires
  both complete test output and the evidence marker. It adds no feature dependency,
  cache reuse, receipt bypass, runtime mutation or application publication.
- Initial affected files: 24 real tests passed. Real isolated PowerShell fixtures
  cover success, failed tests (validator must not run), failed evidence and missing
  marker. Injected timeout/SIGTERM is rejected even with complete passing output.
  Exact selection, missing/extra/duplicate inputs, stale budgets and altered guards
  reject before execution; unrelated fixture evidence is absent on the success path.
- Policy blob: `7c23a57edd0e50b9aba5b9ddae9bb2d72f267c08`.
- Scoped `npm test`: 30 real checks passed, two fixture checks failed, 40 filtered
  file wrappers, 92.110 seconds (`.task-tmp/authoritative-budget-npm-test.log`).
  The failure was inherited NODE_OPTIONS test filtering suppressing intentional
  negative fixture tests, not the production budget. Both isolated fixture launchers
  now clear NODE_OPTIONS and NODE_TEST_CONTEXT; the positive fixture also proves an
  actual named test ran instead of accepting empty-file wrappers. Rechecking only
  these two changed tests passed both, with 42 filtered wrappers, in 20.818 seconds
  (`.task-tmp/authoritative-budget-fixture-final-npm-test.log`). Combined coverage is
  32 real checks; this is not a single unfiltered green suite.
  This is publisher contract acceptance, not a new run of the application's 125
  tests or a live HA takeover acceptance. The application owner must execute its
  normal native gate after binding the new policy identity.

No UI changed. No game/forum/Meelok service, database, shared test stack, credentials,
permissions or production files were modified. Existing unrelated untracked audit
files are preserved. Application-level source-drift/negative evidence behavior was
not reprofiled here; its previous result is diagnostic context, not new acceptance.
