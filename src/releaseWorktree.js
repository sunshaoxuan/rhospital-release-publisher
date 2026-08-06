const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const JOB_ID_PATTERN = /^[0-9]+-[0-9a-f]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function createReleaseWorktree(sourceRoot, publisherRoot, jobId, commit, gitRunner = spawnSync) {
  const safeJobId = validateJobId(jobId);
  const safeCommit = validateCommit(commit);
  const worktreeParent = path.resolve(publisherRoot, '.release-worktrees');
  const worktreePath = path.resolve(worktreeParent, safeJobId);
  if (!worktreePath.startsWith(`${worktreeParent}${path.sep}`)) {
    throw new Error('发布工作树路径越界');
  }
  if (fs.existsSync(worktreePath)) {
    throw new Error(`发布工作树已存在: ${worktreePath}`);
  }

  fs.mkdirSync(worktreeParent, {recursive: true});
  const result = gitRunner('git', ['worktree', 'add', '--detach', worktreePath, safeCommit], {
    cwd: path.resolve(sourceRoot),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`创建隔离发布工作树失败: ${result.error ? result.error.message : output || `git exited with ${result.status}`}`);
  }
  return worktreePath;
}

function removeReleaseWorktree(sourceRoot, publisherRoot, jobId, gitRunner = spawnSync) {
  const safeJobId = validateJobId(jobId);
  const worktreeParent = path.resolve(publisherRoot, '.release-worktrees');
  const worktreePath = path.resolve(worktreeParent, safeJobId);
  if (!worktreePath.startsWith(`${worktreeParent}${path.sep}`)) {
    throw new Error('发布工作树路径越界');
  }
  if (!fs.existsSync(worktreePath)) {
    return {removed: false, path: worktreePath};
  }

  const result = gitRunner('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: path.resolve(sourceRoot),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`清理隔离发布工作树失败: ${result.error ? result.error.message : output || `git exited with ${result.status}`}`);
  }
  return {removed: true, path: worktreePath};
}

function validateJobId(jobId) {
  const value = String(jobId || '').trim();
  if (!JOB_ID_PATTERN.test(value)) {
    throw new Error('发布任务 ID 无效');
  }
  return value;
}

function validateCommit(commit) {
  const value = String(commit || '').trim().toLowerCase();
  if (!COMMIT_PATTERN.test(value)) {
    throw new Error('隔离发布工作树要求完整提交号');
  }
  return value;
}

module.exports = {
  createReleaseWorktree,
  removeReleaseWorktree
};
