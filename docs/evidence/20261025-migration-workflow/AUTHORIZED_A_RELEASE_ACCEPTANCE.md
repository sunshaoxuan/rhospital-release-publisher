# Authorized A Release Acceptance

## Result

- A preparation, formal publication and immutable runtime acceptance: PASS.
- B prerequisite investigation: COMPLETE. B release readiness: BLOCKED.
- No B deployment, B SQL, stopped-writer cutover or scheduler write performed.

## Candidate And Policy

- A commit: `96193ca1825389bf920ad93a5f11b0a77e73cde1`. Tag: `20261025-a`.
- Job: `1792907441383-9e7b412f4d5cd8`, EXECUTED. History:
  `2026-10-25T06:27:34.371Z-20261025-a`.
- Image: `hospital-backend:20261025-a@sha256:2422d371f0c99aecab57fbaae49eb8a38bc5b89bd836809ad0d6a1a245a50aec`.
- Publisher commit: `85ac7a4b9f77d945d687b278c6c5fb51e2c67b15`.
  Content hash: `68ae9fdcb410f34e6c7f29f07d58118dfdcaec4adf121c88ec73bf84e01b9ffe`.
- Only the service Image reference changed during digest pinning. Start-first,
  pause-on-failure and 720-second monitor policy remained unchanged.

## Evidence Matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Exact baseline assessment, retained formal gates | PASS | a-release-plan.json |
| All 36 normal steps, recovery-only steps unexecuted | PASS | a-formal-release-result.json |
| Prepared A callback in live immutable JAR | PASS | a-live-immutable-final.json |
| Completed rollout, one healthy replica, prior tasks terminal | PASS | a-live-immutable-final.json |
| Five original runtime checks after digest pin | PASS | a-immutable-runtime-result.json |
| Unchanged publisher policy | PASS | a-publisher-policy-identity.json; a-immutable-runtime-result.json |
| B JAR, migration and local/production image binding | PASS | b-image-contract.json |
| B assessment relative to newly published A | FAIL | b-plan-after-a.json; b-readiness-after-a.json |
| B scheduler archival | FAIL | b-scheduler-prerequisites.json |
| B stop, backup, contraction migration and deployment | NOT EXECUTED | authorization boundary |

## Verification Boundaries

Preflight includes 472/472 and 51/51 test groups. The formal backend gate
reused candidate-keyed BuildKit COPY/package cache. Retained Surefire reports
contain 1896 tests, zero failures, zero errors and 91 skipped tests. Maven
tests were not freshly executed in this release. No publisher executable
source was changed in this authorized follow-up.

After digest pinning, final-runtime-check, game-prd2-runtime-contract,
verify-game-static-delivery, verify-relations-release and
verify-tradepool-release each executed once and passed. Browser delivery
covered six probes across two gateways. Existing telemetry exclusions were
reported by the validator; they were not changed for this task.

## Outstanding Conditions

B commit `931bad014c1e9356e13652df608704cfda8ec514` requires a new assessment
identifier and exact coverage of the 16 A-to-B runtime/migration paths. Its
current assessment has 25 excess paths already published in A; plan creation
correctly returns HTTP 400. Scheduler jobs 18 and 20 are disabled with
`deleted=0`; archival is outstanding. No pending tasks, batches or active
workflow references were observed in the read-only snapshot.

A new B candidate and formal gates, refreshed pre-cutover evidence and
explicitly authorized scheduler archival and B cutover remain necessary.

An existing Meelok pause marker belongs to another release. Web was already
desired=1/running=0 before A; pause/restore emitted ownership warnings and
preserved its marker and snapshot. No unrelated recovery is claimed.

## Final Scope Review

User-authorized A publication and subsequent B condition verification are
complete. B readiness remains blocked. No safety check was bypassed, no
unrelated dirty work was reverted, and no unrelated maintenance state was
changed. Task-local probes are removed after evidence extraction.

Delivery checks: 15 new JSON receipts parse successfully. Documentation and
structured evidence pass staged whitespace checks. The byte-preserved runtime
log is excluded from whitespace checking because Docker table rows retain
trailing padding; its SHA-256 is recorded in the structured runtime receipt.
