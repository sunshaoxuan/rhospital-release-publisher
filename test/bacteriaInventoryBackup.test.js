const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {MIGRATION, bacteriaInventoryBackupCommands: backup,
  verifyBacteriaInventoryBackupCommands: verify} = require('../src/bacteriaInventoryBackup');
const migrations = [{filePath: MIGRATION}];

test('only the opportunity inventory migration requires its backup', () => {
  assert.deepEqual(backup([]), []);
  assert.deepEqual(verify([{filePath: 'scripts/migration/unrelated.sql'}]), []);
  assert.ok(backup(migrations).length > verify(migrations).length);
});

test('backup and verification fail closed before the migration on missing, damaged or unreadable dumps', () => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.bacteria-backup-'));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const run = (commands, docker) => spawnSync(bash, ['-s'], {cwd: directory, encoding: 'utf8',
    input: ['set -eu', 'backup_dir="$PWD"', 'database_container_id=verified-test',
      'mkdir -p database', 'docker() { ' + docker + '; }', ...commands,
      'echo migration_reached'].join('\n')});
  try {
    const good = 'case "$*" in *pg_dump*) printf PGDMP-test;; *pg_restore*) cat >/dev/null;; *) return 7;; esac';
    let result = run(backup(migrations), good);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /bacteria_inventory_backup=PASS/);
    assert.match(result.stdout, /migration_reached/);
    for (const invalid of [
      'rm database/bacteria-backpack.dump',
      'printf damaged >> database/bacteria-backpack.dump',
      'rm database/bacteria-backpack.SHA256SUMS'
    ]) {
      assert.equal(run(backup(migrations), good).status, 0);
      result = run([invalid, ...verify(migrations)], good);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /migration_reached/);
    }
    result = run(backup(migrations), 'return 8');
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /migration_reached/);
    assert.equal(run(backup(migrations), good).status, 0);
    result = run(verify(migrations), 'return 9');
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /migration_reached/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
