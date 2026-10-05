# Formal Game Dual-Node Candidate

## Scope And Status

Publisher code implements mandatory protocol-v1 client steps and fail-closed
validation. Local mocked-node tests verify publisher behavior. Real A/B deployment
acceptance has not run. No production release, application start, database migration
on B, promotion, traffic switch, shutdown or infrastructure edit is part of this task.
Forum releases and game image-only exports retain their existing behavior.

A is `92.113.124.185`; B is `185.184.223.41`. The existing infrastructure
`deploy/ha-standby/prepare.py stage` reads A's running service and overwrites
`/opt/rhospital-dr/standby-prepared`. It cannot satisfy this protocol. Its existing
lock is `/etc/rhospital-ha/stage.lock` (`prepare.py` uses `ROOT + '/stage.lock'`,
with `ROOT = '/etc/rhospital-ha'`). The monitor's post-release transfer does
not count as the mandatory pre-cutover gate.

## Publisher Sequence

1. Existing source, application, database compatibility and build checks run.
2. `build-image` records its full immutable ID with Docker `--iidfile` in the
   candidate directory. `publish-image` requires this build receipt, checks both
   node contracts and rejects any tag drift from the built ID, saves that ID once,
   hashes the archive, and uploads the same archive bytes to A/B.
   A loads and binds the release tag; B loads and prepares a private versioned
   candidate. B never builds, starts an application, runs business jobs or mutates
   a database. Candidate configuration must use B-local connections while retaining
   production payment, Steam, SSO, profile and other business semantics.
3. `verify-game-standby-candidate` precedes A Compose replacement. `deploy-stack`
   uses the candidate helper to repeat the B binding gate and pin A's image identity
   while executing the publisher's existing deployment script and safety checks.
4. Every existing A runtime and business final check remains mandatory.
5. `accept-game-standby-candidate` runs last, verifies B again and A's actual healthy
   container image ID, then performs an atomic compare-and-swap of B's accepted marker.
   No subsequent cancellation check or fallible release step can trigger rollback.

New steps are registered executable assessment checks. They are unconditional for
formal game deployment; business assessments cannot opt out. Existing game/forum
assessment requirements remain intact.

Full Docker image ID identifies image content; archive SHA-256 binds transferred
bytes. A helper must pin the loaded ID, reject tag drift and registry re-resolution.
No rebuild on B or mutable-tag-only equality is allowed.

## Required Node Contract

The following **cross-repository dependency is currently missing** in the read-only
infrastructure reference. It must be implemented, installed and independently
verified before a formal game release can pass. There is no legacy fallback.

Both nodes must expose root-owned executable
`/usr/local/sbin/rhospital-release-candidate-v1`. Invocation is authenticated SSH
with strict host-key checking, an action argument, and one JSON request on stdin.
The publisher reuses A's resolved SSH user/key and port; B uses the same credentials
and port 22. B's pinned host key and permission to use these credentials are deployment
prerequisites. Failure to authenticate is a failed gate.

Every helper action must suppress secret/configuration values in stdout/stderr.
Only one bounded JSON receipt is allowed on stdout. Publisher errors are generic,
and remote malformed output/stderr never enters logs. Private diagnostics must be
root-only and redact secrets. Secret version is an opaque UUID, never a hash of a
secret. Config hashes cover non-secret structure and references only.

### Actions

`capabilities` returns `protocol: 1`, `node` equal to its fixed IP,
`sharedLock: /etc/rhospital-ha/stage.lock`, and true flags `versionedCandidates`,
`atomicAcceptance`, `pinnedCutover`, `noSecretOutput`. A/B helpers must support all
their applicable actions. Capability claims need real behavioral acceptance.

`begin` creates a private root-owned upload reservation for `candidateId` and
returns that identifier, the matching `operationId` and `ready: true`.
Each command has an independent operation UUID. Upload destination is exactly
`/opt/rhospital-dr/release-incoming/<candidateId>.<operationId>.tar`. Reject symlinks, unsafe
ownership/permissions, existing conflicting reservations and concurrent writers.
Reservations must survive the SCP request and remain exclusive until finish or
bounded crash recovery. A partial upload is never loadable or ready.
The operation ID fences late writers and cleanup requests. Cleanup must compare
the active reservation owner; candidate identity alone cannot authorize release.

`load` on A verifies the entire archive hash, loads it without executing it,
inspects the full image ID, and binds the requested release tag under a node lock.
It returns `candidateId`, `imageId`, `archiveSha256`. Protect loaded candidate IDs
and accepted images against garbage collection and retagging until reconciliation.

`prepare` on B takes the same binding request. Under the **same flock inode** used
by the legacy background staging, it verifies the archive, loads the exact ID,
validates the preprovisioned target config/Secret package, and atomically publishes
an isolated completed candidate directory. `verify` repeats actual image,
config/Secret files, permission, stop-state and version checks under that lock.
Both return the binding fields plus `protocol: 1`, `node` equal to B,
`configurationId` as a 64-character non-secret structure digest, `secretVersion`
as an opaque UUID, `previousAccepted` as a verified baseline UUID, and all true flags:

```text
standbyStopped jobsDisabled databaseUnchanged localConnections
productionSemantics secretsReady isolatedCandidate complete
```

`jobsDisabled` attests that no B business worker is running while the application
is scaled to zero; future production job configuration remains intact.
`databaseUnchanged` attests that publisher/helper actions performed no database
writes, migrations, promotion or role/configuration changes. Existing replication
may continue independently; data/schema freeze and replication acceptance are
outside this protocol.

`configVersion` is SHA-256 of the target production Compose source. `sourceCommit`
is the exact checked-out commit. B must independently bind its rendered package
to those versions, declared B datasource/database identity, B network parameters,
production profile and payment/Steam semantics, expected secret target names,
mode/ownership and content verification. A current-service snapshot alone cannot
prove the target configuration. Missing package, unknown mapping or version drift
must reject preparation. The package source and secure provisioning path require
infrastructure implementation. No secret values traverse the publisher.

Separate versioned candidate/accepted directories must be outside the legacy
mutable `standby-prepared` tree. Legacy background staging must hold the same lock
and never modify candidate/accepted files or their image bindings. Candidate Compose
must reference the full image ID with pull never, restart disabled, scale zero,
controlled profile and loopback ports. Worker ownership is inactive; database remains
unmodified/unpromoted. No data copy or file synchronization is performed here.

`verify-image` on A returns `protocol`, `node`, `candidateId`, `imageId` after
inspecting the tag and loaded image. `verify-runtime` additionally requires
`healthy: true`, exact running container ID, expected service/version, completed
rollout, no old running tasks and no rollback state.

`cutover` on A receives the binding and the original publisher Bash deployment
script. It must independently verify B's immutable candidate immediately before
submitting A, retain B's shared lock/reservation across submission, hold A's
image/deployment lock, reject tag drift, disable registry
re-resolution and execute the script once for the same candidate. It must preserve
the script's Compose, old-health, start-first and backup checks. Return
`candidateId`, `imageId`, `submitted: true` only on confirmed submission. A helper
that merely trusts the client's earlier B receipt leaves a race and is insufficient.
Node lock scope is local to each node; no cross-host flock guarantee is assumed.
Cross-host coordination must use authenticated helper calls and a fenced candidate
reservation. Repeated cutover for the same candidate must reconcile submission
instead of deploying twice. This coordination is part of the missing node interface.

Before the first protocol release, infrastructure must establish a versioned accepted
baseline with verified image, B-local configuration and private secrets. Preserve the
existing legacy prepared artifacts during this separately authorized bootstrap.
Missing/unverified baseline cannot be represented by a null predecessor or promoted
to trusted state automatically. The publisher rejects readiness without its UUID.

`accept` on B rechecks the candidate and A final-runtime proof, acquires shared flock,
and atomically CAS-replaces a single accepted pointer using `previousAccepted`.
Use write, fsync, rename and parent fsync; preserve the prior accepted image and
configuration/Secret directory. Return all immutable binding fields and
`accepted: true`, `standbyStopped: true`. Retrying the exact accepted candidate is
idempotent. Conflicting acceptance fails. Preparation must not update the pointer.
Accepted retries return the original predecessor in verify receipts so the publisher
can reconcile a lost commit acknowledgement.
For an unaccepted candidate, verify must reject when the authoritative accepted
pointer differs from its captured predecessor. This prevents a stale concurrent
candidate from starting an A cutover after another candidate has been accepted.

`finish-upload` releases only the matching candidate/operation reservation and removes temporary/partial
archives only. It must never remove completed candidates or accepted images/config.
Failed cleanup leaves an explicit node maintenance dependency and cannot weaken a gate.
Return the matching `candidateId`, `operationId` and `finished: true` only after
confirmed cleanup. An otherwise successful distribution fails closed without it.
The client sends cleanup only for reservations whose begin receipt it confirmed.
Lost begin acknowledgements require node-side bounded orphan reconciliation.

## Failure And Recovery

B unreachable, partial transfer, mismatched ID/config, missing Secret, running
standby or lock conflict blocks A. Before acceptance, any A failure or rollback
leaves B's accepted pointer unchanged. Old accepted files/images are retained.
Failure or cancellation during the final acceptance command enters
`RECOVERY_REQUIRED`; the atomic marker may have committed before a lost response.
No automatic A rollback runs in that case. Reconcile A runtime and B accepted
pointer before further release/recovery; never infer acceptance from a timeout.
An A helper cutover refusal or lost submission receipt also requires reconciliation
without automatic rollback: an unchanged old service is not failed new-version
evidence. A Compose may already contain the target version and must be checked
against the saved backup before a further attempt. Confirmed later A runtime
failures continue to use the existing fatal/rollback gates.

Candidate IDs are generated once per plan. Re-run a failed CLI action with the same
encoded settings for an idempotent retry; a newly generated plan is a new candidate.
The CLI reads base64 JSON settings from bounded stdin (256 KiB), including the
existing cutover script. PowerShell pipes these settings; they never enter the
native Node command line, which has a smaller Windows argument limit.
Local `.release-candidates/<id>/candidate.json` contains allowlisted non-secret audit
binding. A local exclusive operation lock prevents overlapping same-candidate actions.
After publisher process termination, a leftover local lock requires confirming the
old process has stopped before task-scoped removal. Node reservations require the
same bounded crash-recovery discipline. Local archives are always removed in finally;
history retains published and accepted bindings before isolated worktree cleanup.

## Acceptance Evidence Still Required

Install the versioned helpers and secure target packages through a separately
authorized infrastructure change, including the verified prior accepted baseline.
Verify actual A/B same-ID load, partial transfer,
shared-lock contention with the real monitor, configuration and Secret mismatch,
no B containers/jobs, unchanged DB role/schema, A failure/rollback and accepted-pointer
CAS/fsync/retry behavior. This task supplies local protocol fixtures only. Production
activation and failover acceptance remain outside its authorization.
