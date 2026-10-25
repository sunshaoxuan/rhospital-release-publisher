const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const cutover = require('../src/gameCodegraphCutover');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const root = path.join(__dirname, '..');
const work = path.join(root, '.codex-work', 'codegraph-tests');
fs.mkdirSync(work, {recursive: true});
test.after(() => fs.rmSync(work, {recursive:true, force:true}));
const migrations = [{filePath:cutover.MIGRATION, sha256:'a'.repeat(64)}];
test('real class-file and scheduler observation validators run positive and refusal fixtures', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', 'test/codegraphPrerequisites_test.py'], {cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 4 tests/);
});
test('every generated program parses and separates observations from production changes', () => {
  assert.equal(cutover.requiresCodegraphCutover([]), false);
  assert.equal(cutover.requiresCodegraphCutover(migrations), true);
  const read = cutover.prerequisiteCommands('.', 'game', 'image:target').join('\n');
  const offline = cutover.offlineCommands('.', 'game', 'image:target', migrations).join('\n');
  const receipt = cutover.receiptCommands(migrations, 'image:target').join('\n');
  const rollback = cutover.rollbackCommands().join('\n');
  for (const [index, script] of [read, offline, receipt, rollback].entries()) {
    const file = path.join(work, index + '.sh'); fs.writeFileSync(file, 'set -eu\n' + script);
    const parsed = spawnSync(bash, ['-n', file.replaceAll('\\','/')], {encoding:'utf8',windowsHide:true});
    assert.equal(parsed.status,0,parsed.stderr);
  }
  assert.doesNotMatch(read, /service scale|UPDATE sj_|DELETE FROM|INSERT INTO/);
  assert.ok(offline.indexOf('codegraph_prerequisites=PASS') < offline.indexOf('service scale'));
  assert.ok(offline.indexOf('assert_no_database_writers\n') < offline.lastIndexOf('codegraph-scheduler-archive.json'));
  assert.ok(offline.indexOf('service scale') < offline.indexOf('pg_dump'));
  assert.match(receipt, /target_image_id/); assert.match(receipt, /sha256sum -c/);
  assert.doesNotMatch(rollback, /UPDATE|pg_restore|service rollback/);
});


// Execute complete generated shell programs with an isolated Docker boundary.
// Python image/scheduler validation is exercised independently above using real class files.
const shellFixture = fs.mkdtempSync(path.join(work, 'shell-'));
test.after(() => fs.rmSync(shellFixture, {recursive: true, force: true}));
const shellMock = `
stopped=0
scheduler_calls=0
docker() {
  case "$1 $2" in
    'service scale') stopped=1; echo stopped >> events;;
    'service ps') echo task1;;
    'service inspect')
      case "$*" in
        *PreviousSpec*) echo "\${ROLLBACK_REFERENCE:-repo@sha256:abc}";;
        *FailureAction*) echo pause;;
        *Replicas*) echo "$((1-stopped))";;
        *ContainerSpec.Image*) echo "\${PREDECESSOR:-repo@sha256:abc}";;
        *ContainerSpec.Env*) echo SPRING_DATASOURCE_URL=jdbc:postgresql://92.113.124.185:35433/hospital;;
        *) echo '[{"Spec":{}}]';;
      esac;;
    'image inspect') echo "\${IMAGE_ID:-sha256:target}";;
    'ps -q') case "$*" in *rhospital-failback-game-db*) echo db1;; *) if [ "$stopped" = 0 ] || [ "\${LIVE_CONTAINER:-0}" = 1 ]; then echo app1; fi;; esac;;
    'inspect task1') case "$*" in *ContainerSpec.Image*) echo "\${TASK_IMAGE:-repo@sha256:abc}";; *) if [ "$stopped" = 1 ]; then echo "\${TASK_STATE:-shutdown}"; else echo "\${ROLLOUT_STATE:-running}"; fi;; esac;;
    'inspect snail-job') echo SPRING_DATASOURCE_URL=jdbc:postgresql://92.113.124.185:35432/snailjob;;
    'create --entrypoint') echo guard-container;;
    'cp guard-container:/app/app.jar') printf fixture-jar > "$3";;
    'rm guard-container'|'rm -f') :;;
    exec*)
      case "$*" in
        *snail-job*username*) printf scheduler_fixture;;
        *snail-job*password*) printf local_fixture_only;;
        *spring.datasource.username*)
          role_program="\${5//\\/run\\/secrets\\/spring.datasource.username/\${ROLE_SECRET_FILE:-missing-role-secret}}"
          SPRING_DATASOURCE_USERNAME="\${APPLICATION_ROLE-application_fixture}" sh -ec "$role_program";;
        *pg_control_system*) echo 'hospital|35433|f|7692118169925038123';;
        *pg_stat_activity*) echo "\${OTHER_CLIENTS:-0}";;
        *is_nullable*) echo "\${GUILD_FLOOR:-1}";;
        *pg_dump*) echo dump >> events; printf dump-fixture;;
        *pg_restore*) cat >/dev/null; test "\${BAD_DUMP:-0}" = 0 || return 1; echo TABLES;;
        *SPRING_DATASOURCE_URL*) echo jdbc:postgresql://92.113.124.185:35433/hospital;;
        *psql*) cat >/dev/null; echo scheduler >> events; printf '{}';;
        *) echo 'unexpected exec' >&2; return 91;;
      esac;;
    *) echo 'unexpected docker operation' >&2; return 92;;
  esac
}
python3() {
  cat >/dev/null
  case "$*" in
    *' image '*A) test "\${IMAGE_A_VALID:-1}" = 1;;
    *' image '*B) test "\${IMAGE_B_VALID:-1}" = 1;;
    *compatible*) test "\${ROLLBACK_VALID:-1}" = 1;;
    *scheduler*) test "\${ARCHIVED:-1}" = 1; test "$stopped" = 0 || test "\${DRAINED_AFTER_STOP:-1}" = 1;;
    *) test "\${SNAPSHOT_VALID:-1}" = 1;;
  esac
}
sleep() { return 1; }
`;
function runShell(script, environment = {}) {
  const file = path.join(shellFixture, 'guard.sh');
  fs.writeFileSync(file, 'set -eu\n' + shellMock + '\n' + script + '\n');
  return spawnSync(bash, [file.split(path.sep).join('/')], {cwd: shellFixture,
    env: {...process.env, ...environment}, encoding: 'utf8', timeout: 15000});
}
function resetShell() {
  for (const name of fs.readdirSync(shellFixture)) fs.rmSync(path.join(shellFixture, name), {recursive: true, force: true});
  fs.mkdirSync(path.join(shellFixture, 'backup/database'), {recursive: true});
  fs.writeFileSync(path.join(shellFixture, '.last-game-release-backup'), 'backup\n');
  fs.writeFileSync(path.join(shellFixture, 'backup/service.inspect.json'), '[{"Spec":{}}]');
  assert.equal(runShell('(cd backup && sha256sum service.inspect.json > SHA256SUMS)').status, 0);
}
const offlineProgram = cutover.offlineCommands('.', 'hospital_stack_hospital-backend', 'repo:target', migrations).join('\n');
const receiptProgram = 'service_name=hospital_stack_hospital-backend\nbackup_dir=backup\nstopped=1\n'
  + cutover.receiptCommands(migrations, 'repo:target').join('\n');
test('offline execution drains after stop, validates full dump and accepts the exact receipt', () => {
  resetShell();
  const result = runShell(offlineProgram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(path.join(shellFixture, 'events'), 'utf8'), /scheduler\nstopped\nscheduler\ndump/);
  const receipt = runShell(receiptProgram);
  assert.equal(receipt.status, 0, receipt.stdout + receipt.stderr);
});
test('application role uses environment first and accepts a secret-only runtime', () => {
  for (const [role, secret, expected] of [
    ['production_environment_role', 'different_secret_role\r\n', 'production_environment_role'],
    ['', 'secret_runtime_role\r\n', 'secret_runtime_role']
  ]) {
    resetShell();
    fs.writeFileSync(path.join(shellFixture, 'role-secret'), secret);
    const result = runShell(offlineProgram, {APPLICATION_ROLE:role, ROLE_SECRET_FILE:'role-secret'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(path.join(shellFixture, 'backup/database/codegraph-application-role'), 'utf8'), expected);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(expected));
  }
});
test('missing or empty application role refuses cutover before floor and scale', () => {
  for (const emptySecret of [false, true]) {
    resetShell();
    if (emptySecret) fs.writeFileSync(path.join(shellFixture, 'role-secret'), '');
    const result = runShell(offlineProgram, {APPLICATION_ROLE:'', ROLE_SECRET_FILE:'role-secret'});
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(shellFixture, '.codegraph-format-floor-v1')), false);
    assert.doesNotMatch(fs.readFileSync(path.join(shellFixture, 'events'), 'utf8'), /stopped|dump/);
  }
});
test('unprepared images, active references, old tasks and unfinished rollout cannot stop the game', () => {
  for (const env of [{IMAGE_A_VALID: '0'}, {IMAGE_B_VALID: '0'}, {ARCHIVED: '0'},
    {PREDECESSOR: 'repo:mutable'}, {TASK_IMAGE: 'repo@sha256:old'}, {ROLLOUT_STATE: 'starting'}]) {
    resetShell();
    const result = runShell(offlineProgram, env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.equal(fs.existsSync(path.join(shellFixture, '.codegraph-format-floor-v1')), false);
    assert.doesNotMatch(fs.existsSync(path.join(shellFixture, 'events')) ? fs.readFileSync(path.join(shellFixture, 'events'), 'utf8') : '', /stopped/);
  }
});
test('post-stop failure retains recovery floor and cannot produce migration readiness', () => {
  for (const env of [{LIVE_CONTAINER: '1'}, {TASK_STATE: 'orphaned'}, {OTHER_CLIENTS: '1'},
    {BAD_DUMP: '1'}, {DRAINED_AFTER_STOP: '0'}]) {
    resetShell();
    assert.notEqual(runShell(offlineProgram, env).status, 0, JSON.stringify(env));
    assert.equal(fs.existsSync(path.join(shellFixture, '.codegraph-format-floor-v1')), true);
    assert.equal(fs.existsSync(path.join(shellFixture, 'backup/database/codegraph-offline-backup.verified')), false);
  }
});
test('changed image, migration list, snapshot, floor and dump invalidate readiness', () => {
  for (const [env, mutate, program] of [
    [{IMAGE_ID: 'sha256:changed'}], [{SNAPSHOT_VALID: '0'}],
    [{}, () => fs.writeFileSync(path.join(shellFixture, '.codegraph-format-floor-v1'), 'stale')],
    [{}, () => fs.appendFileSync(path.join(shellFixture, 'backup/database/hospital.pre-migration.dump'), 'corruption')],
    [{}, undefined, 'service_name=hospital_stack_hospital-backend\nbackup_dir=backup\nstopped=1\n' + cutover.receiptCommands([{...migrations[0], sha256: 'b'.repeat(64)}], 'repo:target').join('\n')]
  ]) {
    resetShell(); assert.equal(runShell(offlineProgram).status, 0); mutate?.();
    assert.notEqual(runShell(program || receiptProgram, env).status, 0);
  }
});
test('rollback requires an immutable compatible image after the guild format floor', () => {
  resetShell();
  const program = 'service_name=hospital_stack_hospital-backend\n' + cutover.rollbackCommands().join('\n');
  assert.equal(runShell(program).status, 0);
  for (const env of [{ROLLBACK_REFERENCE: 'repo:mutable'}, {ROLLBACK_VALID: '0'}, {GUILD_FLOOR: 'unknown'}])
    assert.notEqual(runShell(program, env).status, 0);
  assert.equal(runShell(program, {GUILD_FLOOR: '0', ROLLBACK_REFERENCE: 'repo:old'}).status, 0);
  fs.writeFileSync(path.join(shellFixture, '.codegraph-format-floor-v1'), 'partial');
  assert.notEqual(runShell(program, {GUILD_FLOOR: '0', ROLLBACK_VALID: '0'}).status, 0);
});
