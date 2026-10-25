const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {GAME_DATABASE, gameDatabasePsqlCommand, gameDatabaseContainerResolutionCommands} = require('./gameProductionDatabase');
const {gameServiceSnapshotCommands} = require('./gameFormalProductionTransition');
const {stoppedWriterCommands} = require('./gameTechnologyFormatCutover');
const MIGRATION = 'scripts/migration/20261025_finalize_guild_status.sql';
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const binding = migrations => crypto.createHash('sha256').update(JSON.stringify(migrations.map(row => [row.filePath, row.sha256]))).digest('hex');
const requiresCodegraphCutover = migrations => migrations.some(row => row.filePath === MIGRATION);
const guard = () => Buffer.from(fs.readFileSync(path.join(__dirname, 'codegraphPrerequisites.py'))).toString('base64');
function imageCommands(reference, phase) {
  return [
    'image_guard_dir=$(mktemp -d)', 'image_guard_container=',
    'cleanup_image_guard() { if [ -n "$image_guard_container" ]; then docker rm -f "$image_guard_container" >/dev/null 2>&1 || true; fi; rm -rf "$image_guard_dir"; }',
    'trap cleanup_image_guard EXIT',
    'image_guard_container=$(docker create --entrypoint sh ' + reference + ')',
    'docker cp "$image_guard_container:/app/app.jar" "$image_guard_dir/app.jar"',
    'docker rm "$image_guard_container" >/dev/null', 'image_guard_container=',
    'printf %s ' + quote(guard()) + ' | base64 -d | python3 - image "$image_guard_dir/app.jar" ' + phase,
    'cleanup_image_guard', 'trap - EXIT'
  ];
}
function schedulerCommands() {
  const sql = [
    'BEGIN READ ONLY;',
    "SELECT json_build_object('database',current_database(),'recovery',pg_is_in_recovery(),",
    "'jobs',coalesce((SELECT json_agg(to_jsonb(j) ORDER BY j.id) FROM sj_job j WHERE j.executor_info IN ('weeklyRewardResetJob','giftDistributionJob')),'[]'),",
    "'tasks',coalesce((SELECT json_agg(json_build_object('id',t.id,'job_id',t.job_id,'task_status',t.task_status,'retry_count',t.retry_count)) FROM sj_job_task t JOIN sj_job j ON j.id=t.job_id WHERE j.executor_info IN ('weeklyRewardResetJob','giftDistributionJob')),'[]'),",
    "'batches',coalesce((SELECT json_agg(json_build_object('id',t.id,'job_id',t.job_id,'task_batch_status',t.task_batch_status)) FROM sj_job_task_batch t JOIN sj_job j ON j.id=t.job_id WHERE j.executor_info IN ('weeklyRewardResetJob','giftDistributionJob')),'[]'),",
    "'active_workflows',coalesce((SELECT json_agg(to_jsonb(w)) FROM sj_workflow w WHERE w.deleted=0 AND w.workflow_status=1 AND",
    "(w.flow_info LIKE '%weeklyRewardResetJob%' OR w.flow_info LIKE '%giftDistributionJob%' OR w.wf_context LIKE '%weeklyRewardResetJob%' OR w.wf_context LIKE '%giftDistributionJob%' OR EXISTS",
    "(SELECT 1 FROM sj_workflow_node n JOIN sj_job j ON j.id=n.job_id WHERE n.workflow_id=w.id AND n.workflow_node_status=1 AND j.executor_info IN ('weeklyRewardResetJob','giftDistributionJob')))),'[]'));", 'ROLLBACK;'
  ].join('\n');
  return [
    'scheduler_url=$(docker inspect snail-job --format \'{{range .Config.Env}}{{println .}}{{end}}\' | sed -n \'s/^SPRING_DATASOURCE_URL=//p\')',
    'test "$scheduler_url" = jdbc:postgresql://92.113.124.185:35432/snailjob || { echo "ERROR: unrecognized scheduler database"; exit 1; }',
    'scheduler_user=$(docker exec snail-job cat /run/secrets/spring.datasource.username)',
    'PGPASSWORD=$(docker exec snail-job cat /run/secrets/spring.datasource.password)',
    'test -n "$scheduler_user" && test -n "$PGPASSWORD"', 'export PGPASSWORD',
    'scheduler_observation=$(mktemp)', 'trap \'unset PGPASSWORD; rm -f "$scheduler_observation"\' EXIT',
    'printf %s ' + quote(Buffer.from(sql).toString('base64')) + ' | base64 -d | docker exec -i -e PGPASSWORD "$database_container_id" psql -X -q -v ON_ERROR_STOP=on -h 92.113.124.185 -p 35432 -U "$scheduler_user" -d snailjob -At -f - > "$scheduler_observation"',
    'unset PGPASSWORD scheduler_user',
    'printf %s ' + quote(guard()) + ' | base64 -d | python3 - scheduler "$scheduler_observation"',
    'cp "$scheduler_observation" "$backup_dir/database/codegraph-scheduler-archive.json"',
    'chmod 600 "$backup_dir/database/codegraph-scheduler-archive.json"',
    'rm -f "$scheduler_observation"', 'trap - EXIT'
  ];
}
function prerequisiteCommands(directory, serviceName, imageTag) {
  return [
    'cd ' + quote(directory), 'service_name=' + quote(serviceName), 'target_image=' + quote(imageTag),
    'backup_dir=$(cat .last-game-release-backup)', '(cd "$backup_dir" && sha256sum -c SHA256SUMS)',
    ...gameServiceSnapshotCommands(),
    'predecessor_image=$(docker service inspect "$service_name" --format \'{{.Spec.TaskTemplate.ContainerSpec.Image}}\')',
    'case "$predecessor_image" in *@sha256:*) ;; *) echo "ERROR: immutable A predecessor required"; exit 1;; esac',
    ...imageCommands('"$predecessor_image"', 'A'),
    'for task in $(docker service ps -q --no-trunc "$service_name"); do',
    '  state=$(docker inspect "$task" --format \'{{.Status.State}}\')',
    '  case "$state" in shutdown|complete|failed|rejected|remove) continue;; running) ;; *) echo "ERROR: predecessor rollout unfinished"; exit 1;; esac',
    '  task_image=$(docker inspect "$task" --format \'{{.Spec.ContainerSpec.Image}}\')',
    '  test "$task_image" = "$predecessor_image" || { echo "ERROR: pre-A task still active"; exit 1; }', 'done',
    'target_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    ...imageCommands('"$target_image_id"', 'B'), ...gameDatabaseContainerResolutionCommands(), ...schedulerCommands(),
    '(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)',
    'echo codegraph_prerequisites=PASS'
  ];
}
const quiescedCommands = () => gameServiceSnapshotCommands('current', 'codegraph-quiesced.inspect.json');
function receiptCommands(migrations, imageTag) {
  return [
    'target_image=' + quote(imageTag), 'codegraph_binding=' + quote(binding(migrations)),
    'target_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    'test "$(cat .codegraph-format-floor-v1)" = "$backup_dir|$codegraph_binding|$target_image_id"',
    'test "$(cat "$backup_dir/database/codegraph-offline-backup.verified")" = "$codegraph_binding|$target_image_id|' + GAME_DATABASE.name + '|' + GAME_DATABASE.port + '|f|' + GAME_DATABASE.systemIdentifier + '"',
    '(cd "$backup_dir" && sha256sum -c SHA256SUMS)', ...quiescedCommands(), ...stoppedWriterCommands(), 'assert_game_stopped'
  ];
}
function offlineCommands(directory, serviceName, imageTag, migrations) {
  return [
    ...prerequisiteCommands(directory, serviceName, imageTag),
    'test ! -e .codegraph-format-floor-v1 || { echo "ERROR: CodeGraph recovery required"; exit 1; }',
    'test "$(docker service inspect "$service_name" --format \'{{.Spec.UpdateConfig.FailureAction}}\')" = pause',
    'application_container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)',
    'test -n "$application_container_id"',
    'docker exec "$application_container_id" cat /run/secrets/spring.datasource.username > "$backup_dir/database/codegraph-application-role"',
    'test -s "$backup_dir/database/codegraph-application-role"', 'umask 077', 'codegraph_binding=' + quote(binding(migrations)),
    'printf "%s\n" "$backup_dir|$codegraph_binding|$target_image_id" > .codegraph-format-floor-v1',
    'docker service scale --detach=true "$service_name=0"', ...stoppedWriterCommands(),
    'deadline=$(( $(date +%s) + 180 ))',
    'until assert_game_stopped; do test "$(date +%s)" -lt "$deadline" || exit 1; sleep 2; done',
    'assert_no_database_writers', ...schedulerCommands(),
    'docker service inspect "$service_name" > "$backup_dir/codegraph-quiesced.inspect.json"',
    'docker exec "$database_container_id" pg_dump -h ' + GAME_DATABASE.host + ' -p ' + GAME_DATABASE.port + ' -U ' + GAME_DATABASE.user + ' -d ' + GAME_DATABASE.name + ' -Fc > "$backup_dir/database/hospital.pre-migration.dump"',
    'test -s "$backup_dir/database/hospital.pre-migration.dump"',
    'docker exec -i "$database_container_id" pg_restore --list < "$backup_dir/database/hospital.pre-migration.dump" > "$backup_dir/database/hospital.pre-migration.list"',
    'test -s "$backup_dir/database/hospital.pre-migration.list"', 'assert_game_stopped', 'assert_no_database_writers',
    'printf "%s|%s|%s\n" "$codegraph_binding" "$target_image_id" "$database_identity" > "$backup_dir/database/codegraph-offline-backup.verified"',
    '(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)',
    'echo codegraph_offline_cutover=PASS'
  ];
}
function rollbackCommands() {
  const sql = "SELECT exists(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='t_guild' AND column_name='status' AND is_nullable='NO')::int";
  return [
    ...gameDatabaseContainerResolutionCommands(false),
    'codegraph_floor=$(' + gameDatabasePsqlCommand('-At', false) + ' -c ' + quote(sql) + ')',
    'case "$codegraph_floor" in 0|1) ;; *) echo "ERROR: unknown guild format floor"; exit 1;; esac',
    'if [ -f .codegraph-format-floor-v1 ] || [ "$codegraph_floor" = 1 ]; then',
    '  rollback_reference=$(docker service inspect "$service_name" --format \'{{if .PreviousSpec}}{{.PreviousSpec.TaskTemplate.ContainerSpec.Image}}{{end}}\')',
    '  case "$rollback_reference" in *@sha256:*) ;; *) echo "ERROR: immutable A rollback required"; exit 1;; esac',
    ...imageCommands('"$rollback_reference"', 'compatible').map(row => '  ' + row),
    '  echo codegraph_rollback_compatibility=PASS', 'fi'
  ];
}
module.exports = {MIGRATION, requiresCodegraphCutover, prerequisiteCommands, schedulerCommands, offlineCommands, receiptCommands, quiescedCommands, rollbackCommands, imageCommands};
