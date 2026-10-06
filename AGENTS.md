# RHospital Release Publisher Rules

## Repository Boundary

1. This repository owns the release publisher engine, release-state behavior, CheckList validation, release UI, and publisher tests.
2. Application-specific impact assessments belong in `C:\workspace\hospital-backend\release\release-impact.json`.
3. Production environment facts and runbooks belong in `C:\workspace\rhospital`.

## Release Impact CheckList Rule

1. A game or forum runtime change must not enter a formal release plan unless the target commit contains a fresh release impact assessment that exactly covers the production-baseline diff.
2. The publisher must validate the assessment identifier, changed paths, code impact, database impact, risk level, CheckList decision, required checks, and reasons before any build or production action.
3. Core checks remain publisher-owned and mandatory. Business commits cannot remove or replace the game backend test, game pre-deploy CheckList, game final runtime check, forum source validation, forum preflight, or forum final runtime check.
4. Any new or renamed executable validation step that can be referenced by an assessment must be added to the registered check set and covered by tests.
5. Database-related runtime changes must declare database impact. Changed migration scripts must keep the migration safety gate and select `apply-database-migrations`.
6. Release history must retain the assessment identifier, risk, database impact, decision, covered runtime paths, and selected checks for audit.
7. Missing, stale, incomplete, excessive, unknown, or unavailable CheckList declarations must fail closed during plan creation.

## Verification Rule

1. Every publisher code change must pass `npm test` before commit.
2. CheckList-gate changes must include successful and failing tests for game and forum paths where applicable.
3. UI changes require a running release console, browser inspection, console inspection, and screenshot evidence before completion.

## Independent Validation And Double Check (Mandatory)

1. Select feature checks from actual candidate impact. Empty applicable feature selection is valid. Mandatory backend, migration, pre-deploy and final runtime checks retain their existing safety requirements.
2. A feature validator owns its business evidence. It must not invoke another feature's full acceptance, inherit its PASS, require its historical screenshots, or acquire current source hashes by running its validator. Source identity helpers must be pure, path-scoped and read-only.
3. Historical integration commits, local container IDs, captured image IDs, test ports and developer-machine state must never become universal release prerequisites. A runtime check must target the selected candidate in the designated release environment.
4. Register each local check's exact entrypoints and success protocol in src/localCheckPolicy.js. Broad npm aggregates, recursive preflight calls, unknown checks, extra inputs and duplicate inputs must fail closed. Shared-behavior regression tests require a concrete caller/data-flow reason and the smallest sufficient scope.
5. Double Check has two rounds. First compare selected keys, commands, timeouts and registered entrypoints before execution. Then independently review transitive calls and evidence reads, and verify success plus unrelated-feature failure isolation. A second execution of the same broad test chain does not satisfy Double Check.
6. Add positive and negative regression tests for every changed check: exact selection, missing/extra/duplicate selection, success-protocol completeness, relevant-source drift and unrelated-evidence unavailability. Registering an entrypoint alone does not prove transitive independence.
7. Execute the same applicable feature check once per unchanged candidate in a validation phase. New source, policy, runtime or baseline identity invalidates prior results. Commit/push/remote identity checks stay explicit; avoid rerunning a feature chain merely to reread its source hashes.
8. Final review must record candidate and policy identities, affected features, retained safety checks, removed dependencies, actual test results and unresolved risks. Automated green results do not waive the independent scope review.
