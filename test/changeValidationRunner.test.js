const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateChange,assertNodeResult,validateDocuments,identity}=require('../src/changeValidationRunner');
const {receiptStore}=require('../src/changeValidationReceipts');
const {gate,text,snapshot}=require('../src/changeValidationGit');
const {execFileSync}=require('node:child_process');
const good='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';

function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'impact-test-'));return Promise.resolve().then(()=>fn(root)).finally(()=>fs.rmSync(root,{recursive:true,force:true}));}
test('complete Node protocol rejects missing totals, skips and execution errors',()=>{
  assertNodeResult({status:0,output:good});
  for(const output of ['',good.replace('# fail 0\n',''),good.replace('# skipped 0','# skipped 1'),good+'not ok 1 - failure\n'])assert.throws(()=>assertNodeResult({status:0,output}));
  assert.throws(()=>assertNodeResult({status:1,output:good}));
});
test('publisher hooks retain LF under Windows autocrlf checkout',()=>fixture(root=>{
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  git('init','-b','master');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','true');
  fs.copyFileSync(path.join(__dirname,'../.gitattributes'),path.join(root,'.gitattributes'));
  fs.mkdirSync(path.join(root,'.githooks'));const hook=path.join(root,'.githooks/pre-commit');fs.writeFileSync(hook,'#!/bin/sh\nexit 0\n');
  git('add','.');git('commit','-m','hook attributes fixture');fs.unlinkSync(hook);git('checkout','HEAD','--','.githooks/pre-commit');
  assert(!fs.readFileSync(hook,'utf8').includes('\r'));git('config','core.hooksPath','.githooks');git('commit','--allow-empty','-m','native hook checkout proof');
}));
test('owned-input receipts reuse across unrelated edits and reject relevant edits, tampering, missing keys',()=>fixture(async root=>{
  fs.writeFileSync(path.join(root,'README.md'),'hello');
  const plan={scope:'local-change',productionActions:false,checks:[{key:'documents',kind:'documents',inputs:['README.md'],timeoutSeconds:30}]};
  const options={cacheDirectory:path.join(root,'cache'),write:()=>{}};
  assert.equal((await validateChange(root,plan,options)).checks[0].reused,false);
  fs.writeFileSync(path.join(root,'unrelated.md'),'other');
  assert.equal((await validateChange(root,plan,{...options,requireReceipts:true})).checks[0].reused,true);
  fs.writeFileSync(path.join(root,'README.md'),'changed');
  await assert.rejects(validateChange(root,plan,{...options,requireReceipts:true}),/MISSING_VALIDATION/);
  await validateChange(root,plan,options);
  for(const f of fs.readdirSync(options.cacheDirectory).filter(f=>f.endsWith('.json')))fs.writeFileSync(path.join(options.cacheDirectory,f),'{}');
  await assert.rejects(validateChange(root,plan,{...options,requireReceipts:true}),/MISSING_VALIDATION/);
  await validateChange(root,plan,options);fs.unlinkSync(path.join(options.cacheDirectory,'receipt.key'));
  await assert.rejects(validateChange(root,plan,{...options,requireReceipts:true}),/MISSING_VALIDATION/);
}));
test('failure and input mutation never issue reusable evidence; signed result identity is exact',()=>fixture(async root=>{
  const store=receiptStore(path.join(root,'cache'));assert.throws(()=>store.write({id:1},{state:'FAIL'}));
  store.write({id:1},{state:'PASS'});assert.equal(store.read({id:2}),null);
  fs.writeFileSync(path.join(root,'README.md'),'a');
  const plan={scope:'local-change',productionActions:false,checks:[{key:'documents',kind:'documents',inputs:['README.md']}]};
  await assert.rejects(validateChange(root,plan,{cacheDirectory:path.join(root,'cache2'),write:()=>{},execute:()=>{fs.writeFileSync(path.join(root,'README.md'),'b');return {state:'PASS',protocol:'documents/v1',files:1};}}),/changed during/);
}));
test('documents check new local links and malformed JSON without retesting historical links',()=>fixture(root=>{
  fs.writeFileSync(path.join(root,'README.md'),'[old](missing.md)');
  validateDocuments(root,['README.md'],{baseFile:()=>'[old](missing.md)'});
  assert.throws(()=>validateDocuments(root,['README.md']),/Broken new/);
  fs.writeFileSync(path.join(root,'bad.json'),'{');assert.throws(()=>validateDocuments(root,['bad.json']));
}));

test('JPEG evidence validates binary markers and rejects disguised or truncated bytes',()=>fixture(root=>{
 // Marker validation is static admission; real screenshot decoding remains artifact acceptance.
 const bytes=Buffer.from('ffd8ffe000044a46ffd9','hex');
 for(const name of ['scene.jpg','scene.jpeg']){
  fs.writeFileSync(path.join(root,name),bytes);
  assert.equal(validateDocuments(root,[name]).state,'PASS');
  for(const bad of [Buffer.from('text'),Buffer.from('89504e470d0a1a0a','hex'),bytes.subarray(0,-2)]){
   fs.writeFileSync(path.join(root,name),bad);
   assert.throws(()=>validateDocuments(root,[name]),/Invalid evidence JPEG/);
  }
 }
}));
test('real staged publisher snapshot ignores dirty bytes and push reuses authentic document evidence',()=>fixture(async root=>{
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
 git('init','-b','master');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 const files=['changeValidationPolicy.js','changeValidationRunner.js','changeValidationReceipts.js','changeValidationGit.js','publisherGateInputs.json',
  'releasePlugin.js','releasePluginRunner.js','releasePluginContext.js','releasePluginCandidate.js','releasePluginDocuments.js'];
 fs.mkdirSync(path.join(root,'src'));for(const file of files)fs.copyFileSync(path.join(__dirname,'../src',file),path.join(root,'src',file));
 fs.mkdirSync(path.join(root,'docs/design'),{recursive:true});
 fs.copyFileSync(path.join(__dirname,'../docs/design/release-plugin-publisher-retirement.json'),path.join(root,'docs/design/release-plugin-publisher-retirement.json'));
 fs.writeFileSync(path.join(root,'README.md'),'initial');git('add','.');git('commit','-m','base');
 fs.writeFileSync(path.join(root,'README.md'),'accepted');git('add','.');fs.writeFileSync(path.join(root,'README.md'),'[dirty](missing.md)');
 const logs=[];await gate(root,{repository:'publisher',write:s=>logs.push(s)});
 assert(fs.readFileSync(path.join(root,'README.md'),'utf8').includes('dirty'));
 git('commit','-m','docs');
 const result=await gate(root,{repository:'publisher',phase:'push',write:s=>logs.push(s)});
 assert.equal(result.checks[0].reused,true);assert(logs.join('').includes('paths=1 checks=1'));
 git('switch','-c','codex/fixture');
 const baseline=git('rev-parse','HEAD');fs.writeFileSync(path.join(root,'README.md'),'task docs');git('add','README.md');
 const scoped=await gate(root,{repository:'publisher',phase:'source',baseline,write:()=>{}});
 assert.equal(scoped.state,'PASS');assert.equal(scoped.baseline,baseline);assert.deepEqual(scoped.selectedKeys,['documents']);
 assert.equal(scoped.candidateTree,git('write-tree'));
 await assert.rejects(gate(root,{repository:'publisher',phase:'source',baseline:'HEAD',write:()=>{}}),/explicit ancestor/);
 git('switch','-c','unowned');
 await assert.rejects(gate(root,{repository:'publisher',write:()=>{}}),/dedicated codex/);
 git('switch','codex/fixture');
 fs.writeFileSync(path.join(root,'unknown.js'),'x');git('add','unknown.js');
 await assert.rejects(gate(root,{repository:'publisher',write:()=>{}}),/UNMAPPED_CHANGE/);
 const exported=snapshot(root,'HEAD',['README.md']);try{assert.equal(fs.readFileSync(path.join(exported.root,'README.md'),'utf8'),'accepted');}finally{exported.close();}
}));
test('node receipt identity owns relevant source and rejects incomplete or duplicate plans',()=>fixture(async root=>{
 fs.writeFileSync(path.join(root,'leaf.js'),'source');
 const check={key:'fixture',kind:'node-tests',inputs:['leaf.js'],tests:['leaf.js'],timeoutSeconds:10};
 const before=identity(root,check);fs.writeFileSync(path.join(root,'unrelated.json'),'{');assert.deepEqual(identity(root,check),before);
 fs.appendFileSync(path.join(root,'leaf.js'),'changed');assert.notDeepEqual(identity(root,check),before);
 const plan={scope:'local-change',productionActions:false,checks:[check,check]};
 await assert.rejects(validateChange(root,plan,{cacheDirectory:path.join(root,'cache')}),/Invalid bounded/);
 for(const output of ['partial',good.replace('# todo 0','# todo 1')]){
  await assert.rejects(validateChange(root,{...plan,checks:[check]},{cacheDirectory:path.join(root,'cache'),write:()=>{},execute:()=>({state:'PASS',output})}),/Node completion/);
 }
 assert.throws(()=>identity(root,{...check,inputs:['missing.js']}),/Missing owned/);
}));

test('each real Node check receives only its own inputs and unrelated failure cannot leak across leaves',()=>fixture(async root=>{
 fs.writeFileSync(path.join(root,'a.txt'),'a');fs.writeFileSync(path.join(root,'b.txt'),'b');
 fs.writeFileSync(path.join(root,'a.test.cjs'),"const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');test('owned A',()=>{assert.equal(fs.readFileSync('a.txt','utf8'),'a');assert(!fs.existsSync('b.txt'));assert(!fs.existsSync('b.test.cjs'));});");
 fs.writeFileSync(path.join(root,'b.test.cjs'),"const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');test('owned B',()=>{assert.equal(fs.readFileSync('b.txt','utf8'),'b');assert(!fs.existsSync('a.txt'));});");
 const a={key:'owned-a',kind:'node-tests',inputs:['a.txt','a.test.cjs'],tests:['a.test.cjs'],timeoutSeconds:10};
 const b={key:'owned-b',kind:'node-tests',inputs:['b.txt','b.test.cjs'],tests:['b.test.cjs'],timeoutSeconds:10};
 const plan={scope:'local-change',productionActions:false,checks:[a,b]},options={cacheDirectory:path.join(root,'cache'),write:()=>{}};
 assert.equal((await validateChange(root,plan,options)).checks.filter(check=>!check.reused).length,2);
 fs.unlinkSync(path.join(root,'b.txt'));
 assert.equal((await validateChange(root,{...plan,checks:[a]},{...options,requireReceipts:true})).checks[0].reused,true);
 fs.writeFileSync(path.join(root,'a.test.cjs'),"const test=require('node:test'),fs=require('node:fs');test('mutation',()=>fs.appendFileSync('a.txt','drift'));");
 const count=fs.readdirSync(options.cacheDirectory).filter(file=>file.endsWith('.json')).length;
 await assert.rejects(validateChange(root,{...plan,checks:[a]},options),/Owned inputs changed/);
 assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'a');
 assert.equal(fs.readdirSync(options.cacheDirectory).filter(file=>file.endsWith('.json')).length,count);
 assert(!fs.readdirSync(root).some(file=>file.startsWith('.check-')));
}));
test('unrelated policy mapping bytes do not invalidate a leaf while path-admission code remains bound',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'leaf.js'),'source');
 const check={key:'fixture',kind:'node-tests',inputs:['leaf.js'],tests:['leaf.js'],timeoutSeconds:10};
 const load=(name,change)=>{
  const directory=path.join(root,name);fs.mkdirSync(path.join(directory,'src'),{recursive:true});fs.mkdirSync(path.join(directory,'docs/design'),{recursive:true});
  for(const file of ['changeValidationRunner.js','changeValidationReceipts.js','changeValidationPolicy.js','releasePluginDocuments.js','publisherGateInputs.json']){
   let text=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');if(file==='changeValidationPolicy.js')text=change(text);fs.writeFileSync(path.join(directory,'src',file),text);
  }
  fs.copyFileSync(path.join(__dirname,'../docs/design/release-plugin-publisher-retirement.json'),path.join(directory,'docs/design/release-plugin-publisher-retirement.json'));
  return require(path.join(directory,'src/changeValidationRunner.js')).identity(root,check);
 };
 const original=load('original',text=>text),mapping=load('mapping',text=>text+'\n// unrelated mapping annotation\n');
 assert.deepEqual(mapping,original);
 assert.notDeepEqual(load('admission',text=>text.replace('Invalid change path: ','Rejected change path: ')),original);
}));
