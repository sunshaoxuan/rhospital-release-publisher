const crypto = require('node:crypto');
const {GAME_DATABASE, gameDatabasePsqlCommand, gameDatabaseContainerResolutionCommands} = require('./gameProductionDatabase');
const {gameServiceSnapshotCommands} = require('./gameFormalProductionTransition');
const MIGRATIONS = ['scripts/migration/20261016_bound_supervision_income.sql', 'scripts/migration/20261016_technology_catalog.sql'];
const ROOM_MIGRATION = 'scripts/migration/20261021_room_catalog.sql';
const includesRoom = migrations => migrations.some(row => row.filePath === ROOM_MIGRATION);
const formatFloor = migrations => includesRoom(migrations) ? '.room-format-floor-v1' : '.technology-format-floor-v1';
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

function requiresTechnologyCutover(migrations) {
  const count = MIGRATIONS.filter(name => migrations.some(row => row.filePath === name)).length;
  if (count === 1) throw new Error('Technology format migrations must be released together');
  return count === 2 || includesRoom(migrations);
}
function binding(migrations) {
  return crypto.createHash('sha256').update(JSON.stringify(migrations.map(row => [row.filePath, row.sha256]))).digest('hex');
}
function stoppedWriterCommands() {
  return [
    'assert_game_stopped() {',
    '  test "$(docker service inspect "$service_name" --format \'{{.Spec.Mode.Replicated.Replicas}}\')" = 0 || { echo "ERROR: game service is not stopped"; return 1; }',
    '  test -z "$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name")" || { echo "ERROR: game container is still running"; return 1; }',
    '  for task in $(docker service ps -q --no-trunc "$service_name"); do',
    '    state=$(docker inspect "$task" --format \'{{.Status.State}}\')',
    '    case "$state" in shutdown|complete|failed|rejected|remove) ;; *) echo "ERROR: game task has not terminated"; return 1;; esac',
    '  done',
    '}',
    'assert_no_database_writers() {',
    `  other_clients=$(${gameDatabasePsqlCommand('-At', false)} -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")`,
    '  test "$other_clients" = 0 || { echo "ERROR: other database client sessions remain"; return 1; }',
    '}'
  ];
}
function imageCapabilityCommands(room = false) {
  const classes = ['com/zly/hospital/service/catalog/TechnologyCatalogService', 'com/zly/hospital/service/SupervisionSettlementLedger'];
  if (room) classes.push('com/zly/hospital/service/catalog/RoomCatalogService');
  return ['docker run --rm --pull never --network none --entrypoint sh "$target_image_id" -ec '
    + quote(classes.map(name => 'jar tf /app/app.jar | grep -qx BOOT-INF/classes/' + name + '.class').join('; '))];
}
function technologyQuiescedSnapshotCommands() {
  return gameServiceSnapshotCommands('current', 'technology-quiesced.inspect.json');
}
function technologyReceiptCommands(migrations, imageTag) {
  return [
    `target_image=${quote(imageTag)}`,
    `technology_binding=${quote(binding(migrations))}`,
    'target_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    'test "$(cat "$backup_dir/database/technology-image-id")" = "$target_image_id" || { echo "ERROR: technology target image changed"; exit 1; }',
    'test "$(cat "$backup_dir/database/technology-binding")" = "$technology_binding" || { echo "ERROR: technology SQL binding changed"; exit 1; }',
    'test "$(cat ' + formatFloor(migrations) + ')" = "$backup_dir|$technology_binding|$target_image_id" || { echo "ERROR: technology recovery intent differs"; exit 1; }',
    'test -s "$backup_dir/database/technology-offline-backup.verified"',
    `test "$(cat "$backup_dir/database/technology-offline-backup.verified")" = "$technology_binding|$target_image_id|${GAME_DATABASE.name}|${GAME_DATABASE.port}|f|${GAME_DATABASE.systemIdentifier}" || { echo "ERROR: offline backup receipt differs"; exit 1; }`,
    '(cd "$backup_dir" && sha256sum -c SHA256SUMS)',
    ...technologyQuiescedSnapshotCommands(),
    ...stoppedWriterCommands(),
    'assert_game_stopped'
  ];
}
function technologyOfflineBackupCommands(directory, serviceName, imageTag, migrations) {
  return [
    `cd ${quote(directory)}`,
    `service_name=${quote(serviceName)}`,
    `target_image=${quote(imageTag)}`,
    `technology_binding=${quote(binding(migrations))}`,
    'backup_dir=$(cat .last-game-release-backup)',
    '(cd "$backup_dir" && sha256sum -c SHA256SUMS)',
    ...gameServiceSnapshotCommands(),
    'test ! -e ' + formatFloor(migrations) + ' || { echo "ERROR: technology cutover already entered; explicit recovery is required"; exit 1; }',
    'test "$(docker service inspect "$service_name" --format \'{{.Spec.UpdateConfig.FailureAction}}\')" = pause',
    'target_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    ...imageCapabilityCommands(includesRoom(migrations)),
    ...gameDatabaseContainerResolutionCommands(),
    'application_container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)',
    'test -n "$application_container_id"',
    "docker exec \"$application_container_id\" sh -ec 'if [ -n \"${SPRING_DATASOURCE_USERNAME:-}\" ]; then printf \"%s\" \"$SPRING_DATASOURCE_USERNAME\"; else tr -d \"\\r\\n\" < /run/secrets/spring.datasource.username; fi' > \"$backup_dir/database/technology-application-role\"",
    'test -s "$backup_dir/database/technology-application-role"',
    'umask 077',
    'printf "%s\n" "$target_image_id" > "$backup_dir/database/technology-image-id"',
    'printf "%s\n" "$technology_binding" > "$backup_dir/database/technology-binding"',
    'printf "%s\n" "$backup_dir|$technology_binding|$target_image_id" > ' + formatFloor(migrations),
    'docker service scale --detach=true "$service_name=0"',
    ...stoppedWriterCommands(),
    'deadline=$(( $(date +%s) + 180 ))',
    'until assert_game_stopped; do test "$(date +%s)" -lt "$deadline" || exit 1; sleep 2; done',
    'assert_no_database_writers',
    'docker service inspect "$service_name" > "$backup_dir/technology-quiesced.inspect.json"',
    `docker exec "$database_container_id" pg_dump -h ${GAME_DATABASE.host} -p ${GAME_DATABASE.port} -U ${GAME_DATABASE.user} -d ${GAME_DATABASE.name} -Fc > "$backup_dir/database/hospital.pre-migration.dump"`,
    'test -s "$backup_dir/database/hospital.pre-migration.dump"',
    'docker exec -i "$database_container_id" pg_restore --list < "$backup_dir/database/hospital.pre-migration.dump" > "$backup_dir/database/hospital.pre-migration.list"',
    'test -s "$backup_dir/database/hospital.pre-migration.list"',
    'assert_game_stopped',
    'assert_no_database_writers',
    'printf "%s|%s|%s\n" "$technology_binding" "$target_image_id" "$database_identity" > "$backup_dir/database/technology-offline-backup.verified"',
    '(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)',
    'chmod 600 ' + formatFloor(migrations) + ' "$backup_dir/database/technology-"*',
    'echo technology_offline_cutover=PASS'
  ];
}
function technologyRollbackGuardCommands() {
  const sql = "BEGIN READ ONLY; SELECT (to_regclass('public.t_supervision_settlement') IS NOT NULL OR to_regclass('public.t_technology_catalog_publication') IS NOT NULL)::int; ROLLBACK;";
  const roomSql = "BEGIN READ ONLY; SELECT (to_regclass('public.t_room_catalog_publication') IS NOT NULL)::int; ROLLBACK;";
  return [
    ...gameDatabaseContainerResolutionCommands(false),
    `technology_database_floor=$(${gameDatabasePsqlCommand('-At', false)} -c ${quote(sql)} | sed '/^BEGIN$/d; /^ROLLBACK$/d')`,
    'case "$technology_database_floor" in 0|1) ;; *) echo "ERROR: unknown technology database floor"; exit 1;; esac',
    `room_database_floor=$(${gameDatabasePsqlCommand('-At', false)} -c ${quote(roomSql)} | sed '/^BEGIN$/d; /^ROLLBACK$/d')`,
    'case "$room_database_floor" in 0|1) ;; *) echo "ERROR: unknown room database floor"; exit 1;; esac',
    'if [ -f .technology-format-floor-v1 ] || [ "$technology_database_floor" = 1 ] || [ -f .room-format-floor-v1 ] || [ "$room_database_floor" = 1 ]; then',
    '  rollback_reference=$(docker service inspect "$service_name" --format \'{{if .PreviousSpec}}{{.PreviousSpec.TaskTemplate.ContainerSpec.Image}}{{end}}\')',
    '  if [ -n "${backup_dir:-}" ] && [ -f "$backup_dir/paused-retry-baseline.json" ]; then rollback_reference=$(jq -r \'.[0].Spec.TaskTemplate.ContainerSpec.Image\' "$backup_dir/service.inspect.json"); fi',
    '  case "$rollback_reference" in *@sha256:*) ;; *) echo "ERROR: rollback requires an immutable compatible image"; exit 1;; esac',
    '  target_image_id=$(docker image inspect "$rollback_reference" --format \'{{.Id}}\')',
    ...imageCapabilityCommands().map(row => '  ' + row),
    '  if [ -f .room-format-floor-v1 ] || [ "$room_database_floor" = 1 ]; then',
    ...imageCapabilityCommands(true).map(row => '    ' + row),
    '  fi',
    '  echo technology_rollback_compatibility=PASS',
    'fi'
  ];
}
module.exports = {MIGRATIONS, ROOM_MIGRATION, requiresTechnologyCutover, stoppedWriterCommands, technologyOfflineBackupCommands,
  technologyReceiptCommands, technologyQuiescedSnapshotCommands, technologyRollbackGuardCommands};
