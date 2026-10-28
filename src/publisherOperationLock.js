const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

function installationOperationLock(repositoryRoot) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repositoryRoot, encoding: 'utf8', windowsHide: true});
  if (r.status !== 0 || path.basename(r.stdout.trim()) !== '.git') throw new Error('Cannot establish canonical publisher installation lock');
  return path.join(path.dirname(fs.realpathSync(r.stdout.trim())), '.service', 'publisher-operation.lock');
}

function acquireOperationLock(lockPath, kind, token = crypto.randomUUID()) {
  if (!['job', 'update'].includes(kind) || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid publisher lock identity');
  fs.mkdirSync(path.dirname(lockPath), {recursive: true});
  try { fs.mkdirSync(lockPath); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Object.assign(new Error('发布器任务或更新正在占用互斥锁，请等待完成。'), {code: 'PUBLISHER_OPERATION_LOCKED', statusCode: 409});
  }
  const owner = {schema: 1, token, kind, pid: process.pid};
  try { fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner), {flag: 'wx'}); }
  catch (error) { fs.rmdirSync(lockPath); throw error; }
  return {owner, release: () => releaseOperationLock(lockPath, token)};
}

function releaseOperationLock(lockPath, token) {
  const ownerPath = path.join(lockPath, 'owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  if (owner.token !== token) throw new Error('Publisher lock ownership changed; retained for review');
  fs.unlinkSync(ownerPath);
  fs.rmdirSync(lockPath);
}

function assertNoPublisherUpdate(lockPath) {
  if (!fs.existsSync(lockPath)) return;
  // Incomplete, unreadable and stale locks remain fail-closed; never guess an owner dead.
  let kind;
  try { kind = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).kind; } catch {}
  if (kind !== 'job') throw Object.assign(new Error('发布器正在更新，暂不接受新计划或任务。'), {code: 'PUBLISHER_UPDATE_PENDING', statusCode: 409});
}

module.exports = {installationOperationLock, acquireOperationLock, releaseOperationLock, assertNoPublisherUpdate};
