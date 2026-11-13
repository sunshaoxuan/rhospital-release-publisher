const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {planChanges}=require('../src/changeValidationPolicy');
const {runBacteria,assertProtocol}=require('../src/bacteriaOperatorCheck');
const {validateChange}=require('../src/changeValidationRunner');
const manifest=require('../src/bacteriaOperatorCheckInputs.json');
const good={state:'PASS',protocol:'bacteria-operator/v1',testClasses:['BacteriaLabServiceTest'],tests:1};
test('operator triggers select one owned JVM leaf and isolate unrelated features',()=>{
 for(const file of manifest.triggers){const p=planChanges('game',[file,file]);assert.deepEqual(p.checks.map(c=>c.key),['bacteria-operator']);assert.deepEqual(p.checks[0].testClasses,manifest.testClasses);}
 assert.equal(new Set(manifest.inputs).size,manifest.inputs.length);
 assert.equal(planChanges('game',['README.md']).checks.some(c=>c.key==='bacteria-operator'),false);
 assert.equal(planChanges('game',['src/main/java/com/zly/hospital/service/SkinPolicyService.java']).checks.some(c=>c.key==='bacteria-operator'),false);
 assert.throws(()=>planChanges('game',['src/main/java/Unknown.java']),/UNMAPPED/);
 assert(manifest.triggers.every(file=>manifest.inputs.includes(file)));
});
test('JVM protocol rejects changed selection, empty totals and aggregate PASS',()=>{
 assertProtocol(good,good.testClasses);
 for(const bad of [{state:'PASS'},{...good,testClasses:[]},{...good,tests:0},{...good,tests:NaN},{...good,protocol:'skin-admin/v1'}])assert.throws(()=>assertProtocol(bad,good.testClasses),/Incomplete/);
});
test('JVM runner enforces process success and complete fresh Surefire without another feature',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bacteria-gate-')),folder=path.join(root,'target/surefire-reports');fs.mkdirSync(folder,{recursive:true});
 const report=path.join(folder,'TEST-fixture.BacteriaLabServiceTest.xml');
 try{
  const launch=(command,args,options)=>{assert(args.includes('-Dtest=BacteriaLabServiceTest'));assert.equal(options.cwd,root);assert(!('GIT_INDEX_FILE' in options.env));fs.writeFileSync(report,'<testsuite tests="1" failures="0" errors="0" skipped="0">');return {status:0};};
  assert.equal(runBacteria(root,good.testClasses,30,launch).tests,1);
  assert.throws(()=>runBacteria(root,good.testClasses,30,()=>({status:1})),/JVM failed/);
  assert.throws(()=>runBacteria(root,good.testClasses,30,()=>{fs.writeFileSync(report,'<testsuite tests="1" failures="0" errors="0" skipped="1">');return {status:0};}),/Incomplete/);
  assert.throws(()=>runBacteria(root,good.testClasses,30,()=>{fs.unlinkSync(report);return {status:0};}),/Missing/);
  assert.throws(()=>runBacteria(root,['BacteriaLabServiceTest','BacteriaLabServiceTest'],30,launch),/Invalid/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('operator receipts reject owned drift while unrelated missing evidence remains independent',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bacteria-receipt-'));
 try{
  fs.writeFileSync(path.join(root,'owned.java'),'original');
  const plan={scope:'local-change',productionActions:false,checks:[{key:'bacteria-operator',kind:'bacteria-operator',testClasses:good.testClasses,inputs:['owned.java'],timeoutSeconds:30}]};
  const options={cacheDirectory:path.join(root,'cache'),write:()=>{},execute:()=>good};
  assert.equal((await validateChange(root,plan,options)).checks[0].reused,false);
  fs.writeFileSync(path.join(root,'unrelated-evidence.json'),'invalid');
  assert.equal((await validateChange(root,plan,{...options,requireReceipts:true})).checks[0].reused,true);
  fs.writeFileSync(path.join(root,'owned.java'),'changed');
  await assert.rejects(validateChange(root,plan,{...options,requireReceipts:true}),/MISSING_VALIDATION/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
