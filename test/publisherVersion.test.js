const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {spawnSync} = require('node:child_process');

const {
  capturePublisherRuntimeVersion,
  getPublisherVersionStatus,
  publisherContentHash
} = require('../src/publisherVersion');

test('reports an exact clean runtime and repository match', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root, {
    now: new Date('2026-07-17T04:00:00.000Z'),
    processId: 1234
  });
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(runtime.version, `0.2.0+${runtime.shortCommit}`);
  assert.equal(result.status, 'UP_TO_DATE');
  assert.equal(result.statusLabel, '执行环境与仓库一致');
  assert.equal(result.runtime.processId, 1234);
  assert.equal(result.runtime.capturedAt, '2026-07-17T04:00:00.000Z');
  assert.equal(result.runtime.contentHash, result.repository.contentHash);
});

test('reports uncommitted repository changes after the runtime snapshot', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);

  fs.appendFileSync(path.join(root, 'public', 'app.js'), 'console.log("changed");\n', 'utf8');
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(result.status, 'UNCOMMITTED_CHANGES');
  assert.equal(result.repository.dirty, true);
  assert.notEqual(result.runtime.contentHash, result.repository.contentHash);
});

test('reports a restart requirement after a newer clean commit', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);

  fs.appendFileSync(path.join(root, 'server.js'), 'module.exports = {};\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'update runtime']);
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(result.status, 'RESTART_REQUIRED');
  assert.equal(result.repository.dirty, false);
  assert.notEqual(result.runtime.commit, result.repository.commit);
});

test('runtime content hash changes when a displayed asset changes', () => {
  const root = tempPublisherRepository();
  const before = publisherContentHash(root);

  fs.appendFileSync(path.join(root, 'public', 'styles.css'), '.version { color: blue; }\n', 'utf8');

  assert.notEqual(publisherContentHash(root), before);
});

function tempPublisherRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-version-'));
  fs.mkdirSync(path.join(root, 'src'), {recursive: true});
  fs.mkdirSync(path.join(root, 'public'), {recursive: true});
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"publisher","version":"0.2.0"}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'server.js'), 'console.log("server");\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'core.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'app.js'), 'console.log("ui");\n', 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'styles.css'), 'body { color: black; }\n', 'utf8');
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
  return root;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}
