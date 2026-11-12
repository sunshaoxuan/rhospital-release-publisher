const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {capturePublisherRuntimeVersion,getPublisherVersionStatus,assertPublisherActionVersion,shouldAutoRestartPublisher,comparePublisherVersions,readPublisherRepositoryVersion}=require('../src/publisherVersion');
const {createLegacyBarrier,removeLegacyBarrier}=require('../src/publisherLegacyBarrier');
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-version-scope-'));try{
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 put('package.json','{"version":"0.2.0"}');put('server.js','// current');put('src/currentBehaviorChecks.json','{}');
 put('scripts/run-game-release-preflight.mjs','// current executable');put('service/runner.ps1','# current host');
 put('src/manualArchiveChecks.json','{}');put('README.md','initial docs');
 git('init','-b','master');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','current source');
 return run({root,git,put,runtime:capturePublisherRuntimeVersion(root)});
}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('unrelated documents task files and manual archives do not block publisher actions',()=>fixture(({root,put,runtime})=>{
 put('README.md','edited docs');put('.task-tmp/unrelated.txt','task draft');put('docs/evidence/old.json','corrupt archive');put('src/manualArchiveChecks.json','corrupt manual audit input');
 const status=getPublisherVersionStatus(root,runtime);assert.equal(status.status,'UP_TO_DATE');assertPublisherActionVersion(status);assert.equal(shouldAutoRestartPublisher(status,false),false);
}));
test('documentation-only commits retain executable identity without forcing restart',()=>fixture(({root,git,put,runtime})=>{
 put('README.md','new docs');git('add','README.md');git('commit','-m','docs only');const status=getPublisherVersionStatus(root,runtime);
 assert.notEqual(status.runtime.commit,status.repository.commit);assert.equal(status.runtime.contentHash,status.repository.contentHash);assert.equal(status.status,'UP_TO_DATE');
}));
test('actual preflight scripts host runner and current contracts still invalidate runtime',()=>{
 for(const file of ['scripts/run-game-release-preflight.mjs','service/runner.ps1','src/currentBehaviorChecks.json'])fixture(({root,put,runtime})=>{
  put(file,'modified executable');const status=getPublisherVersionStatus(root,runtime);assert.equal(status.status,'UNCOMMITTED_CHANGES');assert.throws(()=>assertPublisherActionVersion(status));
 });
});
test('new executable commit requires restart and active jobs remain protected',()=>fixture(({root,git,put,runtime})=>{
 put('scripts/run-game-release-preflight.mjs','new executable');git('add','.');git('commit','-m','new runtime');
 const status=getPublisherVersionStatus(root,runtime);assert.equal(status.status,'RESTART_REQUIRED');assert(shouldAutoRestartPublisher(status,false));assert(!shouldAutoRestartPublisher(status,true));
}));
test('owned update barrier remains a fail-closed action blocker without altering content identity',()=>fixture(({root,put,runtime})=>{
 put('publisher-update-00000000-0000-0000-0000-000000000001.guard','owned update');
 const status=getPublisherVersionStatus(root,runtime);assert.equal(status.status,'UNCOMMITTED_CHANGES');assert.equal(status.runtime.contentHash,status.repository.contentHash);assert.throws(()=>assertPublisherActionVersion(status));assert(!shouldAutoRestartPublisher(status,false));
}));
test('missing or corrupt executable identities stay unknown and cannot authorize actions',()=>{
 for(const contentHash of [undefined,'', 'not-a-hash']) {
  const state={commit:'a'.repeat(40),dirty:false,contentHash};
  assert.equal(comparePublisherVersions(state,state),'UNKNOWN');
  assert.throws(()=>assertPublisherActionVersion({status:'UNKNOWN'}));
 }
});
test('protected updater scopes cleanliness while preserving exact barrier ownership',()=>fixture(({root,put,runtime})=>{
 put('docs/task.md','unrelated draft');
 const token='00000000-0000-0000-0000-000000000001';createLegacyBarrier(root,token);
 assert.equal(getPublisherVersionStatus(root,runtime).status,'UNCOMMITTED_CHANGES');
 assert.throws(()=>createLegacyBarrier(root,token),/clean/);
 assert.throws(()=>removeLegacyBarrier(root,'00000000-0000-0000-0000-000000000002'));
 removeLegacyBarrier(root,token);assert.equal(getPublisherVersionStatus(root,runtime).status,'UP_TO_DATE');
 put('scripts/run-game-release-preflight.mjs','unaccepted executable');assert.throws(()=>createLegacyBarrier(root,token),/clean/);
}));
test('Git status failure cannot hide an update barrier or authorize actions',()=>fixture(({root,runtime})=>{
 const repository=readPublisherRepositoryVersion(root,{gitRunner:(_exe,args)=>args[0]==='rev-parse'
   ? {status:0,stdout:runtime.commit} : {status:128,stdout:'',stderr:'controlled status failure'}});
 const status=comparePublisherVersions(runtime,repository);assert.equal(status,'UNKNOWN');assert.throws(()=>assertPublisherActionVersion({status}));
}));
