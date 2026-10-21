const test = require('node:test');
const assert = require('node:assert/strict');
const {checkDockerEngine, ENGINE_TIMEOUT_MS} = require('../scripts/check-docker-engine.cjs');
const {dockerCommand, dockerEngineReadinessCommand, resolveDockerCommandTarget} = require('../src/releasePublisherCore');

const decodeTarget = command => JSON.parse(Buffer.from(command.split(' ').at(-1).replace(/'/g, ''), 'base64').toString('utf8'));

test('engine preflight connects to Linux server with the inherited build environment and cwd', async () => {
  const env = {DOCKER_HOST: 'npipe:////./pipe/test-engine', DOCKER_CONTEXT: 'test-context', DOCKER_CONFIG: 'test-config'};
  const cwd = 'candidate-worktree';
  let calls = 0;
  const result = await checkDockerEngine([], {env, cwd, run: async (file, args, options) => {
    calls++;
    assert.equal(file, 'docker');
    assert.deepEqual(args, ['info', '--format', '{{.OSType}}']);
    assert.equal(options.env, env);
    assert.equal(options.cwd, cwd);
    assert.equal(options.timeout, 30000);
    assert.equal(options.windowsHide, true);
    assert.equal(options.killSignal, 'SIGKILL');
    return {stdout: 'linux\r\n'};
  }});
  assert.equal(result, 'docker_build_engine=PASS OSType=linux');
  assert.equal(calls, 1);
});

test('unavailable engine preserves reason and never retries or selects another target', async () => {
  let calls = 0;
  await assert.rejects(checkDockerEngine([], {run: async () => {
    calls++;
    throw Object.assign(new Error('exit 1'), {stderr: 'open //./pipe/dockerDesktopLinuxEngine: file not found'});
  }}), /build target: open .*dockerDesktopLinuxEngine: file not found/);
  assert.equal(calls, 1);
});

test('engine timeout is finite and blocks with an explicit reason', async () => {
  assert.equal(ENGINE_TIMEOUT_MS, 30000);
  let calls = 0;
  await assert.rejects(checkDockerEngine([], {run: async (_file, _args, options) => {
    calls++;
    assert.equal(options.timeout, ENGINE_TIMEOUT_MS);
    throw Object.assign(new Error('terminated'), {killed: true});
  }}), /timed out after 30 seconds/);
  assert.equal(calls, 1);
});

for (const stdout of ['windows', '', 'linux\nwindows', 'Linux']) {
  test('rejects unexpected or empty server OSType: ' + JSON.stringify(stdout), async () => {
    await assert.rejects(checkDockerEngine([], {run: async () => ({stdout})}), /Linux server required; OSType=/);
  });
}

for (const target of [null, {mode: 'local'}, {mode: 'context', context: 'desktop-linux'},
  {mode: 'context', context: 'context with spaces'}, {mode: 'host', host: 'npipe:////./pipe/test-engine'}, 'desktop-linux']) {
  test('preflight and build share exact Docker target: ' + JSON.stringify(target), async () => {
    const args = decodeTarget(dockerEngineReadinessCommand(target));
    let actual;
    await checkDockerEngine(args, {run: async (_file, argv) => { actual = argv; return {stdout: 'linux'}; }});
    const prefix = dockerCommand(target, []);
    const format = value => /^[0-9A-Za-z_./:=@{}+,-]+$/.test(value) ? value : "'" + value.replace(/'/g, "''") + "'";
    assert.equal(['docker', ...actual.slice(0, -3)].map(format).join(' '), prefix);
    assert.ok(dockerCommand(target, ['build', '--target', 'build']).startsWith(prefix + ' build --target build'));
    assert.ok(dockerCommand(target, ['image', 'inspect', 'image']).startsWith(prefix + ' image inspect'));
  });
}

test('production SSH context resolution retains the existing local build choice', () => {
  const target = resolveDockerCommandTarget('production', {resolved: true, local: false});
  assert.deepEqual(decodeTarget(dockerEngineReadinessCommand(target)), []);
  assert.equal(dockerCommand(target, ['build']), 'docker build');
});

test('invalid target requests cannot invoke the Docker CLI', async () => {
  for (const args of [null, ['build'], ['--context', 'x', '-H', 'y'], ['--context', ''], ['--config', 'x']]) {
    await assert.rejects(checkDockerEngine(args, {run: async () => assert.fail('unexpected Docker execution')}), /invalid build target/);
  }
});
