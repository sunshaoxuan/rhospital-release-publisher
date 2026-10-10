# Bacteria Authoritative Check

Objective: register an independent executable release check for the application
challenge-authority repair. The application owns code, migration and runtime
evidence; this repository owns exact check selection and success protocol.

Scope: register one game check in the existing independent-check mechanism,
with exact JS tests and its own source-bound evidence validator. Preserve full
backend, migration, pre-deploy and final runtime gates. No infrastructure changes,
production job, deployment or unrelated feature validation.

Acceptance: npm test passes, exact check selection succeeds, missing/extra/duplicate
inputs and incomplete output fail closed. Application validator rejects relevant
drift and accepts without unrelated receipts. Primary agent reviews transitive
imports and records actual outcomes before committing only this task's files.

Status: PASS. npm test passed 318/318 with no skipped tests. Exact individual and
combined plan selection passed. Missing/extra/duplicate entrypoints and incomplete
markers were rejected. Transitive review: the owning validator reads only its
explicit application sources and four-view challenge screenshots; sourceHash is
a pure helper. No unrelated acceptance receipt is required. The application's
synthetic validator tests reject source drift, missing behavior, missing/corrupt
screenshots, final intent failure and unbounded admission.

No production job or deployment ran. The existing main branch starts with three
local documentation commits; only this task's six paths enter its new commit.
