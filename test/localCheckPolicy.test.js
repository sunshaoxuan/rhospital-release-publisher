const test = require('node:test');
const assert = require('node:assert/strict');
const {TOILET_MARKET_CHECK, doubleCheckLocalChecks, assertLocalCheckResult, registeredLocalCheckContracts} = require('../src/localCheckPolicy');
const toiletSpec = require('./fixtures/toilet-market-node-spec.json');
const steam = {key: 'verify-game-steam-auth', command: 'node --test src/test/js/steamLogin.test.cjs', timeoutSeconds: 120};
const good = {status: 0, output: '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n'};

test('Double Check accepts exact independent selection and a genuine empty selection', () => {
  assert(doubleCheckLocalChecks([steam], [steam]));
  assert(doubleCheckLocalChecks([], []));
  for (const [checks, selected] of [[[steam], []], [[], [steam]], [[steam, steam], [steam]]])
    assert.throws(() => doubleCheckLocalChecks(checks, selected));
});

test('Double Check rejects unrelated, aggregate, recursive and repeated inputs', () => {
  for (const command of [steam.command+'; node src/test/js/bacteriaRegionCovers.test.mjs',
    steam.command+'; npm run test:bacteria-lab', steam.command+'; node scripts/refresh-release-evidence.mjs',
    steam.command+'; '+steam.command, 'node --test src/test/js/clientFingerprint.test.mjs'])
    assert.throws(() => doubleCheckLocalChecks([{...steam, command}]));
  assert.throws(() => doubleCheckLocalChecks([{...steam, key:'unknown'}]));
  assert.throws(() => doubleCheckLocalChecks([{...steam, command:steam.command+' '}], [steam]), /command mismatch/);
  assert.throws(() => doubleCheckLocalChecks([{...steam, timeoutSeconds:121}], [steam]), /timeout mismatch/);
});

test('TAP completion rejects failures, skips, cancelled, TODO, truncation and execution errors', () => {
  assert(assertLocalCheckResult(steam, good));
  for (const result of [{...good,status:1},{...good,error:'ETIMEDOUT'},{...good,signal:'SIGTERM'},
    {...good,output:''},{...good,output:'PASS'}, {...good,output:good.output.replace('# pass 1','# pass 0')},
    ...['fail','skipped','cancelled','todo'].map(name=>({...good,output:good.output.replace('# '+name+' 0','# '+name+' 1')})),
    {...good,output:good.output.replace('# fail 0\n','')}, {...good,output:good.output+'ok 1 - ignored # SKIP\n'}])
    assert.throws(() => assertLocalCheckResult(steam,result));
});

test('JSON success is accepted only under its registered protocol and complete counts', () => {
  for (const [key, report] of [
    ['verify-game-potion-lab',{result:'PASS',checkCount:6,sourceCount:20}],
    ['verify-game-emergency-guard',{status:'PASS',protocol:'emergency-hospital-v1',checks:6,sources:20}]
  ]) {
    const check={key};
    assert(assertLocalCheckResult(check,{status:0,output:JSON.stringify(report)}));
    for(const output of ['PASS','{}',JSON.stringify({...report,checkCount:0,checks:0}), JSON.stringify({...report,result:'FAIL',status:'FAIL'})])
      assert.throws(()=>assertLocalCheckResult(check,{status:0,output}));
    assert.throws(()=>assertLocalCheckResult(check,{status:1,output:JSON.stringify(report)}));
    assert.throws(()=>assertLocalCheckResult(check,{status:0,output:good.output+JSON.stringify({...report,protocol:'other',checkCount:0})}));
  }
});

test('independent loading HUD and fault protocols reject cross-feature additions and missing evidence', () => {
  const specs = [
    ['verify-bacteria-authoritative-challenges', 'src/test/js/bacteriaAuthoritativeChallenge.test.mjs src/test/js/bacteriaCoverReveal.test.mjs src/test/js/bacteriaConcurrentSelection.test.mjs src/test/js/bacteriaSpeed.test.mjs src/test/js/bacteriaSettlementTiming.test.mjs src/test/js/bacteriaChallengeEvidence.test.mjs', 'scripts/bacteria-lab/validate-authoritative-challenge-evidence.mjs', 'PASS bacteria authoritative challenge paths, privacy, lifecycle and final source binding'],
    ["verify-bacteria-gates", "src/test/js/bacteriaGateAnimation.test.mjs src/test/js/bacteriaVisibilityMechanics.test.mjs src/test/js/bacteriaGateEvidence.test.mjs", "scripts/bacteria-lab/validate-gate-evidence.mjs", "PASS bacteria gates all-depth toggle, privacy, promotion and final source binding"],
    ['verify-bacteria-ranking', 'src/test/js/bacteriaRankingEvidence.test.mjs', 'scripts/bacteria-lab/validate-ranking-evidence.mjs', 'PASS bacteria ranking, modal isolation, four-view geometry and final source binding'],
    ['verify-game-loading', 'scripts/tests/game-loading-recovery.test.mjs scripts/tests/emergency-fetch.test.mjs', 'scripts/ui/validate-game-loading-evidence.mjs', 'PASS bounded loading recovery evidence, actual runtime and final source binding'],
    ['verify-hospital-hud', 'src/test/js/hospitalHudGeometry.test.mjs', 'scripts/ui/validate-hospital-hud.mjs', 'PASS hospital HUD geometry, runtime evidence and final source binding'],
    ['verify-game-fault-reports', 'src/test/js/bacteriaDiagnostics.test.mjs src/test/js/bacteriaFaultReportEvidence.test.mjs', 'scripts/bacteria-lab/validate-fault-report-evidence.mjs', 'PASS bounded fault reports, privacy, real persistence, authorization, four-view geometry and final source bindings']
  ];
  for (const [key, tests, validator, marker] of specs) {
    const check = {key, command: 'node --test '+tests+'; node '+validator, timeoutSeconds:180};
    assert(doubleCheckLocalChecks([check]));
    assert(assertLocalCheckResult(check, {...good, output:good.output+marker}));
    assert.throws(() => assertLocalCheckResult(check, good));
    assert.throws(() => assertLocalCheckResult(check, {...good,status:1,output:good.output+marker}));
    assert.throws(() => doubleCheckLocalChecks([{...check,command:check.command+'; '+steam.command}]));
    assert.throws(() => doubleCheckLocalChecks([{...check,command:check.command.replace('node '+validator,'')} ]));
    assert.throws(() => doubleCheckLocalChecks([{...check,command:check.command+'; node '+validator}]));
  }
});


test('gate check rejects missing, extra and duplicate entrypoints', () => {
  const check={key:'verify-bacteria-gates',command:'node --test src/test/js/bacteriaGateAnimation.test.mjs src/test/js/bacteriaVisibilityMechanics.test.mjs src/test/js/bacteriaGateEvidence.test.mjs; node scripts/bacteria-lab/validate-gate-evidence.mjs',timeoutSeconds:180};
  assert(doubleCheckLocalChecks([check]));
  for(const command of [check.command.replace(' src/test/js/bacteriaGateEvidence.test.mjs',''),check.command+'; node scripts/bacteria-lab/validate-ranking-evidence.mjs',check.command+'; node scripts/bacteria-lab/validate-gate-evidence.mjs'])
    assert.throws(()=>doubleCheckLocalChecks([{...check,command}]));
});

const toilet = TOILET_MARKET_CHECK;
const toiletMarker = 'PASS toilet market barter, hourly positions, legacy-safe migration, runtime visuals and final source binding';
const toiletInputs = ['src/test/js/toiletMarket.test.mjs', 'src/test/js/toiletMarketEvidence.test.mjs', 'scripts/validation/toilet-market/validate-evidence.mjs'];

test('toilet contract exposes the exact live policy and defensively copies input metadata', () => {
  const contract = registeredLocalCheckContracts().find(check => check.key === toilet.key);
  assert.deepEqual(contract, {...toilet, inputs: toiletInputs, successMarker: toiletMarker, policyAccepted: true});
  contract.inputs.push('unrelated');
  assert.deepEqual(registeredLocalCheckContracts().find(check => check.key === toilet.key).inputs, toiletInputs);
  assert(doubleCheckLocalChecks([toilet]));
  assert(doubleCheckLocalChecks([toilet, steam], [steam, toilet]));
  assert.throws(() => assertLocalCheckResult({key: toilet.key}, {...good, output: good.output + toiletMarker}));
});

test('toilet selection rejects missing extra repeated and wrong keys', () => {
  for (const [checks, selected] of [
    [[toilet], []], [[], [toilet]], [[toilet], [toilet, steam]],
    [[toilet, steam], [toilet]], [[toilet, toilet], [toilet]],
    [[toilet], [toilet, toilet]], [[toilet], [steam]],
    [[{...toilet, key: 'verify-toilet-market-unknown'}], [{...toilet, key: 'verify-toilet-market-unknown'}]]
  ]) assert.throws(() => doubleCheckLocalChecks(checks, selected));
});

test('toilet command rejects omitted extra repeated cross-feature aggregate recursive and altered execution', () => {
  const commands = [
    ...toiletInputs.map(input => toilet.command.replace(input, '')),
    ...toiletInputs.map(input => toilet.command + ' && node ' + input),
    toilet.command + ' && node src/test/js/bacteriaGateEvidence.test.mjs',
    toilet.command + ' && node scripts/bacteria-lab/validate-ranking-evidence.mjs',
    toilet.command + ' && npm test',
    toilet.command + ' && node scripts/run-game-release-preflight.mjs',
    toilet.command.replace(toiletInputs[0], 'src/test/js/steamLogin.test.cjs'),
    toilet.command.replace(' && ', '; '), toilet.command.replace(' && ', ' || '),
    toilet.command.replace('node --test', 'node'),
    toilet.command.replace('node --test', 'node --test --test-name-pattern=only'),
    toilet.command + ' && node -e "process.exit(0)"', toilet.command + ' ',
    toilet.command.replace('node --test', 'echo node --test')
  ];
  for (const command of commands) {
    const check = {...toilet, command};
    assert.throws(() => doubleCheckLocalChecks([check]), /command mismatch/, command);
    assert.throws(() => doubleCheckLocalChecks([check], [check]), /command mismatch/, command);
  }
});

test('toilet timeout is canonical even when selected and executable declarations drift together', () => {
  for (const timeoutSeconds of [undefined, 0, 179, 181, 3600, '180']) {
    const check = {...toilet, timeoutSeconds};
    assert.throws(() => doubleCheckLocalChecks([check], [check]), /timeout mismatch/);
  }
});

test('toilet complete TAP and actual Node spec summaries accept varying counts and exact marker only', () => {
  // The recorded application's test output has no final runtime PASS marker.
  assert.throws(() => assertLocalCheckResult(toilet, {status: toiletSpec.exitCode, output: toiletSpec.stdout}));
  assert(assertLocalCheckResult(toilet, {status: toiletSpec.exitCode, output: toiletSpec.stdout + toiletMarker + '\n'}));
  for (const count of [1, 7, 37, 211]) {
    const summary = good.output.replace('# tests 1', '# tests ' + count).replace('# pass 1', '# pass ' + count);
    for (const output of [summary, summary.replaceAll('#', '\u2139')]) {
      assert(assertLocalCheckResult(toilet, {status: 0, output: output + toiletMarker + '\n'}));
      assert(assertLocalCheckResult(toilet, {status: 0, output: '\x1b[32m' + output + '\x1b[0m' + toiletMarker + '\r\n'}));
    }
  }
});

test('toilet results reject nonzero exits failures skips cancellations TODO truncation and marker lookalikes', () => {
  const valid = good.output + toiletMarker + '\n';
  const invalidOutputs = [
    '', toiletMarker, good.output,
    good.output + 'prefix ' + toiletMarker, good.output + toiletMarker + ' extra',
    good.output + toiletMarker.slice(0, -1),
    valid.replace('# tests 1', '# tests 0').replace('# pass 1', '# pass 0'),
    valid.replace('# pass 1', '# pass 0'),
    valid.replace('# tests 1', '# tests 9007199254740992').replace('# pass 1', '# pass 9007199254740992'),
    ...['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(name => valid.replace(new RegExp('^# ' + name + '.*\\n', 'm'), '')),
    ...['fail', 'skipped', 'cancelled', 'todo'].map(name => valid.replace('# ' + name + ' 0', '# ' + name + ' 1')),
    ...['fail', 'skipped', 'cancelled', 'todo'].map(name => valid.replaceAll('#', '\u2139').replace('\u2139 ' + name + ' 0', '\u2139 ' + name + ' 1')),
    valid + 'not ok 1 - failed\n', valid + 'ok 1 - omitted # SKIP\n', valid + 'ok 1 - pending # TODO\n',
    valid + 'game_release_preflight=FAIL\n', valid + '# pass 1\n', valid + good.output
  ];
  for (const output of invalidOutputs) assert.throws(() => assertLocalCheckResult(toilet, {status: 0, output}), undefined, output);
  for (const result of [{status: 1}, {status: null}, {status: '0'}, {status: 0, error: 'ETIMEDOUT'}, {status: 0, signal: 'SIGTERM'}])
    assert.throws(() => assertLocalCheckResult(toilet, {output: valid, ...result}));
});
