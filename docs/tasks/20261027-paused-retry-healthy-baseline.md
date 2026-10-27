# Retry a paused game update while retaining the serving old container

This change belongs only to the publisher. Installing it does not update any game
service, stop a task, mount a secret, create a checker job or erase recovery history.
All application execution remains inside a new release explicitly started by the user.

## Baseline and submission contract

The ordinary converged-service path retains its existing Stack deployment. A paused
retry is a separate, narrow path. It requires one replicated slot, start-first, a
single healthy running container, its exact Swarm task/labels/configuration and an
unchanged service version. The failed desired Spec may differ from PreviousSpec
only in the image, IMAGE_TAG and the corresponding Stack image label. Other drift
is refused. The prior publisher history must prove a terminal zero-migration
release and identify its checksummed backup; that backup must match PreviousSpec.
The retry itself must also select zero migrations. Offline/database-changing cases
require their existing recovery runbook instead of this path.

The backup saves the observed failed Spec separately from the effective healthy
recovery Spec. The latter binds the old task configuration and resolved immutable
image to the exact container used for the database evidence and backup. The selector
does not infer a baseline from the failed desired image or pick an arbitrary healthy
container. It rechecks service version and baseline identity after backup and before
submission. The existing schema, database identity, format compatibility, candidate
assessment, mandatory local checks and final runtime gates remain mandatory.

The candidate checker runs after image delivery and before cutover. Its existing
source/policy/image/Compose/service/Secret-ID receipt is verified again immediately
before a paused retry. Compose renders use the same explicit project name, so
temporary-file locations cannot change the receipt's normalized network identity.
The retry also compares healthchecks, update/rollback/restart policy, ports, DNS,
mounts, networks and stop grace period. Unsupported policy changes fail closed.
Docker-generated empty policy fields and null MemorySwappiness are normalized only
where their semantics are unchanged. Signing mode accepts Compose's exact octal
string `0400` or Engine integer 256; decimal 400 and broader permissions fail.

The paused retry submits only the selected service through Docker's version-checked
update API, with the candidate image pinned to a verified digest. It does not use
force, scale-to-zero, container kill, or a preliminary rollback. The old serving
container is left alone during preparation. Replacement happens only during the
user-started candidate rollout, according to the retained start-first health policy.
There is no claim of absolute zero failure or that a scheduler never replaces a task.

If this new candidate fails, recovery uses the authenticated healthy recovery Spec,
not the failed desired Spec that Docker now stores as PreviousSpec. The API mutation
is guarded by the actual submitted Spec hash, old baseline/image identity and current
service version. Existing format compatibility checks still run. The original observed
Compose is retained for audit on this exceptional recovery path; it is not presented
as a successful restoration of that file. No database-wide restore is introduced.

## User operation and cleanup

Use the normal release console, select the final repaired application commit and a
fresh image tag, create/review a formal game plan, then explicitly start that release.
Do not reuse failed tag `2026102601`. Existing RECOVERY_REQUIRED history is retained;
it is terminal audit evidence rather than an active job. The console must be idle
and run the same clean publisher revision as its repository. The new plan must retain
the startup-contract step and all applicable mandatory checks. A failed precheck
stops before game cutover and reports the first reason; it must not manufacture PASS.

No failed image cleanup is performed before the new rollout. After confirmed success,
an operator may review the exact failed image ID and its rebuild source. Before any
removal, recheck that no running container and no current or PreviousSpec service
image references that image/tag/digest. Docker may retain the failed image in the new
service's PreviousSpec even after success; in that case leave it in place. Never
rewrite PreviousSpec merely to enable cleanup. Only when all dependency checks pass,
remove individually identified exited containers for this service/image, then remove
that exact image/tag without force. Never use global container/image/system prune.
Cleanup is optional and is not a prerequisite to re-publication.

## Validation and independent review

Local fixtures cover converged and paused selection; missing/multiple healthy tasks;
wrong service, image, task, configuration or environment; invalid prior history and
checksums; migration/unsupported states; service-version and identity drift; candidate
runtime policy changes; exact octal mode conversion; CAS rejection; and rollback to
the healthy baseline rather than failed PreviousSpec. Docker calls are mocked and no
fixture starts a game or connects to production.

Read-only production audits independently checked the selector against the existing
backup and old running task, and rendered final application commit
`1d4dd5a95a1317ec2e493c50c46200918c3032ab` through stdin to inspect policy and Secret-ID
binding. These are read-only evidence, not a candidate runtime checker PASS. The final
candidate image is built and checked only after the user starts the release.

The second review follows the transitive helpers: no business feature validator is
added, renamed or expanded; no localCheckPolicy entrypoint, timeout or required
business evidence changes. Backup capture uses inspections and existing history;
production mutation is confined to the user-triggered deploy/rollback branches.
History files are never written by the new helper. Secret bytes are never read by
the baseline or policy helpers. The candidate's dedicated checker remains responsible
for validating the actual mounted signing configuration without business startup.
