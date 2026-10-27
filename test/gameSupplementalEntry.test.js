const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function harness({busy=false,concurrent=false,output='fixed_check=PASS',fail=false}={}) {
 const writes=[],commands=[],calls=[];let anchors=0;
 const job={id:'123-abc',status:'RECOVERY_REQUIRED',historyEntryId:'immutable-history',executionProjectRoot:'fixture-source',
   plan:{gitCommit:'a'.repeat(40),imageTag:'hospital-backend:fixture',config:{remoteImageTarget:{}}}};
 const original=JSON.stringify(job),module={exports:{}};
 const nativeRequire=require;
 const mocks={
   'node:fs':{mkdirSync(){},writeFileSync(p,s){writes.push({path:p,data:JSON.parse(s)});}},
   'node:child_process':{spawnSync(_cmd,args){if(args.includes('show'))return {status:0,stdout:'source-with-final-newline\n'};return {status:0,stdout:args.includes('--porcelain')?'':('a'.repeat(40)+'\n')};}},
   '../src/gameStartupContract':{resolveGameStartupContract(a,b,c){assert.equal(a,'source-with-final-newline\n\nsource-with-final-newline\n');assert.equal(b,'source-with-final-newline\n');assert.equal(c,b);return {sourceHash:'bound'};}},
   '../src/gameSupplementalVerification':{supplementalSteps(){return {imageId:'sha256:fixture',deferredChecks:[{key:'verify-tradepool-release',reason:'authorization_pending'}],steps:[{key:'fixed-check',protocol:'fixed_check=PASS',command:'fixed-safe-command',timeout:5}]};}},
   '../src/releasePublisherCore':{remoteSshCommand(){return 'anchor';},remoteBashScriptCommand(){return 'inspect';},
     async runPowerShell(_cwd,cmd){commands.push(cmd);if(cmd==='anchor'){anchors++;return JSON.stringify({version:concurrent&&anchors>1?11:10,image:'hospital-backend:fixture@sha256:fixture',imageId:'sha256:fixture',container:'container'});}if(fail)throw Error('secret-do-not-print');return output;}}
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/verify-game-supplemental.cjs'),'utf8'),{
   require:name=>mocks[name]||nativeRequire(name),module,__dirname:path.dirname(require.resolve('../scripts/verify-game-supplemental.cjs')),
   process:{env:{}},console:{log(){}},AbortSignal,Buffer,fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/active')?{busy}:structuredClone(job)};}
 });
 return {run:()=>module.exports.verify('123-abc',{outputRoot:'fixture-output'}),writes,commands,calls,job,original};
}
test('supplemental entry records partial safe success separately and preserves original identity',async()=>{
 const h=harness();const result=await h.run();assert.equal(result.result,'PARTIAL');assert.equal(result.checks[0].result,'PASS');
 assert.equal(JSON.stringify(h.job),h.original);assert.equal(h.writes.at(-1).data.originalStatus,'RECOVERY_REQUIRED');
 assert.ok(h.writes.every(w=>w.path.startsWith('fixture-output')));assert.deepEqual(h.commands,['anchor','anchor','fixed-safe-command','anchor']);
});
test('supplemental entry rejects busy and concurrent state before executing validation',async()=>{
 for(const options of [{busy:true},{concurrent:true}]) {const h=harness(options);await assert.rejects(h.run);assert.ok(!h.commands.includes('fixed-safe-command'));}
});
test('supplemental entry rejects missing success protocol and retains sanitized failure receipt',async()=>{
 for(const options of [{output:'prefix fixed_check=PASS suffix'},{fail:true}]) {
   const h=harness(options);await assert.rejects(h.run);const receipt=h.writes.at(-1).data;
   assert.equal(receipt.result,'FAIL');assert.equal(receipt.checks[0].result,'FAIL');assert.ok(!JSON.stringify(receipt).includes('secret-do-not-print'));
 }
});
