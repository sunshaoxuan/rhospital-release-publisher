const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {MIGRATIONS, requiresTechnologyCutover, technologyOfflineBackupCommands,
  technologyReceiptCommands, technologyRollbackGuardCommands, stoppedWriterCommands} = require('../src/gameTechnologyFormatCutover');
const migrations = MIGRATIONS.map(filePath => ({filePath, sha256: 'a'.repeat(64)}));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const work = path.join(__dirname, '..', '.codex-work', 'technology-cutover-tests');
fs.mkdirSync(work, {recursive: true});
const fixture = fs.mkdtempSync(path.join(work, 'run-'));
test.after(() => fs.rmSync(fixture, {recursive: true, force: true}));
const mock = `
stopped=0
docker() {
  case "$1 $2" in
    'service scale') stopped=1; echo stopped >> events;;
    'service ps') echo task1;;
    'service inspect')
      case "$*" in
        *Replicas*) echo "$((1-stopped))";;
        *FailureAction*) echo pause;;
        *PreviousSpec*) echo "\${ROLLBACK_REFERENCE:-repo@sha256:abc}";;
        *ContainerSpec.Env*) echo SPRING_DATASOURCE_URL=jdbc:postgresql://92.113.124.185:35433/hospital;;
        *SPRING_DATASOURCE_URL*) echo jdbc:postgresql://92.113.124.185:35433/hospital;;
        *) echo '[{"Spec":{}}]';;
      esac;;
    'image inspect') echo "\${IMAGE_ID:-sha256:target}";;
    'ps -q')
      case "$*" in
        *rhospital-failback-game-db*) echo db1;;
        *) if [ "$stopped" = 0 ] || [ "\${LIVE_CONTAINER:-0}" = 1 ]; then echo app1; fi;;
      esac;;
    'inspect task1') if [ "$stopped" = 1 ]; then echo "\${TASK_STATE:-shutdown}"; else echo running; fi;;
    'run --rm') echo capability >> events; test "\${COMPATIBLE:-1}" = 1;;
    exec*)
      case "$*" in
        *pg_control_system*) echo 'hospital|35433|f|7692118169925038123';;
        *pg_stat_activity*) echo "\${OTHER_CLIENTS:-0}";;
        *to_regclass*) echo "\${DATABASE_FLOOR:-1}";;
        *pg_dump*) echo dump >> events; printf 'custom-format-fixture';;
        *pg_restore*) cat >/dev/null; test "\${BAD_DUMP:-0}" = 0 || return 1; echo TABLES;;
        *SPRING_DATASOURCE_URL*) echo jdbc:postgresql://92.113.124.185:35433/hospital;;
        *SPRING_DATASOURCE_USERNAME*) printf fixture_role;;
        *) return 91;;
      esac;;
    *) echo "unexpected docker operation" >&2; return 92;;
  esac
}
python3() { cat >/dev/null; test "\${SNAPSHOT_VALID:-1}" = 1; }
sleep() { return 1; }
`;
function run(script, environment = {}) {
  const program = path.join(fixture, 'guard.sh');
  fs.writeFileSync(program, 'set -eu\n' + mock + '\n' + script + '\n');
  return spawnSync(bash, [program.replaceAll('\\', '/')], {
    cwd: fixture, env: {...process.env, ...environment}, encoding: 'utf8', timeout: 15000
  });
}
function reset() {
  for (const name of fs.readdirSync(fixture)) fs.rmSync(path.join(fixture, name), {recursive: true, force: true});
  const backup = path.join(fixture, 'backup');
  fs.mkdirSync(path.join(backup, 'database'), {recursive: true});
  fs.writeFileSync(path.join(fixture, '.last-game-release-backup'), 'backup\n');
  fs.writeFileSync(path.join(backup, 'service.inspect.json'), '[{"Spec":{}}]');
  fs.writeFileSync(path.join(backup, 'docker-compose.yml'), 'services: {}');
  const result = run('(cd backup && sha256sum service.inspect.json docker-compose.yml > SHA256SUMS)');
  assert.equal(result.status, 0, result.stderr);
}
const offline = technologyOfflineBackupCommands('.', 'hospital_stack_hospital-backend', 'repo:target', migrations).join('\n');
const receipt = 'service_name=hospital_stack_hospital-backend\nbackup_dir=backup\nstopped=1\n' + technologyReceiptCommands(migrations, 'repo:target').join('\n');

test('only the complete named pair activates the offline format boundary', () => {
  assert.equal(requiresTechnologyCutover([]), false);
  assert.equal(requiresTechnologyCutover([{filePath: 'scripts/migration/other.sql'}]), false);
  assert.equal(requiresTechnologyCutover(migrations), true);
  assert.throws(() => requiresTechnologyCutover(migrations.slice(0, 1)), /together/);
});
test('offline backup executes stop before full dump and accepts its bound receipt', () => {
  reset();
  const result = run(offline);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /technology_offline_cutover=PASS/);
  assert.match(fs.readFileSync(path.join(fixture, 'events'), 'utf8'), /stopped\ndump/);
  const accepted = run(receipt);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
});
test('stale image, source binding, floor, snapshot and corrupted backups are refused', () => {
  for (const [environment, mutate] of [
    [{IMAGE_ID: 'sha256:changed'}],
    [{}, () => fs.writeFileSync(path.join(fixture, 'backup/database/technology-binding'), 'changed')],
    [{}, () => fs.writeFileSync(path.join(fixture, '.technology-format-floor-v1'), 'stale')],
    [{SNAPSHOT_VALID: '0'}],
    [{}, () => fs.appendFileSync(path.join(fixture, 'backup/database/hospital.pre-migration.dump'), 'corrupt')]
  ]) {
    reset(); assert.equal(run(offline).status, 0);
    mutate?.();
    assert.notEqual(run(receipt, environment).status, 0);
  }
});
test('old containers, unconfirmed tasks and other database clients refuse migration readiness', () => {
  for (const environment of [{LIVE_CONTAINER: '1'}, {TASK_STATE: 'running'}, {TASK_STATE: 'orphaned'}, {OTHER_CLIENTS: '1'}, {BAD_DUMP: '1'}]) {
    reset();
    assert.notEqual(run(offline, environment).status, 0, JSON.stringify(environment));
    assert.equal(fs.existsSync(path.join(fixture, 'backup/database/technology-offline-backup.verified')), false);
  }
});
test('rollback rejects vulnerable or mutable PreviousSpec and accepts an immutable compatible image', () => {
  reset();
  const guard = 'service_name=hospital_stack_hospital-backend\n' + technologyRollbackGuardCommands().join('\n');
  const compatible = run(guard);
  assert.equal(compatible.status, 0, compatible.stdout + compatible.stderr);
  assert.notEqual(run(guard, {COMPATIBLE: '0'}).status, 0);
  assert.notEqual(run(guard, {ROLLBACK_REFERENCE: 'repo:mutable'}).status, 0);
  assert.equal(run(guard, {DATABASE_FLOOR: '0', COMPATIBLE: '0', ROLLBACK_REFERENCE: 'repo:old'}).status, 0);
  fs.writeFileSync(path.join(fixture, '.technology-format-floor-v1'), 'partial-migration');
  assert.notEqual(run(guard, {DATABASE_FLOOR: '0', COMPATIBLE: '0'}).status, 0);
});
test('generated programs remain valid bash and do not contain rollback mutations', () => {
  for (const commands of [offline, receipt, technologyRollbackGuardCommands().join('\n'), stoppedWriterCommands().join('\n')]) {
    assert.equal(spawnSync(bash, ['-n'], {input: commands, encoding: 'utf8'}).status, 0);
    assert.doesNotMatch(commands, /service update --.*rollback|UPDATE t_hospitals|DELETE FROM|pg_restore.*-d /i);
  }
});
