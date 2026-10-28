# Owned test fixture cleanup

## Scope and cause

Base candidate: `21f0999c7b901a0774f781386421fbb79c04f5ad`.
The Desktop audit found 23,557 historical publisher temporary directories.
`tempProject`, `tempGitProject`, and configuration helpers allocated roots without
registering teardown. Git/setup failures could also leave partially populated roots.
This change does not remove any historical directories and changes no runtime module,
UI, release gate, production configuration, or application repository.

## Ownership and independent review

`test/helpers/ownedFixtures.js` registers teardown immediately after allocation,
before fixture population. AsyncLocalStorage isolates concurrent test owners.
Awaited nested tests retain their fixtures until their owning parent completes.
Cleanup accepts only roots allocated by this helper instance, directly under the
canonical temporary directory, with the original device/inode/birth-time identity.
Root links/replacements are rejected; nested directory links are not followed.
The helper never enumerates Temp, imports old paths, or traverses other Git trees.
The two redundant unguarded teardown hooks were removed so they cannot bypass an
identity refusal. The separate zero-replica fixture retains its existing lifecycle.

Synchronous and asynchronous completion/failure trigger teardown. An unfinished
callback, explicit outstanding lease, changed identity, or deletion failure retains
the fixture and reports failure. Existing test subprocesses are awaited/synchronous;
new asynchronous consumers must await termination or hold a lease. Abrupt process
termination/power loss cannot execute test hooks; this deliberately adds no global
exit cleanup, historical directory scavenging, or process-killing behavior.

## Verification

- Lifecycle tests: six real tests, including real isolated Node test workers with
  successful and intentionally failed Git fixtures, initialization failure, concurrent
  owners, active leases, identity substitution, deletion errors, already removed
  roots, unrelated path refusal, and nested junction target preservation.
- `npm test`, scoped to lifecycle plus representative existing project/Git/config/
  failure-path tests: 13 real checks passed, 41 filtered-file wrappers; 21.261 seconds.
- After removing redundant hooks, `npm test` scoped to the two affected existing
  tests: four real checks passed (including two nested checks), 42 filtered-file
  wrappers; 18.599 seconds.
- `git diff --check` passed. This is combined scoped evidence, not a claim that a
  complete unfiltered suite was rerun. Unchanged 21f0999 hardening evidence is retained.
- Independent transitive review: helper calls only local filesystem APIs and test
  hooks. The intentional failure worker clears inherited NODE_TEST_CONTEXT, checks
  exit status and failure text, then verifies both owned roots vanished and unrelated
  content survived. No application publication entrypoint is invoked.

No runtime update or administrator action was performed. The current running
publisher remains e280334; the pending 21f0999 activation approval is not reused or
expanded. This test-only fix needs no service restart. If a later update chooses the
latest repository candidate, its exact new commit must replace the old target.
