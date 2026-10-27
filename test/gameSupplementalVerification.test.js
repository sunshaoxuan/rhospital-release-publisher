const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {supplementalSteps,retainedSupplementalJob}=require('../src/gameSupplementalVerification');
const contract={version:2,checker:'--check-login-signing-key',sourceHash:'a'.repeat(64)};
function fixture(){return {status:'RECOVERY_REQUIRED',historyEntryId:'original-history',completedStepKeys:['final-runtime-check','validate-game-startup-contract'],plan:{releaseTarget:'game',dryRun:false,gitCommit:'b'.repeat(40),appTag:'20261027',imageTag:'hospital-backend:20261027',config:{stackName:'hospital_stack',containerName:'hospital-backend',catalogSchemaVersion:5,remoteComposeDir:'/opt/1panel/docker/compose/hospital-stack',remoteImageTarget:{host:'92.113.124.185',user:'root',port:'22',target:'root@92.113.124.185',keyPath:'fixture-key'}},steps:[{key:'game-prd2-runtime-contract',status:'failed',command:'DO NOT EXECUTE PERSISTED COMMAND'},{key:'validate-game-startup-contract',logs:['game_startup_contract=PASS checker=check-login-signing-key image=sha256:'+'c'.repeat(64)]}]}};}
test('supplemental selection regenerates only safe verification checks and defers container compilation without changing failed history',()=>{
 const j=fixture(),before=JSON.stringify(j),prepared=supplementalSteps(j,contract);
 assert.deepEqual(prepared.steps.map(s=>s.key),['game-prd2-runtime-contract','verify-game-static-delivery','verify-relations-release']);
 assert.deepEqual(prepared.deferredChecks.map(s=>s.key),['verify-tradepool-release']);
 assert.match(prepared.deferredChecks[0].reason,/requires_explicit_scope_confirmation/);
 assert.equal(JSON.stringify(j),before);assert.equal(prepared.imageId,'sha256:'+'c'.repeat(64));
 for(const step of prepared.steps)assert.ok(!step.command.includes('DO NOT EXECUTE PERSISTED COMMAND'));
 const entry=fs.readFileSync(require.resolve('../scripts/verify-game-supplemental.cjs'),'utf8');
 assert.doesNotMatch(entry,/appendReleaseHistory|updateHistoryDiagnostics|executePlan\(|service.+(?:update|create|rm)/);
 assert.match(entry,/Concurrent runtime change/);assert.match(entry,/originalHistoryId/);
});
test('retained evidence reconstructs verification after publisher reload and source-worktree removal',()=>{
 const f=fixture(),runId='123-abc';
 const settings={dockerServers:{GAME_PRD2:{host:'92.113.124.185',username:'root',port:'22',keyPath:'fixture-key'}}};
 const history={id:'history',status:f.status,projectRoot:'C:\\removed\\.release-worktrees\\'+runId,sshTarget:'GAME_PRD2',remoteComposeDir:f.plan.config.remoteComposeDir,
   releaseCommit:f.plan.gitCommit,gitCommit:f.plan.gitCommit,releaseTarget:'game',dryRun:false,appTag:f.plan.appTag,imageTag:f.plan.imageTag,catalogSchemaVersion:5,
   stepSummary:[...f.plan.steps.map(s=>({...s,status:s.key==='validate-game-startup-contract'?'done':s.status})),{key:'final-runtime-check',status:'done'}]};
 const before=JSON.stringify(history);
 const j=retainedSupplementalJob([history],runId,settings,'fixture-source');
 assert.equal(j.sourceProjectRoot,'fixture-source');assert.match(j.historyEvidenceHash,/^[a-f0-9]{64}$/);
 assert.equal(supplementalSteps(j,contract).imageId,'sha256:'+'c'.repeat(64));assert.equal(JSON.stringify(history),before);
 for(const mutation of [h=>h.releaseCommit='d'.repeat(40),h=>h.sshTarget='other',h=>h.stepSummary.push(h.stepSummary[0])]){const h=structuredClone(history);mutation(h);assert.throws(()=>retainedSupplementalJob([h],runId,settings,'fixture-source'));}
 assert.throws(()=>retainedSupplementalJob([history,history],runId,settings,'fixture-source'));
 assert.throws(()=>retainedSupplementalJob([],runId,settings,'fixture-source'));
});
test('supplemental selection rejects wrong target boundary and incomplete image evidence',()=>{
 for(const mutate of [j=>j.status='RUNNING',j=>j.plan.dryRun=true,j=>j.plan.config.remoteImageTarget.host='other',j=>j.completedStepKeys=[],j=>j.plan.steps[0].key='different-failure',j=>j.plan.steps[1].logs=[],j=>j.plan.steps[1].logs.push('game_startup_contract=PASS checker=check-login-signing-key image=sha256:'+'d'.repeat(64))]){
 const j=fixture();mutate(j);assert.throws(()=>supplementalSteps(j,contract));
 }
});
