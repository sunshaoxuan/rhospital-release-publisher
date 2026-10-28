const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {transactionOutcome,transactionCommand,lockCommands,transactionSource}=require('../src/gameDeploymentTransaction');
const script=transactionSource();
function run(code){
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c','import json,sys\np=json.load(sys.stdin)\nn={"__name__":"fixture"}\nexec(p["script"],n)\nexec(p["code"],n)'],{input:JSON.stringify({script,code}),encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
}
const fixture=String.raw`
import copy, shutil
from unittest.mock import patch
work=Path(tempfile.mkdtemp(prefix='publisher-transaction-'))
root,backup=work/'root',work/'backup'
root.mkdir();backup.mkdir()
original=b'old compose\n';candidate=b'candidate compose\n'
for directory in [root,backup]:
    (directory/'docker-compose.yml').write_bytes(original)
    (directory/'.env').write_bytes(b'')
(backup/'game-service-recovery.json').write_text(json.dumps({'imageId':'sha256:old'}))
candidate_file=work/'candidate.yml';candidate_file.write_bytes(candidate)
state={'version':42,'spec':{'image':'old'}}
(backup/'service.inspect.json').write_text(json.dumps([{'Version':{'Index':42},'Spec':state['spec']}]))
container={'id':'healthy-old','imageId':'sha256:old','running':True,'health':'healthy'}
calls=[]
def fake_docker(*args):
    calls.append(args)
    if args[:2]==('compose','-f'):return json.dumps({'services':{'hospital-backend':{'image':'hospital-backend:old'}}})
    if args[:2]==('image','inspect'):return 'sha256:old'
    if args[:2]==('service','inspect'):
        return json.dumps(state) if args[-1]=='hospital_stack_hospital-backend' else '1'
    if args[0]=='ps':return 'healthy-old'
    if args[0]=='inspect':return json.dumps(container) if 'imageId' in args[2] else 'healthy'
    raise AssertionError('mutation or unknown command: '+str(args))
docker=fake_docker
t=Transaction(root,backup,'hospital_stack_hospital-backend','12345678-1234-1234-1234-123456789abc','hospital-backend:new')
def reject(fn,expected):
    try:fn();raise AssertionError('expected rejection '+expected)
    except Rejected as error:assert str(error)==expected,str(error)
`;
test('Compose-only compensation restores exact original, preserves env and reentry is idempotent',()=>run(fixture+String.raw`
try:
    assert t.prepare(candidate_file)=='CONFIG_WRITTEN'
    assert (root/'docker-compose.yml').read_bytes()==candidate
    assert t.prepare(candidate_file)=='CONFIG_WRITTEN'
    assert t.compensate()=='NOT_SUBMITTED_RESTORED'
    assert (root/'docker-compose.yml').read_bytes()==original
    inode=(root/'docker-compose.yml').stat().st_ino
    assert t.compensate()=='NOT_SUBMITTED_RESTORED'
    assert (root/'docker-compose.yml').stat().st_ino==inode
    assert (root/'.env').read_bytes()==b''
    assert all(args[0] in ['compose','image','service','ps','inspect'] for args in calls)
    assert not any('update' in args or 'rollback' in args or 'exec' in args for args in calls)
finally:shutil.rmtree(work)
`));
test('durable submission intent makes failed or lost Docker output attempted, never unsubmitted',()=>run(fixture+String.raw`
try:
    t.prepare(candidate_file)
    with patch.object(Path,'read_text',return_value='MemAvailable: 2097152 kB\n'):
        assert t.attempt()=='ATTEMPTED'
    reject(t.compensate,'submission_not_observed')
    state['version']=43
    reject(t.compensate,'submission_not_observed')
    state['spec']={'TaskTemplate':{'ContainerSpec':{'Image':'hospital-backend:new'}}}
    assert t.compensate()=='ATTEMPTED'
    assert (root/'docker-compose.yml').read_bytes()==candidate
finally:shutil.rmtree(work)
`));
test('late memory rejection permits only fenced Compose compensation',()=>run(fixture+String.raw`
try:
    t.prepare(candidate_file)
    with patch.object(Path,'read_text',return_value='MemAvailable: 1976780 kB\n'):
        reject(t.attempt,'memory_headroom_changed_before_cutover')
    assert t.load()['phase']=='CONFIG_WRITTEN'
    assert t.compensate()=='NOT_SUBMITTED_RESTORED'
finally:shutil.rmtree(work)
`));
test('concurrent service, container, config, env or backup drift forbids compensation',()=>run(fixture+String.raw`
try:
    t.prepare(candidate_file)
    for target,change,reason in [
        (state,{'version':43},'concurrent_service_change'),
        (state,{'spec':{'image':'different'}},'concurrent_service_change'),
        (container,{'id':'replacement'},'baseline_container_changed'),
        (container,{'health':'unhealthy'},'baseline_container_changed_or_unhealthy')]:
        before=copy.deepcopy(target);target.update(change)
        reject(t.compensate,reason);target.clear();target.update(before)
        assert (root/'docker-compose.yml').read_bytes()==candidate
    for file,reason in [(root/'docker-compose.yml','concurrent_configuration_change'),(root/'.env','concurrent_environment_change'),(backup/'docker-compose.yml','backup_changed')]:
        before=file.read_bytes();file.write_bytes(b'concurrent')
        reject(t.compensate,reason);file.write_bytes(before)
    assert t.compensate()=='NOT_SUBMITTED_RESTORED'
finally:shutil.rmtree(work)
`));
test('missing/corrupt receipt, persistence failure and advanced phase never authorize success',()=>run(fixture+String.raw`
try:
    try:t.compensate();assert False
    except FileNotFoundError:pass
    t.prepare(candidate_file)
    with patch.dict(globals(),{'atomic_write':lambda *args:(_ for _ in ()).throw(OSError('fixture write denied'))}):
        try:t.compensate();assert False
        except OSError:pass
    assert (root/'docker-compose.yml').read_bytes()==candidate
    r=t.load();r['phase']='UNKNOWN';t.save(r)
    reject(t.compensate,'submission_outcome_unknown')
    r['transaction']='different';t.save(r)
    reject(t.compensate,'transaction_binding_changed')
finally:shutil.rmtree(work)
`));
test('resource admission rejects low memory plus foreign marker early, but never manipulates marker',()=>run(fixture+String.raw`
try:
    marker=root/'.meelok-release-pause';marker.write_text('foreign owner')
    with patch.object(Path,'read_text',return_value='MemAvailable: 1976780 kB\n'):
        reject(lambda:resource_readiness(root),'capacity_insufficient_foreign_maintenance_marker')
    assert not calls and marker.read_text()=='foreign owner'
    with patch.object(Path,'read_text',return_value='MemAvailable: 2097152 kB\n'):
        assert resource_readiness(root)['capacity']=='already_available'
    marker.unlink()
    with patch.object(Path,'read_text',return_value='MemAvailable: 1976780 kB\n'):
        assert resource_readiness(root)['capacity']=='requires_owned_pause_and_final_recheck'
    assert all('update' not in args and 'scale' not in args for args in calls)
finally:shutil.rmtree(work)
`));
test('maintenance admission distinguishes no-check roles from monitored, bad or unknown health',()=>run(fixture+String.raw`
try:
    selected={'service':None,'health':'healthy','current':None}
    def probe(*args):
        if args[0]=='ps':selected['current']=args[-1].split('=')[-1]
        if args[0]=='inspect':
            assert args[2]==MEELOK_HEALTH_FORMAT
            return selected['health'] if selected['current']==selected['service'] else 'healthy'
        return fake_docker(*args)
    with patch.dict(globals(),{'docker':probe}), patch.object(Path,'read_text',return_value='MemAvailable: 1976780 kB\n'):
        for service in MEELOK_SERVICES:
            selected.update(service=service,health='healthy')
            assert resource_readiness(root)['maintenanceReadiness'][service]=='MONITORED_HEALTHY'
            selected['health']='none'
            if service in MEELOK_NO_HEALTHCHECK_SERVICES:
                assert resource_readiness(root)['maintenanceReadiness'][service]=='PROCESS_RUNNING_NO_HEALTHCHECK'
            else:reject(lambda:resource_readiness(root),'capacity_insufficient_safe_pause_unavailable')
            for health in ['unhealthy','starting','unknown','stopped','','null']:
                selected['health']=health
                reject(lambda:resource_readiness(root),'capacity_insufficient_safe_pause_unavailable')
    assert not any('update' in args or 'scale' in args for args in calls)
finally:shutil.rmtree(work)
`));
test('maintenance inspect errors never turn into no-check readiness or weaken the game baseline',()=>run(fixture+String.raw`
try:
    def unavailable(*args):
        if args[0]=='inspect':raise subprocess.CalledProcessError(1,['docker','inspect'])
        return fake_docker(*args)
    with patch.dict(globals(),{'docker':unavailable}), patch.object(Path,'read_text',return_value='MemAvailable: 1976780 kB\n'):
        try:resource_readiness(root);assert False
        except subprocess.CalledProcessError:pass
    for health in [None,'none','unknown','starting','unhealthy']:
        container['health']=health
        reject(lambda:healthy_identity(t.service,'sha256:old'),'baseline_container_changed_or_unhealthy')
finally:shutil.rmtree(work)
`));
test('backup Compose must resolve to the healthy recovery identity before any write',()=>run(fixture+String.raw`
try:
    (backup/'game-service-recovery.json').write_text(json.dumps({'imageId':'sha256:other'}))
    reject(lambda:t.prepare(candidate_file),'backup_compose_not_healthy_baseline')
    assert (root/'docker-compose.yml').read_bytes()==original and not t.path.exists()
finally:shutil.rmtree(work)
`));
test('prepare rejects service drift since backup and compensation refuses a missing persisted receipt',()=>run(fixture+String.raw`
try:
    state['version']=43
    reject(lambda:t.prepare(candidate_file),'service_changed_since_backup')
    assert (root/'docker-compose.yml').read_bytes()==original and not t.path.exists()
    state['version']=42;t.prepare(candidate_file);t.path.unlink()
    try:t.compensate();assert False
    except FileNotFoundError:pass
    assert (root/'docker-compose.yml').read_bytes()==candidate
finally:shutil.rmtree(work)
`));
test('submission protocol rejects missing, conflicting, wrong identity and unknown output',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  const line=state=>`game_deploy_transaction=${state} id=${id}`;
  assert.equal(transactionOutcome(line('NOT_SUBMITTED_RESTORED'),id),'NOT_SUBMITTED_RESTORED');
  assert.equal(transactionOutcome(line('ATTEMPTED')+'\n'+line('ATTEMPTED'),id),'ATTEMPTED');
  for(const output of ['',line('ATTEMPTED')+'\n'+line('NOT_SUBMITTED_RESTORED'),line('UNKNOWN'),line('ATTEMPTED')+'\ngame_deploy_transaction=UNKNOWN reason=lost',line('ATTEMPTED').replace(id,'different')])assert.equal(transactionOutcome(output,id),'UNKNOWN');
  assert.match(lockCommands().join('\n'),/flock -n 9/);
  assert.match(transactionCommand('attempt','/root','service','hospital-backend:new',id),/python3 - attempt --root/);
});
test('transaction regression binds the exact helper source under test',t=>{
  t.diagnostic('transaction_helper_sha256='+require('node:crypto').createHash('sha256').update(script).digest('hex'));
  assert.match(script,/submission_not_observed/);
});
test('all generated maintenance probes use one role-aware missing-field-safe health contract',()=>{
  const {HEALTH_FORMAT,NO_HEALTHCHECK_SERVICES,readyPattern}=require('../src/gameMaintenanceHealth');
  const {gameMeelokStatusCommands,gameMeelokReadinessCommands,gameMeelokRestoreCommands}=require('../src/gameMeelokMaintenance');
  assert.deepEqual(NO_HEALTHCHECK_SERVICES,['meelok_worker','meelok_object_storage']);
  assert.match(HEALTH_FORMAT,/index \.State "Health"/);assert.match(HEALTH_FORMAT,/index \.Config "Healthcheck"/);
  assert.doesNotMatch(HEALTH_FORMAT,/\.State\.Health|Env|Output|Log/);
  assert.ok(script.includes('MEELOK_HEALTH_FORMAT = '+JSON.stringify(HEALTH_FORMAT)));
  for(const commands of [gameMeelokStatusCommands('.'),gameMeelokReadinessCommands('.'),gameMeelokRestoreCommands('.','game','01234567-89ab-cdef-0123-456789abcdef')]){
    const text=commands.join('\n');assert.ok(text.includes(HEALTH_FORMAT));
    assert.doesNotMatch(text,/\*:none|\*:health=none/);
  }
  assert.equal(readyPattern(),'*:healthy|meelok_worker:none|meelok_object_storage:none');
});
