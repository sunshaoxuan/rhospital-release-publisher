const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function git(root, args) {
  const r = spawnSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true});
  if (r.status !== 0) throw new Error('Publisher barrier Git inspection failed');
  return r.stdout.trim();
}

function createLegacyBarrier(root, token) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid publisher barrier identity');
  if (git(root, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Old publisher runtime must be clean before update');
  const name = `publisher-update-${token}.guard`;
  const file = path.join(root, name);
  fs.writeFileSync(file, token, {flag: 'wx'});
  try {
    // Old server's synchronous action-version gate reads this exact Git status.
    if (git(root, ['status', '--porcelain', '--untracked-files=all']) !== `?? ${name}`) throw new Error('Legacy action barrier is not exclusively visible to Git');
  } catch (error) { removeLegacyBarrier(root, token); throw error; }
  return file;
}

function removeLegacyBarrier(root, token) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid publisher barrier identity');
  const file = path.join(root, `publisher-update-${token}.guard`);
  if (fs.readFileSync(file, 'utf8') !== token) throw new Error('Legacy barrier ownership changed');
  fs.unlinkSync(file);
}

module.exports = {createLegacyBarrier, removeLegacyBarrier};
