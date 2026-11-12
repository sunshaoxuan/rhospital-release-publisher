# Skin admin current-change check ownership

Main task: C:/workspace/hospital-backend/docs/tasks/skin-admin-database-controls-20261113.md.
Scope: register a bounded JVM and PostgreSQL18.6 leaf for database-owned skin administration. Existing native hooks reject unmapped Java changes; do not bypass them. No production scheduling or credential changes.
Select explicit skin-task triggers. Compilation dependencies do not select unrelated features. Require complete named Surefire PASS and disposable SQL helper protocol, binding JVM/Python/Docker identity. Native hooks own policy tests after syntax preflight. Production backend, migration and runtime gates remain enabled.
Acceptance: correct positive and negative selection; missing/duplicate/skipped/error protocols reject; command failures propagate; source dependency closure and scope independently reviewed. No npm full suite or app rebuild for this helper-only change.

Frozen paths: src/changeValidationPolicy.js, src/changeValidationGit.js, src/changeValidationRunner.js, src/skinAdminCheck.js, src/skinAdminCheckInputs.json, test/skinAdminCheck.test.js, this record and CHANGELOG.md. Native staged gate owns applicable policy/runner/leaf tests; expected under five minutes. No parallel task files staged. Input closure contains compilation dependencies, not unrelated feature triggers. Source reviewer verified no recursive preflight, feature-chain calls, receipt fabrication or production actions in this leaf. SQL helper is command-scoped and always removes its exact container.

Native gate: documents, skin, preflight and policy PASS; runner6/7PASS, one failure because its synthetic policy repository omitted the two newly required executor/manifest files. Fix only the fixture copy lists. Invalidated input: test/changeValidationRunner.test.js; rerun native runner leaf, reuse other authentic PASS. No application or production behavior changed by this fixture correction.
