const SNAPSHOT_SCRIPT = String.raw`
import json, subprocess, sys
try:
    with open(sys.argv[1], encoding="utf-8") as source:
        baseline = json.load(source)[0]["Spec"]
    live = json.loads(subprocess.check_output(["docker", "service", "inspect", sys.argv[2]], timeout=15))[0]
    actual = live["PreviousSpec" if sys.argv[3] == "rollback" else "Spec"]
    if sys.argv[3] == "restored":
        baseline["TaskTemplate"].pop("ForceUpdate", None)
        actual["TaskTemplate"].pop("ForceUpdate", None)
    if actual != baseline:
        raise ValueError("Service configuration changed since backup")
    print("game_service_snapshot=PASS mode=" + sys.argv[3])
except Exception as error:
    print("game_service_snapshot=FAIL failureType=" + type(error).__name__)
    sys.exit(1)
`;

function gameServiceSnapshotCommands(mode = 'current') {
  if (!['current', 'rollback', 'restored'].includes(mode)) throw new Error('Invalid snapshot mode');
  const encoded = Buffer.from(SNAPSHOT_SCRIPT).toString('base64');
  return [`printf %s "${encoded}" | base64 -d | python3 - "$backup_dir/service.inspect.json" "$service_name" ${mode}`];
}

function gameFormalComposeCommands(source, imageTag, appTag) {
  if (!source.trim()) throw new Error('Target commit must contain docker-compose.yml');
  const encoded = Buffer.from(source).toString('base64');
  return [
    'compose_candidate=$(mktemp)',
    'trap \'rm -f "$compose_candidate"\' EXIT',
    `export APP_TAG='${appTag}' HOST_IP=92.113.124.185`,
    'live_service_json=$(docker service inspect "$service_name")',
    'export JAVA_OPTS=$(printf "%s" "$live_service_json" | jq -r \'.[0].Spec.TaskTemplate.ContainerSpec.Env[] | select(startswith("JAVA_OPTS=")) | ltrimstr("JAVA_OPTS=")\')',
    'export JAVA_EXTRA_OPTS=$(printf "%s" "$live_service_json" | jq -r \'.[0].Spec.TaskTemplate.ContainerSpec.Env[] | select(startswith("JAVA_EXTRA_OPTS=")) | ltrimstr("JAVA_EXTRA_OPTS=")\')',
    `printf %s "${encoded}" | base64 -d | docker stack config -c - > "$compose_candidate"`,
    'docker stack config -c "$compose_candidate" >/dev/null',
    `docker compose -f "$compose_candidate" config --format json | jq -e --arg image '${imageTag}' --arg version '${appTag}' '.services["hospital-backend"].image == $image and .services["hospital-backend"].environment.IMAGE_TAG == $version' >/dev/null`
  ];
}

module.exports = {gameFormalComposeCommands, gameServiceSnapshotCommands};
