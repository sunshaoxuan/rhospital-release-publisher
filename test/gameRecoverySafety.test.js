const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {resolveGameStartupContract, gameStartupContractCommands} = require('../src/gameStartupContract');
const {gameRecoveryIdentityCommands} = require('../src/gameRecoveryIdentity');

const python = process.platform === 'win32' ? 'python' : 'python3';
function runPython(script, code, fixture = {}) {
  return spawnSync(python, ['-c', 'import json,sys\npayload=json.load(sys.stdin)\nns={"__name__":"fixture"}\nexec(payload["script"],ns)\nexec(payload["code"],ns)'],
    {input: JSON.stringify({script, code, fixture}), encoding:'utf8', windowsHide:true, timeout:20000});
}

test('service recovery binds mutable PreviousSpec to backup digest and rejects drift independently', () => {
  const script=fs.readFileSync(require.resolve('../scripts/game-service-recovery.py'),'utf8');
  const result=runPython(script,String.raw`
import copy, types
image_id='sha256:'+'a'*64
digest='hospital-backend@sha256:'+'b'*64
spec={'Mode':{'Replicated':{'Replicas':1}},'TaskTemplate':{'ContainerSpec':{'Image':'hospital-backend:old','Env':['IMAGE_TAG=old','AUTH_TOKEN_SECRET=DO_NOT_PRINT'],'Secrets':[{'SecretName':'existing'}]}}}
snapshot={'Spec':spec}
live={'ID':'service1','Version':{'Index':42},'Spec':{'failed':'candidate'},'PreviousSpec':copy.deepcopy(spec),'UpdateStatus':{'State':'paused'}}
image={'Id':image_id,'RepoDigests':[digest]}
healthy=[{'Id':'old1','Image':image_id,'State':{'Health':{'Status':'healthy'}}}]
def plan(**overrides):
 args=dict(snapshot=snapshot,live=live,snapshot_image=image,resolved_image=image,digest_image=image,healthy=healthy,migration_count=0)
 args.update(overrides)
 return make_plan(**args)
p=plan()
assert p['image']==digest
assert 'DO_NOT_PRINT' not in json.dumps(p)
restored=restore_spec(snapshot,p)
expected=copy.deepcopy(spec);expected['TaskTemplate']['ContainerSpec']['Image']=digest
assert restored==expected
assert snapshot['Spec']==spec
verified_live={'Spec':restored,'UpdateStatus':{'State':'completed'}}
assert verify_service(snapshot,verified_live,image,healthy)['image']==digest
for verification in [(snapshot,live,image,healthy),(snapshot,verified_live,image,[]),(snapshot,verified_live,image,healthy+healthy)]:
 try: verify_service(*verification);assert False
 except ValueError: pass
for overrides in [dict(resolved_image={'Id':'sha256:'+'c'*64,'RepoDigests':[digest]}),dict(digest_image={'Id':'sha256:'+'c'*64}),dict(snapshot_image={'Id':image_id,'RepoDigests':[]}),dict(migration_count=1),dict(healthy=[]),dict(healthy=healthy+healthy),dict(live={**live,'PreviousSpec':{}}),dict(live={**live,'UpdateStatus':{'State':'rollback_started'}})]:
 try: plan(**overrides);assert False,overrides
 except ValueError: pass
events=[]
class Connection:
 def __init__(self,*args,**kwargs): pass
 def request(self,method,path,body,headers): events.append((method,path,json.loads(body)))
 def getresponse(self): return types.SimpleNamespace(status=200,read=lambda:b'')
 def close(self): pass
for expected_hash,version in [('0'*64,42),(p['planHash'],41)]:
 try: apply_plan(snapshot,p,expected_hash,version,Connection);assert False
 except ValueError: pass
assert events==[]
apply_plan(snapshot,p,p['planHash'],42,Connection)
assert events==[('POST','/services/service1/update?version=42',restored)]
class Conflict(Connection):
 def getresponse(self): return types.SimpleNamespace(status=409,read=lambda:b'credential-not-for-output')
try: apply_plan(snapshot,p,p['planHash'],42,Conflict);assert False
except ValueError as error: assert str(error)=='service_recovery_rejected_status_409'
print('recovery_fixture=PASS')
`);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/recovery_fixture=PASS/);
  assert.doesNotMatch(result.stdout+result.stderr,/DO_NOT_PRINT|credential-not-for-output/);
});

test('streaming preflight exposes progress before completion and retains exact protocols',async()=>{
  const {runChecksStreaming}=await import('../scripts/run-game-release-preflight.mjs');
  const check={key:'verify-game-medical-contest-entry',command:'node --test src/test/js/medicalContestEntry.test.mjs',timeoutSeconds:120};
  let text='',during=false;
  const result=await runChecksStreaming([check],{write:chunk=>text+=chunk,run:async(_check,write)=>{
    write('feature_stage=testing\n');
    during=text.includes('feature_stage=testing')&&!text.includes('preflight_check=PASS');
    const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
    write(output);return {status:0,signal:null,error:'',output};
  }});
  assert.equal(during,true);assert.equal(result.passed,true);
  assert.match(text,/game_release_preflight=PASS checks=1/);
  const failed=await runChecksStreaming([check],{write:()=>{},run:async()=>({status:0,output:'partial'})});
  assert.equal(failed.passed,false);
  for(const checks of [[check,check],[{...check,key:'unknown'}],[{...check,command:check.command+' src/test/js/steamLogin.test.cjs'}]]) {
    await assert.rejects(()=>runChecksStreaming(checks,{write:()=>{},run:async()=>{throw new Error('must not execute')}}));
  }
});

test('failure diagnostics provide safe causes and a separate service recovery action',()=>{
  const {buildReleaseDiagnostics}=require('../src/releaseDiagnostics');
  const result=buildReleaseDiagnostics({status:'ERROR',stepSummary:[{key:'validate-game-startup-contract',status:'failed',logs:['game_startup_contract=FAIL key=AUTH_TOKEN_SECRET reason=missing_or_duplicate source=service_environment']} ]});
  assert.equal(result.rootCause.code,'LOGIN_CONFIGURATION');
  assert.match(result.nextAction,/既有有效/);
  const recovery=buildReleaseDiagnostics({status:'RECOVERY_REQUIRED',stepSummary:[{key:'game-rollback-command',status:'failed',logs:['ERROR: rollback requires an immutable compatible image']}]});
  assert.match(recovery.nextAction,/game-service-recovery.mjs/);
  assert.match(recovery.nextAction,/不要重放数据库恢复/);
});

test('recovery eligibility accepts only terminal zero-migration publisher evidence',async()=>{
  const {historyEvidence}=await import('../scripts/game-service-recovery.mjs');
  const record={id:'history1',status:'RECOVERY_REQUIRED',releaseTarget:'game',imageTag:'hospital-backend:new',stepSummary:[
    {key:'pre-deploy-checklist',status:'done',logs:['checklist_database_migrations=PASS count=0']},
    {key:'backup-game-release',status:'done',logs:['game_backup_dir=/opt/1panel/backup/game-release-fixture']}
  ]};
  assert.equal(historyEvidence(record).migrationCount,0);
  for(const mutate of [r=>r.status='RUNNING',r=>r.releaseTarget='forum',r=>r.stepSummary[0].logs=[],r=>r.stepSummary.push({key:'apply-database-migrations',status:'done'}),r=>r.stepSummary[1].logs.push(...r.stepSummary[1].logs)]){
    const copy=structuredClone(record);mutate(copy);assert.throws(()=>historyEvidence(copy));
  }
  assert.throws(()=>gameRecoveryIdentityCommands(-1));
});
