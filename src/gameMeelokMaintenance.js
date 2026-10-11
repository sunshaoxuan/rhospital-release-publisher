const MEELOK_PAUSE_ORDER = [
  'meelok_web', 'meelok_worker', 'meelok_api', 'meelok_redis', 'meelok_object_storage'
];
const MEELOK_RESTORE_ORDER = [...MEELOK_PAUSE_ORDER].reverse();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function gameMeelokPauseCommands(composeDir) {
  return [
    `cd ${shellQuote(composeDir)}`,
    'backup_dir=$(cat .last-game-release-backup)',
    'test -d "$backup_dir"',
    'marker_file=.meelok-release-pause',
    'test ! -e "$marker_file" || { echo "ERROR: prior Meelok pause requires recovery"; exit 1; }',
    `for service in ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')}; do`,
    '  container=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service")',
    '  count=$(printf "%s\n" "$container" | sed "/^$/d" | wc -l)',
    '  [ "$count" -eq 1 ] || { echo "ERROR: $service is not a running singleton"; exit 1; }',
    '  health=$(docker inspect "$container" --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}")',
    '  [ "$health" = healthy ] || [ "$health" = none ] || { echo "ERROR: $service is unhealthy before pause"; exit 1; }',
    'done',
    'umask 077',
    'snapshot_tmp=$(mktemp "$backup_dir/.meelok-replicas.XXXXXX")',
    `docker service inspect ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')} | jq -e '[.[] | {name: .Spec.Name, replicas: .Spec.Mode.Replicated.Replicas, image: .Spec.TaskTemplate.ContainerSpec.Image}] | if length == 5 and all(.[]; .replicas == 1 and (.image | type) == "string") then . else error("unexpected Meelok service state") end' > "$snapshot_tmp"`,
    'snapshot="$backup_dir/meelok-replicas.json"',
    'mv "$snapshot_tmp" "$snapshot"',
    'printf "%s\n" "$snapshot" > "$marker_file.tmp.$$"',
    'mv "$marker_file.tmp.$$" "$marker_file"',
    `for service in ${MEELOK_PAUSE_ORDER.map(shellQuote).join(' ')}; do`,
    '  docker service scale "$service=0" >/dev/null',
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

function gameMeelokRestoreCommands(composeDir, gameServiceName) {
  return [
    `cd ${shellQuote(composeDir)}`,
    'marker_file=.meelok-release-pause',
    'if [ ! -e "$marker_file" ]; then echo meelok_restore=NOT_REQUIRED; exit 0; fi',
    'snapshot=$(cat "$marker_file")',
    'test -s "$snapshot"',
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
    '  case "$desired" in 0) docker service scale "$service=$original" >/dev/null ;; 1) ;; *) echo "ERROR: unexpected $service replica count $desired"; exit 1 ;; esac',
    '  healthy=false',
    '  for attempt in $(seq 1 90); do',
    '    container=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service")',
    '    count=$(printf "%s\n" "$container" | sed "/^$/d" | wc -l)',
    '    if [ "$count" -eq 1 ]; then',
    '      health=$(docker inspect "$container" --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}")',
    '      if [ "$health" = healthy ] || [ "$health" = none ]; then healthy=true; break; fi',
    '    fi',
    '    sleep 2',
    '  done',
    '  [ "$healthy" = true ] || { echo "ERROR: $service did not become healthy"; exit 1; }',
    'done',
    'rm "$marker_file"',
    'echo meelok_restore=PASS services=5'
  ];
}

module.exports = {MEELOK_PAUSE_ORDER, MEELOK_RESTORE_ORDER, gameMeelokPauseCommands, gameMeelokRestoreCommands};
