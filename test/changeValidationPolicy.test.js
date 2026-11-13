const test=require('node:test'),assert=require('node:assert/strict');
const {planChanges}=require('../src/changeValidationPolicy');

test('Resident foreground assets select the presentation leaf once, including artwork negatives',()=>{
 const file='src/main/resources/static/img/game/themes/resident-evil/leon-foreground.png';
 const plan=planChanges('game',[file,file]);
 assert.deepEqual(plan.checks.map(c=>c.key),['current-resident-exchange-presentation']);
 assert(plan.checks[0].tests.includes('src/test/js/residentForegroundArt.test.mjs'));
 assert(plan.checks[0].tests.includes('src/test/js/residentNormalIntegration.test.mjs'));
 assert(!plan.checks[0].tests.some(f=>/bacteria|steam/i.test(f)));
 assert.throws(()=>planChanges('game',['src/main/resources/static/img/game/themes/resident-evil/unknown-character.png']));
});

test('freeze dialog inputs select one isolated leaf, duplicates deduplicate, unknown input rejects',()=>{
 const files=['src/main/resources/static/js/design/FreezeEditor.mjs','src/main/resources/static/js/design/QueueMechanicDialogs.css','src/test/js/bacteriaFreezeEditor.test.mjs'];
 const plan=planChanges('game',[...files,...files]);
 assert.deepEqual(plan.checks.map(c=>c.key),['current-bacteria-freeze-editor']);
 const check=plan.checks[0];assert.equal(new Set(check.inputs).size,check.inputs.length);
 assert.deepEqual(check.tests,['src/test/js/bacteriaFreezeEditor.test.mjs','src/test/js/bacteriaQueueMechanisms.test.mjs']);
 assert(!check.inputs.some(f=>/docs\/evidence|resident|steam/i.test(f)));
 assert.deepEqual(planChanges('game',['docs/tasks/freeze-editor.md']).checks.map(c=>c.key),['documents']);
 assert.throws(()=>planChanges('game',['src/main/resources/static/js/design/UnknownFreeze.mjs']));
});

test('Resident presentation changes select one bounded leaf without backend or unrelated suites',()=>{
 const files=['src/main/resources/static/js/scenes/utils/ResidentRewardDialog.mjs','src/main/resources/static/js/scenes/utils/ResidentExchangeMotion.mjs','src/main/resources/static/js/scenes/utils/residentSoftGlow.mjs','src/test/js/residentDrawPresentation.test.mjs'];
 const plan=planChanges('game',[...files,...files]);
 assert.deepEqual(plan.checks.map(c=>c.key),['current-resident-exchange-presentation']);
 const check=plan.checks[0];assert.equal(check.kind,'node-tests');assert(check.tests.includes(files[3]));
 assert.equal(new Set(check.inputs).size,check.inputs.length);assert.equal(new Set(check.tests).size,check.tests.length);
 assert(check.inputs.every(p=>!p.startsWith('docs/evidence/')));assert(!check.tests.some(p=>/bacteria|steam|design/i.test(p)));
 for(const f of files)assert.throws(()=>planChanges('forum',[f]));
 assert.deepEqual(planChanges('game',['docs/tasks/resident-fix.md']).checks.map(c=>c.key),['documents']);
});
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
