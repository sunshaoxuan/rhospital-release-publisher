const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const ENGINE_TIMEOUT_MS = 30000;

async function checkDockerEngine(targetArgs, {run = promisify(execFile), env = process.env, cwd = process.cwd()} = {}) {
  if (!Array.isArray(targetArgs) || !(targetArgs.length === 0
      || (targetArgs.length === 2 && ['--context', '-H'].includes(targetArgs[0])
        && typeof targetArgs[1] === 'string' && targetArgs[1].length > 0))) {
    throw new Error('Docker engine preflight: invalid build target arguments');
  }
  let result;
  try {
    result = await run('docker', [...targetArgs, 'info', '--format', '{{.OSType}}'], {
      cwd, env, timeout: ENGINE_TIMEOUT_MS, windowsHide: true, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const reason = error.killed || error.code === 'ETIMEDOUT'
      ? 'timed out after 30 seconds'
      : String(error.stderr || error.message || error).trim();
    throw new Error('Docker engine preflight failed for the build target: ' + reason);
  }
  const osType = String(result.stdout || '').trim();
  if (osType !== 'linux') {
    throw new Error('Docker engine preflight: Linux server required; OSType=' + (osType || '<empty>'));
  }
  return 'docker_build_engine=PASS OSType=linux';
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const targetArgs = JSON.parse(Buffer.from(process.argv[2] || '', 'base64').toString('utf8'));
    return checkDockerEngine(targetArgs);
  }).then(message => console.log(message)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {checkDockerEngine, ENGINE_TIMEOUT_MS};
