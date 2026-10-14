# Toilet Market Publisher Policy Review

## Scope And Identity

Only the publisher owns this change. The application checkout and all business
evidence remain read-only. No game release, migration, image switch, service
installation, second publisher listener or authentication/network change occurs.

Application check identity on 2026-10-14:
`c6a28f4828944b6fe172d90e22459a9cd56dfd8171eea902a512a401cb8cef18`
over the validator's 45 declared source paths. The identity was unchanged across
the actual check. The development handoff identifies commit
`1f6138a7ffb09f884a2c573b9f99df47e0fbb05c` and master baseline
`f907b303e8645e6aca320b07867369b55556e52f`; final integration remains separately
owned. Publisher commit, policy hashes and live runtime identity are recorded in
the post-commit operational receipt below.

## Round One: Contract And Commands

- PASS: `verify-toilet-market` is game-only and independently selected. Empty
  applicable feature selection remains valid. Forum selection rejects this key.
- PASS: command is exactly `node --test src/test/js/toiletMarket.test.mjs src/test/js/toiletMarketEvidence.test.mjs && node scripts/validation/toilet-market/validate-evidence.mjs`.
- PASS: canonical timeout is 180 seconds, with one shared execution deadline.
- PASS: inputs are exactly the two tests and validator in the command. Missing,
  extra, repeated, cross-feature, aggregate, recursive and altered commands reject.
- PASS: wrong/missing/extra/duplicate selected keys and timeout drift reject,
  including identical drift in both the selected and executable declarations.
- PASS: complete TAP and spec counts require positive tests equal pass and zero
  fail/skipped/cancelled/TODO. Missing or duplicate summaries, process failure,
  timeout, signal and missing/partial/prefixed/suffixed markers reject. No expected
  test count is hardcoded. ANSI-free spec output and the full application sample
  are exercised; the sample alone has no final evidence PASS and rejects.
- PASS: the exact full-line success marker is
  `PASS toilet market barter, hourly positions, legacy-safe migration, runtime visuals and final source binding`.
- PASS: Windows execution uses two fixed Node processes after canonical policy
  validation. A failed test process stops the evidence process. Other keys retain
  their existing PowerShell path. A completed preflight covers audit steps once.

## Round Two: Calls And Evidence

- `toiletMarket.test.mjs` uses Node builtins, reads ToiletMarketViewer/userService,
  and invokes only a Node syntax check. No other feature validator is called.
- `toiletMarketEvidence.test.mjs` imports its own validator and constructs isolated
  fixtures. Its positive fixture contains no unrelated evidence. Related Java and
  HTML source drift rejects; text LF/CRLF is canonicalized and raster bytes retain
  exact identity. Another feature's screenshot cannot replace this bundle.
- `validate-evidence.mjs` uses Node builtins and read-only source hashing. It reads
  the toilet evidence pointer, final intent receipt, source binding, PostgreSQL
  receipt, runtime receipt and current bundle screenshots. It validates exact API
  cases/UI states, relevant source hashes and bundle-bounded screenshot hashes.
  `verify-postgres.py` and the migration are identity inputs; this validator does
  not execute either file. No production subprocess or full foreign acceptance
  chain is invoked. Shared source files are read because this feature uses them.
- Source identity is calculated by the pure scoped helper, independently from
  business acceptance. Historical container/image IDs, test ports and unrelated
  screenshots are not universal prerequisites in the publisher policy.
- Mandatory backend, migration safety, pre-deploy, static delivery and final
  runtime gates remain under their existing rules. No foreign gate is changed.

## Results And Boundaries

Publisher focused policy/execution checks: exit 0, 20/20 tests. Focused exact plan
and forum rejection: exit 0, 1/1 test. Required final `npm test`: exit 0, 336/336,
zero fail/skipped/cancelled/TODO. `git diff --check`: exit 0. The frozen spec
fixture's stdout and exit code exactly match the actual full application sample.

Actual unchanged application check: 24/24 Node tests passed, with zero
fail/skipped/cancelled/TODO; the final validator exited 1 with
`TOILET_MARKET_EVIDENCE_BLOCKED: Final toilet intent acceptance is incomplete`.
The publisher rejects that result. Synthetic successful evidence fixtures prove
the success protocol only and never authorize a game PASS.

The read-only handoff BLACKBOX_REPORT keeps the final game matrix FAIL/BLOCKED,
including unavailable isolated Docker and rejected cleanup. The application
candidate object was absent from the live publisher's game repository during
review. A formal live plan for that candidate awaits the integration process.

Live registration is verified through the existing `/api/version` endpoint's
`localCheckContracts`, computed by the running policy's Double Check. A clean
matching runtime/repository commit and contentHash must also be observed after
the existing idle self-reload. This is registration/policy evidence only.

Operational evidence directory, retained as formal delivery outside Git's dirty
state: `C:/workspace/rhospital-release-publisher/.service/evidence/toilet-market-check-20261014/`.
It contains `VERIFICATION.md`, `verification.json`, `application-check.json`,
`focused-verified.log`, `plan-focused.log` and `npm-test-final.log`.
