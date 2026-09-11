const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('potion lab evidence rejects missing checks, changed sources, drifted artifacts and failed unit tests', async t => {
  const { SOURCES, CHECKS, sha256, verifyEvidence } = await import('../scripts/verify-potion-lab-release.mjs');
  assert.equal(sha256(Buffer.from('a\r\nb\r\n')), sha256(Buffer.from('a\nb\n')));
  assert.notEqual(sha256(Buffer.from('a\r\nb'), 'sample.png'), sha256(Buffer.from('a\nb'), 'sample.png'));
  const root = fs.mkdtempSync(path.join(__dirname, '.potion-lab-release-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), __dirname);
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const source of SOURCES) {
    fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
    fs.writeFileSync(path.join(root, source), source);
  }
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'verified');
  const receipt = { schemaVersion: 1, result: 'PASS', sources: Object.fromEntries(SOURCES.map(p => [p, sha256(p)])),
    checks: Object.fromEntries(CHECKS.map(name => [name, { result: 'PASS', evidence: [{ path: 'evidence.txt', sha256: sha256('verified') }] }])) };
  const write = () => fs.writeFileSync(path.join(root, 'release/potion-lab-readiness.json'), JSON.stringify(receipt));
  write();
  const success = () => ({ status: 0 });
  assert.equal(verifyEvidence(root, success).result, 'PASS');
  receipt.checks.visual.result = 'FAIL'; write();
  assert.throws(() => verifyEvidence(root, success), /visual/);
  receipt.checks.visual.result = 'PASS'; write();
  fs.writeFileSync(path.join(root, SOURCES[0]), 'changed');
  assert.throws(() => verifyEvidence(root, success), /Untested source/);
  fs.writeFileSync(path.join(root, SOURCES[0]), SOURCES[0]);
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'changed');
  assert.throws(() => verifyEvidence(root, success), /Changed evidence/);
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'verified');
  assert.throws(() => verifyEvidence(root, () => ({ status: 1 })), /tests failed/);
  receipt.checks.visual.evidence[0].path = '../outside.txt'; write();
  assert.throws(() => verifyEvidence(root, success));
});
