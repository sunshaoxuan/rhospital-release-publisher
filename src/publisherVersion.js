const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const RUNTIME_PATHS = ['package.json', 'server.js', 'src', 'public'];

function capturePublisherRuntimeVersion(repositoryRoot, options = {}) {
  const repository = readPublisherRepositoryVersion(repositoryRoot, options);
  return {
    ...repository,
    capturedAt: (options.now || new Date()).toISOString(),
    processId: options.processId === undefined ? process.pid : options.processId,
    version: formatPublisherVersion(repository.packageVersion, repository.shortCommit, repository.dirty)
  };
}

function getPublisherVersionStatus(repositoryRoot, runtime, options = {}) {
  const repository = readPublisherRepositoryVersion(repositoryRoot, options);
  const status = comparePublisherVersions(runtime, repository);
  return {
    packageVersion: runtime.packageVersion,
    runtimeVersion: runtime.version,
    status,
    statusLabel: statusLabel(status),
    runtime: {
      commit: runtime.commit,
      shortCommit: runtime.shortCommit,
      contentHash: runtime.contentHash,
      dirty: runtime.dirty,
      capturedAt: runtime.capturedAt,
      processId: runtime.processId
    },
    repository: {
      commit: repository.commit,
      shortCommit: repository.shortCommit,
      contentHash: repository.contentHash,
      dirty: repository.dirty
    }
  };
}

function readPublisherRepositoryVersion(repositoryRoot, options = {}) {
  const root = path.resolve(repositoryRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gitRunner = options.gitRunner || spawnSync;
  const commit = runGit(root, ['rev-parse', 'HEAD'], gitRunner);
  const dirtyOutput = runGit(root, ['status', '--porcelain', '--untracked-files=all'], gitRunner);
  return {
    packageVersion: String(packageJson.version || '0.0.0'),
    commit,
    shortCommit: commit ? commit.slice(0, 8) : 'unknown',
    dirty: Boolean(dirtyOutput.trim()),
    contentHash: publisherContentHash(root)
  };
}

function comparePublisherVersions(runtime, repository) {
  if (!runtime.commit || !repository.commit) {
    return 'UNKNOWN';
  }
  if (runtime.dirty || repository.dirty) {
    return 'UNCOMMITTED_CHANGES';
  }
  if (runtime.commit !== repository.commit || runtime.contentHash !== repository.contentHash) {
    return 'RESTART_REQUIRED';
  }
  return 'UP_TO_DATE';
}

function statusLabel(status) {
  switch (status) {
    case 'UP_TO_DATE': return '执行环境与仓库一致';
    case 'RESTART_REQUIRED': return '仓库已更新，需要重启发布器';
    case 'UNCOMMITTED_CHANGES': return '仓库存在未提交修改';
    default: return '版本状态无法确认';
  }
}

function formatPublisherVersion(packageVersion, shortCommit, dirty) {
  return `${packageVersion}+${shortCommit}${dirty ? '.dirty' : ''}`;
}

function publisherContentHash(repositoryRoot) {
  const hash = crypto.createHash('sha256');
  const files = RUNTIME_PATHS.flatMap(relativePath => listFiles(repositoryRoot, relativePath))
    .sort((left, right) => left.localeCompare(right));
  for (const relativePath of files) {
    hash.update(relativePath.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(repositoryRoot, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listFiles(repositoryRoot, relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    return [relativePath];
  }
  return fs.readdirSync(absolutePath, {withFileTypes: true}).flatMap(entry => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? listFiles(repositoryRoot, child) : entry.isFile() ? [child] : [];
  });
}

function runGit(repositoryRoot, args, gitRunner) {
  const result = gitRunner('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

module.exports = {
  RUNTIME_PATHS,
  capturePublisherRuntimeVersion,
  getPublisherVersionStatus,
  readPublisherRepositoryVersion,
  comparePublisherVersions,
  publisherContentHash,
  formatPublisherVersion
};
