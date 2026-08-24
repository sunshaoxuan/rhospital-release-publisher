const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {runPowerShell} = require('./releasePublisherCore');

const ACCEPTANCE_FLAG = 'RELEASE_PUBLISHER_FULL_FLOW_ACCEPTANCE';

async function executeReleasePlanAcceptance(plan, cwd, env = process.env, options = {}) {
  if (String(env[ACCEPTANCE_FLAG] || '').toLowerCase() !== 'isolated') {
    throw new Error(`全流程验收只允许在 ${ACCEPTANCE_FLAG}=isolated 时执行`);
  }
  const runCommand = typeof options.runCommand === 'function' ? options.runCommand : runPowerShell;
  const results = [];
  let executorInvocationCount = 0;

  for (const step of plan.steps || []) {
    const mode = acceptanceMode(step);
    const invocations = [];
    if (step.executable && step.command) {
      invocations.push({kind: 'command', command: step.command});
    }
    if (step.executable && step.validationCommand) {
      invocations.push({kind: 'validation', command: step.validationCommand});
    }
    if (invocations.length === 0) {
      results.push({
        key: step.key,
        title: step.title,
        mode: 'METADATA_ONLY',
        status: 'METADATA',
        invocations: []
      });
      continue;
    }

    const invocationResults = [];
    for (const invocation of invocations) {
      const startedAt = Date.now();
      const commandHash = crypto.createHash('sha256').update(invocation.command).digest('hex');
      executorInvocationCount += 1;
      try {
        const output = await runCommand(cwd, invocation.command, env, null, null, null,
          step.timeoutSeconds || options.timeoutSeconds || 120);
        invocationResults.push({
          kind: invocation.kind,
          status: 'PASS',
          commandHash,
          commandLength: invocation.command.length,
          durationMs: Date.now() - startedAt,
          output: compactOutput(output)
        });
      } catch (error) {
        invocationResults.push({
          kind: invocation.kind,
          status: 'FAIL',
          commandHash,
          commandLength: invocation.command.length,
          durationMs: Date.now() - startedAt,
          error: compactOutput(error && error.message ? error.message : error)
        });
      }
    }
    results.push({
      key: step.key,
      title: step.title,
      mode,
      status: invocationResults.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL',
      invocations: invocationResults
    });
  }

  const executableStepCount = results.filter(item => item.status !== 'METADATA').length;
  const failedSteps = results.filter(item => item.status === 'FAIL');
  return {
    releaseTarget: plan.releaseTarget,
    appTag: plan.appTag,
    stepCount: results.length,
    executableStepCount,
    metadataStepCount: results.length - executableStepCount,
    executorInvocationCount,
    failedStepCount: failedSteps.length,
    status: failedSteps.length === 0 ? 'PASS' : 'FAIL',
    steps: results
  };
}

function acceptanceMode(step) {
  if (step.productionAction || step.recoveryOnly) {
    return 'SIMULATED_DESTRUCTIVE';
  }
  return 'ISOLATED_REAL';
}

function compactOutput(value) {
  const text = String(value || '').replace(/\r/g, '').trim();
  if (text.length <= 500) return text;
  return `${text.slice(0, 500)}...`;
}

function createAcceptanceIsolation(publisherRoot) {
  const tempParent = path.join(publisherRoot, '.task-tmp');
  fs.mkdirSync(tempParent, {recursive: true});
  const root = fs.mkdtempSync(path.join(tempParent, 'release-flow-acceptance-'));
  const bin = path.join(root, 'bin');
  const traceFile = path.join(root, 'tool-trace.ndjson');
  const shimScript = path.join(root, 'tool-shim.cjs');
  fs.mkdirSync(bin, {recursive: true});
  fs.writeFileSync(shimScript, acceptanceShimSource(), 'utf8');
  const nodeExe = process.execPath;
  for (const tool of ['docker', 'scp', 'node']) {
    writeCmdWrapper(path.join(bin, `${tool}.cmd`), nodeExe, shimScript, tool);
  }
  writeSshWrapper(path.join(bin, 'ssh.ps1'));
  writeGitWrapper(path.join(bin, 'git.cmd'), nodeExe, shimScript);
  const bashPath = resolveBashPath();
  const env = {
    ...process.env,
    [ACCEPTANCE_FLAG]: 'isolated',
    RELEASE_PUBLISHER_TEST_MODE: 'false',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_ACCEPTANCE_TRACE_FILE: traceFile,
    RELEASE_PUBLISHER_ACCEPTANCE_BASH_PATH: bashPath,
    GIT_BASH_PATH: bashPath,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    TEMP: root,
    TMP: root
  };
  return {
    root,
    bin,
    traceFile,
    env,
    cleanup() {
      fs.rmSync(root, {recursive: true, force: true});
      try {
        if (fs.readdirSync(tempParent).length === 0) fs.rmdirSync(tempParent);
      } catch (_) {
        // Another task may be using the shared task-temp parent.
      }
    }
  };
}

function writeCmdWrapper(filePath, nodeExe, shimScript, tool) {
  fs.writeFileSync(filePath, [
    '@echo off',
    `"${escapeCmdPath(nodeExe)}" "${escapeCmdPath(shimScript)}" ${tool}`,
    'exit /b %errorlevel%',
    ''
  ].join('\r\n'), 'utf8');
}

function writeGitWrapper(filePath, nodeExe, shimScript) {
  fs.writeFileSync(filePath, [
    '@echo off',
    'set "ACCEPTANCE_GIT_MODE=other"',
    'if /I "%~1"=="status" set "ACCEPTANCE_GIT_MODE=status"',
    'if /I "%~1"=="rev-parse" set "ACCEPTANCE_GIT_MODE=rev-parse"',
    'if /I "%~1"=="log" set "ACCEPTANCE_GIT_MODE=log"',
    `"${escapeCmdPath(nodeExe)}" "${escapeCmdPath(shimScript)}" git %ACCEPTANCE_GIT_MODE%`,
    'exit /b %errorlevel%',
    ''
  ].join('\r\n'), 'utf8');
}

function writeSshWrapper(filePath) {
  fs.writeFileSync(filePath, [
    '$encoded = (($input | ForEach-Object { [string]$_ }) -join "").Trim()',
    '$entry = [ordered]@{ at = [DateTime]::UtcNow.ToString("o"); tool = "ssh"; stdinChars = $encoded.Length; bashSyntax = "NOT_APPLICABLE" }',
    'if ($encoded.Length -gt 0) {',
    '  try { $script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) } catch { Write-Error "invalid isolated SSH base64 input"; exit 2 }',
    '  $entry.remoteScriptChars = $script.Length',
    '  $tempScript = [IO.Path]::GetTempFileName()',
    '  try {',
    '    [IO.File]::WriteAllText($tempScript, $script, [Text.UTF8Encoding]::new($false))',
    '    & $env:RELEASE_PUBLISHER_ACCEPTANCE_BASH_PATH -n $tempScript',
    '    if ($LASTEXITCODE -ne 0) { $entry.bashSyntax = "FAIL"; Add-Content -LiteralPath $env:RELEASE_PUBLISHER_ACCEPTANCE_TRACE_FILE -Value ($entry | ConvertTo-Json -Compress); exit $LASTEXITCODE }',
    '    $entry.bashSyntax = "PASS"',
    '  } finally { Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue }',
    '}',
    'Add-Content -LiteralPath $env:RELEASE_PUBLISHER_ACCEPTANCE_TRACE_FILE -Value ($entry | ConvertTo-Json -Compress)',
    'if ($encoded.Length -gt 0) { Write-Output "isolated_ssh=PASS bash_syntax=PASS remote_script_chars=$($entry.remoteScriptChars)" } else { Write-Output "isolated_ssh=PASS" }',
    'exit 0',
    ''
  ].join('\r\n'), 'utf8');
}

function escapeCmdPath(value) {
  return String(value).replace(/%/g, '%%').replace(/"/g, '""');
}

function resolveBashPath() {
  const candidates = process.platform === 'win32'
    ? [
      process.env.GIT_BASH_PATH,
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
    ]
    : [process.env.SHELL, '/bin/bash', '/usr/bin/bash'];
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('全流程验收需要 bash 用于检查远程脚本语法');
  return found;
}

function acceptanceShimSource() {
  return String.raw`const fs = require('node:fs');

const tool = process.argv[2] || 'unknown';
const mode = process.argv[3] || '';
const traceFile = process.env.RELEASE_PUBLISHER_ACCEPTANCE_TRACE_FILE;

function trace(entry) {
  if (traceFile) fs.appendFileSync(traceFile, JSON.stringify({at: new Date().toISOString(), tool, ...entry}) + '\n');
}

if (tool === 'git') {
  trace({mode});
  if (mode === 'rev-parse') process.stdout.write('0123456789abcdef0123456789abcdef01234567\n');
  if (mode === 'log') process.stdout.write('0123456\t2026-08-25 00:00:00 +0900\tIsolated acceptance\n');
  process.exit(0);
}

trace({mode: 'isolated'});
process.stdout.write('isolated_' + tool + '=PASS\n');
`;
}

module.exports = {
  ACCEPTANCE_FLAG,
  executeReleasePlanAcceptance,
  createAcceptanceIsolation
};
