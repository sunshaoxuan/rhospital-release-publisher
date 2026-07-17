# RHospital Release Publisher Rules

## Repository Boundary

1. This repository owns the release publisher engine, release-state behavior, CheckList validation, release UI, and publisher tests.
2. Application-specific impact assessments belong in `C:\workspace\hospital-backend\release\release-impact.json`.
3. Production environment facts and runbooks belong in `C:\workspace\rhopital`.

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
