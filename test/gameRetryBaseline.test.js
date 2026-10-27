const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {signingPrelude}=require('../src/gameSigningBinding');
const {gameRetryBaselineCommand,retryHistoryEvidence}=require('../src/gameRetryBaseline');
const script=signingPrelude(null)+fs.readFileSync(path.resolve(__dirname,'../scripts/game-retry-baseline.py'),'utf8');
function run(code){
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c','import json,sys\np=json.load(sys.stdin)\nn={"__name__":"fixture"}\nexec(p["script"],n)\nexec(p["code"],n)'],{input:JSON.stringify({script,code}),encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE_VALUE/);
}
const fixture=String.raw`
import copy,types
from unittest.mock import patch
old_id='sha256:'+'a'*64
new_id='sha256:'+'b'*64
digest='hospital-backend@sha256:'+'c'*64
image={'Id':old_id,'RepoDigests':[digest]}
spec={'Name':'hospital_stack_hospital-backend','Mode':{'Replicated':{'Replicas':1}},'Labels':{'com.docker.stack.image':'hospital-backend:old'},'UpdateConfig':{'Order':'start-first'},'TaskTemplate':{'ContainerSpec':{'Image':'hospital-backend:old','Env':['IMAGE_TAG=old','SPRING_PROFILE=prod','EXISTING=PRIVATE_VALUE'],'Secrets':[]},'RestartPolicy':{'Condition':'any'}}}
service={'ID':'service1','Version':{'Index':42},'Spec':copy.deepcopy(spec),'PreviousSpec':copy.deepcopy(spec),'UpdateStatus':{'State':'paused'}}
service['Spec']['TaskTemplate']['ContainerSpec']['Image']='hospital-backend:failed'
service['Spec']['TaskTemplate']['ContainerSpec']['Env'][0]='IMAGE_TAG=failed'
service['Spec']['Labels']['com.docker.stack.image']='hospital-backend:failed'
container={'Id':'old-container','Image':old_id,'State':{'Running':True,'Health':{'Status':'healthy'}},'Config':{'Image':'hospital-backend:old','Env':copy.deepcopy(spec['TaskTemplate']['ContainerSpec']['Env']),'Labels':{'com.docker.swarm.task.id':'oldtask','com.docker.swarm.service.id':'service1'}}}
task={'ID':'oldtask','ServiceID':'service1','Slot':1,'DesiredState':'running','Status':{'State':'running','ContainerStatus':{'ContainerID':'old-container'}},'Spec':{**copy.deepcopy(spec['TaskTemplate']),'Runtime':'container'}}
failed={'Id':'candidate','Image':new_id,'State':{'Running':True,'Health':{'Status':'starting'}},'Config':{'Image':'hospital-backend:failed'}}
def choose(**kw):
 args=dict(service=service,containers=[container,failed],tasks=[task],image=image,digest_image=image,migration_count=0)
 args.update(kw)
 return select_baseline(**args)
`;
test('paused retry selects one exact healthy task, pins its image and keeps failed observed state separate',()=>run(fixture+String.raw`
baseline,evidence=choose()
assert baseline['TaskTemplate']['ContainerSpec']['Image']==digest
assert baseline['Labels']['com.docker.stack.image']==digest
assert evidence['containerId']=='old-container' and evidence['taskId']=='oldtask'
assert evidence['imageId']==old_id and evidence['serviceVersion']==42
assert 'PRIVATE_VALUE' not in json.dumps(evidence)
assert service['Spec']['TaskTemplate']['ContainerSpec']['Image']=='hospital-backend:failed'
assert spec['TaskTemplate']['ContainerSpec']['Image']=='hospital-backend:old'
for state in ['completed','rollback_completed']:
 current={**service,'Spec':copy.deepcopy(spec),'UpdateStatus':{'State':state}}
 original,e=choose(service=current,containers=[container])
 assert original==spec and e['mode']=='current'
`));
test('paused retry rejects ambiguous, changed, unsupported and mismatched recovery evidence',()=>run(fixture+String.raw`
cases=[dict(containers=[]),dict(containers=[container,container]),dict(tasks=[]),dict(tasks=[task,task]),dict(migration_count=1),dict(image={**image,'Id':new_id}),dict(digest_image={'Id':new_id})]
for mutate in [lambda s:s['UpdateStatus'].update(State='updating'),lambda s:s.pop('PreviousSpec'),lambda s:s['Spec']['Mode']['Replicated'].update(Replicas=0),lambda s:s['Spec']['UpdateConfig'].update(Order='stop-first'),lambda s:s['Spec']['TaskTemplate']['ContainerSpec']['Env'].append('EXTRA=value')]:
 bad=copy.deepcopy(service);mutate(bad);cases.append(dict(service=bad))
for mutate in [lambda t:t.update(ServiceID='other'),lambda t:t.update(DesiredState='shutdown'),lambda t:t['Spec']['ContainerSpec'].update(Secrets=[{'SecretName':'unknown'}])]:
 bad=copy.deepcopy(task);mutate(bad);cases.append(dict(tasks=[bad]))
for mutate in [lambda c:c.update(Image=new_id),lambda c:c['Config']['Env'].append('EXISTING=conflict'),lambda c:c['Config']['Labels'].update({'com.docker.swarm.service.id':'other'})]:
 bad=copy.deepcopy(container);mutate(bad);cases.append(dict(containers=[bad,failed]))
for case in cases:
 try:choose(**case);assert False,case
 except ValueError:pass
unrelated=copy.deepcopy(failed);unrelated['Config']['Image']='hospital-backend:unrelated'
try:choose(containers=[container,unrelated]);assert False
except ValueError:pass
`));
test('current verification rejects concurrent service version, baseline identity and container changes',()=>run(fixture+String.raw`
baseline,receipt=choose()
receipt['predecessor']={'historyId':'previous'}
observed=copy.deepcopy(service)
def loader(backup,name):return receipt if name=='paused-retry-baseline.json' else [observed]
current_receipt=copy.deepcopy(receipt)
with patch.dict(verify_current.__globals__,load=loader,inspect_baseline=lambda *a:(copy.deepcopy(service),copy.deepcopy(baseline),image,copy.deepcopy(current_receipt))):
 assert verify_current('/fixture','service1')[1]==receipt
 for field,value in [('serviceVersion',43),('containerId','replacement'),('imageId',new_id),('baselineHash','changed')]:
  current_receipt[field]=value
  try:verify_current('/fixture','service1');assert False,field
  except ValueError:pass
  current_receipt=copy.deepcopy(receipt)
 changed=copy.deepcopy(service);changed['Version']['Index']=43
 with patch.dict(verify_current.__globals__,inspect_baseline=lambda *a:(changed,baseline,image,receipt)):
  try:verify_current('/fixture','service1');assert False
  except ValueError:pass
`));
test('retry submission pins approved candidate image, uses CAS and preserves all other service policy',()=>run(fixture+String.raw`
candidate={'services':{'hospital-backend':{'image':'hospital-backend:new','environment':{'IMAGE_TAG':'new','SPRING_PROFILE':'prod','EXISTING':'PRIVATE_VALUE'},'secrets':[]}},'secrets':{}}
new_image={'Id':new_id,'RepoDigests':['hospital-backend@sha256:'+'d'*64]}
desired=deployment_spec(service,candidate,new_image,None,lambda *a:[new_image])
assert desired['TaskTemplate']['ContainerSpec']['Image']=='hospital-backend:new@sha256:'+'d'*64
assert desired['TaskTemplate']['RestartPolicy']==service['Spec']['TaskTemplate']['RestartPolicy']
assert service['Spec']['TaskTemplate']['ContainerSpec']['Image']=='hospital-backend:failed'
events=[]
class Connection:
 def __init__(self,*a,**k):pass
 def request(self,method,url,body,headers):events.append((method,url,json.loads(body)))
 def getresponse(self):return types.SimpleNamespace(status=200,read=lambda:b'PRIVATE_VALUE')
 def close(self):pass
submit(service,desired,Connection)
assert events==[('POST','/services/service1/update?version=42',desired)]
class Conflict(Connection):
 def getresponse(self):return types.SimpleNamespace(status=409,read=lambda:b'PRIVATE_VALUE')
try:submit(service,desired,Conflict);assert False
except ValueError as e:assert str(e)=='service_submission_rejected'
for change in [lambda c:c['services']['hospital-backend']['environment'].update(EXTRA='x'),lambda c:c['services']['hospital-backend'].update(secrets=[{'source':'unknown','target':'unknown'}])]:
 bad=copy.deepcopy(candidate);change(bad)
 try:deployment_spec(service,bad,new_image,None,lambda *a:[new_image]);assert False
 except (ValueError,KeyError):pass
try:deployment_spec(service,candidate,{**new_image,'RepoDigests':[]},None);assert False
except ValueError:pass
`));
test('paused retry requires authentic terminal predecessor evidence and never changes history',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-retry-'));
 const file=path.join(dir,'history.json');
 const record={id:'old-release',releaseTarget:'game',status:'RECOVERY_REQUIRED',imageTag:'hospital-backend:failed',stepSummary:[{key:'backup-game-release',status:'done',logs:['game_backup_dir=/opt/1panel/backup/game-release-fixture']},{key:'pre-deploy-checklist',status:'done',logs:['checklist_database_migrations=PASS count=0']}]};
 fs.writeFileSync(file,JSON.stringify([record]));const before=fs.readFileSync(file,'utf8');
 assert.equal(retryHistoryEvidence({RELEASE_PUBLISHER_HISTORY_FILE:file}).historyId,'old-release');
 assert.equal(fs.readFileSync(file,'utf8'),before);
 for(const mutate of [r=>r.status='RUNNING',r=>r.stepSummary[1].logs=[],r=>r.stepSummary.push({key:'apply-database-migrations',status:'done'}),r=>r.stepSummary[0].logs.push(...r.stepSummary[0].logs)]){
  const copy=structuredClone(record);mutate(copy);fs.writeFileSync(file,JSON.stringify([copy]));assert.equal(retryHistoryEvidence({RELEASE_PUBLISHER_HISTORY_FILE:file}),null);
 }
 assert.throws(()=>gameRetryBaselineCommand('cleanup'));
 const command=gameRetryBaselineCommand('capture','0');
 assert.match(command,/python3 - capture/);assert.doesNotMatch(command,/docker service update|docker rm|prune/);
});
test('retry rollback selects healthy baseline rather than the failed PreviousSpec and refuses drift',()=>run(fixture+String.raw`
baseline,receipt=choose()
candidate=copy.deepcopy(service)
candidate['Version']['Index']=43
candidate['PreviousSpec']=copy.deepcopy(service['Spec'])
candidate['Spec']['TaskTemplate']['ContainerSpec']['Image']='hospital-backend:new'
submission={'specHash':fingerprint(candidate['Spec']),'imageId':new_id,'baselineHash':receipt['baselineHash']}
def reader(*a):return [{'Id':old_id if a[-1]==digest else new_id}]
restored=rollback_spec(candidate,service,receipt,submission,baseline,reader)
assert restored==baseline and restored!=candidate['PreviousSpec']
for field in ['specHash','baselineHash']:
 bad={**submission,field:'changed'}
 try:rollback_spec(candidate,service,receipt,bad,baseline,reader);assert False
 except ValueError:pass
bad=copy.deepcopy(candidate);bad['PreviousSpec']={}
try:rollback_spec(bad,service,receipt,submission,baseline,reader);assert False
except ValueError:pass
try:rollback_spec(candidate,service,receipt,submission,baseline,lambda *a:[{'Id':'wrong'}]);assert False
except ValueError:pass
`));
test('predecessor proof requires intact backup and matching failed release, not a caller assertion',()=>run(fixture+String.raw`
predecessor={'historyId':'history1','backup':'/opt/1panel/backup/game-release-fixture','migrationCount':0,'targetImage':'hospital-backend:failed'}
def loader(backup,name):return [{'Spec':spec}] if name=='service.inspect.json' else [image]
with patch.dict(predecessor_evidence.__globals__,load=loader,read=lambda *a:[image]):
 with patch('subprocess.run') as checksum:
  assert predecessor_evidence(service,predecessor)==predecessor
  assert checksum.call_args.args[0]==['sha256sum','-c','SHA256SUMS']
  for change in [None,{**predecessor,'targetImage':'hospital-backend:other'},{**predecessor,'migrationCount':1},{**predecessor,'backup':'/other/project'}]:
   try:predecessor_evidence(service,change);assert False
   except ValueError:pass
 with patch('subprocess.run',side_effect=RuntimeError('checksum failure')):
  try:predecessor_evidence(service,predecessor);assert False
  except RuntimeError:pass
bad=copy.deepcopy(spec);bad['TaskTemplate']['ContainerSpec']['Env'].append('UNKNOWN=x')
with patch.dict(predecessor_evidence.__globals__,load=lambda b,n:[{'Spec':bad}] if n=='service.inspect.json' else [image],read=lambda *a:[image]),patch('subprocess.run'):
 try:predecessor_evidence(service,predecessor);assert False
 except ValueError:pass
`));
test('retry runtime policy compares Docker-normalized defaults and rejects unrelated policy changes',()=>run(fixture+String.raw`
live=copy.deepcopy(service)
live['Spec']['Labels']['com.docker.stack.namespace']='hospital_stack'
live['Spec']['TaskTemplate']['Resources']={'MemorySwappiness':None}
live['Spec']['TaskTemplate']['Placement']={}
live['Spec']['TaskTemplate']['ContainerSpec'].update(Healthcheck={'Test':['CMD','true'],'Interval':10000000000,'Timeout':5000000000,'StartPeriod':60000000000,'Retries':3},DNSConfig={'Nameservers':['1.1.1.1']},StopGracePeriod=60000000000)
live['Spec']['EndpointSpec']={'Ports':[{'TargetPort':8090,'PublishedPort':8090,'Protocol':'tcp','PublishMode':'ingress'}]}
live['Spec']['TaskTemplate']['Networks']=[{'Target':'network1'}]
candidate={'name':'render-project','services':{'hospital-backend':{'image':'hospital-backend:new','environment':{},'command':[],'entrypoint':[],'dns':['1.1.1.1'],'stop_grace_period':'1m0s','ports':[{'target':8090,'published':'8090','protocol':'tcp','mode':'ingress'}],'healthcheck':{'test':['CMD','true'],'interval':'10s','timeout':'5s','start_period':'1m','retries':3},'deploy':{'replicas':1,'placement':{},'resources':{},'update_config':{'order':'start-first'},'restart_policy':{'condition':'any'},'rollback_config':{}},'networks':{'default':None}}},'networks':{'default':{'name':'render-project_default','ipam':{}}}}
reader=lambda *a:[{'Name':'hospital_stack_default'}]
validate_candidate_runtime(candidate,live,reader)
mutations=[lambda c:c['services']['hospital-backend'].update(privileged=True),lambda c:c['services']['hospital-backend']['deploy'].update(replicas=0),lambda c:c['services']['hospital-backend']['deploy']['resources'].update(limits={'memory':'1G'}),lambda c:c['services']['hospital-backend']['deploy']['placement'].update(constraints=['node.id==other']),lambda c:c['services']['hospital-backend']['deploy']['update_config'].update(order='stop-first'),lambda c:c['services']['hospital-backend']['deploy']['restart_policy'].update(condition='none'),lambda c:c['services']['hospital-backend']['healthcheck'].update(disable=True),lambda c:c['services']['hospital-backend']['healthcheck'].update(timeout='1s'),lambda c:c['services']['hospital-backend'].update(dns=['8.8.8.8']),lambda c:c['services']['hospital-backend'].update(stop_grace_period='1s'),lambda c:c['services']['hospital-backend'].update(command=['normal-business-start']),lambda c:c['services']['hospital-backend']['ports'][0].update(published='9999'),lambda c:c['networks']['default'].update(ipam={'driver':'other'}),lambda c:c['networks']['default'].update(name='unrelated')]
for mutate in mutations:
 bad=copy.deepcopy(candidate);mutate(bad)
 try:validate_candidate_runtime(bad,live,reader);assert False
 except ValueError:pass
try:validate_candidate_runtime(candidate,live,lambda *a:[{'Name':'unrelated'}]);assert False
except ValueError:pass
assert duration('1m0s')==duration('60s')
try:duration('1m;not-a-duration');assert False
except ValueError:pass
`));
test('Compose octal signing mode is normalized to Engine 0400 without accepting decimal or broader permissions',()=>run(fixture+String.raw`
approval={'secretName':'approved','source':'signing','target':'auth_token_signing_key','uid':'0','gid':'0','mode':256}
candidate={'services':{'hospital-backend':{'environment':{'IMAGE_TAG':'new','SPRING_PROFILE':'prod','EXISTING':'PRIVATE_VALUE','AUTH_TOKEN_SECRET_FILE':'/run/secrets/auth_token_signing_key'},'secrets':[{'source':'signing','target':'auth_token_signing_key','uid':'0','gid':'0','mode':'0400'}]}},'secrets':{'signing':{'external':True,'name':'approved'}}}
reader=lambda *a:[{'ID':'secret-id','Spec':{'Name':'approved'}}]
for mode in ['0400',256]:
 candidate['services']['hospital-backend']['secrets'][0]['mode']=mode
 result=candidate_signing_container(candidate,spec['TaskTemplate']['ContainerSpec'],approval,reader)
 assert result['Secrets'][0]['File']=={'Name':'auth_token_signing_key','UID':'0','GID':'0','Mode':256}
for mode in ['400',400,'0404','0444',True,None,'0o400']:
 candidate['services']['hospital-backend']['secrets'][0]['mode']=mode
 try:candidate_signing_container(candidate,spec['TaskTemplate']['ContainerSpec'],approval,reader);assert False
 except ValueError:pass
`));
