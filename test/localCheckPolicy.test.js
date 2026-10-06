const test = require('node:test');
const assert = require('node:assert/strict');
const {doubleCheckLocalChecks, assertLocalCheckResult} = require('../src/localCheckPolicy');
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
