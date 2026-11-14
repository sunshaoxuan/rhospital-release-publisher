const test=require('node:test'),assert=require('node:assert/strict');
const {selectLeaves,runLeaves,verifyServerArtifact}=require('../src/localCheckLeaves');
const {currentLocalCheck}=require('../src/localCheckPolicy');
const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';

test('independent normal startup never runs unrelated covers and shared selection deduplicates it',async()=>{
 const check=currentLocalCheck('verify-bacteria-normal-startup'),seen=[];
 await runLeaves([check],{run:async leaf=>{seen.push(leaf.args.at(-1));assert.equal(leaf.args.at(-1),'src/test/js/bacteriaNormalStartup.test.mjs');return {status:0,output};}});
 assert.deepEqual(seen,['src/test/js/bacteriaNormalStartup.test.mjs']);
 const both=selectLeaves([check,currentLocalCheck('verify-bacteria-region-covers')]);
 assert.equal(both.leaves.filter(l=>l.args.at(-1)===seen[0]).length,1);
 for(const result of [{status:1,output},{status:0,output:'historical PASS'}, {status:0,output:output.replace('# skipped 0','# skipped 1')}])await assert.rejects(runLeaves([check],{run:async()=>result}));
});
test('shared current behavior leaves execute once and report both owners',async()=>{
 const checks=['verify-bacteria-region-covers','verify-bacteria-authoritative-challenges'].map(currentLocalCheck),seen=new Set(),observed=[];
 const plan=selectLeaves(checks);assert(plan.leaves.length<checks.reduce((n,c)=>n+plan.owners.get(c.key).length,0));
 const result=await runLeaves(checks,{onCheck:c=>observed.push(c.key),run:async leaf=>{assert(!seen.has(leaf.id));seen.add(leaf.id);assert(leaf.args.includes('--require'));return {status:0,output};}});
 assert(result.passed);assert.deepEqual(observed,checks.map(c=>c.key));
});
test('failed incomplete skipped and timed out leaves never produce a parent success',async()=>{
 const checks=[currentLocalCheck('verify-game-steam-auth')];
 for(const result of [{status:1,output},{status:0,output:'PASS'},{status:0,output:output.replace('# skipped 0','# skipped 1')},{status:null,error:'ETIMEDOUT',output}])await assert.rejects(runLeaves(checks,{run:async()=>result}));
});
test('unknown altered and recursive commands are rejected before executing work',async()=>{
 const c=currentLocalCheck('verify-game-steam-auth');let ran=false;
 await assert.rejects(runLeaves([{...c,command:c.command+' && npm test'}],{run:async()=>{ran=true;}}));assert.equal(ran,false);
 assert.throws(()=>selectLeaves([c,c]));
});

test('registered artifact CLI accepts actual silent success and rejects silent failure',async()=>{
 const {spawnSync}=require('node:child_process'),check=currentLocalCheck('verify-design-level-packages');
 for(const exitCode of [0,9]) {
  let silentChecks=0;
  const execute=()=>runLeaves([check],{run:async leaf=>{
   if(leaf.test)return {status:0,output};
   silentChecks++;
   const r=spawnSync(process.execPath,['-e','process.exit('+exitCode+')'],{encoding:'utf8',windowsHide:true,timeout:5000});
   return {status:r.status,signal:r.signal,error:r.error,output:(r.stdout||'')+(r.stderr||'')};
  }});
  if(exitCode===0){assert((await execute()).passed);assert.equal(silentChecks,2);}
  else {await assert.rejects(execute,/exit=9 signal=none error=none/);assert.equal(silentChecks,1);}
 }
});

test('dry-run artifact check reads current manifest only and rejects real source/bundle drift',()=>{
 const hash=t=>require('node:crypto').createHash('sha256').update(t.replaceAll('\r\n','\n')).digest('hex');
 const bundle='src/main/resources/bacteria-level-validator.js',source='scripts/bacteria-lab/server-validator-entry.mjs',manifest='scripts/bacteria-lab/server-validator-manifest.json';
 const files={[bundle]:'bundle\n',[source]:'source\n'};
 files[manifest]=JSON.stringify({bundleSha256:hash(files[bundle]),sources:{[source]:hash(files[source])}});
 const read=f=>{assert(!f.includes('evidence'));assert(f in files);return files[f];};
 assert.equal(verifyServerArtifact(read).state,'PASS');
 files[source]='source\r\n';assert.equal(verifyServerArtifact(read).state,'PASS');
 files[source]='changed';assert.throws(()=>verifyServerArtifact(read),/artifact drift/);
 files[source]='source\n';files[bundle]='changed';assert.throws(()=>verifyServerArtifact(read),/artifact drift/);
 files[bundle]='bundle\n';files[manifest]=JSON.stringify({bundleSha256:hash(files[bundle]),sources:{'docs/evidence/old.json':hash('old')}});
 assert.throws(()=>verifyServerArtifact(read),/source path/);
});
