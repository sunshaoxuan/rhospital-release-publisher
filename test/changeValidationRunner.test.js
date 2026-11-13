const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateChange,assertNodeResult,validateDocuments,identity}=require('../src/changeValidationRunner');
const {receiptStore}=require('../src/changeValidationReceipts');
const {gate,text,snapshot,copyDependencies}=require('../src/changeValidationGit');
const {execFileSync}=require('node:child_process');
const good='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';

test('Resident leaf identity rejects relevant drift and ignores absent unrelated archives',()=>fixture(root=>{
  const check=require('../src/changeValidationPolicy').planChanges('game',['src/main/resources/static/js/scenes/utils/ResidentRewardDialog.mjs']).checks[0];
  for(const file of check.inputs){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'source');}
  assert.throws(()=>identity(root,check,{}),/ENOENT/);
  for(const name of check.dependencies){const target=path.join(root,'node_modules',name);fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'index.js'),'dependency fixture');}
  const before=identity(root,check,{});
  fs.mkdirSync(path.join(root,'docs/evidence/unrelated'),{recursive:true});fs.writeFileSync(path.join(root,'docs/evidence/unrelated/broken.json'),'{');
  assert.deepEqual(identity(root,check,{}),before);
  const file=check.inputs.find(f=>f.endsWith('ResidentRewardDialog.mjs'));fs.appendFileSync(path.join(root,file),'changed');
  assert.notDeepEqual(identity(root,check,{}),before);
}));
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
  await assert.rejects(validateChange(root,plan,{cacheDirectory:path.join(root,'cache2'),write:()=>{},execute:()=>{fs.writeFileSync(path.join(root,'README.md'),'b');return {state:'PASS',protocol:'documents/v1'};}}),/changed during/);
}));
test('documents check new local links and malformed JSON without retesting historical links',()=>fixture(root=>{
  fs.writeFileSync(path.join(root,'README.md'),'[old](missing.md)');
  validateDocuments(root,['README.md'],{baseFile:()=>'[old](missing.md)'});
  assert.throws(()=>validateDocuments(root,['README.md']),/Broken new/);
  fs.writeFileSync(path.join(root,'bad.json'),'{');assert.throws(()=>validateDocuments(root,['bad.json']));
}));
test('scoped installed dependencies are copied immutably and every byte participates in identity',()=>fixture(root=>{
  const source=path.join(root,'source'),target=path.join(root,'target'),installed=path.join(source,'node_modules/pngjs');
  fs.mkdirSync(installed,{recursive:true});fs.mkdirSync(target);
  fs.writeFileSync(path.join(installed,'package.json'),JSON.stringify({version:'7.0.0'}));fs.writeFileSync(path.join(installed,'index.js'),'original');
  fs.writeFileSync(path.join(target,'package-lock.json'),JSON.stringify({packages:{'node_modules/pngjs':{version:'7.0.0'}}}));
  const check={key:'fixture',kind:'node-tests',inputs:[],dependencies:['pngjs']};
  copyDependencies(source,target,[check]);const before=identity(target,check);
  fs.writeFileSync(path.join(installed,'index.js'),'source changed');assert.equal(fs.readFileSync(path.join(target,'node_modules/pngjs/index.js'),'utf8'),'original');
  fs.writeFileSync(path.join(target,'node_modules/pngjs/index.js'),'target changed');assert.notDeepEqual(identity(target,check),before);
  fs.writeFileSync(path.join(installed,'package.json'),JSON.stringify({version:'8.0.0'}));assert.throws(()=>copyDependencies(source,target,[check]),/candidate lock/);
  assert.throws(()=>copyDependencies(source,target,[{dependencies:['unregistered']}]),/Unregistered/);
}));
test('real staged Git snapshot ignores dirty working bytes and push reuses exact document receipt',()=>fixture(async root=>{
  const repo=path.join(root,'repo'),policy=path.join(root,'policy');fs.mkdirSync(repo);fs.mkdirSync(policy);
  const command=(r,...args)=>execFileSync('git',['-C',r,...args],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
  for(const r of [repo,policy]){command(r,'init','-b','master');command(r,'config','user.name','Fixture');command(r,'config','user.email','fixture@example.invalid');}
  for(const name of ['changeValidationPolicy','changeValidationRunner','changeValidationReceipts','changeValidationGit','residentMigrationCheck','skinAdminCheck','bacteriaOperatorCheck','giftPackCheck']) {
    fs.mkdirSync(path.join(policy,'src'),{recursive:true});fs.copyFileSync(path.join(__dirname,'../src',name+'.js'),path.join(policy,'src',name+'.js'));
  }
  for(const file of ['currentBehaviorInputs.json','publisherGateInputs.json','skinAdminCheckInputs.json','bacteriaOperatorCheckInputs.json','giftPackCheckInputs.json'])fs.copyFileSync(path.join(__dirname,'../src',file),path.join(policy,'src',file));
  command(policy,'add','.');command(policy,'commit','-m','policy');
  fs.writeFileSync(path.join(repo,'README.md'),'initial');command(repo,'add','.');command(repo,'commit','-m','base');
  fs.writeFileSync(path.join(repo,'README.md'),'accepted');command(repo,'add','.');fs.writeFileSync(path.join(repo,'README.md'),'[dirty](missing.md)');
  const logs=[];await gate(repo,{repository:'game',policyRoot:policy,write:s=>logs.push(s)});
  assert(fs.readFileSync(path.join(repo,'README.md'),'utf8').includes('dirty'));
  command(repo,'commit','-m','docs');
  const result=await gate(repo,{repository:'game',policyRoot:policy,phase:'push',write:s=>logs.push(s)});
  assert.equal(result.checks[0].reused,true);assert(logs.join('').includes('paths=1 checks=1'));
  fs.writeFileSync(path.join(repo,'unknown.js'),'x');command(repo,'add','.');
  await assert.rejects(gate(repo,{repository:'game',policyRoot:policy,write:()=>{}}),/UNMAPPED_CHANGE/);
  const exported=snapshot(repo,'HEAD',['README.md']);try{assert.equal(fs.readFileSync(path.join(exported.root,'README.md'),'utf8'),'accepted');}finally{exported.close();}
}));
