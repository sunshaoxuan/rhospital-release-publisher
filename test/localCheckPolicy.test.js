const test=require('node:test'),assert=require('node:assert/strict');
const {catalog,currentLocalCheck,doubleCheckLocalChecks,assertLocalCheckResult,registeredLocalCheckContracts}=require('../src/localCheckPolicy');
const good={status:0,output:'# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n'};

test('Resident presentation protocol rejects incomplete and altered checks',()=>{
 const check=currentLocalCheck('verify-resident-exchange-presentation');
 assert(check.command.includes('residentDrawPresentation.test.mjs'));assert.equal(check.timeoutSeconds,60);
 assertLocalCheckResult(check,good);
 for(const selection of [[],[check,check],[{...check,command:check.command+' && npm test'}]])assert.throws(()=>doubleCheckLocalChecks(selection,[check]));
 for(const result of [{status:1,output:good.output},{status:0,output:'PASS'}, {...good,output:good.output.replace('# skipped 0','# skipped 1')}])assert.throws(()=>assertLocalCheckResult(check,result));
});
test('all current contracts select exactly their registered entrypoints and budgets',()=>{
 for(const key of Object.keys(catalog)){
  const check=currentLocalCheck(key);doubleCheckLocalChecks([check]);assertLocalCheckResult(check,good);
  for(const command of [check.command+' ',check.command+' && npm test',check.command+' && node scripts/bacteria-lab/validate-design-evidence.mjs',check.command.replace(' --test ',' '),check.command+' && node -e bypass'])assert.throws(()=>doubleCheckLocalChecks([{...check,command}]));
  assert.throws(()=>doubleCheckLocalChecks([{...check,timeoutSeconds:check.timeoutSeconds+1}]));
 }
});
test('missing extra duplicate unknown or substituted selection fails closed',()=>{
 const check=currentLocalCheck('verify-toilet-market'),other=currentLocalCheck('verify-game-steam-auth');
 for(const [checks,selected] of [[[check],[]],[[],[check]],[[check],[other]],[[check,check],[check]],[[check],[check,other]]])assert.throws(()=>doubleCheckLocalChecks(checks,selected));
 assert.throws(()=>currentLocalCheck('unknown'));
});
test('a historical marker cannot replace actual current behavior and every failure protocol rejects',()=>{
 const check=currentLocalCheck('verify-toilet-market');
 for(const bad of [{status:0,output:'PASS toilet market historical evidence'}, {...good,status:1},{...good,signal:'SIGTERM'},{...good,error:'timeout'}, {...good,output:good.output.replace('# skipped 0','# skipped 1')},{...good,output:good.output.replace('# fail 0','# fail 1')}])assert.throws(()=>assertLocalCheckResult(check,bad));
});
test('contract metadata is a defensive copy and current commands do not claim browser evidence',()=>{
 const contract=registeredLocalCheckContracts()[0];contract.inputs.push('unrelated');
 assert(!registeredLocalCheckContracts()[0].inputs.includes('unrelated'));
 for(const check of registeredLocalCheckContracts())assert(!/validate-.+evidence|Evidence\.test|runtime visuals/.test(check.command));
});
