"""Read only selected Docker metadata; never inspect environment or secret data."""
import datetime
import json
import subprocess


def read(args):
    return subprocess.check_output(['docker', *args], text=True, timeout=10).strip()


service = 'hospital_stack_hospital-backend'
view = '{"version":{{json .Version.Index}},"image":{{json .Spec.TaskTemplate.ContainerSpec.Image}},"replicas":{{json .Spec.Mode.Replicated.Replicas}},"updateState":{{json .UpdateStatus.State}}}'
before = json.loads(read(['service', 'inspect', service, '--format', view]))
ids = read(['ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + service]).split()
containers = []
for identity in ids:
    container_view = '{"id":{{json .Id}},"imageId":{{json .Image}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}'
    containers.append(json.loads(read(['inspect', identity, '--format', container_view])))
after = json.loads(read(['service', 'inspect', service, '--format', view]))
if before != after:
    raise RuntimeError('Concurrent service change')
print(json.dumps({'schemaVersion': 1, 'service': service, 'host': '92.113.124.185',
                 'sampledAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 **before, 'containers': containers}, sort_keys=True))
