const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {createPlan,requiresFeatureRuntimeCheck}=require('../src/releasePublisherCore');
const {catalog,currentLocalCheck,doubleCheckLocalChecks}=require('../src/localCheckPolicy');
const {selectLeaves,runLeaves}=require('../src/localCheckLeaves');
const env={RELEASE_PUBLISHER_TEST_MODE:'true',RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'};
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gate-scope-')),before=process.env.RELEASE_PUBLISHER_CONFIG;try{put(root,'publisher-config.json',JSON.stringify({releaseTargets:{game:{dockerServer:'fixture'},forum:{dockerServer:'fixture'}},dockerServers:{fixture:{host:'92.113.124.185',username:'fixture'}}}));process.env.RELEASE_PUBLISHER_CONFIG=path.join(root,'publisher-config.json');return run(root);}finally{if(before===undefined)delete process.env.RELEASE_PUBLISHER_CONFIG;else process.env.RELEASE_PUBLISHER_CONFIG=before;fs.rmSync(root,{recursive:true,force:true});}}
function put(root,file,value){const full=path.join(root,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,value);}
function project(root){
 put(root,'mvnw.cmd','@echo off\n');put(root,'docker-compose.yml','services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n');
 put(root,'src/main/java/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.java','class CatalogDatabaseUpgradeService { private static final int MARKER_VERSION = 20; }');
}
test('all registered features have bounded current contracts, manual archives stay outside selected leaves',()=>{
 const checks=Object.keys(catalog).map(currentLocalCheck);assert.equal(checks.length,21);doubleCheckLocalChecks(checks);
 const plan=selectLeaves(checks);assert.equal(new Set(plan.leaves.map(l=>l.id)).size,plan.leaves.length);
 for(const leaf of plan.leaves)assert(!/Evidence\.test|validate-.*evidence|docs\/evidence|readiness|npm/.test(leaf.id),leaf.id);
 assert(plan.leaves.length<checks.reduce((n,c)=>n+plan.owners.get(c.key).length,0));
});
test('runtime scope follows affected feature and shared authentication; unknown scope remains conservative',()=>{
 const analysis=paths=>({targets:{game:{changedPaths:paths}}});
 for(const key of ['verify-relations-release','verify-tradepool-release']) {
  assert.equal(requiresFeatureRuntimeCheck(key,analysis(['src/main/resources/static/js/design/Paint.mjs'])),false);
  assert.equal(requiresFeatureRuntimeCheck(key,analysis(['src/main/java/com/zly/hospital/service/TokenService.java'])),true);
  assert.equal(requiresFeatureRuntimeCheck(key,undefined),true);
  assert.equal(requiresFeatureRuntimeCheck(key,analysis([]),{requiredChecks:[{stepKey:key}]}),true);
 }
 assert(requiresFeatureRuntimeCheck('verify-relations-release',analysis(['src/main/resources/templates/relations.html'])));
 assert(requiresFeatureRuntimeCheck('verify-tradepool-release',analysis(['src/main/java/com/zly/hospital/service/ToiletMarketService.java'])));
});
test('actual game plan keeps production safety and replaces every displayed local command coherently',()=>fixture(root=>{
 project(root);
 const plan=createPlan(root,{appTag:'20261112',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);
 for(const key of ['test-game-backend','build-image','game-database-preflight','backup-game-release','pre-deploy-checklist','deploy-stack','final-runtime-check','verify-game-static-assets-predeploy','verify-game-static-delivery','game-rollback-decision','game-fatal-rollback-decision'])assert(keys.includes(key),key);
 const sso=plan.steps.find(s=>s.key==='validate-game-sso-source');assert(!sso.command.includes('merge-base --is-ancestor'));assert(sso.command.includes('MARKER_VERSION'));
 assert(plan.steps.find(s=>s.key==='final-runtime-check').command);
}));
test('actual forum reuse plan retains database admission backup and runtime safety',()=>fixture(root=>{
 project(root);const plan=createPlan(root,{releaseTarget:'forum',forumImageMode:'reuse',appTag:'20261112',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);for(const key of ['validate-existing-forum-image','forum-preflight','backup-forum-release','deploy-forum-compose','final-runtime-check','forum-rollback-command'])assert(keys.includes(key),key);
 assert(!keys.includes('validate-game-release-preflight'));
}));
test('archive guard rejects actual sync async and subprocess history reads while current fixtures work',()=>fixture(root=>{
 const guard=path.resolve(__dirname,'../src/currentBehaviorGuard.cjs'),script=path.join(root,'probe.cjs');
 put(root,'current.json','{}');put(root,'docs/evidence/old.json','corrupt old bytes');
 const run=code=>{fs.writeFileSync(script,code);return spawnSync(process.execPath,['--require',guard,script],{cwd:root,encoding:'utf8',windowsHide:true});};
 assert.equal(run("require('fs').readFileSync('current.json');").status,0);
 for(const code of ["require('fs').readFileSync('docs/evidence/old.json');","require('fs').promises.readFile('docs/evidence/missing.json');","require('child_process').execFileSync('git',['show','old:secret']);"]) {
  const result=run(code);assert.notEqual(result.status,0);assert.match(result.stderr,/ARCHIVE_DEPENDENCY|GIT_HISTORY/);
 }
}));
test('actual release CLI ignores corrupt unrelated archive, rejects current failure and rejects archive access',()=>fixture(root=>{
 const check=currentLocalCheck('verify-game-steam-auth');
 const args=[path.resolve(__dirname,'../scripts/run-game-release-preflight.mjs'),'--checks-base64',Buffer.from(JSON.stringify({version:1,checks:[check]})).toString('base64')];
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 const run=()=>spawnSync(process.execPath,args,{cwd:root,env:childEnv,encoding:'utf8',timeout:10000,windowsHide:true});
 put(root,'docs/evidence/unrelated.json','invalid history');
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('current',()=>{});");
 let result=run();assert.equal(result.status,0,result.stdout+result.stderr);
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('current',()=>{throw Error('current fault');});");
 result=run();assert.notEqual(result.status,0);assert(!result.stdout.includes('game_release_preflight=PASS'));assert.match(result.stdout+result.stderr,/exit=1/);
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('bad dependency',()=>require('fs').readFileSync('docs/evidence/unrelated.json'));");
 result=run();assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/ARCHIVE_DEPENDENCY/);
}));
test('manual audit is explicit and unavailable in routine selection',()=>{
 assert.throws(()=>currentLocalCheck('manual-archive'));
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/audit-historical-evidence.mjs')],{encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Select an explicit archive check/);
});
