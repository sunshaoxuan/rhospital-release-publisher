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
test('design-tool changes select the actual evidence consumer and preserve unrelated scope isolation',()=>{
  const plan=planChanges('game',['scripts/bacteria-lab/validate-design-evidence.mjs']);
  assert.deepEqual(plan.checks.map(c=>c.key),['game-gate','design-evidence']);
  const evidence=plan.checks.find(c=>c.key==='design-evidence');
  assert(evidence.tests.includes('src/test/js/designEvidenceGate.test.mjs'));
  assert(evidence.inputs.includes('scripts/bacteria-lab/validate-stall-monitor-evidence.mjs'));
  assert(!evidence.tests.some(p=>/steam|resident|toilet/i.test(p)));
  assert.deepEqual(planChanges('game',['docs/tasks/update.md']).checks.map(c=>c.key),['documents']);
  assert.deepEqual(planChanges('game',['docs/evidence/bacteria-question-center-20261020/ACCEPTANCE.json']).checks.map(c=>c.key),['design-evidence']);
});
