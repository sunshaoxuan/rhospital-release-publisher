const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {GAME_PRODUCTION_SECRET_MAPPINGS, gameRuntimeSecretCommands} = require('../src/gameRuntimeSecrets');

function fixture(signed=true) {
  const approval = signed ? {source:'login_signing_key',secretName:'fixture_signing',target:'auth_token_signing_key',uid:'0',gid:'0',mode:256} : null;
  const secrets = GAME_PRODUCTION_SECRET_MAPPINGS.map(([SecretName, Name]) => ({SecretName,SecretID:'id-'+SecretName,File:{Name,UID:'0',GID:'0',Mode:292}}));
  if (approval) secrets.push({SecretName:approval.secretName,SecretID:'id-'+approval.secretName,File:{Name:approval.target,UID:'0',GID:'0',Mode:256}});
  return {container:{Secrets:secrets,Env:signed?['AUTH_TOKEN_SECRET_FILE=/run/secrets/auth_token_signing_key']:[]},
    config:{mappings:GAME_PRODUCTION_SECRET_MAPPINGS,approval,bindingHash:'bound-source'},
    receipt:{result:'PASS',sourceHash:'bound-source',imageId:'sha256:fixture',signingSecret:{id:'id-fixture_signing',name:'fixture_signing'}}, imageId:'sha256:fixture'};
}
function run(value) {
  const source=fs.readFileSync(require.resolve('../scripts/check-game-runtime-secrets.py'),'utf8');
  const harness=source.replace("if __name__ == '__main__':", "if False:")+'\nf=json.load(sys.stdin)\nvalidate(f["container"],f["config"],lambda name:"id-"+name,f.get("receipt"),f["imageId"])\nprint("PASS")\n';
  return spawnSync(process.platform==='win32'?'python':'python3',['-c',harness],{input:JSON.stringify(value),encoding:'utf8',windowsHide:true,timeout:30000});
}
test('runtime contract accepts exact legacy fourteen and approved signed fifteen',()=>{
  for(const signed of [false,true]) {const result=run(fixture(signed));assert.equal(result.status,0,result.stderr);}
});
test('runtime contract rejects missing extra duplicate wrong reference identity and permissions',()=>{
  const cases={
    missing:f=>f.container.Secrets.pop(), extra:f=>f.container.Secrets.push({...f.container.Secrets[0],SecretName:'unknown'}),
    duplicate:f=>f.container.Secrets[1]=structuredClone(f.container.Secrets[0]),
    reference:f=>f.container.Secrets[0].SecretName='unknown', identity:f=>f.container.Secrets[0].SecretID='wrong',
    target:f=>f.container.Secrets[0].File.Name='wrong', baseMode:f=>f.container.Secrets[0].File.Mode=256,
    signingMode:f=>f.container.Secrets.at(-1).File.Mode=292, uid:f=>f.container.Secrets[0].File.UID='1',
    gid:f=>f.container.Secrets.at(-1).File.GID='1', stringMode:f=>f.container.Secrets.at(-1).File.Mode='0400',
    unknown:f=>f.container.Secrets[0].Runtime={Target:'wrong'}, conflict:f=>f.container.Env.push('AUTH_TOKEN_SECRET=do-not-print'),
    duplicateEnv:f=>f.container.Env.push(f.container.Env[0]), missingFile:f=>f.container.Env=[],
    unapproved:f=>f.config.approval=null, staleSource:f=>f.receipt.sourceHash='stale',
    staleImage:f=>f.receipt.imageId='old', staleSecret:f=>f.receipt.signingSecret.id='wrong', missingReceipt:f=>f.receipt=null
  };
  for(const [name,change] of Object.entries(cases)){const f=fixture();change(f);const result=run(f);assert.notEqual(result.status,0,name);assert.ok(!result.stdout.includes('do-not-print'),name);}
});
test('generated runtime check binds startup evidence and permits only inspect operations',()=>{
  const f=fixture(); const commands=gameRuntimeSecretCommands({version:2,checker:'--check-login-signing-key',sourceHash:'a'.repeat(64)},f.config.approval);
  assert.equal(commands.length,1);
  const code=Buffer.from(commands[0].match(/printf %s "([^"]+)"/)[1],'base64').toString();
  assert.match(code,/candidate_startup_receipt_mismatch/);assert.match(code,/concurrent_service_change/);
  assert.doesNotMatch(code,/service.+(?:create|update|rm)|check_output\(\['docker',\s*'exec'/);
});

test('runtime inspection integrates service task container receipt and concurrent version guards',()=>{
  const source=fs.readFileSync(require.resolve('../scripts/check-game-runtime-secrets.py'),'utf8');
  const runMain=mutation=>{
    const f=fixture();
    const spec={...f.container,Image:'hospital-backend:fixture@sha256:fixture'};
    const service={Version:{Index:10},Spec:{TaskTemplate:{ContainerSpec:spec}}};
    const runtime={Image:f.imageId,State:{Running:true,Health:{Status:'healthy'}},Config:{Image:spec.Image,Labels:{'com.docker.swarm.task.id':'task'}}};
    spec.Env.push('IMAGE_TAG=fixture');
    const task={Spec:{ContainerSpec:structuredClone(spec)}};
    const input={...f,service,runtime,task,concurrent:false};mutation?.(input);
    const harness='import io,json,subprocess,sys\nfrom unittest.mock import patch\nf=json.load(sys.stdin)\nCONFIG=json.dumps(f["config"])\n'+source.replace("if __name__ == '__main__':",'if False:')+String.raw`
calls=0
def read(args,**kw):
    global calls
    assert args[0]=='docker'
    if args[1:3]==['service','inspect']:
        calls+=1
        result=json.loads(json.dumps(f['service']))
        if calls>1 and f['concurrent']:result['Version']['Index']+=1
        return json.dumps([result]).encode()
    if args[1:3]==['secret','inspect']:
        return json.dumps([{'ID':'id-'+args[3],'Spec':{'Name':args[3]}}]).encode()
    assert args[1]=='inspect'
    return json.dumps([f['task'] if args[2]=='task' else f['runtime']]).encode()
sys.argv=['check','service','container']
with patch('subprocess.check_output',side_effect=read),patch('builtins.open',return_value=io.StringIO(json.dumps(f['receipt']))):
    main()
`;
    return spawnSync(process.platform==='win32'?'python':'python3',['-c',harness],{input:JSON.stringify(input),encoding:'utf8',timeout:30000,windowsHide:true});
  };
  // The receipt lookup is scoped by IMAGE_TAG; fixtures deliberately include it.
  const good=runMain();
  assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/game_runtime_secret_contract=PASS/);
  for(const mutation of [f=>f.concurrent=true,f=>f.task.Spec.ContainerSpec.Secrets.pop(),f=>f.task.Spec.ContainerSpec.Env.pop(),f=>f.runtime.State.Health.Status='unhealthy',f=>f.runtime.Config.Image='other']){
    const result=runMain(mutation);
    assert.notEqual(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/=PASS/);
  }
});
