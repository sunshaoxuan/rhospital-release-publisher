const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {resolveGameStartupContract, gameStartupContractCommands} = require('../src/gameStartupContract');
const {gameRecoveryIdentityCommands, gameRollbackIdentityCommands} = require('../src/gameRecoveryIdentity');

const python = process.platform === 'win32' ? 'python' : 'python3';
function runPython(script, code, fixture = {}) {
  return spawnSync(python, ['-c', 'import json,sys\npayload=json.load(sys.stdin)\nns={"__name__":"fixture"}\nexec(payload["script"],ns)\nexec(payload["code"],ns)'],
    {input: JSON.stringify({script, code, fixture}), encoding:'utf8', windowsHide:true, timeout:20000});
}

test('automatic rollback consumes captured identity, pins the full baseline and rejects drift before submission', () => {
  const command = gameRollbackIdentityCommands('apply')[0];
  const script = Buffer.from(command.match(/printf %s "([A-Za-z0-9+/=]+)"/)[1], 'base64').toString();
  const result = runPython(script, String.raw`
import tempfile, io, contextlib
image_id='sha256:'+'a'*64
digest='hospital-backend@sha256:'+'b'*64
spec={'Mode':{'Replicated':{'Replicas':1}},'TaskTemplate':{'ContainerSpec':{'Image':'hospital-backend:old','Env':['IMAGE_TAG=old','SECRET=DO_NOT_PRINT'],'Secrets':[{'SecretName':'existing'}]}}}
image={'Id':image_id,'RepoDigests':[digest]}
receipt={'version':1,'baselineHash':fingerprint(spec),'imageId':image_id,'digests':[digest],'migrationCount':0}
live={'ID':'service1','Version':{'Index':42},'Spec':{'candidate':True},'PreviousSpec':copy.deepcopy(spec)}
events=[]
class Connection:
    status=200
    def __init__(self,*args,**kwargs): pass
    def request(self,method,path,body,headers): events.append((method,path,json.loads(body)))
    def getresponse(self): return self
    def read(self): return b''
    def close(self): pass
objects={('service','inspect','service1'):[live],('image','inspect','hospital-backend:old'):[image],('image','inspect',digest):[image]}
def reader(*args): return copy.deepcopy(objects[args])
read=reader
with tempfile.TemporaryDirectory() as backup:
    def save(name,value):
        with open(os.path.join(backup,name),'w') as out: json.dump(value,out)
    save('service.inspect.json',[{'Spec':spec}]);save('image.inspect.json',[image]);save('game-service-recovery.json',receipt)
    with contextlib.redirect_stdout(io.StringIO()):
        main(backup,'service1','verify',Connection)
        assert events==[]
        main(backup,'service1','apply',Connection)
        target=copy.deepcopy(spec);target['TaskTemplate']['ContainerSpec']['Image']=digest
        assert events==[('POST','/services/service1/update?version=42',target)]
        events.clear()
        live['Spec']=copy.deepcopy(target)
        main(backup,'service1','restored',Connection)
        live['Spec']=copy.deepcopy(spec)
        main(backup,'service1','current',Connection)
        for key,replacement in [('baselineHash','c'*64),('imageId','sha256:'+'c'*64),('digests',[]),('migrationCount',-1),('version',2)]:
            bad=copy.deepcopy(receipt);bad[key]=replacement;save('game-service-recovery.json',bad)
            try: main(backup,'service1','apply',Connection);assert False,key
            except ValueError: pass
            assert events==[]
        save('game-service-recovery.json',receipt)
        for key in [('image','inspect','hospital-backend:old'),('image','inspect',digest)]:
            objects[key]=[{'Id':'sha256:'+'c'*64}]
            try: main(backup,'service1','apply',Connection);assert False,key
            except ValueError: pass
            assert events==[];objects[key]=[image]
        live['PreviousSpec']={}
        try: main(backup,'service1','apply',Connection);assert False
        except ValueError: pass
        assert events==[];live['PreviousSpec']=copy.deepcopy(spec)
        Connection.status=409
        try: main(backup,'service1','apply',Connection);assert False
        except ValueError: pass
        assert len(events)==1
        # A paused retry has a distinct observed Spec and already-pinned baseline.
        events.clear();Connection.status=200
        baseline=copy.deepcopy(target)
        save('service.inspect.json',[{'Spec':baseline}])
        retry=copy.deepcopy(receipt);retry['baselineHash']=fingerprint(baseline)
        save('game-service-recovery.json',retry)
        save('paused-retry-baseline.json',{})
        save('service.observed.inspect.json',[{'Spec':spec}])
        main(backup,'service1','verify',Connection)
        assert events==[]
print('automatic_rollback_identity_fixture=PASS')
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /automatic_rollback_identity_fixture=PASS/);
  assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_PRINT/);
});

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
