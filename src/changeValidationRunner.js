const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {hash,receiptStore}=require('./changeValidationReceipts');
const {safePath}=require('./changeValidationPolicy');

function fileHash(root,file) {
  safePath(file);const target=path.resolve(root,file);
  if(!fs.existsSync(target))return 'absent';
  if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()
    ||!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep))throw new Error('Unsafe validation input: '+file);
  return hash(fs.readFileSync(target));
}
function assertNodeResult(result) {
  const output=result?.output||'';
  if(result?.status!==0||result.error||result.signal||/^\s*(?:not ok|✖)/mu.test(output))throw new Error('Incomplete Node check');
  const values=name=>[...output.matchAll(new RegExp('^[#ℹ]\\s*'+name+'\\s+(\\d+)\\s*$','gm'))].map(m=>Number(m[1]));
  const tests=values('tests'),pass=values('pass');
  if(!tests.length||tests.some((n,i)=>!n||pass[i]!==n)||['pass','fail','skipped','cancelled','todo'].some(k=>values(k).length!==tests.length)
    ||['fail','skipped','cancelled','todo'].some(k=>values(k).some(Boolean)))throw new Error('Missing or failed Node completion protocol');
}
function nodeTests(root,tests,seconds,launch=spawnSync) {
  const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key];
  const r=launch(process.execPath,['--experimental-vm-modules','--test','--test-concurrency=1',...tests],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:seconds*1000,maxBuffer:8*1024*1024});
  const result={status:r.status,signal:r.signal,error:r.error?.message,output:(r.stdout||'')+(r.stderr||'')};
  try {assertNodeResult(result);} catch(error) {throw new Error(error.message+'\n'+result.output.slice(-24000));}return result.output;
}
const links=text=>[...text.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1].replace(/^<|>$/g,''));
function validateDocuments(root,files,{baseFile=()=>'',exists=file=>fs.existsSync(path.resolve(root,file))}={}) {
  for(const file of files) {
    if(!fs.existsSync(path.join(root,file)))continue;
    if(file.endsWith('.png')){
      const bytes=fs.readFileSync(path.join(root,file));
      if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'
        ||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw new Error('Invalid evidence PNG: '+file);
      continue;
    }
    const text=fs.readFileSync(path.join(root,file),'utf8');
    if(text.includes('\uFFFD')||text.includes('\0'))throw new Error('Invalid document encoding: '+file);
    if(file.endsWith('.json')){JSON.parse(text);continue;}
    const before=new Set(links(baseFile(file)));
    for(const link of links(text)) {
      if(before.has(link)||/^(?:[a-z]+:|#|\/)/i.test(link))continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURI(link.split('#')[0])));
      if(target.startsWith('../')||!exists(target))throw new Error('Broken new document link: '+file+' -> '+target);
    }
  }
  return {state:'PASS',protocol:'documents/v1',files:files.length};
}
function environment(check,{dockerIdentity}={}) {
  const result={node:process.version,executable:hash(fs.readFileSync(process.execPath)),platform:process.platform,arch:process.arch,os:os.release(),
    variables:hash(Object.fromEntries(['NODE_OPTIONS','NODE_PATH','NODE_ENV','PATH','Path','ComSpec','SystemRoot','TZ','LANG'].map(k=>[k,process.env[k]||''])))};
  if(check.kind==='resident')result.docker=dockerIdentity?dockerIdentity(check.images):require('./residentMigrationCheck').dockerIdentity(check.images);
  if(check.kind==='bacteria-operator')result.tools=require('./bacteriaOperatorCheck').toolIdentity();
  if(check.kind==='skin-admin'){
    result.tools=require('./skinAdminCheck').toolIdentity();
    result.docker=dockerIdentity?dockerIdentity(check.images):require('./residentMigrationCheck').dockerIdentity(check.images);
  }
  return result;
}
function identity(root,check,context={}) {
  const inputs={};
  for(const file of [...new Set([...check.inputs,...(check.kind==='documents'?[]:['package.json','package-lock.json'])])].sort()) {
    const h=fileHash(root,file);
    if(h==='absent'&&check.kind!=='documents'&&!['package.json','package-lock.json'].includes(file))throw new Error('Missing owned input: '+file);
    inputs[file]=h;
  }
  for(const dependency of check.dependencies||[]) {
    if(dependency!=='pngjs')throw new Error('Unregistered validation dependency');
    const folder='node_modules/'+dependency;
    const visit=relative=>{
      const full=path.join(root,relative);
      if(fs.lstatSync(full).isSymbolicLink())throw new Error('Linked validation dependency');
      if(fs.lstatSync(full).isDirectory())for(const name of fs.readdirSync(full).sort())visit(relative+'/'+name);
      else inputs[relative]=fileHash(root,relative);
    };
    visit(folder);
  }
  const executorFiles=['changeValidationRunner.js','changeValidationReceipts.js','changeValidationPolicy.js','changeValidationGit.js',...(check.kind==='resident'?['residentMigrationCheck.js']:[]),...(check.kind==='skin-admin'?['skinAdminCheck.js','residentMigrationCheck.js']:[])];
  if(check.kind==='bacteria-operator')executorFiles.push('bacteriaOperatorCheck.js','skinAdminCheck.js');
  const executor=hash(Object.fromEntries(executorFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])));
  const baseline=check.kind==='documents'?Object.fromEntries(check.inputs.map(f=>[f,hash(context.baseFile?.(f)||'')])):{};
  return {schema:1,check,inputs,executor,baseline,environment:environment(check,context)};
}
function assertResult(check,result) {
  if(result?.state!=='PASS')throw new Error('Missing validation PASS');
  if(check.kind==='syntax'&&(result.protocol!=='syntax/v1'||result.files!==check.inputs.length))throw new Error('Invalid syntax protocol');
  if(check.kind==='node-tests')assertNodeResult({status:0,output:result.output});
  else if(check.kind==='documents'&&result.protocol!=='documents/v1')throw new Error('Invalid document protocol');
  else if(check.kind==='resident'&&(result.protocol!=='resident-schema/v1'||result.versions?.length!==2||result.cases<20))throw new Error('Invalid migration protocol');
  else if(check.kind==='skin-admin')require('./skinAdminCheck').assertProtocol(result,check.testClasses);
  else if(check.kind==='bacteria-operator')require('./bacteriaOperatorCheck').assertProtocol(result,check.testClasses);
}
async function validateChange(root,plan,{cacheDirectory,requireReceipts=false,write=s=>process.stdout.write(s),execute, ...context}={}) {
  if(plan.scope!=='local-change'||plan.productionActions!==false||new Set(plan.checks.map(c=>c.key)).size!==plan.checks.length)throw new Error('Invalid bounded validation plan');
  const store=receiptStore(cacheDirectory),results=[];
  // Resolve every owned input before starting any expensive check.
  const prepared=plan.checks.map(check=>({check,id:identity(root,check,context)}));
  for(const {check,id} of prepared) {
    const prior=store.read(id);
    if(prior){assertResult(check,prior);results.push({key:check.key,reused:true});write('CHANGE_CHECK_PASS key='+check.key+' reused=true\n');continue;}
    if(requireReceipts)throw new Error('MISSING_VALIDATION_RECEIPT: '+check.key+'; validate this candidate before push');
    const started=Date.now();write('CHANGE_CHECK_BEGIN key='+check.key+'\n');
    let result;
    if(execute)result=await execute(check);
    else if(check.kind==='documents')result=validateDocuments(root,check.inputs,context);
    else if(check.kind==='syntax') {
      for(const file of check.inputs){const r=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:check.timeoutSeconds*1000});if(r.status!==0||r.error||r.signal)throw new Error('Invalid archive tooling syntax: '+file);}
      result={state:'PASS',protocol:'syntax/v1',files:check.inputs.length};
    }
    else if(check.kind==='node-tests')result={state:'PASS',output:nodeTests(root,check.tests,check.timeoutSeconds)};
    else if(check.kind==='resident') {
      const output=nodeTests(root,['src/test/js/residentSchemaOracle.test.cjs'],30);
      result={...await require('./residentMigrationCheck').runResident(root,check.images),output};
    } else if(check.kind==='skin-admin'){
      result=require('./skinAdminCheck').runSkin(root,check.testClasses,check.timeoutSeconds);
    } else if(check.kind==='bacteria-operator'){
      result=require('./bacteriaOperatorCheck').runBacteria(root,check.testClasses,check.timeoutSeconds);
    } else throw new Error('Unknown leaf kind');
    assertResult(check,result);
    if(hash(identity(root,check,context))!==hash(id))throw new Error('Owned inputs changed during validation: '+check.key);
    store.write(id,result);results.push({key:check.key,reused:false});
    write('CHANGE_CHECK_PASS key='+check.key+' reused=false elapsed_ms='+(Date.now()-started)+'\n');
  }
  return {state:'PASS',checks:results};
}
module.exports={validateChange,identity,fileHash,nodeTests,assertNodeResult,validateDocuments,assertResult};
