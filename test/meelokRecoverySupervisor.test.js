const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {supervisedRestore}=require('../src/meelokRecoverySupervisor');
const id='01234567-89ab-cdef-0123-456789abcdef';
test('native Meelok deadline kills an unresponsive recovery group and retains unknown evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meelok-deadline-'));
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'meelok-deadline-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(root,'.meelok-release-pause'),'fixture-original-snapshot\n');
 const generated=supervisedRestore('.',id,['trap "" TERM','while true; do sleep 1; done']).join('\n');
 assert.match(generated,/--kill-after=5s 2100s/);
 // Accelerate only this process-management fixture; production bounds stay fixed.
 const fixture='set -euo pipefail\nflock() { :; }\nsync() { :; }\nexport -f flock sync\n'+generated.replace('--kill-after=5s 2100s','--kill-after=0.2s 0.1s');
 const file=path.join(root,'deadline.sh');fs.writeFileSync(file,fixture);
 const bash=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Git/bin/bash.exe'):'bash';
 const r=spawnSync(bash,[file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,LC_ALL:'C'}});
 assert.equal(r.status,137,r.stdout+r.stderr);
 assert.match(r.stdout,/meelok_recovery=UNKNOWN exit_code=137/);
 assert.equal(fs.readFileSync(path.join(root,'.publisher-maintenance',id,'restore.state'),'utf8').trim(),'UNKNOWN');
 assert.equal(fs.readFileSync(path.join(root,'.meelok-release-pause'),'utf8'),'fixture-original-snapshot\n');
});
