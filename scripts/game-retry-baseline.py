"""Publisher-owned paused-rollout baseline. Runs only inside a user-started release.

Never starts an application to discover its identity. No secret values are logged.
The observed failed service and the healthy recovery specification stay separate.
"""
import copy
import base64
import hashlib
import http.client
import json
import os
import re
import socket
import subprocess
import sys


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read(*args):
    return json.loads(subprocess.check_output(['docker', *args], timeout=20))


def require(condition, code):
    if not condition:
        raise ValueError(code)


def task_template(value):
    value = copy.deepcopy(value)
    require(value.pop('Runtime', 'container') == 'container', 'unsupported_runtime')
    return value


def without_version(spec):
    spec = copy.deepcopy(spec)
    container = spec['TaskTemplate']['ContainerSpec']
    image = container.pop('Image', None)
    labels = spec.get('Labels', {})
    if 'com.docker.stack.image' in labels:
        require(labels.pop('com.docker.stack.image') == image, 'stack_image_label_mismatch')
    entries = container.get('Env', [])
    require(len(dict(e.split('=', 1) for e in entries)) == len(entries), 'duplicate_environment')
    container['Env'] = [e for e in entries if not e.startswith('IMAGE_TAG=')]
    return spec


def select_baseline(service, containers, tasks, image, digest_image, migration_count):
    require(service.get('Spec', {}).get('Mode') == {'Replicated': {'Replicas': 1}}, 'single_replica_required')
    state = service.get('UpdateStatus', {}).get('State', 'completed')
    require(state in ('completed', 'rollback_completed', 'paused'), 'unsupported_update_state')
    healthy = [c for c in containers if c.get('State', {}).get('Running') is True and c.get('State', {}).get('Health', {}).get('Status') == 'healthy']
    require(len(healthy) == 1, 'single_healthy_baseline_required')
    container = healthy[0]
    matching = [t for t in tasks if t.get('Status', {}).get('ContainerStatus', {}).get('ContainerID') == container['Id']]
    require(len(matching) == 1, 'healthy_task_identity_required')
    task = matching[0]
    require(task.get('ServiceID') == service['ID'] and task.get('DesiredState') == 'running' and task.get('Status', {}).get('State') == 'running' and task.get('Slot') == 1, 'healthy_task_not_running')
    require(container.get('Config', {}).get('Labels', {}).get('com.docker.swarm.task.id') == task['ID'], 'container_task_label_mismatch')
    require(container['Config']['Labels'].get('com.docker.swarm.service.id') == service['ID'], 'container_service_label_mismatch')
    baseline = copy.deepcopy(service.get('PreviousSpec') if state == 'paused' else service['Spec'])
    require(isinstance(baseline, dict), 'previous_spec_required')
    require(task_template(task['Spec']) == task_template(baseline['TaskTemplate']), 'healthy_task_configuration_mismatch')
    require(baseline.get('Mode') == {'Replicated': {'Replicas': 1}}, 'baseline_replica_mismatch')
    if state == 'paused':
        require(migration_count == 0, 'paused_retry_requires_zero_migrations')
        require(service['Spec'].get('UpdateConfig', {}).get('Order') == 'start-first', 'start_first_required')
        require(without_version(service['Spec']) == without_version(baseline), 'paused_configuration_drift')
        require(service['Spec']['TaskTemplate']['ContainerSpec']['Image'] != baseline['TaskTemplate']['ContainerSpec']['Image'], 'paused_target_not_distinct')
    else:
        require(len([c for c in containers if c.get('State', {}).get('Running')]) == 1, 'unexpected_running_container')
    reference = baseline['TaskTemplate']['ContainerSpec']['Image']
    image_id = image.get('Id', '')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id) and container.get('Image') == image_id, 'healthy_image_identity_mismatch')
    repository = reference.split('@')[0].rsplit(':', 1)[0] if ':' in reference.split('/')[-1] else reference.split('@')[0]
    digests = sorted(set(d for d in image.get('RepoDigests', []) if re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', d)))
    require(len(digests) == 1 and digest_image.get('Id') == image_id, 'immutable_image_identity_mismatch')
    for c in containers:
        if c.get('State', {}).get('Running') and c['Id'] != container['Id']:
            require(state == 'paused' and c.get('Config', {}).get('Image') == service['Spec']['TaskTemplate']['ContainerSpec']['Image'], 'unrelated_running_candidate')
    declared = dict(e.split('=', 1) for e in baseline['TaskTemplate']['ContainerSpec'].get('Env', []))
    actual_entries = container.get('Config', {}).get('Env', [])
    actual = dict(e.split('=', 1) for e in actual_entries)
    require(len(actual) == len(actual_entries) and all(actual.get(k) == v for k, v in declared.items()), 'running_environment_mismatch')
    require(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', declared.get('IMAGE_TAG', '')), 'baseline_version_required')
    if state == 'paused':
        baseline['TaskTemplate']['ContainerSpec']['Image'] = digests[0]
        if 'com.docker.stack.image' in baseline.get('Labels', {}):
            baseline['Labels']['com.docker.stack.image'] = digests[0]
    evidence = {'version': 1, 'mode': 'paused' if state == 'paused' else 'current', 'serviceId': service['ID'], 'serviceVersion': service['Version']['Index'],
                'observedHash': fingerprint(service['Spec']), 'baselineHash': fingerprint(baseline), 'containerId': container['Id'], 'taskId': task['ID'],
                'imageId': image_id, 'image': digests[0], 'appTag': declared['IMAGE_TAG'], 'migrationCount': migration_count}
    return baseline, evidence


def predecessor_evidence(service, predecessor):
    require(isinstance(predecessor, dict) and predecessor.get('migrationCount') == 0 and predecessor.get('historyId') and predecessor.get('targetImage') == service['Spec']['TaskTemplate']['ContainerSpec']['Image'], 'zero_migration_predecessor_history_required')
    backup = predecessor.get('backup', '')
    require(re.fullmatch(r'/opt/1panel/backup/game-release-[A-Za-z0-9_-]+', backup), 'invalid_predecessor_backup')
    subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=backup, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    snapshot = load(backup, 'service.inspect.json')[0]
    image = load(backup, 'image.inspect.json')[0]
    require(snapshot['Spec'] == service.get('PreviousSpec'), 'predecessor_backup_spec_mismatch')
    require(read('image', 'inspect', snapshot['Spec']['TaskTemplate']['ContainerSpec']['Image'])[0]['Id'] == image['Id'], 'predecessor_backup_image_mismatch')
    return predecessor


def inspect_baseline(service_name, migration_count, predecessor=None):
    service = read('service', 'inspect', service_name)[0]
    if service.get('UpdateStatus', {}).get('State') == 'paused':
        predecessor_evidence(service, predecessor)
    ids = subprocess.check_output(['docker', 'ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + service_name], text=True, timeout=15).split()
    containers = read('inspect', *ids) if ids else []
    healthy = [c for c in containers if c.get('State', {}).get('Health', {}).get('Status') == 'healthy']
    require(len(healthy) == 1, 'single_healthy_baseline_required')
    task_id = healthy[0].get('Config', {}).get('Labels', {}).get('com.docker.swarm.task.id', '')
    require(re.fullmatch(r'[a-z0-9]{25}', task_id), 'healthy_task_identity_required')
    tasks = read('inspect', task_id)
    spec = service.get('PreviousSpec') if service.get('UpdateStatus', {}).get('State') == 'paused' else service['Spec']
    require(isinstance(spec, dict), 'previous_spec_required')
    image = read('image', 'inspect', spec['TaskTemplate']['ContainerSpec']['Image'])[0]
    repository = spec['TaskTemplate']['ContainerSpec']['Image'].split('@')[0].rsplit(':', 1)[0]
    digests = [d for d in image.get('RepoDigests', []) if d.startswith(repository + '@sha256:')]
    require(len(set(digests)) == 1, 'immutable_image_identity_mismatch')
    baseline, evidence = select_baseline(service, containers, tasks, image, read('image', 'inspect', digests[0])[0], migration_count)
    if evidence['mode'] == 'paused':
        evidence['predecessor'] = predecessor
    again = read('service', 'inspect', service_name)[0]
    require(again['Version'] == service['Version'] and again['Spec'] == service['Spec'], 'service_changed_during_baseline')
    require(read('inspect', healthy[0]['Id'])[0].get('State', {}).get('Health', {}).get('Status') == 'healthy', 'baseline_health_changed')
    return service, baseline, image, evidence


def load(backup, name):
    with open(os.path.join(backup, name), encoding='utf-8') as f:
        return json.load(f)


def save(backup, name, value):
    fd = os.open(os.path.join(backup, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(value, f, sort_keys=True)


def verify_current(backup, service_name):
    receipt = load(backup, 'paused-retry-baseline.json')
    observed = load(backup, 'service.observed.inspect.json')[0]
    service, baseline, _, current = inspect_baseline(service_name, 0, receipt.get('predecessor'))
    require(service['Version']['Index'] == receipt['serviceVersion'] and service['Spec'] == observed['Spec'], 'service_changed_since_backup')
    require(current == receipt and fingerprint(baseline) == receipt['baselineHash'], 'baseline_changed_since_backup')
    return service, receipt


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def submit(service, spec, connection_factory=DockerConnection):
    connection = connection_factory('localhost', timeout=20)
    connection.request('POST', '/services/' + service['ID'] + '/update?version=' + str(service['Version']['Index']), json.dumps(spec).encode(), {'Content-Type': 'application/json'})
    response = connection.getresponse()
    response.read()
    connection.close()
    require(response.status == 200, 'service_submission_rejected')


def duration(value):
    if value in (None, 0, '0s'):
        return 0
    pieces = re.findall(r'([0-9]+(?:\.[0-9]+)?)(ns|us|ms|s|m|h)', str(value))
    require(pieces and ''.join(n + u for n, u in pieces) == str(value), 'unsupported_policy_duration')
    units = {'ns': 1, 'us': 1000, 'ms': 1000000, 's': 1000000000, 'm': 60000000000, 'h': 3600000000000}
    return int(sum(float(n) * units[u] for n, u in pieces))


def validate_candidate_runtime(candidate, service, reader=read):
    require(set(candidate['services']) == {'hospital-backend'}, 'unsupported_retry_services')
    source = candidate['services']['hospital-backend']
    require(not set(source) - {'image', 'environment', 'volumes', 'secrets', 'healthcheck', 'ports', 'deploy', 'networks', 'command', 'entrypoint', 'dns', 'stop_grace_period'}, 'unsupported_retry_compose_policy')
    spec = service['Spec']
    task = spec['TaskTemplate']
    deploy = source.get('deploy', {})
    require(not set(deploy) - {'mode', 'replicas', 'update_config', 'rollback_config', 'restart_policy', 'resources', 'placement'}, 'unsupported_retry_deploy_policy')
    require(deploy.get('mode', 'replicated') == 'replicated' and deploy.get('replicas') == 1, 'candidate_replica_policy_mismatch')
    definitions = [('update_config', 'UpdateConfig', {'parallelism': ('Parallelism', 1), 'delay': ('Delay', 0), 'failure_action': ('FailureAction', 'pause'), 'monitor': ('Monitor', 5000000000), 'max_failure_ratio': ('MaxFailureRatio', 0), 'order': ('Order', 'stop-first')}),
                   ('rollback_config', 'RollbackConfig', {'parallelism': ('Parallelism', 1), 'delay': ('Delay', 0), 'failure_action': ('FailureAction', 'pause'), 'monitor': ('Monitor', 5000000000), 'max_failure_ratio': ('MaxFailureRatio', 0), 'order': ('Order', 'stop-first')}),
                   ('restart_policy', 'RestartPolicy', {'condition': ('Condition', 'any'), 'delay': ('Delay', 5000000000), 'max_attempts': ('MaxAttempts', 0), 'window': ('Window', 0)})]
    for key, api_key, fields in definitions:
        declared = deploy.get(key, {})
        actual = task.get(api_key, {}) if key == 'restart_policy' else spec.get(api_key, {})
        require(not set(declared) - set(fields), 'unsupported_retry_deploy_policy')
        for name, (api_name, default) in fields.items():
            value = declared.get(name, default)
            if name in ('delay', 'monitor', 'window') and name in declared:
                value = duration(value)
            require(value == actual.get(api_name, default), 'candidate_' + key + '_mismatch')
    health = source.get('healthcheck', {})
    require(not set(health) - {'test', 'interval', 'timeout', 'start_period', 'start_interval', 'retries', 'disable'}, 'unsupported_retry_health_policy')
    require(health.get('disable') is not True, 'candidate_health_disabled')
    actual_health = task['ContainerSpec'].get('Healthcheck', {})
    require(health.get('test') == actual_health.get('Test') and health.get('test') not in (None, ['NONE']), 'candidate_healthcheck_mismatch')
    for key, api_key in [('interval', 'Interval'), ('timeout', 'Timeout'), ('start_period', 'StartPeriod'), ('start_interval', 'StartInterval')]:
        require(duration(health.get(key)) == actual_health.get(api_key, 0), 'candidate_healthcheck_mismatch')
    require(health.get('retries', 0) == actual_health.get('Retries', 0), 'candidate_healthcheck_mismatch')
    expected_ports = sorted((int(p['target']), int(p['published']), p.get('protocol', 'tcp'), p.get('mode', 'ingress')) for p in source.get('ports', []))
    actual_ports = sorted((p['TargetPort'], p['PublishedPort'], p.get('Protocol', 'tcp'), p.get('PublishMode', 'ingress')) for p in spec.get('EndpointSpec', {}).get('Ports', []))
    require(expected_ports == actual_ports, 'candidate_ports_mismatch')
    expected_mounts = sorted((m['type'], m['source'], m['target'], bool(m.get('read_only', False))) for m in source.get('volumes', []))
    actual_mounts = sorted((m['Type'], m['Source'], m['Target'], bool(m.get('ReadOnly', False))) for m in task['ContainerSpec'].get('Mounts', []))
    require(expected_mounts == actual_mounts, 'candidate_mounts_mismatch')
    require(not deploy.get('resources') and not deploy.get('placement'), 'unsupported_retry_task_policy')
    require(not {k:v for k,v in task.get('Resources', {}).items() if not (k == 'MemorySwappiness' and v is None)} and not task.get('Placement'), 'unsupported_retry_task_policy')
    for key, api_key in [('command', 'Args'), ('entrypoint', 'Command')]:
        require(not source.get(key) and not task['ContainerSpec'].get(api_key), 'unsupported_retry_startup_override')
    dns = task['ContainerSpec'].get('DNSConfig', {})
    require(not set(dns) - {'Nameservers'} and source.get('dns', []) == dns.get('Nameservers', []), 'candidate_dns_mismatch')
    require(duration(source.get('stop_grace_period', '10s')) == task['ContainerSpec'].get('StopGracePeriod', 10000000000), 'candidate_stop_grace_mismatch')
    namespace = spec.get('Labels', {}).get('com.docker.stack.namespace')
    expected_networks = []
    for logical, options in source.get('networks', {}).items():
        require(not options, 'unsupported_retry_network_options')
        network = candidate.get('networks', {}).get(logical, {})
        require(not set(network) - {'name', 'external', 'ipam'} and not network.get('ipam'), 'unsupported_retry_network_policy')
        require(namespace or network.get('external'), 'network_namespace_required')
        if not network.get('external'):
            require(network.get('name') in (None, namespace + '_' + logical, str(candidate.get('name', '')) + '_' + logical), 'candidate_network_name_mismatch')
        expected_networks.append(network['name'] if network.get('external') else namespace + '_' + logical)
    actual_networks = [reader('network', 'inspect', n['Target'])[0]['Name'] for n in task.get('Networks', [])]
    require(sorted(expected_networks) == sorted(actual_networks), 'candidate_networks_mismatch')


def deployment_spec(service, candidate, image, approval, reader=read):
    reference = candidate['services']['hospital-backend']['image']
    require(reference and re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('Id', '')), 'candidate_image_required')
    repository = reference.split('@')[0].rsplit(':', 1)[0]
    digests = sorted(set(d for d in image.get('RepoDigests', []) if re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', d)))
    require(len(digests) == 1 and reader('image', 'inspect', digests[0])[0].get('Id') == image['Id'], 'candidate_digest_required')
    spec = copy.deepcopy(service['Spec'])
    container = candidate_signing_container(candidate, spec['TaskTemplate']['ContainerSpec'], approval, reader)
    container['Image'] = reference.split('@')[0] + '@' + digests[0].split('@')[1]
    spec['TaskTemplate']['ContainerSpec'] = container
    if 'com.docker.stack.image' in spec.get('Labels', {}):
        spec['Labels']['com.docker.stack.image'] = container['Image']
    require(spec.get('UpdateConfig', {}).get('Order') == 'start-first', 'start_first_required')
    return spec


def rollback_spec(service, observed, receipt, submitted, baseline, reader=read):
    require(service.get('PreviousSpec') == observed['Spec'] and fingerprint(service['Spec']) == submitted['specHash'], 'rollback_service_changed')
    require(fingerprint(baseline) == receipt['baselineHash'] == submitted['baselineHash'], 'rollback_baseline_changed')
    require(reader('image', 'inspect', receipt['image'])[0]['Id'] == receipt['imageId'], 'rollback_image_changed')
    require(reader('image', 'inspect', service['Spec']['TaskTemplate']['ContainerSpec']['Image'])[0]['Id'] == submitted['imageId'], 'rollback_candidate_changed')
    return copy.deepcopy(baseline)


def main():
    mode, backup, service_name = sys.argv[1:4]
    require(service_name == 'hospital_stack_hospital-backend', 'unsupported_service')
    if mode == 'capture':
        predecessor = json.loads(base64.b64decode(sys.argv[5], validate=True))
        service, baseline, image, evidence = inspect_baseline(service_name, int(sys.argv[4]), predecessor)
        snapshot = copy.deepcopy(service)
        snapshot['Spec'] = baseline
        save(backup, 'service.inspect.json', [snapshot])
        save(backup, 'image.inspect.json', [image])
        if evidence['mode'] == 'paused':
            save(backup, 'service.observed.inspect.json', [service])
            save(backup, 'paused-retry-baseline.json', evidence)
        # Exact checked container is also the database backup source.
        print(evidence['containerId'])
    elif mode == 'verify':
        verify_current(backup, service_name)
        print('game_retry_baseline=PASS protected_old_container=true')
    elif mode == 'deploy':
        service, receipt = verify_current(backup, service_name)
        with open(sys.argv[4], encoding='utf-8') as f:
            candidate = json.load(f)
        image = read('image', 'inspect', candidate['services']['hospital-backend']['image'])[0]
        require(image['Id'] != receipt['imageId'], 'candidate_must_differ_from_baseline')
        validate_candidate_runtime(candidate, service)
        startup = load('.', '.publisher-startup-check-' + candidate['services']['hospital-backend']['image'].split(':')[1] + '.json')
        require(startup.get('result') == 'PASS' and startup.get('imageId') == image['Id'] and startup.get('candidateHash') == fingerprint(candidate) and startup.get('serviceVersion') == service['Version']['Index'] and startup.get('specHash') == fingerprint(service['Spec']), 'candidate_startup_receipt_changed')
        spec = deployment_spec(service, candidate, image, APPROVED_SIGNING)
        if startup.get('signingSecret'):
            require(any(s.get('SecretID') == startup['signingSecret']['id'] and s.get('SecretName') == startup['signingSecret']['name'] for s in spec['TaskTemplate']['ContainerSpec'].get('Secrets', [])), 'candidate_signing_identity_changed')
        save(backup, 'paused-retry-submission.json', {'specHash': fingerprint(spec), 'imageId': image['Id'], 'baselineHash': receipt['baselineHash']})
        submit(service, spec)
        print('game_retry_submission=PASS mode=version_compare_and_swap')
    elif mode == 'rollback':
        service = read('service', 'inspect', service_name)[0]
        observed = load(backup, 'service.observed.inspect.json')[0]
        receipt = load(backup, 'paused-retry-baseline.json')
        submitted = load(backup, 'paused-retry-submission.json')
        baseline = load(backup, 'service.inspect.json')[0]['Spec']
        submit(service, rollback_spec(service, observed, receipt, submitted, baseline))
        print('game_retry_rollback=SUBMITTED validation=REQUIRED')
    else:
        raise ValueError('unsupported_mode')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z0-9_]+', str(error)) else 'evidence_unavailable'
        print('game_retry_baseline=FAIL reason=' + code + ' action=preserve_healthy_service_and_review', file=sys.stderr)
        sys.exit(1)
