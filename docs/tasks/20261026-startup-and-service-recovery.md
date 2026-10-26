# Startup configuration and service-only recovery

Scope: publisher code, local fixtures and publisher delivery. No game/ forum
production mutation, key rotation or database restoration is performed here.
Existing unrelated validation-audit documents are excluded.

The selected candidate must declare `--check-login-signing-key` capability in its
main entrypoint when login signing configuration is required. After image
delivery and before application cutover, a short-lived Swarm validation job runs
that candidate JAR with the production profile and rendered candidate Compose
bindings. It compares the candidate with the live baseline and permits only the
publisher-approved signing delta. The application checker loads actual Spring
configuration (environment, configtree or AUTH_TOKEN_SECRET_FILE), enforces its
32-byte rule and exits before database/business startup. The publisher reads exit
status and candidate identity; it never reads key bytes or candidate logs.
The approved metadata is `gameStartup.signingSecret` in publisher configuration:
`source=login_signing_key`, `secretName=game_login_signing_key_20261026`,
`target=auth_token_signing_key`, `uid=0`, `gid=0`, `mode=0400` (JSON decimal 256).
The exact environment reference is `/run/secrets/auth_token_signing_key` via
`AUTH_TOKEN_SECRET_FILE`. The Compose override variable
`AUTH_TOKEN_SECRET_DOCKER_SECRET` cannot select an unapproved resolved name.
This records permission to use the reference, not proof that the secret exists
or preserves the original signing identity. That external evidence remains required.

The validation job has no published ports or overlay network and uses read-only
binds; cleanup verifies exact ownership. No key is provisioned, mounted afresh or
rotated. A source/policy/image/service-bound PASS receipt is rechecked by the
pre-deploy CheckList without rerunning an unchanged candidate check. Unknown
capability, failed exit, unavailable evidence or changed identity fails closed.

New backups retain a checksummed recovery receipt: original Spec hash, image ID,
verified digest and migration count. Legacy backups require a terminal publisher
history record with completed zero-migration CheckList evidence. Recovery binds
tag-only PreviousSpec to the exact backup Spec and resolves backup/tag/digest to
one identical image ID. It rejects drift, missing/ambiguous identity, migrations,
missing original healthy container or required technology/room capability classes.

Only the original Spec's image reference changes to its verified digest. Secrets,
authentication, mounts, networks and runtime policy remain intact. The reviewed
plan hash and service version are required. Docker's versioned update API supplies
an atomic concurrency guard. Submission and successful verification are separate.
No database, Compose file, key or application source is restored.

## Operator workflow in the authorized production operations task

From the publisher repository, use the approved SSH target and existing identity:

```powershell
node scripts/game-service-recovery.mjs --history-id <terminal-history-id> --host <approved-ssh-target> --identity <existing-identity-file>
```

The default is read-only. Review digest/image ID, original version, replicas,
baseline/current Spec hashes, healthy container, service version and plan hash.
Confirm no concurrent operator is recovering or releasing the service.

After separate production authorization, run the same command with
`--apply --expected-plan <reviewed-planHash> --expected-version <reviewed-serviceVersion>`.
Evidence is re-read before submission; changes cause refusal. After an uncertain
submission inspect current state before any retry. Use the same base command with
`--verify` to require restored Spec, completed update, exactly one healthy original
image replica and no other running service container. Then perform the established
login/runtime checks. Container health alone does not prove business behavior.

## Independent double check

The structural validator uses a normalized validation-only view that removes
only this exact approved addition. The original 14 required Secret mappings and
all other environment/mount/profile/runtime invariants remain mandatory. The
actual candidate JSON and deployment YAML retain the approved binding. Unknown,
duplicate, missing or differently permissioned signing mappings are rejected.

Round one: compare selected core check, command and 240-second timeout. The startup
check is registered and selected from the candidate declaration. Existing feature
selection, local policy, backend, migration, pre-deploy and final runtime checks
are retained. No unrelated feature acceptance is added.

Round two: review transitive reads and mutations. Startup reads candidate source
and service metadata, and creates/removes only its owned checker job during an
authorized release. Current verification uses mocks, never a real production job.
Recovery reads checksummed snapshots, publisher history,
Docker metadata and the original JAR class listing. Its only mutation is the
explicit versioned service update. It invokes no other feature validator and reads
no historical screenshot or unrelated evidence. The separate broad automatic
rollback path remains unchanged and must not be replayed for service-only recovery.

The feature preflight CLI now streams progress while preserving exact selection,
success protocol, timeouts/output bounds and shell-free toilet-market entrypoints.

Validation: targeted existing/new 28-test run passed before the application's new
checker contract arrived. The revised six behavior tests passed. The earlier
full run was interrupted because that new contract invalidated the candidate;
the final unchanged candidate has its own full npm test run. A previous full run
passed 438/440: two existing Windows Git Bash fixtures exceeded their ten-second
harness limit and returned truncated output with null status. The complete
standalone eleven-case fixture then passed, including all five services and the
negative readiness message. Windows harness allowance is now thirty seconds;
production timeouts and all assertions are unchanged. Full npm test and
publisher delivery identities are recorded on completion.
Tests use local fixtures and mock Docker/HTTP; no application production action
is used to validate the publisher.

Remaining limits: unsupported checker capability and unprovable legacy identity are
refused. Actual application/login acceptance belongs in the designated release
environment after separately authorized recovery. No promise of runtime success
is inferred from green publisher unit tests.

## Final local acceptance

The final unchanged executable candidate passed `npm test`: 441 tests, 441 pass,
0 failures/cancellations/skips/TODO, 423579.8583 ms. Log SHA256:
`6f64d44ebfa781d3624ea4e022b14d823c849174ff526df014e02978b3b87690`.
The focused signing/configuration/recovery suite passed 23/23; the zero-replica
guard reached its intended failure with stdin transport and passed; the complete
Meelok fixture passed 11/11 after the Windows harness adjustment.

The long generated program also exposed a legacy test passing Bash source in
argv. Its fixture now uses stdin, matching the already-tested production runner.
The zero-replica guard remains before any signing metadata probe or deployment.
No production timeout or safety assertion was relaxed.

Local check policy SHA256:
`8fc5ca10bf651eb9d67dce1e8aca77884bc7b9ed798d22acf039e307e7b42e7d`.
Signing binding module SHA256:
`9a7a4fdf555c3c00e77d83d2de3c1147a74a8e11d2b869f5d6757b8aaf1c205a`.
Candidate checker script SHA256:
`644df9df8fe5a92a0bcc4ff5508834af7bf7ea4226f3e8c2c63042336d74b217`.
The PASS receipt also binds the actual approved Secret ID, so deleting/recreating
the same Secret name cannot reuse prior acceptance.

Browser acceptance used an isolated running console on port 8791 with synthetic
failure history and an empty job store. Both concrete configuration rejection and
the separate service-recovery action rendered correctly; a full-page screenshot
was captured in the task, and application console errors were empty. No execute,
cancel, diagnose or application recovery action was clicked. The fixture server
was stopped after inspection.

Publisher runtime commit/tree and delivery state are verified separately against
the clean committed runtime. The repository has no checked-in CI workflow; local
acceptance is not represented as an external CI run. Existing game recovery
history and private signing identity approval are not rewritten by this delivery.
