"""Fenced Compose-only transaction. The caller holds the shared flock on fd 9.

This helper never starts/stops a container, changes a service, or runs SQL.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


class Rejected(Exception):
    pass


def require(value, code):
    if not value:
        raise Rejected(code)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=20).strip()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fingerprint(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def secure_file(path, optional=False):
    if optional and not path.exists():
        return None
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and not path.is_symlink() and s.st_nlink == 1, 'unsafe_file')
    if os.name == 'posix':
        require(s.st_uid == 0 and not s.st_mode & 0o022, 'unsafe_file_owner_or_mode')
    return path.read_bytes()


def file_hash(path, optional=False):
    content = secure_file(path, optional)
    return digest(content) if content is not None else None


def atomic_write(path, content):
    fd, name = tempfile.mkstemp(prefix='.publisher-config-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600)
        os.replace(name, path)
        if os.name == 'posix':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def live(service):
    return json.loads(docker('service', 'inspect', '--format',
        '{"version":{{json .Version.Index}},"spec":{{json .Spec}}}', service))


def healthy_identity(service, baseline_image):
    ids = docker('ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + service).split()
    rows = [json.loads(docker('inspect', '--format',
        '{"id":{{json .Id}},"imageId":{{json .Image}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}}}', cid)) for cid in ids]
    require(len(rows) == 1 and rows[0]['imageId'] == baseline_image and rows[0]['running'] and rows[0]['health'] == 'healthy', 'baseline_container_changed_or_unhealthy')
    return rows[0]['id']


def resource_readiness(root):
    available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    print('game_release_resources=OBSERVED availableKiB=' + str(available))
    if available >= 2097152:
        return {'result': 'PASS', 'availableKiB': available, 'capacity': 'already_available'}
    require(not (root / '.meelok-release-pause').exists() and not (root / '.meelok-release-pause').is_symlink(), 'capacity_insufficient_foreign_maintenance_marker')
    for name in ['meelok_web', 'meelok_worker', 'meelok_api', 'meelok_redis', 'meelok_object_storage']:
        replicas = docker('service', 'inspect', '--format', '{{.Spec.Mode.Replicated.Replicas}}', name)
        ids = docker('ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + name).split()
        require(replicas == '1' and len(ids) == 1, 'capacity_insufficient_safe_pause_unavailable')
        health = docker('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', ids[0])
        require(health in ['healthy', 'none'], 'capacity_insufficient_safe_pause_unavailable')
    return {'result': 'PASS', 'availableKiB': available, 'capacity': 'requires_owned_pause_and_final_recheck'}


class Transaction:
    def __init__(self, root, backup, service, transaction, image):
        self.root, self.backup = Path(root), Path(backup)
        self.service, self.transaction, self.image = service, transaction, image
        self.path = self.backup / 'publisher-config-transaction.json'
        require(re.fullmatch(r'[a-f0-9-]{36}', transaction) and re.fullmatch(r'hospital-backend:[A-Za-z0-9_.-]+', image), 'invalid_binding')

    def load(self):
        r = json.loads(secure_file(self.path))
        require(r.get('schema') == 1 and r.get('transaction') == self.transaction and r.get('image') == self.image and r.get('service') == self.service, 'transaction_binding_changed')
        return r

    def save(self, receipt):
        atomic_write(self.path, json.dumps(receipt, sort_keys=True).encode())

    def verify_baseline(self, r):
        state = live(self.service)
        require(state['version'] == r['serviceVersion'] and fingerprint(state['spec']) == r['specHash'], 'concurrent_service_change')
        require(healthy_identity(self.service, r['baselineImage']) == r['container'], 'baseline_container_changed')
        require(file_hash(self.root / '.env', True) == r['environmentHash'], 'concurrent_environment_change')
        require(file_hash(self.backup / 'docker-compose.yml') == r['originalHash'] and file_hash(self.backup / '.env', True) == r['environmentHash'], 'backup_changed')

    def prepare(self, candidate):
        candidate_bytes = secure_file(Path(candidate))
        candidate_hash = digest(candidate_bytes)
        if self.path.exists():
            r = self.load()
            self.verify_baseline(r)
            require(r['phase'] in ['PREPARED', 'CONFIG_WRITTEN'] and r['candidateHash'] == candidate_hash, 'transaction_already_advanced')
        else:
            original = secure_file(self.backup / 'docker-compose.yml')
            require(file_hash(self.root / 'docker-compose.yml') == digest(original), 'configuration_drift_before_prepare')
            environment = file_hash(self.root / '.env', True)
            require(environment == file_hash(self.backup / '.env', True), 'environment_drift_before_prepare')
            baseline = json.loads(secure_file(self.backup / 'game-service-recovery.json'))
            rendered = json.loads(docker('compose', '-f', str(self.backup / 'docker-compose.yml'), 'config', '--format', 'json'))['services']['hospital-backend']
            resolved = docker('image', 'inspect', '--format', '{{.Id}}', rendered['image'])
            require(resolved == baseline['imageId'], 'backup_compose_not_healthy_baseline')
            state = live(self.service)
            observed_file = 'service.observed.inspect.json' if (self.backup / 'paused-retry-baseline.json').exists() else 'service.inspect.json'
            expected = json.loads(secure_file(self.backup / observed_file))[0]
            require(state['version'] == expected['Version']['Index'] and state['spec'] == expected['Spec'], 'service_changed_since_backup')
            r = {'schema': 1, 'transaction': self.transaction, 'image': self.image, 'service': self.service,
                'originalHash': digest(original), 'candidateHash': candidate_hash, 'environmentHash': environment,
                'serviceVersion': state['version'], 'specHash': fingerprint(state['spec']), 'baselineImage': baseline['imageId'],
                'container': healthy_identity(self.service, baseline['imageId']), 'phase': 'PREPARED'}
            self.save(r)
        self.verify_baseline(r)
        current = file_hash(self.root / 'docker-compose.yml')
        require(current in [r['originalHash'], r['candidateHash']], 'concurrent_configuration_change')
        if current != r['candidateHash']:
            atomic_write(self.root / 'docker-compose.yml', candidate_bytes)
        r['phase'] = 'CONFIG_WRITTEN'
        self.save(r)
        return 'CONFIG_WRITTEN'

    def attempt(self):
        r = self.load()
        require(r['phase'] == 'CONFIG_WRITTEN', 'submission_phase_invalid')
        self.verify_baseline(r)
        require(file_hash(self.root / 'docker-compose.yml') == r['candidateHash'], 'concurrent_configuration_change')
        available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        require(available >= 2097152, 'memory_headroom_changed_before_cutover')
        r['phase'] = 'SUBMISSION_ATTEMPTED'
        self.save(r)
        return 'ATTEMPTED'

    def compensate(self):
        r = self.load()
        if r['phase'] == 'SUBMISSION_ATTEMPTED':
            # Durable intent may precede a refused Docker request or a lost reply.
            # It never alone permits a service rollback. Observe the new desired
            # image and a monotonic service-version change before that path.
            state = live(self.service)
            image = state['spec'].get('TaskTemplate', {}).get('ContainerSpec', {}).get('Image', '')
            require(state['version'] > r['serviceVersion'] and (image == self.image or image.startswith(self.image + '@sha256:')), 'submission_not_observed')
            return 'ATTEMPTED'
        require(r['phase'] in ['PREPARED', 'CONFIG_WRITTEN', 'COMPENSATED'], 'submission_outcome_unknown')
        self.verify_baseline(r)
        current = file_hash(self.root / 'docker-compose.yml')
        require(current in [r['originalHash'], r['candidateHash']], 'concurrent_configuration_change')
        if current != r['originalHash']:
            atomic_write(self.root / 'docker-compose.yml', secure_file(self.backup / 'docker-compose.yml'))
        r['phase'] = 'COMPENSATED'
        self.save(r)
        self.verify_baseline(r)
        require(file_hash(self.root / 'docker-compose.yml') == r['originalHash'], 'configuration_restore_not_verified')
        return 'NOT_SUBMITTED_RESTORED'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['resource', 'prepare', 'attempt', 'compensate'])
    for name in ['root', 'backup', 'service', 'transaction', 'image', 'candidate']:
        parser.add_argument('--' + name)
    a = parser.parse_args()
    require(os.name == 'posix' and os.geteuid() == 0, 'unsupported_executor')
    require(a.root == '/opt/1panel/docker/compose/hospital-stack', 'unapproved_configuration_root')
    if a.action == 'resource':
        result = resource_readiness(Path(a.root))
        print('game_release_resources=PASS ' + json.dumps(result, sort_keys=True))
        return
    require(re.fullmatch(r'/opt/1panel/backup/game-release-[A-Za-z0-9_-]+', a.backup or '') and a.service == 'hospital_stack_hospital-backend', 'unapproved_transaction_scope')
    lock = Path(a.root) / '.publisher-game-config.lock'
    fd_stat, path_stat = os.fstat(9), lock.lstat()
    require(stat.S_ISREG(fd_stat.st_mode) and fd_stat.st_ino == path_stat.st_ino and fd_stat.st_dev == path_stat.st_dev and path_stat.st_uid == 0 and stat.S_IMODE(path_stat.st_mode) == 0o600, 'shared_lock_not_held')
    import fcntl
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    t = Transaction(a.root, a.backup, a.service, a.transaction, a.image)
    result = t.prepare(a.candidate) if a.action == 'prepare' else t.attempt() if a.action == 'attempt' else t.compensate()
    print('game_deploy_transaction=' + result + ' id=' + a.transaction)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('game_deploy_transaction=UNKNOWN reason=' + (str(error) if isinstance(error, Rejected) else type(error).__name__))
        sys.exit(1)
