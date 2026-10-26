"""Run the candidate's fail-fast signing checker with approved Compose bindings.

The publisher never reads key files. This is a short-lived validation job without
overlay networks or published ports;
validation job; it never updates the application service. Tests mock all I/O.
"""
import copy
import http.client
import json
import hashlib
import os
import re
import socket
import subprocess
import sys
import time
import uuid


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def request(method, path, body=None):
    connection = DockerConnection('localhost', timeout=20)
    connection.request(method, path, None if body is None else json.dumps(body).encode(), {'Content-Type':'application/json'})
    response = connection.getresponse()
    raw = response.read()
    connection.close()
    if response.status not in (200, 201, 204):
        raise ValueError('docker_validation_request_failed')
    return json.loads(raw) if raw else None


def inspect(*arguments):
    return json.loads(subprocess.check_output(['docker', *arguments], timeout=15))


def spec_hash(spec):
    return hashlib.sha256(json.dumps(spec,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def verify_receipt(result,live,image_id,source_hash,candidate,signing_secret_id=None):
    if result.get('sourceHash')!=source_hash or result.get('candidateHash')!=spec_hash(candidate) or result.get('result')!='PASS' or result.get('imageId')!=image_id or result.get('specHash')!=spec_hash(live['Spec']) or result.get('serviceVersion')!=live['Version']['Index']:
        raise ValueError('startup_validation_identity_changed')
    if result.get('signingSecret') and result['signingSecret'].get('id')!=signing_secret_id:
        raise ValueError('approved_signing_secret_identity_changed')


def job_spec(live, image, node, nonce):
    task = copy.deepcopy(live['Spec']['TaskTemplate'])
    container = task['ContainerSpec']
    if container.get('Command') or container.get('Args'):
        raise ValueError('startup_override_not_supported')
    # The candidate JAR receives the same production profile and JVM options.
    container['Image'] = image
    container['Command'] = ['/bin/sh','-ec']
    container['Args'] = ['exec java $JAVA_OPTS $JAVA_EXTRA_OPTS -Dspring.profiles.active="$SPRING_PROFILE" -jar /app/app.jar --check-login-signing-key']
    container['Healthcheck'] = {'Test':['NONE']}
    task['RestartPolicy'] = {'Condition':'none'}
    task['Placement'] = {'Constraints':['node.id==' + node]}
    task['Networks'] = []
    # No published ports, service discovery, database restore or writable data bind.
    for mount in container.get('Mounts', []):
        mount['ReadOnly'] = True
    task.pop('ForceUpdate', None)
    return {'Name':'publisher-login-check-' + nonce, 'Labels':{'publisher.login-check':nonce},
            'TaskTemplate':task, 'Mode':{'ReplicatedJob':{'MaxConcurrent':1,'TotalCompletions':1}}}


def run(service, target_image, call=request, read=inspect, sleep=time.sleep, now=time.monotonic, nonce=None, candidate=None, approval=None):
    nonce = nonce or uuid.uuid4().hex
    live = read('service','inspect',service)[0]
    version = live['Version']['Index']
    image_id = read('image','inspect',target_image)[0]['Id']
    if not re.fullmatch('sha256:[a-f0-9]{64}',image_id):
        raise ValueError('candidate_identity_unavailable')
    node = subprocess.check_output(['docker','info','--format','{{.Swarm.NodeID}}'], text=True, timeout=15).strip()
    if not re.fullmatch('[a-z0-9]{1,64}',node):
        raise ValueError('validation_node_unavailable')
    if candidate is None:
        raise ValueError('candidate_compose_evidence_required')
    checked_live=copy.deepcopy(live)
    checked_live['Spec']['TaskTemplate']['ContainerSpec']=candidate_signing_container(candidate,live['Spec']['TaskTemplate']['ContainerSpec'],approval,read)
    if candidate['services']['hospital-backend'].get('image')!=target_image:
        raise ValueError('candidate_compose_image_mismatch')
    spec = job_spec(checked_live,target_image,node,nonce)
    job_id = None
    outcome = 'checker_timeout'
    try:
        created = call('POST','/services/create',spec)
        job_id = created['ID']
        deadline = now()+90
        while now()<deadline:
            # IDs are Docker generated alphanumerics, never shell arguments.
            if not re.fullmatch('[a-z0-9]+',job_id):
                raise ValueError('validation_job_identity_invalid')
            tasks = call('GET','/tasks?filters=' + '%7B%22service%22%3A%5B%22' + job_id + '%22%5D%7D')
            if len(tasks)>1:
                raise ValueError('validation_job_task_count')
            if tasks:
                status = tasks[0]['Status']
                state = status['State']
                if state in ('complete','failed','rejected','shutdown'):
                    exit_code = status.get('ContainerStatus',{}).get('ExitCode')
                    if state!='complete' or exit_code!=0:
                        outcome='candidate_signing_checker_failed'
                        raise ValueError(outcome)
                    container_id=status.get('ContainerStatus',{}).get('ContainerID')
                    checked=read('inspect',container_id)[0]
                    if checked.get('Image')!=image_id or read('image','inspect',target_image)[0]['Id']!=image_id:
                        raise ValueError('candidate_image_changed')
                    current=read('service','inspect',service)[0]
                    if current['Version']['Index']!=version or current['Spec']!=live['Spec']:
                        raise ValueError('configuration_changed_during_validation')
                    outcome='PASS'
                    signing = next(({'name':entry['SecretName'],'id':entry['SecretID']} for entry in checked_live['Spec']['TaskTemplate']['ContainerSpec'].get('Secrets',[]) if approval and entry['SecretName']==approval['secretName']),None)
                    return {'result':'PASS','imageId':image_id,'serviceVersion':version,'specHash':spec_hash(live['Spec']),'candidateHash':spec_hash(candidate),'signingSecret':signing}
            sleep(1)
        raise ValueError(outcome)
    finally:
        # An uncertain create is resolved by the unique owned name; never retry
        # creation or delete a service that lacks this invocation's exact label.
        owned=call('GET','/services/'+(job_id or spec['Name']))
        if owned['Spec']['Name']!=spec['Name'] or owned['Spec'].get('Labels',{}).get('publisher.login-check')!=nonce:
            raise ValueError('validation_cleanup_ownership_mismatch')
        call('DELETE','/services/'+owned['ID'])


if __name__=='__main__':
    try:
        if len(sys.argv) not in (5,6) or sys.argv[1]!='hospital_stack_hospital-backend' or not re.fullmatch('hospital-backend:[A-Za-z0-9_.-]+',sys.argv[2]) or not re.fullmatch('[a-f0-9]{64}',sys.argv[3]) or (len(sys.argv)==6 and sys.argv[5]!='--verify'):
            raise ValueError('invalid_startup_check_target')
        with open(sys.argv[4],encoding='utf-8') as source:
            candidate=json.load(source)
        receipt='.publisher-startup-check-'+sys.argv[2].split(':')[1]+'.json'
        if len(sys.argv)==6:
            with open(receipt,encoding='utf-8') as source:
                result=json.load(source)
            live=inspect('service','inspect',sys.argv[1])[0]
            secret_id=None
            if result.get('signingSecret'):
                if not APPROVED_SIGNING or result['signingSecret'].get('name')!=APPROVED_SIGNING['secretName']:
                    raise ValueError('signing_reference_not_approved')
                secret_id=inspect('secret','inspect',APPROVED_SIGNING['secretName'])[0]['ID']
            verify_receipt(result,live,inspect('image','inspect',sys.argv[2])[0]['Id'],sys.argv[3],candidate,secret_id)
        else:
            result=run(sys.argv[1],sys.argv[2],candidate=candidate,approval=APPROVED_SIGNING)
            result['sourceHash']=sys.argv[3]
            temporary=receipt+'.'+uuid.uuid4().hex
            with open(temporary,'x',encoding='utf-8') as target:
                os.chmod(temporary,0o600)
                json.dump(result,target,sort_keys=True)
            os.replace(temporary,receipt)
        print('game_startup_contract=PASS checker=check-login-signing-key image='+result['imageId'])
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch('[a-z_]+',str(error)) else 'validation_evidence_unavailable'
        print('game_startup_contract=FAIL reason='+code+' action=verify_existing_signing_configuration_no_key_rotation')
        sys.exit(1)
