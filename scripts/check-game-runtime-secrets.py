"""Validate Engine reference metadata only. Never read secret payloads or print env."""
import json
import subprocess
import sys


def validate(container, config, resolve, receipt=None, image_id=None):
    expected = [(name, target, '0', '0', 292) for name, target in config['mappings']]
    approval = config['approval']
    entries = container.get('Env', [])
    env = dict(item.split('=', 1) for item in entries)
    if len(env) != len(entries):
        raise ValueError('duplicate_environment')
    if approval:
        if set(approval) != {'source', 'secretName', 'target', 'uid', 'gid', 'mode'} or approval['uid'] != '0' or approval['gid'] != '0' or approval['mode'] != 256:
            raise ValueError('invalid_signing_approval')
        if env.get('AUTH_TOKEN_SECRET_FILE') != '/run/secrets/' + approval['target'] or 'AUTH_TOKEN_SECRET' in env:
            raise ValueError('signing_environment_conflict')
        expected.append((approval['secretName'], approval['target'], '0', '0', 256))
    elif 'AUTH_TOKEN_SECRET_FILE' in env:
        raise ValueError('unapproved_signing_environment')
    secrets = container.get('Secrets', [])
    if len(secrets) != len(expected):
        raise ValueError('secret_mapping_count_mismatch')
    actual = []
    for item in secrets:
        file = item.get('File', {})
        if set(item) != {'SecretID', 'SecretName', 'File'} or set(file) != {'Name', 'UID', 'GID', 'Mode'} or type(file['Mode']) is not int:
            raise ValueError('unknown_secret_reference_shape')
        actual.append((item['SecretName'], file['Name'], file['UID'], file['GID'], file['Mode']))
        if not item['SecretID'] or resolve(item['SecretName']) != item['SecretID']:
            raise ValueError('secret_identity_mismatch')
    if sorted(actual) != sorted(expected):
        raise ValueError('secret_reference_target_or_permission_mismatch')
    if approval:
        signing = next(item for item in secrets if item['File']['Name'] == approval['target'])
        if not receipt or receipt.get('result') != 'PASS' or receipt.get('sourceHash') != config['bindingHash'] or receipt.get('imageId') != image_id:
            raise ValueError('candidate_startup_receipt_mismatch')
        if receipt.get('signingSecret') != {'id': signing['SecretID'], 'name': approval['secretName']}:
            raise ValueError('candidate_signing_identity_mismatch')


def main():
    config = json.loads(CONFIG)
    service, container_id = sys.argv[1:]
    def read(*args):
        return json.loads(subprocess.check_output(['docker', *args], timeout=20))
    before = read('service', 'inspect', service)[0]
    spec = before['Spec']['TaskTemplate']['ContainerSpec']
    running = read('inspect', container_id)[0]
    if not running['State']['Running'] or running['State'].get('Health', {}).get('Status') != 'healthy':
        raise ValueError('runtime_not_healthy')
    task = read('inspect', running['Config']['Labels']['com.docker.swarm.task.id'])[0]
    task_spec = task['Spec']['ContainerSpec']
    if task_spec.get('Secrets') != spec.get('Secrets') or task_spec.get('Env') != spec.get('Env') or task_spec.get('Image') != spec['Image'] or running['Config']['Image'] != spec['Image']:
        raise ValueError('runtime_service_identity_mismatch')
    receipt = None
    if config['approval']:
        version = dict(item.split('=', 1) for item in spec.get('Env', [])).get('IMAGE_TAG', '')
        import re
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', version):
            raise ValueError('invalid_runtime_version')
        with open('.publisher-startup-check-' + version + '.json', encoding='utf-8') as source:
            receipt = json.load(source)
    def identity(name):
        secret = read('secret', 'inspect', name)[0]
        return secret['ID'] if secret['Spec']['Name'] == name else None
    validate(spec, config, identity, receipt, running['Image'])
    after = read('service', 'inspect', service)[0]
    if before['Version']['Index'] != after['Version']['Index'] or before['Spec'] != after['Spec']:
        raise ValueError('concurrent_service_change')
    print('game_runtime_secret_contract=PASS mappings=' + str(len(spec['Secrets'])))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only controlled error categories escape; Docker output/config never does.
        reason = str(error) if type(error) is ValueError else type(error).__name__
        print('ERROR: runtime Secret contract failed: ' + reason, file=sys.stderr)
        sys.exit(1)
