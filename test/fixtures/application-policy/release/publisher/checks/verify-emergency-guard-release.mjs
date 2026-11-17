import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROTOCOL = 'emergency-hospital-v1';
const required = ['normal-player-replay', 'historical-replay', 'postgres-concurrency',
  'browser-runtime', 'nginx-runtime', 'production-test-identities'];
function checkedFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Evidence paths must be relative');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Evidence escaped project');
  return resolved;
}
export function evidenceHash(file) {
  const bytes=fs.readFileSync(file);
  // Git checkout line-ending conversion must not invalidate tested text; binary evidence stays exact.
  const content=/\.(java|js|mjs|sql|md|json|csv|txt|xml|properties|ya?ml|conf)$/i.test(file)
    ? bytes.toString('utf8').replace(/\r\n/g,'\n') : bytes;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function verifyEvidence(root) {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'release/emergency-guard-readiness.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (receipt.protocol !== PROTOCOL || receipt.status !== 'PASS') throw new Error('Emergency guard rollout evidence is incomplete');
  for (const name of required) {
    const evidence = receipt.checks?.[name];
    if (evidence?.status !== 'PASS' || evidenceHash(checkedFile(root, evidence.path)) !== evidence.sha256)
      throw new Error(`Emergency guard evidence missing or changed: ${name}`);
  }
  const assessment = JSON.parse(fs.readFileSync(path.join(root, 'release/release-impact.json'), 'utf8').replace(/^\uFEFF/, ''));
  const paths = assessment.targets.game.coveredRuntimePaths;
  if (!Array.isArray(paths) || !paths.length || !receipt.sources ||
      Object.keys(receipt.sources).length !== paths.length) throw new Error('Emergency guard source coverage mismatch');
  for (const relative of paths) {
    if (evidenceHash(checkedFile(root, relative)) !== receipt.sources[relative]) throw new Error(`Untested source: ${relative}`);
  }
  return { status:'PASS', protocol:PROTOCOL, checks:required.length, sources:paths.length };
}

export function verifyRuntime(args, run = spawnSync) {
  const raw = fs.readFileSync(args['auth-token-file'], 'utf8').trim();
  const token = raw.startsWith('token=') ? raw.slice(6).trim() : raw;
  if (!token || /[\r\n]/.test(token)) throw new Error('Runtime credential is unavailable');
  const target = args['ssh-target'];
  if (!/^[a-zA-Z0-9_.@-]+$/.test(target || '') || !args['ssh-key']) throw new Error('Explicit SSH target and key are required');
  const encoded = Buffer.from(JSON.stringify({token})).toString('base64');
  const script = `import urllib.request,urllib.error,json,base64,sys
credential=json.loads(base64.b64decode('${encoded}'))
request=urllib.request.Request('http://127.0.0.1:8190/internal/emergency-guard/preflight',headers={'Authorization':'Bearer '+credential['token'],'X-Emergency-Method':'POST','X-Emergency-Path':'/api/emergency/info'})
try:
 try: response=urllib.request.urlopen(request,timeout=3)
 except urllib.error.HTTPError as e: response=e
 if response.status not in (204,403) or response.headers.get('X-Emergency-Guard-Version')!='${PROTOCOL}': sys.exit(2)
 if response.status==403:
  if response.headers.get('X-Emergency-Scope')!='EMERGENCY_QUERY' or not 1<=int(response.headers.get('X-Emergency-Retry-After','0'))<=3600: sys.exit(3)
 print('emergency_guard_runtime=PASS')
except Exception: sys.exit(4)
`;
  const result = run('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=5','-i',args['ssh-key'],
    '-p',String(args['ssh-port'] || 22),target,'python3','-'], {input:script, encoding:'utf8', timeout:15000, windowsHide:true});
  // Never forward upstream stderr, credential material, response bodies, or the generated script.
  if (result.status !== 0 || !result.stdout?.includes('emergency_guard_runtime=PASS'))
    throw new Error('Emergency guard runtime capability/authentication check failed');
  return {status:'PASS', protocol:PROTOCOL};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = {};
  for (let i=2;i<process.argv.length;i+=2) args[process.argv[i].replace(/^--/,'')] = process.argv[i+1];
  try {
    const result = args.mode === 'runtime' ? verifyRuntime(args) : verifyEvidence(args['project-root'] || process.cwd());
    console.log(JSON.stringify(result));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
