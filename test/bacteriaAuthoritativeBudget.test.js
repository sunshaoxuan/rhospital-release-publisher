const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {BACTERIA_AUTHORITATIVE_CHECK:check,registeredLocalCheckContracts,doubleCheckLocalChecks}=require('../src/localCheckPolicy');
const {runLeaves}=require('../src/localCheckLeaves');
test('authoritative current budget is exact and contains five behavior files without archive validators',()=>{
 const c=registeredLocalCheckContracts().find(c=>c.key===check.key);assert.equal(c.timeoutSeconds,300);assert.equal(c.inputs.length,5);
 for(const timeoutSeconds of [undefined,180,299,301,3600,'300'])assert.throws(()=>doubleCheckLocalChecks([{...check,timeoutSeconds}]));
 assert.throws(()=>doubleCheckLocalChecks([{...check,command:check.command+' && node scripts/bacteria-lab/validate-authoritative-challenge-evidence.mjs'}]));
});
test('one parent deadline bounds all five leaves and incomplete output blocks the owner',async()=>{
 let calls=0;const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
 await runLeaves([check],{run:async leaf=>{calls++;assert(leaf.timeoutSeconds>0&&leaf.timeoutSeconds<=300);return {status:0,output};}});assert.equal(calls,5);
 await assert.rejects(runLeaves([check],{run:async()=>({status:null,error:'ETIMEDOUT',output})}));
});
test('actual authoritative CLI works without history and rejects current failures',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'current-authority-'));try{
  const inputs=registeredLocalCheckContracts().find(c=>c.key===check.key).inputs;
  for(const file of inputs){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),"import test from 'node:test';test('current controlled behavior',()=>{});");}
  const args=[path.resolve(__dirname,'../scripts/run-game-release-preflight.mjs'),'--checks-base64',Buffer.from(JSON.stringify({version:1,checks:[check]})).toString('base64')];const env={...process.env};delete env.NODE_TEST_CONTEXT;
  let r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);assert(r.stdout.includes('game_release_preflight=PASS'));
  fs.writeFileSync(path.join(root,inputs[0]),"import test from 'node:test';test('current fault',()=>{throw Error('controlled');});");r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(r.status,0);assert(!r.stdout.includes('game_release_preflight=PASS'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
