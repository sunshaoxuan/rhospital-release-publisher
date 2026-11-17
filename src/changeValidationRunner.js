const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {hash,receiptStore}=require('./changeValidationReceipts');
const {safePath}=require('./changeValidationPolicy');
const {validateDocuments}=require('./releasePluginDocuments');
function fileHash(root,file){
 safePath(file);const target=path.resolve(root,file);
 if(!fs.existsSync(target))return 'absent';
 if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()
   ||!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep))throw new Error('Unsafe validation input: '+file);
 return hash(fs.readFileSync(target));
}
function assertNodeResult(result){
 const output=String(result?.output||'').replace(/\x1b\[[0-9;]*m/g,'');
 if(result?.status!==0||result.error||result.signal||/^\s*(?:not ok|\u2716)/mu.test(output))throw new Error('Incomplete Node check');
 const values=name=>[...output.matchAll(new RegExp('^[#\\u2139]\\s*'+name+'\\s+(\\d+)\\s*$','gm'))].map(m=>Number(m[1]));
 const tests=values('tests'),pass=values('pass');
 if(!tests.length||tests.some((n,i)=>!n||pass[i]!==n)||['pass','fail','skipped','cancelled','todo'].some(k=>values(k).length!==tests.length)
  ||['fail','skipped','cancelled','todo'].some(k=>values(k).some(Boolean))
  ||/^\s*(?:ok|not ok)\b[^\r\n]*#\s*(?:SKIP|TODO)\b/mi.test(output))throw new Error('Missing or failed Node completion protocol');
}
function nodeTests(root,tests,seconds,launch=spawnSync){
 const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','NODE_TEST_CONTEXT'])delete env[key];
 const r=launch(process.execPath,['--experimental-vm-modules','--test','--test-concurrency=1',...tests],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:seconds*1000,maxBuffer:8*1024*1024});
 const result={status:r.status,signal:r.signal,error:r.error?.message,output:(r.stdout||'')+(r.stderr||'')};
 try{assertNodeResult(result);}catch(error){throw new Error(error.message+'\n'+result.output.slice(-24000));}return result.output;
}
function identity(root,check,context={}){
 if(!['documents','node-tests'].includes(check.kind))throw new Error('Unknown publisher leaf kind');
 const inputs={};
 for(const file of [...new Set([...check.inputs,...(check.kind==='documents'?[]:['package.json','package-lock.json'])])].sort()){
  const value=fileHash(root,file);
  if(value==='absent'&&check.kind!=='documents'&&!['package.json','package-lock.json'].includes(file))throw new Error('Missing owned input: '+file);
  inputs[file]=value;
 }
 const executor=hash({admission:safePath.toString().replace(/\r\n/g,'\n'),modules:Object.fromEntries(['changeValidationRunner.js','changeValidationReceipts.js','releasePluginDocuments.js'].map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))]))});
 const environment={node:process.version,executable:hash(fs.readFileSync(process.execPath)),platform:process.platform,arch:process.arch,os:os.release()};
 if(check.kind==='node-tests')environment.variables=hash(Object.fromEntries(['NODE_OPTIONS','NODE_PATH','NODE_ENV','PATH','Path','ComSpec','SystemRoot','TZ','LANG'].map(k=>[k,process.env[k]||''])));
 const baseline=check.kind==='documents'?Object.fromEntries(check.inputs.map(file=>[file,hash(context.baseFile?.(file)||'')])):{};
 return {schema:1,check,inputs,executor,baseline,environment};
}
function assertResult(check,result){
 if(result?.state!=='PASS')throw new Error('Missing validation PASS');
 if(check.kind==='node-tests')assertNodeResult({status:0,output:result.output});
 else if(check.kind!=='documents'||result.protocol!=='documents/v1'||result.files!==check.inputs.length)throw new Error('Invalid publisher completion protocol');
}

function scopedNodeTests(root,check,context,expected){
 const owner=fs.realpathSync(root),privateRoot=fs.mkdtempSync(path.join(owner,'.check-'));
 try{
  for(const file of [...new Set([...check.inputs,'package.json','package-lock.json'])]){
   const source=path.join(owner,file);if(!fs.existsSync(source))continue;
   const destination=path.join(privateRoot,safePath(file));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
  }
  const before=hash(identity(privateRoot,check,context));
  if(before!==hash(expected))throw new Error('Owned inputs changed before validation: '+check.key);
  const output=nodeTests(privateRoot,check.tests,check.timeoutSeconds);
  if(before!==hash(identity(privateRoot,check,context)))throw new Error('Owned inputs changed during validation: '+check.key);
  return output;
 }finally{
  if(fs.lstatSync(privateRoot).isSymbolicLink()||path.dirname(fs.realpathSync(privateRoot))!==owner)throw new Error('Private check directory identity changed; retained');
  fs.rmSync(privateRoot,{recursive:true,force:true});
 }
}

async function validateChange(root,plan,{cacheDirectory,requireReceipts=false,write=text=>process.stdout.write(text),execute,...context}={}){
 if(plan.scope!=='local-change'||plan.productionActions!==false||new Set(plan.checks.map(c=>c.key)).size!==plan.checks.length)throw new Error('Invalid bounded validation plan');
 const prepared=plan.checks.map(check=>({check,id:identity(root,check,context)})),store=receiptStore(cacheDirectory),results=[];
 for(const {check,id} of prepared){
  const prior=store.read(id);
  if(prior){assertResult(check,prior);results.push({key:check.key,reused:true});write('CHANGE_CHECK_PASS key='+check.key+' reused=true\n');continue;}
  if(requireReceipts)throw new Error('MISSING_VALIDATION_RECEIPT: '+check.key+'; validate this candidate before push');
  const started=Date.now();write('CHANGE_CHECK_BEGIN key='+check.key+'\n');
  let result;
  if(execute)result=await execute(check);
  else if(check.kind==='documents')result=validateDocuments(root,check.inputs,context);
  else result={state:'PASS',output:scopedNodeTests(root,check,context,id)};
  assertResult(check,result);
  if(hash(identity(root,check,context))!==hash(id))throw new Error('Owned inputs changed during validation: '+check.key);
  store.write(id,result);results.push({key:check.key,reused:false});write('CHANGE_CHECK_PASS key='+check.key+' reused=false elapsed_ms='+(Date.now()-started)+'\n');
 }
 return {state:'PASS',checks:results};
}
module.exports={validateChange,identity,fileHash,nodeTests,assertNodeResult,validateDocuments,assertResult};
