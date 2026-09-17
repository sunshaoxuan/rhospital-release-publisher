import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const CHECK_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function decodeChecks(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 100_000) {
    throw new Error('预检清单编码无效');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (payload?.version !== 1 || !Array.isArray(payload.checks) || payload.checks.length > 20) {
    throw new Error('预检清单结构无效');
  }
  const keys = new Set();
  for (const check of payload.checks) {
    if (!CHECK_KEY_PATTERN.test(check?.key || '') || keys.has(check.key)) throw new Error('预检项目名称无效或重复');
    if (typeof check.command !== 'string' || !check.command.trim() || check.command.length > 20_000) throw new Error(`预检命令无效: ${check.key}`);
    if (!Number.isSafeInteger(check.timeoutSeconds) || check.timeoutSeconds < 1 || check.timeoutSeconds > 3600) throw new Error(`预检超时无效: ${check.key}`);
    keys.add(check.key);
  }
  return payload.checks;
}

export function runPowerShellCheck(check) {
  const commandBase64 = Buffer.from(check.command, 'utf8').toString('base64');
  const wrapper = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
    '$global:LASTEXITCODE = 0',
    'try {',
    `  $commandText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${commandBase64}'))`,
    '  Invoke-Expression $commandText',
    '  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    '  exit 0',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}'
  ].join('\n');
  const result = spawnSync('powershell', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', '$scriptText = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($scriptText))'
  ], {
    input: `${wrapper}\n`,
    encoding: 'utf8',
    windowsHide: true,
    timeout: check.timeoutSeconds * 1000,
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message || '',
    output: `${result.stdout || ''}${result.stderr || ''}`
  };
}

export function runChecks(checks, {run = runPowerShellCheck, write = text => process.stdout.write(text)} = {}) {
  const failures = [];
  for (const check of checks) {
    write(`preflight_check_begin=${check.key}\n`);
    const result = run(check);
    if (result.output) write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    if (result.status === 0 && !result.error && !result.signal) {
      write(`preflight_check=PASS key=${check.key}\n`);
    } else {
      failures.push(check.key);
      write(`preflight_check=FAIL key=${check.key} exit=${result.status ?? 'none'} signal=${result.signal || 'none'} error=${result.error || 'none'}\n`);
    }
  }
  if (failures.length) {
    write(`game_release_preflight=FAIL checks=${checks.length} failures=${failures.length} keys=${failures.join(',')}\n`);
  } else {
    write(`game_release_preflight=PASS checks=${checks.length}\n`);
  }
  return {passed: failures.length === 0, failures};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const optionIndex = process.argv.indexOf('--checks-base64');
  if (optionIndex < 0 || !process.argv[optionIndex + 1]) throw new Error('缺少 --checks-base64');
  const result = runChecks(decodeChecks(process.argv[optionIndex + 1]));
  if (!result.passed) process.exitCode = 1;
}
