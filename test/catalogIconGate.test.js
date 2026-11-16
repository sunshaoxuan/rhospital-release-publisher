const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {planChanges}=require('../src/changeValidationPolicy');
const {identity,assertResult,validateChange}=require('../src/changeValidationRunner');
const good='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
test('catalog icon has one exact leaf, rejects unknown/forum paths and retains independent shared consumers',()=>{
 const c=require('../src/catalogIconCheckInputs.json'),p=planChanges('game',[...c.triggers,...c.triggers]);
 assert.deepEqual(p.checks.map(c=>c.key),['catalog-icon']);
 const check=p.checks[0];assert.equal(check.kind,'catalog-icon');assert.equal(check.timeoutSeconds,300);
 assert.equal(new Set(check.inputs).size,check.inputs.length);assert.deepEqual(check.tests,c.tests);
 assert(check.inputs.includes('pom.xml'));assert(check.inputs.includes('src/main/resources/static/js/utils/GameAssetCatalog.js'));
 assert(!check.tests.some(p=>/skin|gift|bacteria/i.test(p)));assert(!check.inputs.some(p=>p.startsWith('docs/evidence/')));
 for(const f of c.triggers)assert.throws(()=>planChanges('forum',[f]),/Invalid change scope/);
 assert.throws(()=>planChanges('game',['src/main/resources/static/img/game/item/unknown.png']),/UNMAPPED_CHANGE/);
 assert(planChanges('game',['src/main/resources/static/js/utils/GameAssetCatalog.js']).checks.some(c=>c.key!=='catalog-icon'));
});
test('catalog icon strict protocol refuses missing or incomplete test results',()=>{
 const check=planChanges('game',['src/main/resources/static/img/game/item/1025.png']).checks[0];
 assert.doesNotThrow(()=>assertResult(check,{state:'PASS',output:good}));
 for(const result of [{state:'FAIL',output:good},{state:'PASS'},{state:'PASS',output:good.replace('pass 1','pass 0')},
  {state:'PASS',output:good.replace('skipped 0','skipped 1')}])assert.throws(()=>assertResult(check,result));
});
test('catalog source drift invalidates receipt and unavailable unrelated evidence does not; unchanged PASS reuses',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-icon-policy-'));
 const check={key:'catalog-icon-fixture',kind:'catalog-icon',inputs:['src/icon.png'],tests:['test/icon.cjs'],timeoutSeconds:30,images:['postgres:18.6-alpine']};
 const context={jvmIdentity:()=>({java:'fixture'}),dockerIdentity:()=>({image:'immutable-fixture'})};
 try{
  fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/icon.png'),'candidate');const before=identity(root,check,context);
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs/unrelated.json'),'{');assert.deepEqual(identity(root,check,context),before);
  assert.notDeepEqual(identity(root,check,{...context,jvmIdentity:()=>({java:'changed'})}),before);
  assert.notDeepEqual(identity(root,check,{...context,dockerIdentity:()=>({image:'changed'})}),before);
  const plan={scope:'local-change',productionActions:false,checks:[check]};let executions=0;
  const options={...context,cacheDirectory:path.join(root,'cache'),write:()=>{},execute:async()=>{executions++;return {state:'PASS',output:good};}};
  await validateChange(root,plan,options);await validateChange(root,plan,{...options,requireReceipts:true});assert.equal(executions,1);
  fs.appendFileSync(path.join(root,'src/icon.png'),'changed');assert.notDeepEqual(identity(root,check,context),before);
  await assert.rejects(()=>validateChange(root,plan,{...options,requireReceipts:true}),/MISSING_VALIDATION_RECEIPT/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
