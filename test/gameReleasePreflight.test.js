const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {TOILET_MARKET_CHECK, assertLocalCheckResult} = require('../src/localCheckPolicy');

async function moduleUnderTest() {
  return import('../scripts/run-game-release-preflight.mjs');
}

function encoded(checks) {
  return Buffer.from(JSON.stringify({version: 1, checks}), 'utf8').toString('base64');
}

test('decodes validated checks and preserves PowerShell command quoting', async () => {
  const {decodeChecks} = await moduleUnderTest();
  const checks = [{key: 'verify-game-steam-auth', command: "node --test 'src/test/js/steamLogin.test.cjs'", timeoutSeconds: 30}];
  assert.deepEqual(decodeChecks(encoded(checks)), checks);
  assert.throws(() => decodeChecks(encoded([...checks, {...checks[0]}])), /无效或重复/);
  assert.throws(() => decodeChecks(encoded([{key: '../bad', command: 'ok', timeoutSeconds: 30}])), /名称无效/);
});

test('payload capacity retains encoding structure registration and per-check bounds', async () => {
  const {decodeChecks} = await moduleUnderTest();
  const check = {key: 'verify-game-steam-auth', command: 'node --test src/test/js/steamLogin.test.cjs', timeoutSeconds: 30};
  const payload = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  assert.deepEqual(decodeChecks(encoded([])), []);
  assert.deepEqual(decodeChecks(encoded([check])), [check]);
  for (const value of [undefined, '', '!', 'A'.repeat(100001)]) {
    assert.throws(() => decodeChecks(value), /编码无效/);
  }
  for (const value of [null, {version: 2, checks: []}, {version: 1, checks: {}}]) {
    assert.throws(() => decodeChecks(payload(value)), /结构无效/);
  }
  assert.throws(() => decodeChecks(encoded([check, {...check}])), /无效或重复/);
  assert.throws(() => decodeChecks(encoded([{...check, key: 'verify-unregistered'}])), /Unregistered local check/);
  for (const command of ['', ' '.repeat(3), 'x'.repeat(20001)]) {
    assert.throws(() => decodeChecks(encoded([{...check, command}])), /命令无效/);
  }
  for (const timeoutSeconds of [0, 3601, 1.5, '30', null]) {
    assert.throws(() => decodeChecks(encoded([{...check, timeoutSeconds}])), /超时无效/);
  }
  assert.throws(() => decodeChecks(encoded([{...check, command: 'npm test'}])), /aggregate|entrypoint|input/i);
});

test('runs every check and aggregates multiple failures', async () => {
  const {runChecks} = await moduleUnderTest();
  const seen = [], output = [];
  const checks = [
    {key: 'verify-game-steam-auth', command: 'node --test src/test/js/steamLogin.test.cjs', timeoutSeconds: 30},
    {key: 'verify-game-client-fingerprint', command: 'node --test src/test/js/clientFingerprint.test.mjs', timeoutSeconds: 30},
    {key: 'verify-game-medical-contest-entry', command: 'node --test src/test/js/medicalContestEntry.test.mjs', timeoutSeconds: 30}
  ];
  const result = runChecks(checks, {
    run(check) {
      seen.push(check.key);
      return check.key === 'verify-game-client-fingerprint'
        ? {status: 0, signal: null, error: '', output: '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n'}
        : {status: 1, signal: null, error: '', output: `${check.key} failed`};
    },
    write(text) { output.push(text); }
  });
  assert.deepEqual(seen, checks.map(check => check.key));
  assert.deepEqual(result, {passed: false, failures: [checks[0].key, checks[2].key]});
  assert.match(output.join(''), /game_release_preflight=FAIL checks=3 failures=2 keys=verify-game-steam-auth,verify-game-medical-contest-entry/);
});

test('real PowerShell runner fails closed on parser and native-command errors', async () => {
  const {runPowerShellCheck} = await moduleUnderTest();
  const parserFailure = runPowerShellCheck({
    key: 'parser-failure',
    command: 'Write-Output before && Write-Output after',
    timeoutSeconds: 30
  });
  assert.notEqual(parserFailure.status, 0);
  assert.match(parserFailure.output, /&&|statement separator|语句分隔符/);

  const nativeFailure = runPowerShellCheck({
    key: 'native-failure',
    command: 'node -e "process.exit(7)"',
    timeoutSeconds: 30
  });
  assert.equal(nativeFailure.status, 7);
});

test('reports a clean no-op when no local evidence checks apply', async () => {
  const {runChecks} = await moduleUnderTest();
  const output = [];
  const result = runChecks([], {run() { throw new Error('must not run'); }, write(text) { output.push(text); }});
  assert.deepEqual(result, {passed: true, failures: []});
  assert.equal(output.join(''), 'game_release_preflight=PASS checks=0\n');
});

test('toilet payload rejects canonical command and timeout drift before any process starts', async () => {
  const {decodeChecks, runChecks} = await moduleUnderTest();
  assert.deepEqual(decodeChecks(encoded([TOILET_MARKET_CHECK])), [TOILET_MARKET_CHECK]);
  for (const check of [
    {...TOILET_MARKET_CHECK, timeoutSeconds: 181},
    {...TOILET_MARKET_CHECK, command: TOILET_MARKET_CHECK.command + ' && npm test'}
  ]) {
    assert.throws(() => decodeChecks(encoded([check])));
    assert.throws(() => runChecks([check], {run() { assert.fail('must not execute invalid check'); }}));
  }
});

test('toilet native runner uses exact Node inputs and one shared timeout without a shell', async () => {
  const {runToiletMarketCheck} = await moduleUnderTest();
  const calls = [];
  const times = [1000, 1000, 16000];
  const result = runToiletMarketCheck(TOILET_MARKET_CHECK, {
    now: () => times.shift(),
    spawn(executable, args, options) {
      calls.push({executable, args, options});
      return {status: 0, stdout: calls.length === 1 ? 'tests\n' : 'evidence\n', stderr: ''};
    }
  });
  assert.equal(result.status, 0);
  assert.equal(result.output, 'tests\nevidence\n');
  assert.deepEqual(calls.map(call => call.args), [
    ['--test', 'src/test/js/toiletMarket.test.mjs', 'src/test/js/toiletMarketEvidence.test.mjs'],
    ['scripts/validation/toilet-market/validate-evidence.mjs']
  ]);
  assert(calls.every(call => call.executable === process.execPath && !call.options.shell && call.options.windowsHide));
  assert.deepEqual(calls.map(call => call.options.timeout), [180000, 165000]);
});

test('toilet runner short circuits process errors and shared timeout exhaustion', async () => {
  const {runToiletMarketCheck} = await moduleUnderTest();
  for (const failed of [{status: 7}, {status: 0, signal: 'SIGTERM'}, {status: null, error: new Error('ETIMEDOUT')}]) {
    let calls = 0;
    const result = runToiletMarketCheck(TOILET_MARKET_CHECK, {spawn() { calls++; return {...failed, stdout: 'blocked'}; }});
    assert.equal(calls, 1);
    assert.equal(result.status, failed.status);
    assert.equal(result.output, 'blocked');
    assert.throws(() => assertLocalCheckResult(TOILET_MARKET_CHECK, result));
  }
  const times = [0, 1, 180001];
  let calls = 0;
  const timedOut = runToiletMarketCheck(TOILET_MARKET_CHECK, {now: () => times.shift(), spawn() {calls++; return {status: 0};}});
  assert.equal(calls, 1);
  assert.equal(timedOut.error, 'ETIMEDOUT');
  assert.throws(() => assertLocalCheckResult(TOILET_MARKET_CHECK, timedOut));
});

test('real toilet runner accepts synthetic evidence and rejects failed tests evidence skips and incomplete output', async t => {
  const {runPowerShellCheck, runChecks} = await moduleUnderTest();
  const contracts = ['PASS toilet market barter, hourly positions, legacy-safe migration, runtime visuals and final source binding'];
  for (const scenario of ['success', 'test-failure', 'evidence-failure', 'skip', 'todo', 'cancelled', 'missing-marker']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-toilet-runner-'));
    t.after(() => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert(path.basename(root).startsWith('publisher-toilet-runner-'));
      fs.rmSync(root, {recursive: true, force: true});
    });
    const write = (relative, text) => {
      const filename = path.join(root, relative);
      fs.mkdirSync(path.dirname(filename), {recursive: true});
      fs.writeFileSync(filename, text);
    };
    const testBody = scenario === 'test-failure' ? "throw new Error('expected failure');" : '';
    const testOptions = scenario === 'skip' ? '{skip: true}, ' : scenario === 'todo' ? '{todo: true}, ' : '';
    write('src/test/js/toiletMarket.test.mjs', scenario === 'cancelled'
      ? "import {test} from 'node:test'; const held = setTimeout(() => {}, 100); test('synthetic cancelled', {timeout: 20}, () => new Promise(() => {})).finally(() => clearTimeout(held));"
      : "import {test} from 'node:test'; test('synthetic behavior', " + testOptions + '() => {' + testBody + '});');
    write('src/test/js/toiletMarketEvidence.test.mjs', "import {test} from 'node:test'; test('synthetic evidence', () => {});");
    write('scripts/validation/toilet-market/validate-evidence.mjs',
      "import fs from 'node:fs'; fs.writeFileSync('validator-ran', 'synthetic'); "
      + (scenario === 'evidence-failure' ? 'process.exitCode = 9;' : scenario === 'missing-marker' ? "console.log('incomplete');" : 'console.log(' + JSON.stringify(contracts[0]) + ');'));
    const output = [];
    let execution;
    const result = runChecks([TOILET_MARKET_CHECK], {
      run: check => (execution = runPowerShellCheck(check, {cwd: root, spawn(executable, args, options) {
        const env = {...process.env};
        delete env.NODE_TEST_CONTEXT;
        return spawnSync(executable, args, {...options, env});
      }})), write: text => output.push(text)
    });
    assert.equal(result.passed, scenario === 'success', scenario + '\n' + output.join(''));
    assert.equal(fs.existsSync(path.join(root, 'validator-ran')), !['test-failure', 'cancelled'].includes(scenario));
    if (['success', 'skip', 'todo', 'missing-marker'].includes(scenario)) assert.equal(execution.status, 0);
    if (scenario === 'evidence-failure') assert.equal(execution.status, 9);
    if (scenario === 'test-failure') assert.equal(execution.status, 1);
    if (scenario === 'cancelled') assert.match(execution.output, /[#\u2139] cancelled 1\b/);
    if (scenario === 'skip') assert.match(execution.output, /[#\u2139] skipped 1\b/);
    if (scenario === 'todo') assert.match(execution.output, /[#\u2139] todo 1\b/);
    assert.match(output.join(''), scenario === 'success' ? /preflight_check=PASS key=verify-toilet-market/ : /preflight_check=FAIL key=verify-toilet-market/);
  }
});
