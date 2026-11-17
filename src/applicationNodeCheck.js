const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {loadApplicationPolicy,PROFILE}=require('./applicationReleasePolicy');
const {hash}=require('./changeValidationReceipts');
function validateCompletion(completion,output){
 const lines=String(output).split(/\r?\n/).filter(Boolean),line=lines.at(-1)||'';
 if(completion.kind==='marker')return line===completion.value||line.startsWith(completion.value+' ');
 if(completion.kind==='json'){try{const value=JSON.parse(line);return value.status==='PASS'&&value.protocol===completion.protocol;}catch{return false;}}
 return false;
}
function runApplicationNodeCheck({root,candidate,id,expectedPolicy,args=[],timeoutSeconds=900,entryHint},{launch=spawnSync}={}){
 if(!/^[a-f0-9]{40}$/.test(candidate||'')||!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>3600||!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw Error('Exact application check candidate and bounded argv required');
 const policy=loadApplicationPolicy(root,candidate),check=policy.data.nodeChecks.find(check=>check.id===id);
 if(!check||policy.identity.ownedInputHash!==expectedPolicy||entryHint&&entryHint!==check.entrypoint)throw Error('Application check policy identity mismatch');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'release-application-check-'));
 try {
  const before={};for(const file of [PROFILE,...policy.data.inputs]){const destination=path.join(directory,file),source=file===PROFILE?policy.profileText:policy.read(file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,source);before[file]=hash(fs.readFileSync(destination));}
  const env=Object.fromEntries(['SystemRoot','TEMP','TMP','PATH','Path','ComSpec','LANG','TZ'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  const result=launch(process.execPath,[path.join(directory,check.entrypoint),...args],{cwd:directory,env,encoding:'utf8',shell:false,windowsHide:true,timeout:timeoutSeconds*1000,maxBuffer:4*1024*1024});
  if(result.status!==0||result.error||result.signal||!validateCompletion(check.completion,result.stdout||''))throw Error('Application check failed or completion protocol missing: '+id);
  for(const [file,digest] of Object.entries(before))if(hash(fs.readFileSync(path.join(directory,file)))!==digest)throw Error('Application check input changed');
  return {protocol:'application-runtime-result/v1',state:'PASS',id,candidateCommit:candidate,policyHash:expectedPolicy,...(check.completion.kind==='marker'?{marker:check.completion.value}:{})};
 } finally {if(fs.lstatSync(directory).isSymbolicLink())throw Error('Application check directory changed; retained');fs.rmSync(directory,{recursive:true,force:true});}
}
module.exports={runApplicationNodeCheck,validateCompletion};
