const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test, temporaryDirectory} = require('./helpers/ownedFixtures').fixtureLifecycle(require('node:test'));
const {BACTERIA_AUTHORITATIVE_CHECK: check, doubleCheckLocalChecks,
  assertLocalCheckResult, registeredLocalCheckContracts} = require('../src/localCheckPolicy');
const marker = 'PASS bacteria authoritative challenge paths, privacy, lifecycle and final source binding';
const tap = '# tests 125\n# pass 125\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';

test('authoritative budget is exact, independently exported and rejects drift before execution', async () => {
  const {decodeChecks, runChecks} = await import('../scripts/run-game-release-preflight.mjs');
  const contract = registeredLocalCheckContracts().find(item => item.key === check.key);
  assert.equal(check.timeoutSeconds, 300);
  assert.equal(contract.timeoutSeconds, 300);
  assert.equal(contract.inputs.length, 7);
  contract.inputs.pop();
  assert.equal(registeredLocalCheckContracts().find(item => item.key === check.key).inputs.length, 7);
  assert(doubleCheckLocalChecks([check]));
  assert.throws(() => doubleCheckLocalChecks([check], []));
  assert.throws(() => doubleCheckLocalChecks([check, check]));
  for (const changed of [
    ...[undefined, 180, 299, 301, 3600, '300'].map(timeoutSeconds => ({...check, timeoutSeconds})),
    {...check, command: check.command.replace('src/test/js/bacteriaSpeed.test.mjs ', '')},
    {...check, command: check.command + '; node scripts/bacteria-lab/validate-authoritative-challenge-evidence.mjs'},
    {...check, command: check.command + '; node scripts/bacteria-lab/validate-ranking-evidence.mjs'},
    {...check, command: check.command.replace('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ', '')}
  ]) {
    assert.throws(() => doubleCheckLocalChecks([changed], [changed]));
    assert.throws(() => decodeChecks(Buffer.from(JSON.stringify({version: 1, checks: [changed]})).toString('base64')));
    assert.throws(() => runChecks([changed], {run() { assert.fail('invalid contract executed'); }}));
  }
});

test('authoritative budget reaches the native executor once and never accepts timeout as PASS', async () => {
  const {runPowerShellCheck, runChecks} = await import('../scripts/run-game-release-preflight.mjs');
  for (const failure of [null, {status: null, error: new Error('ETIMEDOUT'), signal: 'SIGTERM'}, {status: 7}]) {
    let calls = 0;
    const output = [];
    const outcome = runChecks([check], {write: text => output.push(text), run: candidate => runPowerShellCheck(candidate, {
      spawn(executable, args, options) {
        calls++;
        assert.equal(options.timeout, 300000);
        assert.equal(executable, 'powershell');
        assert(options.input.includes(Buffer.from(check.command).toString('base64')));
        return {status: 0, stdout: tap + marker, ...failure};
      }
    })});
    assert.equal(calls, 1);
    assert.equal(outcome.passed, !failure);
    assert.match(output.join(''), failure ? /game_release_preflight=FAIL/ : /game_release_preflight=PASS/);
  }
  for (const result of [
    {status: 0, output: tap},
    {status: 0, output: tap.replace('# pass 125', '# pass 124') + marker},
    {status: 0, output: tap.replace('# skipped 0', '# skipped 1') + marker},
    {status: 0, output: tap + marker, signal: 'SIGTERM'}
  ]) assert.throws(() => assertLocalCheckResult(check, result));
});

test('authoritative native contract retains all seven inputs and stops on test or evidence failure', async () => {
  const {runChecks, runPowerShellCheck} = await import('../scripts/run-game-release-preflight.mjs');
  const inputs = registeredLocalCheckContracts().find(item => item.key === check.key).inputs;
  for (const scenario of ['pass', 'tests-fail', 'evidence-fail', 'marker-missing']) {
    const root = temporaryDirectory('release-publisher-authoritative-contract-');
    for (const [index, input] of inputs.entries()) {
      const filename = path.join(root, input);
      fs.mkdirSync(path.dirname(filename), {recursive: true});
      fs.writeFileSync(filename, index < 6
        ? `import {test} from 'node:test'; test('isolated fixture ${index}',()=>{${scenario === 'tests-fail' && index === 0 ? "throw Error('expected test failure')" : ''}});`
        : `import fs from 'node:fs'; fs.writeFileSync('validator-ran','yes'); ${scenario === 'evidence-fail' ? 'process.exitCode=9;' : scenario === 'marker-missing' ? "console.log('incomplete');" : `console.log(${JSON.stringify(marker)});`}`);
    }
    let captured;
    const result = runChecks([check], {write() {}, run: candidate => (captured = runPowerShellCheck(candidate, {
      cwd: root, spawn(executable, args, options) {
        const env = {...process.env}; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
        return spawnSync(executable, args, {...options, env});
      }
    }))});
    assert.equal(result.passed, scenario === 'pass', `${scenario}\n${captured.output}`);
    assert.equal(fs.existsSync(path.join(root, 'validator-ran')), scenario !== 'tests-fail');
    if (scenario === 'pass') {
      assert.match(captured.output, /(?:#|ℹ) tests 6/);
      assert.match(captured.output, /isolated fixture 0/);
    }
  }
});
