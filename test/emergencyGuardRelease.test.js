const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('emergency release evidence rejects missing, changed and escaped evidence', async t => {
  const {verifyEvidence,PROTOCOL} = await import('../scripts/verify-emergency-guard-release.mjs');
  const parent=path.join(__dirname,'.emergency-test');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'evidence-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true}); if(fs.readdirSync(parent).length===0)fs.rmdirSync(parent);});
  fs.mkdirSync(path.join(root,'release'));fs.mkdirSync(path.join(root,'evidence'));
  const source='runtime.txt';fs.writeFileSync(path.join(root,source),'tested');
  const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
  const checks={};
  for(const name of ['normal-player-replay','historical-replay','postgres-concurrency','browser-runtime','nginx-runtime','production-test-identities']) {
    const p=`evidence/${name}.txt`;fs.writeFileSync(path.join(root,p),'PASS');checks[name]={status:'PASS',path:p,sha256:digest(p)};
  }
  const receipt={protocol:PROTOCOL,status:'PASS',checks,sources:{[source]:digest(source)}};
  const write=()=>fs.writeFileSync(path.join(root,'release/emergency-guard-readiness.json'),JSON.stringify(receipt));
  fs.writeFileSync(path.join(root,'release/release-impact.json'),JSON.stringify({targets:{game:{coveredRuntimePaths:[source]}}}));
  write();assert.equal(verifyEvidence(root).status,'PASS');
  receipt.status='BLOCKED';write();assert.throws(()=>verifyEvidence(root),/incomplete/);
  receipt.status='PASS';write();fs.writeFileSync(path.join(root,source),'changed');assert.throws(()=>verifyEvidence(root),/Untested/);
  fs.writeFileSync(path.join(root,source),'tested');receipt.checks['normal-player-replay'].path='../escape';write();assert.throws(()=>verifyEvidence(root),/escaped/);
});

test('text evidence hashes survive Git CRLF checkout while content changes fail',async t=>{
  const {evidenceHash}=await import('../scripts/verify-emergency-guard-release.mjs');
  const file=path.join(__dirname,'.emergency-lines.txt');t.after(()=>fs.rmSync(file,{force:true}));
  fs.writeFileSync(file,'a\nb\n');const expected=evidenceHash(file);
  fs.writeFileSync(file,'a\r\nb\r\n');assert.equal(evidenceHash(file),expected);
  fs.writeFileSync(file,'a\r\nc\r\n');assert.notEqual(evidenceHash(file),expected);
});

test('runtime probe keeps credentials out of arguments and suppresses unsafe diagnostics', async t => {
  const {verifyRuntime}=await import('../scripts/verify-emergency-guard-release.mjs');
  const dir=path.join(__dirname,'.emergency-probe');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'fixture.txt');fs.writeFileSync(file,'token=fixture-secret');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const args={'auth-token-file':file,'ssh-key':'fixture-key','ssh-target':'root@fixture'};
  const run=(command,argv,options)=>{
    assert.equal(command,'ssh');assert.ok(!argv.join(' ').includes('fixture-secret'));
    assert.ok(options.input.includes('preflight'));assert.ok(options.input.includes('127.0.0.1:8190'));
    return {status:0,stdout:'emergency_guard_runtime=PASS'};
  };
  assert.equal(verifyRuntime(args,run).status,'PASS');
  assert.throws(()=>verifyRuntime(args,()=>({status:1,stderr:'fixture-secret'})),e=>!e.message.includes('fixture-secret'));
});
