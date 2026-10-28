const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

for (const scenario of ['success', 'busy', 'service-drift', 'bad-runtime', 'rollback-failure']) {
  test(`publisher update script isolated service transaction: ${scenario}`, {skip: process.platform !== 'win32'}, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-update-script-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, 'scripts'), {recursive: true});
    const host = path.join(root, '.service', 'releases', 'bbbbbbbbbbbb', '.service');
    fs.mkdirSync(host, {recursive: true});
    fs.writeFileSync(path.join(host, 'RHospitalReleaseConsoleService.build.exe'), 'unchanged fixture host, never executed');
    for (const file of ['.release-history.json', '.release-jobs.json', '.release-history-migrations.json']) fs.writeFileSync(path.join(root, file), '[]');
    fs.copyFileSync(path.join(__dirname, '../scripts/update-publisher.ps1'), path.join(root, 'scripts/update-publisher.ps1'));
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fixtures/publisher-update-harness.ps1'), '-Root', root, '-Scenario', scenario], {encoding: 'utf8', windowsHide: true, timeout: 30000});
    assert.equal(r.status, 0, r.stderr);
    let result;
    try { result = JSON.parse(r.stdout.trim()); } catch { assert.fail(r.stdout + r.stderr); }
    if (scenario === 'success') {
      assert.equal(result.failure, null);
      assert.deepEqual(result.events, ['guard-acquire','guard-barrier','stop','config-new','start-new','guard-unbarrier','guard-release']);
    } else if (scenario === 'busy' || scenario === 'service-drift') {
      assert.ok(result.failure);
      assert.equal(result.events.includes('stop'), false);
      assert.equal(result.oldRestored, true);
    } else if (scenario === 'bad-runtime') {
      assert.match(result.failure, /prior runtime restored/);
      assert.deepEqual(result.events.slice(-4), ['config-old','guard-unbarrier','guard-release','start-old']);
    } else {
      assert.match(result.failure, /Rollback configuration failed/);
      assert.equal(result.locked, true);
      assert.equal(result.barrier, true);
      assert.equal(result.events.includes('start-old'), false);
    }
    if (scenario !== 'rollback-failure') { assert.equal(result.locked, false); assert.equal(result.barrier, false); }
    for (const file of ['.release-history.json', '.release-jobs.json', '.release-history-migrations.json']) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), '[]');
  });
}
