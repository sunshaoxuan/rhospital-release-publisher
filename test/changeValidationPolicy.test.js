const test=require('node:test'),assert=require('node:assert/strict');
const {planChanges}=require('../src/changeValidationPolicy');
test('documents select static validation only; duplicate paths select once',()=>{
  const p=planChanges('game',['CHANGELOG.md','docs/release.md','CHANGELOG.md']);
  assert.deepEqual(p.checks.map(c=>c.key),['documents']);assert.equal(p.changedPaths.length,2);
});
test('Resident SQL owns schema and direct entity inputs without editor or Steam',()=>{
  const p=planChanges('game',['scripts/migration/20261108_add_resident_reward_ledger.sql','scripts/validation/resident-reward/schema-readonly.sql']);
  assert.deepEqual(p.checks.map(c=>c.key),['resident-schema']);assert.equal(p.productionActions,false);
  assert(p.checks[0].inputs.some(f=>f.endsWith('ResidentRewardReceipt.java')));
});
test('unknown runtime, entity behavioral edits and unsafe paths fail closed without full fallback',()=>{
  for(const f of ['src/main/java/New.java','src/main/java/com/zly/hospital/model/resident/ResidentRewardAccount.java','../outside','C:/outside'])assert.throws(()=>planChanges('game',[f]));
  assert.throws(()=>planChanges('other',[]));
});
test('archived validator edits get syntax checks; unrelated historical JSON is static documentation',()=>{
 const plan=planChanges('game',['scripts/bacteria-lab/validate-design-evidence.mjs']);
 assert.deepEqual(plan.checks.map(c=>c.key),['archive-syntax']);
 assert.deepEqual(planChanges('game',['docs/evidence/old/ACCEPTANCE.json']).checks.map(c=>c.key),['documents']);
});
test('attribute validation has no archived receipt or predecessor inputs',()=>{
 const plan=planChanges('game',['.gitattributes']);assert.deepEqual(plan.checks.map(c=>c.key),['evidence-attributes']);
 assert(plan.checks[0].inputs.every(p=>!p.endsWith('.json')));
});
test('current test split selects actual affected behavior without archives or global evidence closure',()=>{
 const plan=planChanges('game',['src/test/js/toiletMarket.test.mjs']);
 assert.deepEqual(plan.checks.map(c=>c.key),['current-toilet-market']);
 assert(plan.checks[0].inputs.every(p=>!p.startsWith('docs/evidence/')));
 assert(plan.checks[0].inputs.length<250);
});
test('optional CI identity configuration uses static checks without product suites',()=>{
 assert.deepEqual(planChanges('game',['.github/workflows/final-release-preflight.yml']).checks.map(c=>c.key),['documents']);
});
test('manual archive metadata is not required by normal publisher code checks',()=>{
 const archived=['src/manualArchiveChecks.json','src/designValidationLeaves.json','src/designEvidenceInputs.json'];
 const checks=planChanges('publisher',['src/releasePublisherCore.js']).checks;
 for(const check of checks)for(const file of archived)assert(!check.inputs.includes(file),file);
 for(const file of archived)assert.deepEqual(planChanges('publisher',[file]).checks.map(c=>c.key),['documents']);
});

test('each changed behavior selects its own consumers without unrelated game features',()=>{
 const one=planChanges('game',['src/test/js/toiletMarket.test.mjs']);assert.equal(one.checks.length,1);assert.deepEqual(one.checks[0].tests,['src/test/js/toiletMarket.test.mjs']);
 const design=planChanges('game',['src/test/resources/design/user-60x60-32color-request.json']);assert(design.checks.length>0);assert(design.checks.every(c=>c.key.startsWith('current-design-')));
});
