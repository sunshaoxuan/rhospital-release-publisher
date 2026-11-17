# Release Plugin Producer Contract

Batch A contract, 2026-11-17. The existing server is not switched by this document. Producer B belongs to the application chat; consumer C must connect the real formal entry before whole-chain acceptance. No application or production mutation from the publisher task.

## Manifest Location And Data

Use `release/publisher/game.json` and `release/publisher/forum.json`, addressed explicitly by trusted target configuration. The loader reads these files from the exact 40-character committed candidate, never working bytes or a discovered parent directory.

Required root fields: `apiVersion: release-plugin/v1`, `pluginId` (stable namespace), `target` (`game` or `forum`), `coverage`, `units`, `migrations`. The schema and example are linked from [v1 design](release-plugin-v1.md). No extra fields, inline commands, credentials, safety-step overrides or remote targets.

Coverage entries have `paths` (exact Git paths), `prefixes` (Git directory prefixes ending `/`), and `units` (defined leaf IDs). Changed scope must be explicit and entirely mapped. Unknown scope fails before checks; overlapping rules select the union once. Duplicate declarations/IDs are rejected. If changedPaths contains the manifest itself, pass explicit ancestor baselineCommit: changed unit definitions and changed coverage rules select only their affected units. Namespace/target changes select all; first committed manifest selects all from proved baseline absence; removing a unit requires the atomic migration instead of silently accepting lost coverage. Do not add a blanket manifest-path rule selecting every business unit. Application-owned documentation can map to an application static leaf; no publisher business registration is required.

Each unit has `id`, `phase` (`source`, `artifact`, `pre-deploy`, `post-deploy`), `requires`, `inputs`, `run`. Every invoked entrypoint must be in `inputs`; list the complete executable/import/test/dependency closure, including lock/config files actually consumed. Inputs are regular committed files, not globs, absolute paths, directories, symlinks, parent paths or unrelated historical evidence. Independent leaves must not invoke other acceptance suites.

Bounded resource admission: at most 4,096 inputs per unit, 16,384 distinct exported inputs, 1 MiB manifest JSON, 8 MiB per owned file and 128 MiB total exported content. The real 2,086-file compile closure fits the per-unit budget. Git object sizes and contents are read in batches. Exceeding a limit is a precise admission error, never an implicit full suite or silently truncated closure.

Node-test run: `kind: node-test`, exact `entrypoints`, `timeoutSeconds` 1..3600, `protocol: tap-v1`; requires `engine-context@1` and `node-test@1`. The core explicitly supplies --experimental-vm-modules, TAP reporter and serial file execution. All TAP completion counters must be complete with tests=pass>0 and fail/skipped/cancelled/todo=0.

Node-module run: `kind: node-module`, `entrypoint`, `args` (literal argv), `timeoutSeconds`, `protocol: check-result-v1`; requires `engine-context@1` and `node-module@1`. Stdout is one JSON object: `protocol`, `unitId`, `state: PASS`, `inputDigest`, `checks`, `passed`, `failed`, `skipped`, `cancelled`, `todo`. Require checks=passed>0 and every remaining counter zero. Nonzero exit, signal, timeout, extra/missing result fields or input mismatch fail. Diagnostic text may use stderr. No shell is used.

Maven declarations use the design's `maven-test`/`junit-xml-v1` and `maven-test@1`. Batch A must reject an unprovided capability before cache or execution. Real Maven support is required in C if B selects it; this document does not claim it callable yet. Producer must identify exact classes, owned source/resources/build inputs and actual compilation/dependency/toolchain needs; no implicit full suite.

`migrations` lists regular committed `.sql` files. It never authorizes execution or replaces backup, SQL safety, identity, pre-deploy, runtime or rollback checks. B must provide cumulative production-diff migration declarations and the existing required safety assessment, in its own project.

## Explicit Context And Minimal Call

Publisher API is `loadReleasePlugin(options)`, `createReleaseContext(options)`, `executeReleasePlugin(plan, context, options)`. Core caller supplies repositoryRoot, candidateCommit, manifestPath, target, changedPaths and an existing task-owned workspaceRoot. Plan owns a committed export and close() cleanup.

```javascript
const {loadReleasePlugin, createReleaseContext} = require('./src/releasePlugin');
const {executeReleasePlugin} = require('./src/releasePluginRunner');
const plan = loadReleasePlugin({repositoryRoot, candidateCommit,
  manifestPath:'release/publisher/game.json', target:'game', changedPaths, workspaceRoot});
try {
  const context = createReleaseContext({candidateRoot:plan.sourceRoot,
    checkRoot:plan.sourceRoot, artifactRoot, target:'game',
    capabilities:['engine-context@1', 'node-test@1', 'node-module@1'],
    nodeExecutable:process.execPath, environment:{}});
  const result = await executeReleasePlugin(plan, context, {
    boundary:'before-production', stage:'precheck', receiptsDirectory});
} finally { plan.close(); }
```

The formal caller uses the same function, options boundary and context builder, with stage `formal`. Stage is diagnostic only, not a cache invalidator. A successful prefix is `PREFIX_PASS`, not a production release PASS. Source/artifact leaves execute before the production barrier; pre-deploy/post-deploy declarations remain pending until C supplies the appropriate controlled phase. Dry preview issues no execution receipt.

Leaf scripts read `RELEASE_CONTEXT_FILE`, a core-created JSON file. They receive explicit version, roots, target, unit ID and input digest. No installed publisher repository, `findPublisherRoot`, upward search or `RHOSPITAL_RELEASE_PUBLISHER_ROOT` is required. Use contract fixtures in application tests. Environment is explicit and limited to SystemRoot/TEMP/TMP/TZ/LANG/NODE_ENV; Node is invoked by resolved absolute path. No inherited PATH/NODE_OPTIONS/NODE_PATH or production credentials. Declaring capabilities does not grant them; the core controls grants before receipt lookup.

The JSON also holds the admitted `environment` object. A core preload strips Windows-added defaults before loading each leaf/test worker, then supplies only this admitted environment and RELEASE_CONTEXT_FILE. TEMP/TMP and export locations are scratch paths, not business semantics; other admitted environment values, tool bytes and capability versions are bound to receipts. This is explicit execution context, not OS-level code isolation.

Receipts bind the unit definition, owned bytes, executor, tool and semantic context/environment. Whole-manifest digest/candidate/stage are audit provenance; unrelated unit metadata must not alone invalidate other owned evidence. Leaf code must not derive business assertions from export-directory names or access undeclared inputs. JSON and argv validation are not a malicious-code sandbox. Local HMAC receipts require trusted local storage, not cross-machine portability.

### C Integration Requirements Raised By Producer

Frozen C producer extension: `requires` may include `local-tools@1` and `node-dependencies@1`. The former requests a core-created local validation tool bundle (Java, Python, local Docker, Git, cmd, Maven wrapper support); only requesting units consume that bundle identity. It grants no production credentials or remote target. The latter requires optional unit field `dependencies: ["pngjs"]` (generic package names, not a core business registry), plus owned package.json/package-lock.json. Core copies the selected locked dependency closure from the explicit dependencyRoot, rejects links/version mismatch, and binds every copied byte. No application-side PATH/environment repair. Existing vm-modules Node support remains explicit.

Every local-tools unit declares `images` (array, possibly empty): exact local test image references. Core binds the local daemon identity and those resolved image IDs before cache. No arbitrary Docker remote endpoint or credential config is accepted. The trusted context file may provide `tools` (java/python/docker/git/cmd absolute executable paths), `dockerHost` (explicit local named-pipe or Unix socket), `dependencyRoot` (installed node_modules), and `environment` (only admitted semantic settings). The same file is supplied by --context-file or explicit RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE in the formal/CLI environment. Core creates its own credential-free Docker config. The bootstrap's core-owned NODE_OPTIONS preload propagates into nested Node children; ambient NODE_OPTIONS remains forbidden.

C2 producer refinement: every local-tools unit also declares `tools`, a nonempty unique subset of node/git/powershell/java/python/docker/cmd. game-gate declares [node,git,powershell] with images=[]; JVM-wrapper leaves declare their actual java/cmd/powershell needs; include docker/python only when consumed. Node is already a common runner tool. Core constructs PATH from those selected absolute tools and OS command directories, hashes only the requested tool subset, and probes Docker/images only for units requesting docker. No raw PATH is accepted from a plugin or used as a global cache invalidator. Extra configured but unrequested tools do not invalidate another unit's PASS. C2 removes the C1 coarse bundle requirement before real application validation.

CLI: node /absolute/publisher/scripts/validate-plugin-candidate.mjs --repository-root /absolute/application --phase source --baseline <40-char-ancestor> --target game --manifest release/publisher/game.json --context-file /absolute/trusted-context.json. Optional flags: --commit, --remote, --workspace, --receipts, --dependencies-root, --artifact-root. Commit phase defaults its baseline to actual HEAD; source/release-source require explicit baseline; push/remote require genuine receipts. Context configuration and executable discovery happen in the core, never by business leaf fallback. Final stdout is one JSON prefix result; diagnostic identity components go to stderr.

The CLI/native adapter result has `protocol: release-candidate-validation/v1`, `state: PASS`, `scope: before-production`, `prefixState: PREFIX_PASS`, candidateTree, baseline, changedPaths, selectedKeys, counts, documents and productionActions=0. This PASS belongs to bounded candidate validation, not deployment. The lower shared executor retains PREFIX_PASS. selectedKeys uses opaque plugin unit IDs plus core.documents only when real dynamic document validation applies. Producer snapshots must include the committed CLI and its transitive generic core files; no mutable working code or business registry is required after C.

Generic snapshot closure for this entry: scripts/validate-plugin-candidate.mjs; src/releasePlugin.js, releasePluginRunner.js, releasePluginContext.js, releasePluginCandidate.js, releasePluginDocuments.js, changeValidationGit.js, changeValidationReceipts.js. Candidate/loader admission always runs fresh. Individual worker receipts bind the execution kernel (runner/context/receipt code), actual unit definition/inputs/tools/dependencies/context, not unrelated legacy Git-policy export lists or an entire publisher commit. New grants/result protocol changes are still admitted and old result completeness revalidated before reuse. Each worker receives only its own declared source/dependency export; this prevents incidental cross-leaf file availability, with host OS permissions unchanged.

C supplies `validatePluginCandidate(repositoryRoot, options)` from src/releasePluginCandidate.js and scripts/validate-plugin-candidate.mjs. Options name phase (commit/source/push/remote/release-source), explicit baseline for source/release-source, target, manifestPath and actual commit/remote identity where relevant. Commit/source use the actual index tree represented as a detached Git candidate object; after validation the real index/tree identity is checked again. Push/remote require complete owned receipts and do not run missing business checks. Dynamic documentation is a genuine core static check with relevant base-document identity, not an empty business leaf. Manifest changes use the unit/coverage delta described above.

The native thin client invokes the publisher CLI by an explicitly configured executable/script path (for example a repository-local Git config value release.publisherExecutable or an explicit argv path). No upward root lookup or old RHOSPITAL_RELEASE_PUBLISHER_ROOT fallback. The application owns that thin client and its contract fixtures; business leaf workers never import a locally installed publisher. Actual server execution calls the same candidate/context/execute API directly. The exact CLI argv is frozen with its implementation before C verification.

The existing application requires Java/Maven-wrapper/Python/Docker and pngjs. A's node-only context does not execute those real leaves. C must add controlled, explicitly granted tool descriptors (absolute executable plus argv/version/digest and minimal environment), dependency closure and lock validation, and selected-unit capability identity before cache. No application script may patch process.env to simulate these missing grants. The exact tool/dependency extension will be frozen with B's actual selected contracts before C verification; current v1 fixtures do not claim these capabilities callable.

Application native commit/source integration must provide the exact staged tree and explicit task baseline. A only accepts actual Git commit objects. C must supply a staged-candidate adapter that creates a detached candidate object from the real index, checks owned tree identity, and runs the same plugin loader/executor; commit/push identity checks remain separate and must not rerun valid owned checks. A committed-only helper is insufficient for the real native hook.

Publisher-owned business files to transfer in B before C removes their consumers: currentBehaviorInputs.json/currentBehaviorChecks.json, catalogIconCheckInputs.json, skinAdminCheck.js and its inputs, giftPackCheck.js and its inputs, bacteriaOperatorCheck.js and its inputs, residentMigrationCheck.js and their business fixture/helper dependencies. C must trace remaining consumers in changeValidationPolicy.js, changeValidationGit.js, changeValidationRunner.js, localCheckPolicy.js, localCheckLeaves.js and releasePublisherCore.js before deleting registrations. No blind deletion or long-term dual registration; fixed production safety is retained. This is a migration inventory, not permission for this chat to edit application files.

## Producer Handoff Checklist

1. Provide game/forum candidate manifests and exact changed-path sets per task/release baseline.
2. Identify every selected leaf, source/import/test/resource/lock/config closure, result protocol and capability; remove hidden publisher lookup from application tests.
3. Identify Maven classes/build needs, artifact inputs and any pre/post-deploy leaves requiring C adapter integration. Report exact expected selected sets for equivalence review.
4. Keep application business logic/migrations/assessments in the application repository. Preserve valid scoped evidence and give genuine receipt provenance; never rewrite historical PASS.
5. Notify consumer of the exact committed producer candidate. C must prove the real formal entry stops before every production action, with selected/executed/reused counts, then remove replaced legacy paths atomically. Production and service activation remain separately controlled.
