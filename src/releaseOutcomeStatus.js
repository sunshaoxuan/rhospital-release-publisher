const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const CHECKS={
  'game-prd2-runtime-contract':'运行合同',
  'verify-game-static-delivery':'双前置登录与静态资源',
  'verify-relations-release':'关系图',
  'verify-tradepool-release':'交易池'
};
const DEFERRED_REASON='container_temporary_compilation_requires_explicit_scope_confirmation';
const HASH=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const IMAGE=/^hospital-backend:[A-Za-z0-9_.-]+(?:@sha256:[a-f0-9]{64})?$/;
const IMAGE_ID=/^sha256:[a-f0-9]{64}$/;
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function validTime(value,now){const time=Date.parse(value);return Number.isFinite(time)&&time<=now+30000?time:NaN;}

function validateSnapshot(value,now=Date.now()) {
  if(value?.schemaVersion!==2||!IMAGE_ID.test(value.imageId)||value.service!=='hospital_stack_hospital-backend'||value.host!=='92.113.124.185'
      || !IMAGE.test(value.image)||!Number.isSafeInteger(value.version)||!Number.isSafeInteger(value.replicas)||value.replicas<0
      || !Number.isFinite(validTime(value.sampledAt,now))||!Array.isArray(value.containers)||value.containers.length>10
      || !['completed','rollback_completed','updating','paused','rollback_started','rollback_paused'].includes(value.updateState))throw Error('Invalid runtime snapshot');
  const containers=value.containers.map(c=>{
    if(!/^[a-f0-9]{64}$/.test(c.id)||!/^sha256:[a-f0-9]{64}$/.test(c.imageId)||!IMAGE.test(c.image)||typeof c.running!=='boolean'||!['healthy','unhealthy','starting','none'].includes(c.health))throw Error('Invalid container metadata');
    return {id:c.id,imageId:c.imageId,image:c.image,running:c.running,health:c.health};
  });
  if(new Set(containers.map(c=>c.id)).size!==containers.length)throw Error('Duplicate container metadata');
  const healthyCount=containers.filter(c=>c.running&&c.health==='healthy'&&c.imageId===value.imageId&&c.image.split('@')[0]===value.image.split('@')[0]).length;
  return {schemaVersion:2,service:value.service,host:value.host,sampledAt:value.sampledAt,version:value.version,image:value.image,imageId:value.imageId,
    replicas:value.replicas,updateState:value.updateState,containers,healthyCount,
    healthy:value.replicas>0&&containers.length===value.replicas&&healthyCount===value.replicas&&['completed','rollback_completed'].includes(value.updateState)};
}

function readSupplemental(root,history,snapshot,now=Date.now()) {
  const directory=path.join(root,'.supplemental-verifications'),accepted=[],invalid=[];
  if(!fs.existsSync(directory))return {records:[],invalidCount:0};
  for(const name of fs.readdirSync(directory).filter(n=>/^\d+-[a-f0-9]+-\d+\.json$/.test(n)).sort().reverse().slice(0,100)) {
    try {
      const file=path.join(directory,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Invalid receipt file');
      const r=JSON.parse(fs.readFileSync(file,'utf8'));
      const h=history.find(item=>item.id===r.originalHistoryId);
      if(r.schemaVersion!==1||r.kind!=='SUPPLEMENTAL_VERIFICATION'||!h||r.originalStatus!==h.status
          || r.candidateCommit!==h.releaseCommit||r.candidateCommit!==h.gitCommit||!COMMIT.test(r.candidateCommit)||!COMMIT.test(r.candidateTree)
          || !COMMIT.test(r.publisherCommit)||!/^sha256:[a-f0-9]{64}$/.test(r.imageId)||r.historyEvidenceHash!==hash(h)
          || r.baseline?.image!==h.imageTag+'@'+r.imageId||r.baseline?.imageId!==r.imageId||!HASH.test(r.baseline?.container)||!Number.isSafeInteger(r.baseline?.version)
          || String(h.projectRoot||'').replace(/\\/g,'/').split('/').at(-1)!==r.runId||!name.startsWith(r.runId+'-')
          || !['PASS','PARTIAL','FAIL'].includes(r.result)||!Array.isArray(r.checks)||!Array.isArray(r.deferredChecks)
          || !Number.isFinite(validTime(r.startedAt,now))||!Number.isFinite(validTime(r.finishedAt,now))||Date.parse(r.finishedAt)<Date.parse(r.startedAt))throw Error('Unbound receipt');
      const seen=new Set();
      const checks=r.checks.map(c=>{
        if(!CHECKS[c.key]||seen.has(c.key)||!['PASS','FAIL'].includes(c.result)||!Number.isFinite(c.durationMs)||c.durationMs<0||(c.result==='PASS'&&!HASH.test(c.outputHash)))throw Error('Invalid check');
        seen.add(c.key);return {key:c.key,label:CHECKS[c.key],result:c.result,durationMs:c.durationMs};
      });
      const deferred=r.deferredChecks.map(c=>{
        if(c.key!=='verify-tradepool-release'||c.reason!==DEFERRED_REASON||seen.has(c.key))throw Error('Invalid deferred check');
        seen.add(c.key);return {key:c.key,label:CHECKS[c.key],result:'PENDING_APPROVAL',reason:'在健康容器独立临时目录编译并清理只读数据库审计程序'};
      });
      if((r.result!=='FAIL'&&seen.size!==4)||(r.result==='PASS'&&(deferred.length||checks.some(c=>c.result!=='PASS')))
          ||(r.result==='PARTIAL'&&(!deferred.length||checks.some(c=>c.result!=='PASS'))))throw Error('Incomplete receipt protocol');
      const matched=snapshot&&snapshot.imageId===r.imageId&&snapshot.image.split('@')[0]===h.imageTag&&snapshot.version===r.baseline?.version
        &&snapshot.containers.length===1&&snapshot.containers[0].id===r.baseline?.container;
      const ageSeconds=Math.max(0,Math.floor((now-Date.parse(r.finishedAt))/1000));
      accepted.push({historyId:h.id,runId:r.runId,result:r.result,candidateCommit:r.candidateCommit,imageId:r.imageId,
        finishedAt:r.finishedAt,ageSeconds,applicability:!snapshot?'UNKNOWN':!matched?'DEPLOYMENT_CHANGED':ageSeconds>86400?'STALE':'MATCHED',
        checks,deferred,receiptFile:name,receiptSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
    } catch {invalid.push(name);}
  }
  accepted.sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));
  return {records:accepted.filter((r,i,all)=>all.findIndex(x=>x.historyId===r.historyId)===i),invalidCount:invalid.length};
}

function samplingError(code){const error=Error(code);error.code=code;return error;}
function historyView(record){
  if(!record)return null;
  const failed=(record.stepSummary||[]).find(step=>['failed','interrupted','cancelled'].includes(step.status));
  const first=failed||record.diagnostics?.firstFailure;
  const unmapped=(failed?.logs||[]).map(line=>String(line).match(/\bUNMAPPED_PLUGIN_CHANGE: ([A-Za-z0-9_./-]+)/)).find(Boolean);
  return {id:record.id,status:record.status,appTag:record.appTag,releaseCommit:record.releaseCommit,createdAt:record.createdAt,
    firstFailure:first?{stepKey:first.key||first.stepKey,title:first.title,status:first.status,
      ...(unmapped?{errorCode:'UNMAPPED_PLUGIN_CHANGE',path:unmapped[1]}:{})}:null};
}
function sampleRuntime(root,env) {
  const settings=JSON.parse(fs.readFileSync(env.RELEASE_PUBLISHER_CONFIG||path.join(root,'release-publisher.config.json'),'utf8'));
  const target=settings.dockerServers?.GAME_PRD2;
  if(target?.host!=='92.113.124.185'||target.username!=='root'||String(target.port)!=='22'||!target.keyPath)throw samplingError('STATUS_TARGET_INVALID');
  return new Promise((resolve,reject)=>{
    const child=spawn('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-i',target.keyPath,'-p','22','root@92.113.124.185','python3 -'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill();},25000);
    child.stdout.on('data',data=>{output+=data;if(output.length>32768){failed=true;child.kill();}});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(samplingError('STATUS_SSH_UNAVAILABLE'));});
    child.on('close',code=>{clearTimeout(timer);if(code||failed)return reject(samplingError(failed?'STATUS_SAMPLE_LIMIT':'STATUS_REMOTE_FAILED'));try{resolve(JSON.parse(output));}catch{reject(samplingError('STATUS_JSON_INVALID'));}});
    child.stdin.end(fs.readFileSync(path.join(root,'scripts/read-game-runtime-status.py'),'utf8'));
  });
}

function createOutcomeReader(root,{sample=()=>sampleRuntime(root,process.env),now=Date.now}={}) {
  const file=path.join(root,'.runtime-status/game.json');let pending;
  return async function read(history,activity) {
    const at=now();let snapshot=null,error=false,failureCode=null;
    try{snapshot=validateSnapshot(JSON.parse(fs.readFileSync(file,'utf8')),at);}catch{}
    if(!snapshot||at-Date.parse(snapshot.sampledAt)>60000) {
      if(!pending)pending=Promise.resolve().then(sample).then(value=>{
        let clean;try{clean=validateSnapshot(value,now());}catch{throw samplingError('STATUS_SNAPSHOT_INVALID');}fs.mkdirSync(path.dirname(file),{recursive:true});
        const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(clean)+'\n',{mode:0o600});fs.renameSync(temp,file);return clean;
      }).finally(()=>{pending=null;});
      try{snapshot=await pending;}catch(cause){error=true;failureCode=['STATUS_TARGET_INVALID','STATUS_SSH_UNAVAILABLE','STATUS_SAMPLE_LIMIT','STATUS_REMOTE_FAILED','STATUS_JSON_INVALID','STATUS_SNAPSHOT_INVALID'].includes(cause.code)?cause.code:'STATUS_SAMPLE_UNAVAILABLE';}
    }
    const ageSeconds=snapshot?Math.max(0,Math.floor((now()-Date.parse(snapshot.sampledAt))/1000)):null;
    const freshness=error?'UNAVAILABLE':!snapshot?'UNKNOWN':ageSeconds>120?'STALE':'CURRENT';
    const supplemental=readSupplemental(root,history,snapshot,now());
    if(freshness!=='CURRENT')for(const record of supplemental.records)if(record.applicability==='MATCHED')record.applicability='UNKNOWN';
    return {observedAt:new Date(now()).toISOString(),activity:{busy:Boolean(activity.busy),jobId:activity.job?.id||null},
      deployment:snapshot?{...snapshot,ageSeconds,freshness,failureCode}:{freshness,failureCode},supplemental,
      latestHistory:historyView(history.find(h=>h.releaseTarget==='game'))};
  };
}
module.exports={CHECKS,validateSnapshot,readSupplemental,createOutcomeReader,historyView,sampleRuntime};
