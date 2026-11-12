# Bounded validation implementation, 2026-11-12

User authorization: implement actual commit, push and publisher gates, validate the current Resident migration and documentation-only changes, commit/push master. Production publication, publisher-service activation and database-engine upgrades remain excluded. Detailed original scope and corrections: C:/workspace/codex-work/test-impact-audit-20261112/TASK.md and GOAL_AND_SCOPE.md.

## Batch, impact and method

1. Daily policy: explicit path-to-check ownership for documents, the three Resident SQL scripts/oracle, application gate code and publisher gate code. Unknown paths fail with UNMAPPED_CHANGE. Java entity behavioral changes require their own JVM coverage; entities are read-only inputs to the SQL contract.
2. Commit: compare HEAD with the exact staged tree, export selected Git blobs into a temporary sparse snapshot, validate all owned inputs before running checks, then record authentic PASS with an HMAC. Preserve dirty working files and other tasks.
3. Push: select the actual remote-to-target range, require ancestor and current remote identity, recompute owned-input evidence identity, require existing PASS. Missing/stale evidence stops the push with an actionable validation request. Staged and committed Git metadata do not invalidate identical check inputs. Post-push verification checks the actual remote SHA.
4. Publisher preflight: retain registered commands and success protocols; normalize the reviewed five current R34 checks into finite Node argv leaves. Shared test leaves run once and their actual output is assigned to each owning check. Parent time budgets remain bounded across their leaves. The former design aggregate owns 78 behavior files and six fixture files explicitly; its evidence script does not start tests. Other formal features require a reviewed finite-leaf registration before execution.
5. Receipt identity includes owned source/test/dependency bytes, check specification, executor and relevant tool/environment identity. Migration identity additionally includes the local Docker context and immutable image IDs. Failed, truncated, skipped, tampered or stale results never qualify. Local receipts prove local checks, with no production or deployment authority.

Dependencies: publisher implementation is committed first; application hooks load its committed policy closure. Existing formal release policy and full backend, pre-deploy, migration, backup and final runtime steps remain in place. The running publisher service is not updated by Git push.

## Necessary checks and stop boundary

Publisher policy/receipt/Git/leaf tests, application routing/manifest checks, and the existing preflight/budget consumer tests cover this change. No Maven full suite, Docker application build, UI acceptance or full npm suite is selected. The Resident leaf uses isolated --rm/network-none/tmpfs PostgreSQL18.6 and16 containers, synthetic schema only, and checks first/repeat execution, malformed schema rejection, readonly audits and transactional rollback. It removes only its exact helper containers and preserves data volumes. It never changes the engine of an existing environment.

The first migration run took65.543 seconds and its immediate receipt-only rerun reused PASS. No product performance improvement is claimed from this isolated timing. Missing mapping is a stop condition, never a request to test all products. The existing formal-release cache retains its existing offline allowlist; new daily receipts are separate.

## Acceptance and evidence

Read docs/evidence/20261112-bounded-validation/FINAL_INTENT_ACCEPTANCE.md. Exact native-hook and remote delivery outcomes are recorded separately after the stable candidate passes. No source changes or test reruns are required merely to write that delivery record. New requirements after freeze form another batch. Revert only this task's commits to restore its gate behavior; retained historical acceptance and application migration content remain unchanged.
