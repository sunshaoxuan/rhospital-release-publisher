// Explicit opt-in audit. No commit, push or release entrypoint imports this file.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const policies=require('../src/manualArchiveChecks.json');
const index=process.argv.indexOf('--check'),key=process.argv[index+1];
if(index<0||!policies[key])throw new Error('Select an explicit archive check using --check; choices: '+Object.keys(policies).join(', '));
const root=process.cwd(),policy=policies[key];
let files=policy.inputs;
if(key==='verify-design-level-packages')files=[...files,...require('../src/designValidationLeaves.json').tests];
for(const file of [...new Set(files)]) {
  if(!fs.existsSync(path.join(root,file)))throw new Error('Missing historical audit input: '+file);
  const test=/\.test\.(mjs|cjs|js)$/.test(file);
  const args=test?['--experimental-vm-modules','--test',file]:[file];
  if(file.endsWith('/validate-design-evidence.mjs'))args.push('--leaf-plan-v1');
  if(file.endsWith('/build-level-catalog.mjs'))args.push('--check');
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',timeout:policy.timeoutSeconds*1000||180000,windowsHide:true});
  if(result.error||result.status!==0||result.signal)throw new Error('Historical audit failed: '+file);
}
console.log('MANUAL_ARCHIVE_AUDIT_PASS key='+key+'; not current behavior or production acceptance');
