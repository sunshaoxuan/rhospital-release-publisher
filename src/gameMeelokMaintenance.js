const {SERVICES,HEALTH_FORMAT,readyPattern}=require('./gameMaintenanceHealth');
const {supervisedRestore}=require('./meelokRecoverySupervisor');
const MEELOK_PAUSE_ORDER = [...SERVICES];
const MEELOK_RESTORE_ORDER = [...MEELOK_PAUSE_ORDER].reverse();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function gameMeelokStatusCommands(composeDir) {
  return [
    `cd ${shellQuote(composeDir)}`,
    'if [ -e .meelok-release-pause ] || [ -L .meelok-release-pause ]; then echo "WARNING: Meelok has a retained maintenance marker; notification only"; fi',
    `for service in ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')}; do`,
    '  if ! desired=$(docker service inspect "$service" --format "{{.Spec.Mode.Replicated.Replicas}}"); then echo "WARNING: meelok_status service=$service state=unknown reason=service_inspect_failed"; continue; fi',
    '  if ! containers=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service"); then echo "WARNING: meelok_status service=$service desired=$desired state=unknown reason=container_list_failed"; continue; fi',
    '  count=$(printf "%s\\n" "$containers" | sed "/^$/d" | wc -l)',
    '  echo "meelok_status service=$service desired=$desired running=$count"',
    '  if [ "$desired" != 1 ] || [ "$count" -ne 1 ]; then echo "WARNING: Meelok $service is not a running singleton; notification only"; fi',
    '  for container in $containers; do',
    `    if ! state=$(docker inspect "$container" --format ${shellQuote('health='+HEALTH_FORMAT+' started_at={{.State.StartedAt}} restart_count={{.RestartCount}}')}); then echo "WARNING: meelok_status service=$service container=$container state=unknown reason=container_inspect_failed"; continue; fi`,
    '    echo "meelok_status service=$service container=$container $state"',
    `    case "$service:\${state%% *}" in ${readyPattern('health=')}) ;; *) echo "WARNING: Meelok $service health is not ready; notification only" ;; esac`,
    '  done',
    'done',
    'echo "meelok_status=OBSERVED services=5"'
  ];
}

function gameMeelokReadinessCommands(composeDir) {
  return [
    `cd ${shellQuote(composeDir)}`,
    'marker_file=.meelok-release-pause',
    'if [ -e "$marker_file" ] || [ -L "$marker_file" ]; then echo "ERROR: prior Meelok pause requires recovery before a new release"; exit 1; fi',
    `for service in ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')}; do`,
    '  desired=$(docker service inspect "$service" --format "{{.Spec.Mode.Replicated.Replicas}}")',
    '  [ "$desired" = 1 ] || { echo "ERROR: $service has unexpected desired replicas: $desired"; exit 1; }',
    '  container=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service")',
    '  count=$(printf "%s\n" "$container" | sed "/^$/d" | wc -l)',
    '  [ "$count" -eq 1 ] || { echo "ERROR: $service is not a running singleton"; exit 1; }',
    `  health=$(docker inspect "$container" --format ${shellQuote(HEALTH_FORMAT)})`,
    `  case "$service:$health" in ${readyPattern()}) ;; *) echo "ERROR: $service health contract is not ready before pause"; exit 1 ;; esac`,
    'done',
    'echo "meelok_readiness=PASS services=5"'
  ];
}

function snapshotName(maintenanceId) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(maintenanceId)) {
    throw new Error('Invalid Meelok maintenance identity');
  }
  return `meelok-replicas-${maintenanceId}.json`;
}

function gameMeelokPauseCommands(composeDir, maintenanceId) {
  return [
    ...gameMeelokReadinessCommands(composeDir),
    'umask 077',
    'mkdir -p .publisher-maintenance',
    'exec 8>.publisher-maintenance/operation.lock',
    'flock -n 8 || { echo "ERROR: Meelok maintenance operation is already running"; exit 75; }',
    'if [ -e "$marker_file" ] || [ -L "$marker_file" ]; then echo "ERROR: concurrent Meelok maintenance marker; preserve assets"; exit 1; fi',
    'backup_dir=$(cat .last-game-release-backup)',
    'test -d "$backup_dir"',
    `maintenance_dir="$PWD/.publisher-maintenance/${maintenanceId}"`,
    'test ! -e "$maintenance_dir"',
    'mkdir "$maintenance_dir"',
    'printf "%s\\n" "$backup_dir" > "$maintenance_dir/rollback-backup.ref"',
    `printf '%s\\n' "$maintenance_dir" > "$backup_dir/.publisher-maintenance-pin-${maintenanceId}"`,
    'backup_dir="$maintenance_dir"',
    'umask 077',
    'snapshot_tmp=$(mktemp "$backup_dir/.meelok-replicas.XXXXXX")',
    `docker service inspect ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')} | jq -e '[.[] | {name: .Spec.Name, replicas: .Spec.Mode.Replicated.Replicas, image: .Spec.TaskTemplate.ContainerSpec.Image}] | if length == 5 and all(.[]; .replicas == 1 and (.image | type) == "string") then . else error("unexpected Meelok service state") end' > "$snapshot_tmp"`,
    `snapshot="$backup_dir/${snapshotName(maintenanceId)}"`,
    'mv "$snapshot_tmp" "$snapshot"',
    'sha256sum "$snapshot" > "$maintenance_dir/captured.sha256"',
    'sync -f "$snapshot"; sync -f "$maintenance_dir"',
    'printf "%s\n" "$snapshot" > "$marker_file.tmp.$$"',
    'mv "$marker_file.tmp.$$" "$marker_file"',
    'sync -f "$marker_file"',
    `for service in ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')}; do`,
    '  docker service scale --detach "$service=0" >/dev/null',
    '  stopped=false',
    '  for attempt in $(seq 1 90); do',
    '    desired=$(docker service inspect "$service" --format "{{.Spec.Mode.Replicated.Replicas}}")',
    '    running=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service" | wc -l)',
    '    if [ "$desired" -eq 0 ] && [ "$running" -eq 0 ]; then stopped=true; break; fi',
    '    sleep 2',
    '  done',
    '  [ "$stopped" = true ] || { echo "ERROR: $service did not stop"; exit 1; }',
    'done',
    'for attempt in 1 2 3; do',
    '  available_kb=$(awk "/^MemAvailable:/ {print \\$2}" /proc/meminfo)',
    '  [ "$available_kb" -ge 2097152 ] || { echo "ERROR: insufficient memory after Meelok pause: ${available_kb}kB"; exit 1; }',
    '  sleep 2',
    'done',
    'echo "meelok_pause=PASS available_kb=$available_kb services=5"'
  ];
}

function gameMeelokRestoreCommands(composeDir, gameServiceName, maintenanceId) {
  snapshotName(maintenanceId);
  const body = [
    `cd ${shellQuote(composeDir)}`,
    'marker_file=.meelok-release-pause',
    'if [ ! -e "$marker_file" ]; then echo meelok_restore=NOT_REQUIRED; exit 0; fi',
    'snapshot=$(cat "$marker_file")',
    'backup_dir=$(cat .last-game-release-backup)',
    `[ "$snapshot" = "$backup_dir/${snapshotName(maintenanceId)}" ] || [ "$snapshot" = "$PWD/.publisher-maintenance/${maintenanceId}/${snapshotName(maintenanceId)}" ] || { echo "ERROR: Meelok pause belongs to another release; preserve marker and snapshot"; exit 1; }`,
    'test -s "$snapshot"',
    'snapshot_identity=$(sha256sum "$snapshot")',
    `if [ -f "$PWD/.publisher-maintenance/${maintenanceId}/captured.sha256" ]; then sha256sum -c "$PWD/.publisher-maintenance/${maintenanceId}/captured.sha256" >/dev/null; fi`,
    `printf '%s\\n' "$snapshot_identity" > "$PWD/.publisher-maintenance/${maintenanceId}/snapshot.sha256"`,
    `jq -e 'length == 5 and all(.[]; .replicas == 1 and (.image | type) == "string")' "$snapshot" >/dev/null`,
    `game_service=${shellQuote(gameServiceName)}`,
    'game_ready=false',
    'for attempt in $(seq 1 450); do',
    '  update_state=$(docker service inspect "$game_service" --format "{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}completed{{end}}")',
    '  game_running=$(docker ps -q --filter "label=com.docker.swarm.service.name=$game_service" | wc -l)',
    '  game_healthy=$(docker ps -q --filter "label=com.docker.swarm.service.name=$game_service" --filter health=healthy | wc -l)',
    '  if { [ "$update_state" = completed ] || [ "$update_state" = rollback_completed ]; } && [ "$game_running" -eq 1 ] && [ "$game_healthy" -eq 1 ]; then game_ready=true; break; fi',
    '  sleep 2',
    'done',
    '[ "$game_ready" = true ] || { echo "ERROR: game did not reach one healthy task before Meelok restore"; exit 1; }',
    `for service in ${MEELOK_RESTORE_ORDER.map(shellQuote).join(' ')}; do`,
    '  echo "meelok_recovery_phase=CHECK_SERVICE service=$service"',
    '  [ "$(cat "$marker_file")" = "$snapshot" ] || { echo "ERROR: Meelok pause ownership changed during restore"; exit 1; }',
    '  update_state=$(docker service inspect "$game_service" --format "{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}completed{{end}}")',
    '  game_running=$(docker ps -q --filter "label=com.docker.swarm.service.name=$game_service" | wc -l)',
    '  game_healthy=$(docker ps -q --filter "label=com.docker.swarm.service.name=$game_service" --filter health=healthy | wc -l)',
    '  { [ "$update_state" = completed ] || [ "$update_state" = rollback_completed ]; } && [ "$game_running" -eq 1 ] && [ "$game_healthy" -eq 1 ] || { echo "ERROR: game update must be complete with exactly one healthy task before Meelok restore"; exit 1; }',
    '  available_kb=$(awk "/^MemAvailable:/ {print \\$2}" /proc/meminfo)',
    '  [ "$available_kb" -ge 1572864 ] || { echo "ERROR: insufficient memory for Meelok restore: ${available_kb}kB"; exit 1; }',
    '  original=$(jq -r --arg name "$service" ".[] | select(.name == \\$name) | .replicas" "$snapshot")',
    '  original_image=$(jq -r --arg name "$service" ".[] | select(.name == \\$name) | .image" "$snapshot")',
    '  [ "$original" = 1 ] && [ -n "$original_image" ] || { echo "ERROR: incomplete Meelok snapshot for $service"; exit 1; }',
    '  current_image=$(docker service inspect "$service" --format "{{.Spec.TaskTemplate.ContainerSpec.Image}}")',
    '  [ "$current_image" = "$original_image" ] || { echo "ERROR: $service image changed during game release"; exit 1; }',
    '  desired=$(docker service inspect "$service" --format "{{.Spec.Mode.Replicated.Replicas}}")',
    '  restart_requested=false',
    '  case "$desired" in 0) docker service scale --detach "$service=$original" >/dev/null; restart_requested=true ;; 1) ;; *) echo "ERROR: unexpected $service replica count $desired"; exit 1 ;; esac',
    '  healthy=false',
    '  for attempt in $(seq 1 90); do',
    '    health=absent',
    '    container=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service")',
    '    count=$(printf "%s\n" "$container" | sed "/^$/d" | wc -l)',
    '    if [ "$count" -eq 1 ]; then',
    `      health=$(docker inspect "$container" --format ${shellQuote(HEALTH_FORMAT)})`,
    `      case "$service:$health" in ${readyPattern()}) healthy=true; break ;; esac`,
    '    fi',
    '    sleep 2',
    '  done',
    '  [ "$healthy" = true ] || { desired=$(docker service inspect "$service" --format "{{.Spec.Mode.Replicated.Replicas}}"); echo "ERROR: $service did not become healthy desired=$desired running=$count health=$health; preserve recovery marker"; exit 1; }',
    '  echo "meelok_restore_status service=$service restart_requested=$restart_requested running=$count health=$health container=$container"',
    'done',
    '[ "$(cat "$marker_file")" = "$snapshot" ] || { echo "ERROR: Meelok pause ownership changed before completion"; exit 1; }',
    '[ "$(sha256sum "$snapshot")" = "$snapshot_identity" ] || { echo "ERROR: recovery snapshot changed; preserve assets"; exit 1; }',
    `test ! -e "$PWD/.publisher-maintenance/${maintenanceId}/marker.completed"`,
    `mv "$marker_file" "$PWD/.publisher-maintenance/${maintenanceId}/marker.completed"`,
    'echo meelok_restore=PASS services=5'
  ];
  return supervisedRestore(composeDir, maintenanceId, body);
}

module.exports = {MEELOK_PAUSE_ORDER, MEELOK_RESTORE_ORDER, gameMeelokStatusCommands, gameMeelokReadinessCommands, gameMeelokPauseCommands, gameMeelokRestoreCommands};
