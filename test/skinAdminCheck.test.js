const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {planChanges}=require('../src/changeValidationPolicy');
const {reports,assertProtocol}=require('../src/skinAdminCheck');
const manifest=require('../src/skinAdminCheckInputs.json');
test('skin triggers are bounded and duplicate changes select one complete leaf',()=>{
 const trigger='src/main/java/com/zly/hospital/service/SkinPolicyService.java';
 const plan=planChanges('game',[trigger,trigger,'docs/tasks/skin-admin-database-controls-20261113.md']);
 assert.deepEqual(plan.checks.map(c=>c.key),['documents','skin-admin']);assert.deepEqual(plan.checks[1].testClasses,manifest.testClasses);
 assert(!manifest.triggers.includes('src/main/java/com/zly/hospital/service/BacteriaLabService.java'));
 assert.throws(()=>planChanges('game',['src/main/java/com/zly/hospital/service/UnmappedFeature.java']),/UNMAPPED/);
 assert.equal(planChanges('game',['README.md']).checks.some(c=>c.key==='skin-admin'),false);
 assert.equal(new Set(manifest.inputs).size,manifest.inputs.length);assert.equal(new Set(manifest.testClasses).size,manifest.testClasses.length);
});
test('skin snapshot retains current configuration tests and complete gift compile dependencies',()=>{
 const retired='src/main/java/com/zly/hospital/service/resident/ResidentRewardPolicyConfiguration.java';
 assert(!manifest.triggers.includes(retired));assert(!manifest.inputs.includes(retired));
 assert.throws(()=>planChanges('game',[retired]),/UNMAPPED/);
 for(const file of ['src/main/java/com/zly/hospital/service/ConfigurableGiftPackService.java',
  'src/main/java/com/zly/hospital/service/item/ConfigurableGiftPackUser.java',
  'src/test/java/com/zly/hospital/service/ConfigurableGiftPackTest.java',
  'src/main/java/com/zly/hospital/service/SkinPolicyService.java',
  'src/test/java/com/zly/hospital/service/resident/ResidentRewardPolicyConfigurationTest.java'])assert(manifest.inputs.includes(file),file);
 assert(manifest.testClasses.includes('ResidentRewardPolicyConfigurationTest'));
 assert(!manifest.testClasses.includes('ConfigurableGiftPackTest'),'compile input must not expand runtime test selection');
});
test('Surefire requires actual named complete results; skip/error/missing/duplicates reject',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skin-check-')),folder=path.join(root,'target/surefire-reports');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'TEST-fixture.SampleTest.xml');
 try{fs.writeFileSync(file,'<testsuite tests="2" failures="0" errors="0" skipped="0">');assert.equal(reports(root,['SampleTest']),2);
  for(const mutation of ['tests="0" failures="0" errors="0" skipped="0"','tests="2" failures="1" errors="0" skipped="0"','tests="2" failures="0" errors="0" skipped="1"','tests="2" failures="0" errors="1" skipped="0"']){fs.writeFileSync(file,'<testsuite '+mutation+'>');assert.throws(()=>reports(root,['SampleTest']),/Incomplete/);}
  fs.writeFileSync(path.join(folder,'TEST-other.SampleTest.xml'),'<testsuite/>');assert.throws(()=>reports(root,['SampleTest']),/ambiguous/);
  assert.throws(()=>reports(root,['MissingTest']),/Missing/);
  fs.rmSync(path.join(folder,'TEST-other.SampleTest.xml'));fs.writeFileSync(file,'<testsuite tests="2" failures="0" errors="0" skipped="0">');fs.utimesSync(file,1,1);assert.throws(()=>reports(root,['SampleTest'],Date.now()),/Stale/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('SQL and JVM completion protocols cannot be replaced by aggregate PASS',()=>{
 const good={state:'PASS',protocol:'skin-admin/v1',classes:1,tests:4,migration:{state:'PASS',protocol:'skin-migration/v1',version:'18.6',checks:Array(8).fill('case')}};
 assertProtocol(good,['SampleTest']);for(const bad of [{state:'PASS'},{...good,tests:0},{...good,classes:2},{...good,migration:{...good.migration,version:'16'}},{...good,migration:{...good.migration,state:'FAIL'}}])assert.throws(()=>assertProtocol(bad,['SampleTest']),/Incomplete/);
});
test('runtime screenshot documentation receives binary format validation without JVM selection',()=>{
 const plan=planChanges('game',['docs/evidence/skin-admin-20261113/desktop.png']);assert.deepEqual(plan.checks.map(c=>c.key),['documents']);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skin-image-'));const file='docs/evidence/screen.png';fs.mkdirSync(path.join(root,'docs/evidence'),{recursive:true});
 try{fs.writeFileSync(path.join(root,file),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AgAAAABJRU5ErkJggg==','base64'));assert.equal(require('../src/changeValidationRunner').validateDocuments(root,[file]).state,'PASS');fs.writeFileSync(path.join(root,file),'broken');assert.throws(()=>require('../src/changeValidationRunner').validateDocuments(root,[file]),/Invalid evidence PNG/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
