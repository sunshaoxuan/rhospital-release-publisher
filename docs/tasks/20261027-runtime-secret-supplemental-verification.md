# Runtime Secret contract and supplemental verification

## Problem and scope

User-started run `1793070703606-4b3d272f6f1bf` deployed application commit
`1d4dd5a95a1317ec2e493c50c46200918c3032ab` (tree
`0d4f03f72ed4227bf7fc5a8ee2f251a506d01b0b`), tag `20261027`.
The publisher then incorrectly required the legacy fourteen mappings after the
approved login signing mapping had passed candidate startup validation.
The original run remains `RECOVERY_REQUIRED`; supplemental evidence is a new
record, never a rewritten successful release.

## Contract review

`gameRuntimeSecrets` owns the unchanged fourteen name/target pairs, exact Engine
UID/GID `0` and mode `0444`, plus the publisher-approved signing mapping only
when the candidate declares its startup contract. The signing mapping requires
UID/GID `0`, mode `0400`, its approved file environment reference and no competing
literal key. Each name must resolve to its actual immutable Docker Secret ID.
The healthy task must match the service image, environment and Secret mappings.
The startup receipt must bind the candidate image, checker source/policy and
signing Secret ID. Concurrent service changes fail closed. No Secret payload
is fetched by this new checker.

The registered `game-prd2-runtime-contract` key and its 180-second timeout remain
unchanged. Its Firebase, production environment, update/rollback, database
identity, Stripe GET authentication, unsigned payment rejection and monitoring
checks are retained. Backend, migration, pre-deploy, final runtime, selected
feature and forum checks retain their prior selection and requirements.
`src/localCheckPolicy.js` is unchanged (SHA256
`8fc5ca10bf651eb9d67dce1e8aca77884bc7b9ed798d22acf039e307e7b42e7d`).

## Verification-only entrypoint

After installing the tested publisher version, an operator may run:

```
node scripts/verify-game-supplemental.cjs --run-id 1793070703606-4b3d272f6f1bf
```

This accepts only the narrow supported failure boundary. It regenerates fixed
verification commands from current publisher code; persisted release commands
are never executed. It requires an idle publisher, the original candidate source,
the unique prechecked image, completed single-replica Swarm state and a healthy
container. It rechecks service version/container/image between checks. The
source bytes retain their line endings for the existing startup receipt protocol;
the installed publisher checkout must compute the same binding as its prior
startup check. A source/policy mismatch is rejected, not bypassed.

Evidence is stored separately in `.supplemental-verifications/` with original
run/history IDs, candidate tree, publisher commit, service identity, check
durations, result and output hashes. Raw account/credential output is not stored.
No deployment, rollback, container deletion or history mutation is selected.

The runtime contract uses a temporary host log file and deletes that exact file;
its existing validator handles the Stripe credential internally and performs a
GET balance request, without exposing its value. The empty unsigned Stripe and
Paddle requests exercise signature rejection before payment business handlers.
Browser checks use the existing controlled operator token, isolated local Chrome
profiles and the two configured gateways. They visit the normal/Steam game and
relations pages and do not issue business interaction commands.

## Deferred container audit

The existing trade-pool verification creates one `mktemp -d` directory **inside
the selected healthy game container**, extracts profile/driver files there,
writes/compiles `ReleaseTradePoolDatabaseAudit.java`, runs mode `verify`, then
removes that directory through an EXIT trap. The Java connection is read-only,
repeatable-read and rolls back; no schema/data mutation or service restart is
selected. It still consumes container CPU, temporary storage and a DB connection
(existing timeout 120 seconds), and is not a purely read-only container operation.

The new supplemental entrypoint therefore records this check as deferred rather
than inferring permission for its container writes from earlier investigation or
the user's original release click. Until its precise scope is confirmed and the
check passes, the separate supplemental result is `PARTIAL`, never full `PASS`.
No production service rollback is required by this temporary audit. If its
cleanup fails, preserve the exact temporary directory evidence for an explicit
cleanup action; do not use global prune or delete arbitrary paths.

## Verification evidence

Targeted contract, task/service integration, supplemental selection and complete
entrypoint fixtures cover success, missing/extra/duplicate mappings, wrong
identity/target/permissions, stale candidate receipt, environment drift,
concurrency, busy publisher, incomplete success protocol, sanitized failure and
preservation of original records. A final `npm test` is required before commit.
No application feature acceptance chain is rerun merely to read source hashes.

Final local gate completed on 2026-10-27: **460/460 passed**, zero failed,
cancelled or skipped, duration `468802.433 ms` (7m49s). Log:
`.task-tmp/final-runtime-secret-tests.log`, SHA256
`d48be0402d06b548230ba905e5ad673bf82df78f5f36f54b2afae0e012d67516`.
The metadata-only new checker also inspected the actual current candidate:
`game_runtime_secret_contract=PASS mappings=15`, with the original startup
binding `81ddedf9d6c67aeeb9455984343895704e34560bfb36ccfefa80648001ca2678`.
This inspection created no service or file and does not replace the remaining
login, dual-gateway, relations or deferred trade-pool verification.
