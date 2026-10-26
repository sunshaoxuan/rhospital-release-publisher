const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {resolveGameStartupContract,gameStartupContractCommands}=require('../src/gameStartupContract');
const {SIGNING_BINDING_SCRIPT}=require('../src/gameSigningBinding');

test('candidate capability is source bound and unknown signing contracts fail closed',()=>{
  const declaration='auth.token.secret=${AUTH_TOKEN_SECRET:}';
  const checker='--check-login-signing-key';
  const contract=resolveGameStartupContract(declaration,'TokenService',checker);
  assert.equal(contract.version,2);
  assert.notEqual(contract.sourceHash,resolveGameStartupContract(declaration,'changed',checker).sourceHash);
  assert.throws(()=>resolveGameStartupContract(declaration,'TokenService','old main'),/lacks --check/);
  assert.equal(resolveGameStartupContract('unrelated=x','old implementation'),null);
  assert.throws(()=>gameStartupContractCommands({...contract,checker:'--unknown'}));
  const command=gameStartupContractCommands(contract).join('\n');
  assert.doesNotMatch(command,/AUTH_TOKEN_SECRET=/);
  assert.match(command,/\$target_image/);
});

test('candidate checker preserves bindings and checks exit, identity, concurrency and owned cleanup',()=>{
  const script=SIGNING_BINDING_SCRIPT+fs.readFileSync(require.resolve('../scripts/check-game-startup.py'),'utf8');
  const code=String.raw`
from unittest.mock import patch
image_id='sha256:'+'a'*64
live={'Version':{'Index':42},'Spec':{'TaskTemplate':{'ContainerSpec':{'Image':'hospital-backend:old','Env':['SPRING_PROFILE=prod','IMAGE_TAG=old'],'Secrets':[],'Mounts':[{'Target':'/data','ReadOnly':False}]},'Networks':[{'Target':'production'}]}}}
approval={'secretName':'fixture-signing-v1','source':'signing','target':'auth.token.secret','uid':'0','gid':'0','mode':256}
candidate={'services':{'hospital-backend':{'image':'hospital-backend:new','environment':{'SPRING_PROFILE':'prod','IMAGE_TAG':'new','AUTH_TOKEN_SECRET_FILE':'/run/secrets/auth.token.secret'},'secrets':[{'source':'signing','target':'auth.token.secret','mode':256}]}},'secrets':{'signing':{'external':True,'name':'fixture-signing-v1'}}}
def exercise(mode):
 events=[];created={};reads=0
 def read(*args):
  nonlocal reads
  events.append(('read',args))
  if args[:2]==('service','inspect'):
   reads+=1
   return [{**live,'Version':{'Index':43}}] if mode=='drift' and reads>1 else [live]
  if args[:2]==('image','inspect'): return [{'Id':image_id}]
  if args[:2]==('secret','inspect'): return [{'ID':'secret1','Spec':{'Name':'fixture-signing-v1'}}]
  if args[0]=='inspect': return [{'Image':image_id if mode!='image_drift' else 'sha256:'+'b'*64}]
  raise AssertionError(args)
 def call(method,path,body=None):
  events.append((method,path))
  if method=='POST': created.update(body);return {'ID':'job1'}
  if path.startswith('/tasks'):
   return [{'Status':{'State':'failed' if mode=='invalid_key' else 'complete','ContainerStatus':{'ExitCode':1 if mode=='invalid_key' else 0,'ContainerID':'container1'}}}]
  if method=='GET':
   owned={'ID':'job1','Spec':created.copy()}
   if mode=='foreign_cleanup': owned['Spec']['Labels']={'publisher.login-check':'other'}
   return owned
  if method=='DELETE': return None
  raise AssertionError((method,path))
 with patch('subprocess.check_output',return_value='node1'):
  try: result=run('hospital_stack_hospital-backend','hospital-backend:new',call,read,lambda _:None,nonce='fixture',candidate=candidate,approval=approval)
  except ValueError as error: result=str(error)
 spec=created['TaskTemplate']['ContainerSpec']
 assert spec['Secrets']==[{'SecretID':'secret1','SecretName':'fixture-signing-v1','File':{'Name':'auth.token.secret','UID':'0','GID':'0','Mode':256}}]
 assert 'AUTH_TOKEN_SECRET_FILE=/run/secrets/auth.token.secret' in spec['Env']
 assert 'IMAGE_TAG=new' in spec['Env']
 assert live['Spec']['TaskTemplate']['ContainerSpec']['Secrets']==[]
 assert '--check-login-signing-key' in spec['Args'][0]
 assert spec['Mounts'][0]['ReadOnly'] is True
 assert created['TaskTemplate']['Networks']==[]
 assert created['TaskTemplate']['RestartPolicy']=={'Condition':'none'}
 assert (('DELETE','/services/job1') in events)==(mode!='foreign_cleanup')
 return result
assert exercise('success')['result']=='PASS'
assert exercise('invalid_key')=='candidate_signing_checker_failed'
assert exercise('drift')=='configuration_changed_during_validation'
assert exercise('image_drift')=='candidate_image_changed'
assert exercise('foreign_cleanup')=='validation_cleanup_ownership_mismatch'
assert exercise('success')['signingSecret']=={'name':'fixture-signing-v1','id':'secret1'}
for mutate in [lambda c:c['services']['hospital-backend']['environment'].update({'UNRELATED':'drift'}),lambda c:c['services']['hospital-backend']['secrets'].append({'source':'unknown','target':'unknown'}),lambda c:c['services']['hospital-backend']['secrets'].append(c['services']['hospital-backend']['secrets'][0]),lambda c:c['services']['hospital-backend']['environment'].update({'AUTH_TOKEN_SECRET_FILE':'/run/secrets/wrong'}),lambda c:c['secrets']['signing'].update({'name':'not-approved'}),lambda c:c['services']['hospital-backend']['secrets'][0].update({'mode':511})]:
 changed=copy.deepcopy(candidate);mutate(changed)
 try: candidate_signing_container(changed,live['Spec']['TaskTemplate']['ContainerSpec'],approval,lambda *args:[]);assert False
 except (ValueError,IndexError): pass
try: candidate_signing_container(candidate,live['Spec']['TaskTemplate']['ContainerSpec'],None,lambda *args:[]);assert False
except ValueError as error: assert str(error)=='signing_reference_not_approved'
receipt={'result':'PASS','imageId':image_id,'serviceVersion':42,'specHash':spec_hash(live['Spec']),'candidateHash':spec_hash(candidate),'sourceHash':'source-policy'}
verify_receipt(receipt,live,image_id,'source-policy',candidate)
for key in ('result','imageId','serviceVersion','specHash','candidateHash','sourceHash'):
 changed={**receipt,key:'drift'}
 try: verify_receipt(changed,live,image_id,'source-policy',candidate);assert False
 except ValueError: pass
bound={**receipt,'signingSecret':{'name':'fixture-signing-v1','id':'secret1'}}
verify_receipt(bound,live,image_id,'source-policy',candidate,'secret1')
try: verify_receipt(bound,live,image_id,'source-policy',candidate,'recreated-same-name-id');assert False
except ValueError as error: assert str(error)=='approved_signing_secret_identity_changed'
print('candidate_checker_fixture=PASS')
`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c','import json,sys\np=json.load(sys.stdin)\nns={"__name__":"fixture"}\nexec(p["script"],ns)\nexec(p["code"],ns)'],{input:JSON.stringify({script,code}),encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/candidate_checker_fixture=PASS/);
  assert.doesNotMatch(result.stdout+result.stderr,/AUTH_TOKEN_SECRET_FILE=|\/run\/secrets/);
});
