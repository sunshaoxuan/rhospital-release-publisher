// Regression boundary for trusted current checks. This is not a security sandbox.
const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {syncBuiltinESMExports} = require('node:module');
function assertCurrentPath(value) {
  if (typeof value === 'number') return;
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString();
  if (typeof value !== 'string') return;
  const relative = path.relative(process.cwd(),path.resolve(value)).replaceAll('\\','/');
  if (/^(?:docs\/evidence\/|release\/evidence\/|release\/[^/]+-readiness\.json$|\.git(?:\/|$))/i.test(relative))
    throw new Error('ARCHIVE_DEPENDENCY_IN_CURRENT_CHECK: '+relative);
}
for (const name of ['readFileSync','readFile','openSync','open','createReadStream']) {
  const original=fs[name];fs[name]=function(file,...args){assertCurrentPath(file);return original.call(this,file,...args);};
}
for(const name of ['readFile','open']) {
  const original=fs.promises[name];fs.promises[name]=function(file,...args){assertCurrentPath(file);return original.call(this,file,...args);};
}
const cp=require('node:child_process');
for(const name of ['spawn','spawnSync','execFile','execFileSync','exec','execSync']) {
  const original=cp[name];cp[name]=function(command,...args){
    if(/(?:^|[\\/\s])git(?:\.exe)?(?:\s|$)/i.test(String(command)))throw new Error('GIT_HISTORY_IN_CURRENT_CHECK');
    return original.call(this,command,...args);
  };
}
// Node test children, workers and explicit Node subprocesses retain the boundary.
const preload='--require '+JSON.stringify(__filename);
if(!(process.env.NODE_OPTIONS||'').includes(__filename))process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS||'')+' '+preload).trim();
syncBuiltinESMExports();
