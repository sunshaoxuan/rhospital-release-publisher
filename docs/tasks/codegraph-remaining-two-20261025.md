# CodeGraph remaining-two publisher support, 2026-10-25

User authorizes source/check implementation, local tests, commit and push. Production access, scheduler reads/writes and release execution are forbidden in this task. Use isolated clean main clone; preserve original publisher checkout including five local documentation commits.

Implement only selected-candidate weekly retirement and guild B prerequisite checks, read-only proof of completed scheduler archival and drain at publisher execution time, migration/cutover integration, and rollback-to-A safety. Retain mandatory backend/migration/predeploy/runtime gates and exact input identities. Local tests use synthetic data and temporary schemas in the existing local PostgreSQL; never contact a live scheduler. New checks must fail closed on unknown status/schema, missing or stale predecessor, active references/workflows/retries, changed selected image/SQL and unarchived jobs. Archive the exact read-only scheduler observation in the release backup; this check never changes scheduler rows. Preserve player history and all other jobs. No UI changes.

Acceptance: focused command/selection/positive/negative/concurrency tests and full npm test; double-check transitive independence; developer final intent receipt, source/version IDs, verified push. Publisher production checks remain NOT EXECUTED.

Implemented: B-only plan selection, actual A class-file callback verification, immutable image/SQL-bound offline backup, read-only scheduler observation with workflow/retry refusal, compatible A/B rollback floor and target JAR retirement contract. Combined technology/room and B contraction is refused because A must be deployed first. Local shell tests cover pre-stop refusal, post-stop recovery, stale/corrupt receipts and rollback compatibility. No production checks were run.

Final transitive review classified predecessor/scheduler proof as remote-check so app commit and push preflights cannot treat its SSH command as local evidence. Regression verifies exclusion from both local selection and encoded local payload.

Final developer validation: full npm test 424 passed, 0 failed, 0 skipped (346.17 seconds). Intent review PASS against bound final source; see docs/evidence/codegraph-remaining-two-20261025/FINAL_INTENT_ACCEPTANCE.md. Production and scheduling checks NOT EXECUTED.
