# Publisher Migration Workflow Acceptance

- Date: 2026-10-25, local publisher only.
- Candidate: 6888056d43fe14f5e9e4e1e131365d21ee763b40.
- Task: ../../tasks/20261025-migration-workflow.md.
- Root cause: local runtime lacked existing upstream Guild B workflow support.
- Correction: integrate 7de0c954 with all five local commits preserved.
- Narrow SQL contract: exact Guild B path and clause, prior prepared A, scheduler
  archive/drain, stopped writers, verified full backup and compatible rollback.
  Generic ALTER COLUMN and destructive operations retain fail-closed guards.
- Safety and independence: mandatory game/forum gates retained; two new checks
  are remote; local-check policy unchanged. Command selection and transitive
  shell/Python evidence flows independently reviewed.
- Local gate blocker: bounded Windows atomic receipt replacement retries only;
  old receipt/lock retained, permanent and unknown errors reject, remote acceptance
  is not repeated. Focused tests 35/35, no skips.
- Final mandatory gate: npm test 430/430, zero failures/skips/cancellations/todo;
  frozen 14 source hashes unchanged. Earlier two full failures remain failures.
- Runtime: automatic idle reload, clean UP_TO_DATE and exact content fingerprint.
- API: fixed f62422f9 and 931bad01 each HTTP 200, 43 steps; baseline 6bf869bc.
- Browser: normal flow, new checks visible, fixed commit selection; zero new
  console warnings/errors, failed HTTP requests or execute requests.
- Visual scope: actual unchanged desktop UI screenshot; no redesigned UI,
  responsive, glyph or geometry certification.
- Production: zero release actions, history unchanged, publisher idle. Prior A
  and scheduler conditions remain unverified until authorized release preflight.
- Delivery status: publisher correction PASS; production readiness UNVERIFIED.
- Evidence manifest binds raw and normalized LF hashes to avoid confusing
  Windows checkout newline conversion with executable source drift.
- Final evidence-only commit retains the same executable candidate and test
  inputs. No push or manual service restart is included.
