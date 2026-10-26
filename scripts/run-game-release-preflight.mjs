import {spawn, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

import checkPolicy from '../src/localCheckPolicy.js';
const {TOILET_MARKET_CHECK} = checkPolicy;
export const {doubleCheckLocalChecks, assertLocalCheckResult} = checkPolicy;

const CHECK_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function decodeChecks(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 100_000) {
    throw new Error('预检清单编码无效');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (payload?.version !== 1 || !Array.isArray(payload.checks)) {
    throw new Error('预检清单结构无效');
  }
  const keys = new Set();
  for (const check of payload.checks) {
    if (!CHECK_KEY_PATTERN.test(check?.key || '') || keys.has(check.key)) throw new Error('预检项目名称无效或重复');
    if (typeof check.command !== 'string' || !check.command.trim() || check.command.length > 20_000) throw new Error(`预检命令无效: ${check.key}`);
    if (!Number.isSafeInteger(check.timeoutSeconds) || check.timeoutSeconds < 1 || check.timeoutSeconds > 3600) throw new Error(`预检超时无效: ${check.key}`);
    keys.add(check.key);
  }
  doubleCheckLocalChecks(payload.checks);
  return payload.checks;
}

export function runPowerShellCheck(check, options = {}) {
  if (check.key === TOILET_MARKET_CHECK.key) return runToiletMarketCheck(check, options);
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

export function runPowerShellCheckStreaming(check, onChunk, {launch = spawn} = {}) {
  doubleCheckLocalChecks([check]);
  if (check.key === TOILET_MARKET_CHECK.key) return runToiletMarketStreaming(check,onChunk,launch);
  const encoded = Buffer.from(check.command, 'utf8').toString('base64');
  const wrapper = "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n"
    + "$global:LASTEXITCODE = 0\ntry {\n$commandText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + encoded + "'))\n"
    + "Invoke-Expression $commandText\nexit $LASTEXITCODE\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }\n";
  return streamChild('powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', '$scriptText = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($scriptText))'], wrapper, check.timeoutSeconds * 1000, onChunk, launch);
}

async function runToiletMarketStreaming(check, onChunk, launch) {
  const deadline = Date.now()+check.timeoutSeconds*1000;
  let output='';
  for(const command of check.command.split(' && ')) {
    const remaining=deadline-Date.now();
    if(remaining<=0) return {status:null,signal:null,error:'ETIMEDOUT',output};
    const result=await streamChild(process.execPath,command.split(' ').slice(1),'',remaining,onChunk,launch);
    output+=result.output;
    if(result.status!==0 || result.error || result.signal) return {...result,output};
  }
  return {status:0,signal:null,error:'',output};
}

function streamChild(executable,args,input,timeoutMs,onChunk,launch) {
  return new Promise(resolveResult => {
    let output = '', bytes = 0, error = '', finished = false;
    const child = launch(executable,args,{windowsHide:true});
    const stop = () => {
      if(process.platform==='win32' && child.pid) {
        const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.on('error',()=>child.kill());
      } else child.kill();
    };
    const timeout = setTimeout(() => { error = 'ETIMEDOUT'; stop(); }, timeoutMs);
    const finish = (status, signal) => {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      resolveResult({status, signal, error, output});
    };
    const chunk = text => {
      bytes += Buffer.byteLength(text);
      if (bytes > 64 * 1024 * 1024) { error = 'OUTPUT_LIMIT'; stop(); return; }
      output += text; onChunk(text);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk); child.stderr.on('data',chunk);
    child.on('error', () => { error = 'PROCESS_UNAVAILABLE'; finish(null,null); });
    child.on('close',finish);
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}

export async function runChecksStreaming(checks, {run = runPowerShellCheckStreaming, write = text => process.stdout.write(text)} = {}) {
  doubleCheckLocalChecks(checks);
  const failures = [];
  for (const check of checks) {
    write(`preflight_check_begin=${check.key}\n`);
    const result = await run(check, write);
    try {
      assertLocalCheckResult(check,result);
      write(`\npreflight_check=PASS key=${check.key}\n`);
    } catch {
      failures.push(check.key);
      write(`\npreflight_check=FAIL key=${check.key} exit=${result.status ?? 'none'} signal=${result.signal || 'none'} error=${result.error || 'protocol_incomplete'}\n`);
    }
  }
  write(`game_release_preflight=${failures.length ? 'FAIL' : 'PASS'} checks=${checks.length}${failures.length ? ' failures='+failures.length+' keys='+failures.join(',') : ''}\n`);
  return {passed:failures.length===0,failures};
}

export function runToiletMarketCheck(check, {spawn = spawnSync, now = Date.now, cwd} = {}) {
  doubleCheckLocalChecks([check]);
  if (check.key !== TOILET_MARKET_CHECK.key) throw new Error('Expected toilet market check');
  const deadline = now() + check.timeoutSeconds * 1000;
  let output = '';
  // Exact policy validation makes these two fixed Node invocations shell-free.
  for (const command of check.command.split(' && ')) {
    const remaining = deadline - now();
    if (remaining <= 0) return {status: null, signal: null, error: 'ETIMEDOUT', output};
    const result = spawn(process.execPath, command.split(' ').slice(1), {
      cwd, encoding: 'utf8', windowsHide: true, timeout: remaining,
      maxBuffer: 64 * 1024 * 1024
    });
    output += `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0 || result.error || result.signal) {
      return {status: result.status, signal: result.signal, error: result.error?.message || '', output};
    }
  }
  return {status: 0, signal: null, error: '', output};
}

export function runChecks(checks, {run = runPowerShellCheck, write = text => process.stdout.write(text)} = {}) {
  doubleCheckLocalChecks(checks);
  const failures = [];
  for (const check of checks) {
    write(`preflight_check_begin=${check.key}\n`);
    const result = run(check);
    if (result.output) write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    let complete = false;
    try { assertLocalCheckResult(check, result); complete = true; }
    catch (error) { write('preflight_protocol_error=' + error.message + '\n'); }
    if (complete) {
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
  const result = await runChecksStreaming(decodeChecks(process.argv[optionIndex + 1]));
  if (!result.passed) process.exitCode = 1;
}
