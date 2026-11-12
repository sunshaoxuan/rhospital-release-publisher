const assert=require('node:assert/strict');
const catalog=require('./currentBehaviorChecks.json');
function currentLocalCheck(key) {
  const spec=catalog[key];assert(spec,'Unregistered current behavior: '+key);
  const commands=['node --experimental-vm-modules --test --test-concurrency=1 '+spec.tests.join(' '),
    ...(spec.checks||[]).map(args=>'node '+args.join(' '))];
  return {key,command:commands.join(' && '),timeoutSeconds:spec.timeoutSeconds};
}
const TOILET_MARKET_CHECK=Object.freeze(currentLocalCheck('verify-toilet-market'));
const BACTERIA_AUTHORITATIVE_CHECK=Object.freeze(currentLocalCheck('verify-bacteria-authoritative-challenges'));
const BACTERIA_AUTHORITATIVE_INPUTS=Object.freeze([...catalog[BACTERIA_AUTHORITATIVE_CHECK.key].tests]);
function doubleCheckLocalChecks(checks,selected=checks) {
  assert(Array.isArray(checks)&&Array.isArray(selected),'Invalid local selection');
  assert.equal(new Set(checks.map(c=>c.key)).size,checks.length,'Duplicated local check');
  assert.deepEqual(checks.map(c=>c.key).sort(),selected.map(c=>c.key).sort(),'Local check selection mismatch');
  for(const check of checks) {
    const expected=currentLocalCheck(check.key),step=selected.find(c=>c.key===check.key);
    for(const field of ['command','timeoutSeconds']) {
      assert.equal(check[field],expected[field],'Current behavior contract mismatch: '+check.key+' '+field);
      assert.equal(step[field],expected[field],'Selected step mismatch: '+check.key+' '+field);
    }
  }return true;
}
function assertLocalCheckResult(check,result) {
  doubleCheckLocalChecks([check]);
  // Genuine complete TAP, not archived success markers or screenshot claims.
  require('./changeValidationRunner').assertNodeResult(result);
  return true;
}
function registeredLocalCheckContracts(){return Object.keys(catalog).map(key=>({...currentLocalCheck(key),
  inputs:[...catalog[key].tests,...(catalog[key].checks||[]).map(a=>a[0])],policyAccepted:true}));}
module.exports={currentLocalCheck,catalog,TOILET_MARKET_CHECK,BACTERIA_AUTHORITATIVE_CHECK,BACTERIA_AUTHORITATIVE_INPUTS,
  doubleCheckLocalChecks,assertLocalCheckResult,registeredLocalCheckContracts};
