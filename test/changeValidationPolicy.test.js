const test=require('node:test'),assert=require('node:assert/strict');
const {planChanges,safePath}=require('../src/changeValidationPolicy');
const keys=paths=>planChanges('publisher',paths).checks.map(c=>c.key);
test('plugin modules select their isolated consumer once without application registries',()=>{
 const paths=['src/releasePlugin.js','src/releasePluginRunner.js','test/releaseWorktree.test.js'];
 const plan=planChanges('publisher',[...paths,...paths]);
 assert.deepEqual(plan.checks.map(c=>c.key),['publisher-plugin','publisher-source']);
 assert.deepEqual(plan.checks[0].tests,['test/releaseWorktree.test.js']);
 for(const file of paths)assert(plan.checks[0].inputs.includes(file));
 for(const repository of ['game','forum'])assert.throws(()=>planChanges(repository,paths),/committed release plugin/);
});
test('publisher controller owns its public contract and production safety consumers',()=>{
 const check=planChanges('publisher',['src/releasePublisherCore.js','server.js','public/app.js']).checks.find(check=>check.key==='publisher-plan');
 assert.equal(check.key,'publisher-plan');
 assert.deepEqual(check.tests,['test/releasePublisherCore.test.js','test/releasePlanSources.test.js','test/applicationReleasePolicy.test.js','test/chromeTargetLifecycle.test.js']);
 for(const file of ['src/releasePluginCandidate.js','src/releasePlugin.js','src/gameProductionDatabase.js','test/helpers/ownedFixtures.js'])assert(check.inputs.includes(file),file);
 assert(!check.inputs.some(file=>/localCheckPolicy|currentBehavior|CheckInputs/.test(file)));
});
test('changed shared gate infrastructure selects only explicit direct consumers',()=>{
 assert.deepEqual(keys(['src/changeValidationGit.js']),['publisher-policy','publisher-runner','publisher-plugin','publisher-source']);
 assert.deepEqual(keys(['src/changeValidationPolicy.js']),['publisher-policy','publisher-runner']);
 assert.deepEqual(keys(['src/changeValidationRunner.js']),['publisher-policy','publisher-runner','publisher-console','publisher-outcome','publisher-recovery','publisher-version','publisher-plugin','publisher-plan','publisher-source']);
 assert.deepEqual(keys(['scripts/game-service-recovery.py']),['publisher-recovery']);
});

test('deployment status owns its Python sampler and dedicated business-free regression',()=>{
 assert.deepEqual(keys(['src/releaseOutcomeStatus.js','public/release-status.js']),['publisher-console','publisher-outcome']);
 assert.deepEqual(keys(['scripts/read-game-runtime-status.py']),['publisher-outcome']);
 const check=planChanges('publisher',['test/releaseOutcomeStatus.test.js']).checks[0];assert.equal(check.key,'publisher-outcome');
 assert(check.inputs.includes('scripts/read-game-runtime-status.py'));assert(!check.inputs.includes('src/releasePublisherCore.js'));
});
test('documents and image evidence remain static while archive metadata is excluded from runtime checks',()=>{
 const files=['CHANGELOG.md','docs/tasks/change.md','docs/evidence/run/scene.jpg','docs/evidence/run/crop.jpeg'];
 const plan=planChanges('publisher',[...files,...files]);
 assert.deepEqual(plan.checks.map(c=>c.key),['documents']);assert.deepEqual(plan.checks[0].inputs,files.sort());
 for(const file of ['src/manualArchiveChecks.json','src/designValidationLeaves.json','src/designEvidenceInputs.json']){
  assert.deepEqual(keys([file]),['documents']);
  assert(!planChanges('publisher',['src/releasePublisherCore.js']).checks.some(c=>c.inputs.includes(file)));
 }
});
test('migration retirement is audit-only and preserves exact publisher consumer checks',()=>{
 const retired=require('../docs/design/release-plugin-publisher-retirement.json');
 const selected=planChanges('publisher',retired.files);
 assert.deepEqual(new Set(selected.checks.map(c=>c.key)),new Set(retired.checks));
 assert(selected.checks.every(check=>check.kind==='node-tests'&&!check.inputs.some(file=>retired.files.includes(file))));
});
test('empty selection is valid, all unknown or unsafe scope fails closed with no full fallback',()=>{
 assert.deepEqual(keys([]),[]);
 for(const file of ['src/unmapped.js','docs/evidence/scene.webp','../outside','C:/outside','src\\other.js'])assert.throws(()=>planChanges('publisher',[file]));
 for(const file of ['','/root','a/../b','a//b'])assert.throws(()=>safePath(file));
 assert.throws(()=>planChanges('other',[]));
});
test('selection unions are deduplicated and every executable test is owned',()=>{
 const plan=planChanges('publisher',['src/changeValidationGit.js','src/changeValidationPolicy.js','src/releasePublisherCore.js','src/releasePlugin.js']);
 assert.equal(new Set(plan.checks.map(c=>c.key)).size,plan.checks.length);
 for(const check of plan.checks){
  assert.equal(new Set(check.inputs).size,check.inputs.length);
  for(const file of check.tests)assert(check.inputs.includes(file),file);
  assert(!check.tests.some(file=>/npm|mvn|gameReleasePreflight/.test(file)));
 }
});

test('public-only changes select console consumers without rerunning backend safety or business suites',()=>{
 for(const file of ['public/app.js','public/index.html','public/styles.css','src/releaseConsoleView.js']){
  const plan=planChanges('publisher',[file,file]);assert.deepEqual(plan.checks.map(check=>check.key),['publisher-console']);
  assert(plan.checks[0].tests.includes('test/releaseConsole.test.js'));
 }
 const backend=planChanges('publisher',['test/releasePublisherCore.test.js']).checks[0];
 assert.equal(backend.key,'publisher-plan');assert(!backend.inputs.includes('public/app.js'));
 assert.deepEqual(keys(['server.js']),['publisher-console','publisher-plan']);
});

test('formal Source integration has its own unchanged consumer scope',()=>{
 assert.deepEqual(keys(['test/fullGateScope.test.js']),['publisher-source']);
 assert.deepEqual(keys(['test/releaseWorktree.test.js']),['publisher-plugin']);
 assert.deepEqual(keys(['test/releasePublisherCore.test.js']),['publisher-plan']);
 assert.deepEqual(keys(['server.js']),['publisher-console','publisher-plan']);
 const checks=planChanges('publisher',['src/releasePublisherCore.js']).checks;
 assert.deepEqual(checks.map(check=>check.key),['publisher-console','publisher-recovery','publisher-plan','publisher-source']);
 assert(checks.find(check=>check.key==='publisher-source').tests.includes('test/fullGateScope.test.js'));
 assert.deepEqual(keys(['src/releasePlanSources.js']),checks.map(check=>check.key));
 assert.deepEqual(keys(['test/releasePlanSources.test.js']),['publisher-plan']);
 for(const check of checks)assert(check.inputs.includes('src/releasePlanSources.js'));
});

test('retirement preserves the game transaction and publisher interruption checks',()=>{
 assert.deepEqual(keys(['test/gameDeploymentTransaction.test.js']),['publisher-recovery']);
 assert.deepEqual(keys(['test/releaseJobStore.test.js']),['publisher-console']);
 assert.deepEqual(keys(['scripts/game-deployment-transaction.py']),['publisher-console','publisher-recovery','publisher-plan','publisher-source']);
});
