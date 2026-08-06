const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const test = require('node:test');

const {
  createReleaseWorktree,
  removeReleaseWorktree
} = require('../src/releaseWorktree');

test('creates a clean detached release worktree without changing developer files', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'release-worktree-'));
  const sourceRoot = path.join(sandbox, 'source');
  const publisherRoot = path.join(sandbox, 'publisher');
  fs.mkdirSync(sourceRoot, {recursive: true});
  fs.mkdirSync(publisherRoot, {recursive: true});
  runGit(sourceRoot, ['init']);
  runGit(sourceRoot, ['config', 'user.name', 'Test']);
  runGit(sourceRoot, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(sourceRoot, 'runtime.txt'), 'committed', 'utf8');
  runGit(sourceRoot, ['add', 'runtime.txt']);
  runGit(sourceRoot, ['commit', '-m', 'baseline']);
  const commit = runGit(sourceRoot, ['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(path.join(sourceRoot, 'runtime.txt'), 'developer work', 'utf8');

  const jobId = '1786020000000-a1b2c3';
  const worktree = createReleaseWorktree(sourceRoot, publisherRoot, jobId, commit);

  assert.equal(fs.readFileSync(path.join(sourceRoot, 'runtime.txt'), 'utf8'), 'developer work');
  assert.equal(fs.readFileSync(path.join(worktree, 'runtime.txt'), 'utf8'), 'committed');
  assert.equal(runGit(worktree, ['status', '--porcelain']).stdout, '');
  assert.equal(runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim(), commit);

  const cleanup = removeReleaseWorktree(sourceRoot, publisherRoot, jobId);
  assert.equal(cleanup.removed, true);
  assert.equal(fs.existsSync(worktree), false);
  fs.rmSync(sandbox, {recursive: true, force: true});
});

test('rejects unsafe worktree identifiers and incomplete commits', () => {
  assert.throws(() => createReleaseWorktree('C:\\source', 'C:\\publisher', '../bad', 'a'.repeat(40)),
    /任务 ID 无效/);
  assert.throws(() => createReleaseWorktree('C:\\source', 'C:\\publisher', '1786020000000-a1b2', 'abc1234'),
    /完整提交号/);
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  return result;
}
