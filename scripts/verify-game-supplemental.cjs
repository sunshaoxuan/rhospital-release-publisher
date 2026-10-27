// Explicit verification-only entrypoint. It cannot run executePlan or recovery.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {supplementalSteps,retainedSupplementalJob}=require('../src/gameSupplementalVerification');
const {resolveGameStartupContract}=require('../src/gameStartupContract');
const {runPowerShell,remoteSshCommand,remoteBashScriptCommand}=require('../src/releasePublisherCore');

async function verify(runId,{api='http://192.168.20.218:8787',env=process.env,outputRoot=path.resolve(__dirname,'../.supplemental-verifications')}={}) {
  if(!/^\d+-[a-f0-9]+$/.test(runId)) throw new Error('Invalid run ID');
  const get=async route=>{const r=await fetch(api+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Publisher state unavailable');return r.json();};
  const idle=async()=>{const a=await get('/api/jobs/active');if(a.busy||a.job)throw new Error('Publisher busy; verification refused');};
  await idle();
  const settings=JSON.parse(fs.readFileSync(env.RELEASE_PUBLISHER_CONFIG||path.resolve(__dirname,'../release-publisher.config.json'),'utf8'));
  const publisherConfig=await get('/api/config');
  const retained=async()=>{
    const items=[];
    for(let page=1;page<=20;page++) {
      const result=await get('/api/history?limit=50&page='+page);items.push(...result.items);
      if(page>=result.pageCount)return retainedSupplementalJob(items,runId,settings,publisherConfig.projectRoot);
    }
    throw new Error('Retained history exceeds verification search bound');
  };
  const job=await retained();
  const source=job.sourceProjectRoot;
  const git=(...args)=>{const r=spawnSync('git',['-C',source,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('Candidate source unavailable');return r.stdout;};
  if(!source || git('rev-parse',job.plan.gitCommit+'^{commit}').trim()!==job.plan.gitCommit) throw new Error('Candidate source identity changed');
  const file=p=>git('show',job.plan.gitCommit+':'+p);
  const contract=resolveGameStartupContract(file('src/main/resources/application.properties')+'\n'+file('src/main/resources/application-prod.properties'),
    file('src/main/java/com/zly/hospital/service/TokenService.java'),file('src/main/java/com/zly/hospital/HospitalBackendApplication.java'));
  const prepared=supplementalSteps(job,contract,env);
  const remote=job.plan.config.remoteImageTarget;
  const anchorCode=String.raw`
import json,subprocess
def read(*args):return json.loads(subprocess.check_output(['docker',*args],timeout=20))
s=read('service','inspect','hospital_stack_hospital-backend')[0]
ids=subprocess.check_output(['docker','ps','-q','--filter','label=com.docker.swarm.service.name=hospital_stack_hospital-backend'],text=True,timeout=20).split()
assert len(ids)==1 and s['Spec']['Mode']['Replicated']['Replicas']==1 and s.get('UpdateStatus',{}).get('State')=='completed'
c=read('inspect',ids[0])[0]
assert c['State']['Running'] and c['State']['Health']['Status']=='healthy'
print(json.dumps({'version':s['Version']['Index'],'image':s['Spec']['TaskTemplate']['ContainerSpec']['Image'],'imageId':c['Image'],'container':c['Id']} ,sort_keys=True))
`;
  const anchor=async()=>{
    await idle();
    const cmd=remoteSshCommand(remote,remoteBashScriptCommand([`printf %s "${Buffer.from(anchorCode).toString('base64')}" | base64 -d | python3 -`]));
    const r=JSON.parse(await runPowerShell(path.resolve(__dirname,'..'),cmd,env,()=>{},()=>{},undefined,90));
    if(r.imageId!==prepared.imageId || r.image!==job.plan.imageTag+'@'+prepared.imageId)throw new Error('Current runtime differs from released candidate');
    return r;
  };
  const baseline=await anchor();
  const receipt={schemaVersion:1,kind:'SUPPLEMENTAL_VERIFICATION',runId,originalHistoryId:job.historyEntryId,originalStatus:job.status,
    candidateCommit:job.plan.gitCommit,candidateTree:git('rev-parse',job.plan.gitCommit+'^{tree}').trim(),imageId:prepared.imageId,baseline,historyEvidenceHash:job.historyEvidenceHash,
    publisherCommit:spawnSync('git',['-C',path.resolve(__dirname,'..'),'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim(),
    startedAt:new Date().toISOString(),result:'RUNNING',checks:[],deferredChecks:prepared.deferredChecks.map(({key,reason})=>({key,reason}))};
  fs.mkdirSync(outputRoot,{recursive:true});
  const target=path.join(outputRoot,runId+'-'+Date.now()+'.json');
  const save=()=>fs.writeFileSync(target,JSON.stringify(receipt,null,2)+'\n',{mode:0o600}); save();
  try {
    for(const step of prepared.steps) {
      if(JSON.stringify(await anchor())!==JSON.stringify(baseline))throw new Error('Concurrent runtime change');
      console.log('supplemental_check_begin='+step.key);
      const started=Date.now(); let output='';
      try {output=await runPowerShell(path.resolve(__dirname,'..'),step.command,env,()=>{},()=>{},undefined,step.timeout);}
      catch(error) {
        const reason=String(error.message).split(/\r?\n/).find(line=>/^ERROR: runtime Secret contract failed: [a-z_]+$/.test(line));
        receipt.checks.push({key:step.key,result:'FAIL',durationMs:Date.now()-started,reason:reason||'validator_failed_output_withheld'});
        throw new Error('Verification failed: '+step.key+(reason?' '+reason:''));
      }
      if(!output.split(/\r?\n/).some(line=>line===step.protocol || line.startsWith(step.protocol+' '))) {
        receipt.checks.push({key:step.key,result:'FAIL',durationMs:Date.now()-started,reason:'incomplete_success_protocol'});
        throw new Error('Incomplete success protocol: '+step.key);
      }
      receipt.checks.push({key:step.key,result:'PASS',durationMs:Date.now()-started,outputHash:crypto.createHash('sha256').update(output).digest('hex')});
      save();console.log('supplemental_check=PASS key='+step.key);
    }
    if(JSON.stringify(await anchor())!==JSON.stringify(baseline))throw new Error('Concurrent runtime change');
    const current=await retained();
    if(current.historyEvidenceHash!==job.historyEvidenceHash)throw new Error('Original release record changed');
    receipt.result=receipt.deferredChecks.length?'PARTIAL':'PASS';
  } catch(error) {receipt.result='FAIL';receipt.reason=error.message;throw error;}
  finally {receipt.finishedAt=new Date().toISOString();save();console.log('supplemental_receipt='+target);}
  console.log('game_supplemental_verification='+receipt.result+' original_status='+job.status);
  return receipt;
}
module.exports={verify};
if(require.main===module){
  if(process.argv.length!==4||process.argv[2]!=='--run-id'){console.error('Usage: node scripts/verify-game-supplemental.cjs --run-id <terminal-run-id>');process.exitCode=1;}
  else verify(process.argv[3]).catch(error=>{console.error(error.message);process.exitCode=1;});
}
