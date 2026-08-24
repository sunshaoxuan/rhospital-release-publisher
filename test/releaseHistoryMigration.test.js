const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const scriptPath = path.resolve(__dirname, '..', 'scripts', 'migrate-release-history-v2.mjs');
const retiredAlias = ['SSH', '178'].join('');
const retiredHost = ['178', '239', '117', '99'].join('.');

test('release history migration redacts retired targets idempotently and supports rollback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-history-v2-'));
  const historyPath = path.join(root, 'history.json');
  const receiptPath = path.join(root, 'receipt.json');
  fs.writeFileSync(historyPath, JSON.stringify([{
    sshTarget: retiredAlias,
    imageUploadTarget: `root@${retiredHost}:22`,
    logs: [`ssh root@${retiredHost}`],
    stepSummary: [{command: `ssh ${retiredAlias}`}]
  }]), 'utf8');

  const apply = runMigration(historyPath, receiptPath, 'apply');
  assert.equal(apply.status, 0, apply.stderr);
  const appliedText = fs.readFileSync(historyPath, 'utf8');
  assert.equal(appliedText.includes(retiredAlias), false);
  assert.equal(appliedText.includes(retiredHost), false);
  assert.match(appliedText, /历史生产目标别名已清除/);
  assert.match(appliedText, /历史生产主机V1已清除/);

  const secondApply = runMigration(historyPath, receiptPath, 'apply');
  assert.equal(secondApply.status, 0, secondApply.stderr);
  assert.match(secondApply.stdout, /replacements=0/);

  const rollback = runMigration(historyPath, receiptPath, 'rollback');
  assert.equal(rollback.status, 0, rollback.stderr);
  const rolledBackText = fs.readFileSync(historyPath, 'utf8');
  assert.match(rolledBackText, new RegExp(retiredAlias));
  assert.match(rolledBackText, new RegExp(retiredHost.replaceAll('.', '\\.')));
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.migrations[0].status, 'rolled_back');
});

function runMigration(historyPath, receiptPath, direction) {
  return spawnSync(process.execPath, [scriptPath,
    '--history', historyPath,
    '--receipt', receiptPath,
    '--direction', direction
  ], {encoding: 'utf8', windowsHide: true});
}
