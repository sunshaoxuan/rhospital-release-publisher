const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
function git(root,args,input) {
  const env={...process.env,GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1'};
  for(const k of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[k];
  return execFileSync('git',['-C',root,...args],{input,env,windowsHide:true,maxBuffer:256*1024*1024});
}
const text=(root,...args)=>git(root,args).toString('utf8').trim();
function manifest(root,ref) {
  return new Map(git(root,['ls-tree','-r','-z',ref]).toString('utf8').split('\0').filter(Boolean).map(line=>{
    const m=line.match(/^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/);if(!m)throw new Error('Invalid Git manifest');
    return [m[4],{mode:m[1],kind:m[2],oid:m[3]}];
  }));
}
function snapshot(root,ref,files) {
  const entries=manifest(root,ref),directory=fs.mkdtempSync(path.join(os.tmpdir(),'hospital-impact-'));
  try {
    const selected=[...new Set(files)].filter(f=>entries.has(f)).map(file=>{
      require('./changeValidationPolicy').safePath(file);
      const e=entries.get(file);if(!['100644','100755'].includes(e.mode)||e.kind!=='blob')throw new Error('Unsafe candidate mode: '+file);
      return {file,...e};
    });
    if(selected.length) {
      const bytes=git(root,['cat-file','--batch'],selected.map(e=>e.oid).join('\n')+'\n');let offset=0;
      for(const e of selected){
        const end=bytes.indexOf(10,offset),m=bytes.subarray(offset,end).toString().match(/^([a-f0-9]{40}) blob (\d+)$/);
        if(!m||m[1]!==e.oid)throw new Error('Candidate blob identity mismatch');
        const size=Number(m[2]),start=end+1;if(bytes[start+size]!==10)throw new Error('Truncated candidate blob');
        const target=path.join(directory,e.file);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,bytes.subarray(start,start+size),{mode:e.mode==='100755'?0o755:0o644});offset=start+size+1;
      }
    }
    return {root:directory,entries,close:()=>fs.rmSync(directory,{recursive:true,force:true})};
  } catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
function loadPolicy(repository,ref='HEAD') {
  const names=['src/changeValidationPolicy.js','src/changeValidationRunner.js','src/changeValidationReceipts.js',
    'src/residentMigrationCheck.js','src/changeValidationGit.js','src/currentBehaviorInputs.json','src/publisherGateInputs.json',
    'src/skinAdminCheck.js','src/skinAdminCheckInputs.json','src/bacteriaOperatorCheck.js','src/bacteriaOperatorCheckInputs.json'];
  const copy=snapshot(repository,ref,names);
  const req=createRequire(path.join(copy.root,'package.json'));
  return {...copy,plan:req('./src/changeValidationPolicy').planChanges,validate:req('./src/changeValidationRunner').validateChange};
}
function copyDependencies(source,target,checks) {
  for(const name of new Set(checks.flatMap(c=>c.dependencies||[]))) {
    if(name!=='pngjs')throw new Error('Unregistered validation dependency: '+name);
    const lock=JSON.parse(fs.readFileSync(path.join(target,'package-lock.json'),'utf8'));
    const base=path.join(source,'node_modules',name),destination=path.join(target,'node_modules',name);
    if(fs.lstatSync(base).isSymbolicLink()||fs.realpathSync(base)!==base)throw new Error('Unsafe dependency root');
    const version=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8')).version;
    if(version!==lock.packages?.['node_modules/'+name]?.version)throw new Error('Installed validation dependency does not match candidate lock: '+name);
    const copy=(from,to)=>{
      if(fs.lstatSync(from).isSymbolicLink())throw new Error('Linked validation dependency rejected');
      if(fs.lstatSync(from).isDirectory()){
        fs.mkdirSync(to,{recursive:true});for(const file of fs.readdirSync(from))copy(path.join(from,file),path.join(to,file));
      } else if(fs.lstatSync(from).isFile())fs.copyFileSync(from,to);
      else throw new Error('Nonregular validation dependency');
    };
    copy(base,destination);
  }
}
async function gate(root,{repository,policyRoot=root,phase='commit',commit,remote,validate=false,write}={}) {
  if(text(root,'branch','--show-current')!=='master')throw new Error('Validation requires master');
  const head=text(root,'rev-parse','HEAD'),tree=text(root,'write-tree');
  const committing=phase==='commit';
  if(committing&&fs.existsSync(text(root,'rev-parse','--path-format=absolute','--git-path','MERGE_HEAD')))throw new Error('Merge candidate requires an explicit integration base');
  const target=committing?tree:(commit||head);
  const base=committing?head:(remote&& !/^0+$/.test(remote)?remote:text(root,'rev-parse',target+'^'));
  if(phase==='remote'&&text(root,'ls-remote','origin','refs/heads/master').split(/\s+/)[0]!==target)throw new Error('Remote master does not contain the delivered candidate');
  if(!committing&&text(root,'merge-base',base,target)!==base)throw new Error('Push requires an ancestor integration base');
  const files=git(root,['diff','--name-only','-z',base,target]).toString('utf8').split('\0').filter(Boolean);
  const policy=loadPolicy(policyRoot,repository==='publisher'&&committing?tree:'HEAD');
  try {
    const plan=policy.plan(repository,files);
    if(!committing&&remote){
      const actual=text(root,'ls-remote','origin','refs/heads/master').split(/\s+/)[0]||'0'.repeat(40);
      if(actual!==remote)throw new Error('Remote master changed; refresh the integration base');
    }
    const owned=[...new Set(plan.checks.flatMap(c=>c.inputs).concat(['package.json','package-lock.json']))];
    const copy=snapshot(root,target,owned);
    try {
      copyDependencies(root,copy.root,plan.checks);
      const result=await policy.validate(copy.root,plan,{
        cacheDirectory:path.join(text(root,'rev-parse','--path-format=absolute','--git-common-dir'),'change-validation'),
        requireReceipts:!committing&&!validate,write,
        baseFile:file=>{try{return git(root,['show',base+':'+file]).toString('utf8');}catch{return ''; }},
        exists:file=>copy.entries.has(file)
      });
      if(text(root,'rev-parse','HEAD')!==head||text(root,'write-tree')!==tree)throw new Error('HEAD or staged inputs changed during validation');
      (write||process.stdout.write.bind(process.stdout))('CHANGE_GATE_PASS phase='+phase+' paths='+files.length+' checks='+plan.checks.length+'\n');
      return result;
    } finally {copy.close();}
  } finally {policy.close();}
}
module.exports={git,text,manifest,snapshot,loadPolicy,copyDependencies,gate};
