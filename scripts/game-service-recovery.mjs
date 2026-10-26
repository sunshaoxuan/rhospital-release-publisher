import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function historyEvidence(record) {
  if (!record || record.status !== 'RECOVERY_REQUIRED' || record.releaseTarget !== 'game') throw new Error('A terminal game recovery record is required');
  const steps = record.stepSummary || [];
  const checklist = steps.find(s => s.key === 'pre-deploy-checklist');
  if (checklist?.status !== 'done' || !(checklist.logs || []).some(line => /^checklist_database_migrations=PASS count=0$/m.test(line))) throw new Error('Verified zero-migration CheckList evidence is required');
  if (steps.some(s => /apply.*migration|offline-cutover/.test(s.key) && s.status !== 'pending')) throw new Error('Database-changing recovery requires a separate runbook');
  const backupStep = steps.find(s => s.key === 'backup-game-release' && s.status === 'done');
  const paths = (backupStep?.logs || []).flatMap(line => [...line.matchAll(/^game_backup_dir=(\/opt\/1panel\/backup\/game-release-[A-Za-z0-9_-]+)$/gm)].map(m => m[1]));
  if (paths.length !== 1 || !/^hospital-backend:[A-Za-z0-9_.-]+$/.test(record.imageTag || '')) throw new Error('Backup or target image evidence is unavailable');
  return {historyId: record.id, backup: paths[0], status: record.status, migrationCount: 0, targetImage: record.imageTag};
}

export function main(argv) {
  const allowed = new Set(['--history-id', '--host', '--identity', '--port', '--apply', '--verify', '--expected-plan', '--expected-version']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.has(key) || Object.hasOwn(options, key)) throw new Error('Unknown or duplicate recovery option');
    options[key] = ['--apply','--verify'].includes(key) ? true : argv[++i];
    if (!options[key]) throw new Error('Missing recovery option value');
  }
  if (!options['--history-id'] || !/^[A-Za-z0-9_.@-]+$/.test(options['--host'] || '') || !options['--identity']) throw new Error('Required: --history-id, --host, --identity');
  if (options['--apply'] && (!/^[a-f0-9]{64}$/.test(options['--expected-plan'] || '') || !/^\d+$/.test(options['--expected-version'] || ''))) throw new Error('Apply requires the reviewed plan hash and service version');
  if (options['--apply'] && options['--verify']) throw new Error('Conflicting recovery modes');
  const records = JSON.parse(fs.readFileSync(new URL('../.release-history.json', import.meta.url), 'utf8'));
  const evidence = historyEvidence(records.find(record => record.id === options['--history-id']));
  const script = fs.readFileSync(new URL('./game-service-recovery.py', import.meta.url), 'utf8');
  const remote = ['python3', '-', '--backup', evidence.backup, '--release-evidence-base64', Buffer.from(JSON.stringify(evidence)).toString('base64')];
  if (options['--apply']) remote.push('--apply', '--expected-plan', options['--expected-plan'], '--expected-version', options['--expected-version']);
  if (options['--verify']) remote.push('--verify');
  const port = options['--port'] || '22';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid SSH port');
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', options['--identity'], '-p', port, options['--host'], remote.join(' ')],
    {input: script, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);
  for (const line of (result.stderr || '').split(/\r?\n/)) if (/^game_service_recovery=FAIL reason=[a-z0-9_]+ action=[a-z0-9_]+$/.test(line)) console.error(line);
  // SSH errors can include local identity paths. Keep diagnostics bounded.
  if (result.status !== 0 || result.error) throw new Error('Recovery evidence/SSH operation failed; no successful recovery is confirmed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
