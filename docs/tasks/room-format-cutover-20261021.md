# Room Format Cutover

Objective: make the existing room catalog migration use the established stopped-writer, verified-backup and compatible-image boundary. This is a required dependency of the hospital room/database repair, not a production deployment.

Scope: detect the single named room migration, retain the existing paired technology requirement, check room-capable target and rollback images, bind a distinct permanent room format floor, and preserve all existing migration/rollout checks. No new release UI, credentials, production actions or generic infrastructure changes.

Method: extend the existing format guard, exercise successful and rejected generated shell programs, check actual plan ordering, run npm test, review the exact diff, commit and push the existing publisher main branch. The backend remains on master; no branch is created or switched.

Acceptance: room-only and combined migrations require offline cutover; absent capability, live writers, stale receipts and incompatible rollback are refused. Unrelated migrations and legacy technology behavior remain unchanged. Actual production cutover stays separately authorized.

## Final Acceptance

Candidate scope: src/gameTechnologyFormatCutover.js and its two directly affected test files. Existing registered step technology-offline-cutover is reused; no check entrypoint or UI changed.

| Intent | Evidence | Result |
| --- | --- | --- |
| Named room-only migration stops writers before migration and rollout | Generated plan test, offline shell test and receipt replay | PASS |
| Distinct floor permits the completed prior technology cutover and rejects stale/repeated room intent | Executed generated shell programs | PASS |
| Missing room capability, unknown room DB floor and old rollback image are refused | Positive and negative executed rollback/capability tests | PASS |
| Paired technology requirement, writer checks and unrelated game/forum behavior retained | npm test:400 tests,400 passed,0 failed/skipped | PASS |
| Scope and transitive independence | Exact diff reviewed: only named-format activation, capability/floor/receipt/rollback guard; no feature-validator calls or inherited historical UI PASS | PASS |
| Production boundary | No production command, migration, restart or deployment executed | PASS |

Full test command: npm test, completed2026-10-21; duration281545.9702ms. Source and generated programs were inspected after execution. Status: software acceptance PASS; commit/push verification is recorded after Git executes.
