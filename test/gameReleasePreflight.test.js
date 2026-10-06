const test = require('node:test');
const assert = require('node:assert/strict');

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
