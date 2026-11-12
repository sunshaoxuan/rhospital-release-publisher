const test=require('node:test'),assert=require('node:assert/strict');
const {currentLocalCheck,TOILET_MARKET_CHECK}=require('../src/localCheckPolicy');
const encoded=checks=>Buffer.from(JSON.stringify({version:1,checks})).toString('base64');
const tap='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
test('decoder accepts exact current contracts and rejects invalid registration structure and bounds',async()=>{
 const {decodeChecks}=await import('../scripts/run-game-release-preflight.mjs');const c=currentLocalCheck('verify-game-steam-auth');
 assert.deepEqual(decodeChecks(encoded([c])),[c]);assert.deepEqual(decodeChecks(encoded([])),[]);
 for(const value of ['', '!', 'A'.repeat(100001)])assert.throws(()=>decodeChecks(value));
 for(const checks of [[c,c],[{...c,key:'unknown'}],[{...c,command:'npm test'}],[{...c,timeoutSeconds:0}],[{...c,timeoutSeconds:3601}],[{...c,timeoutSeconds:1.5}]])assert.throws(()=>decodeChecks(encoded(checks)));
});
test('aggregate runner reports every selected failure without inheriting historical success markers',async()=>{
 const {runChecks}=await import('../scripts/run-game-release-preflight.mjs');const checks=['verify-game-steam-auth','verify-game-client-fingerprint','verify-game-medical-contest-entry'].map(currentLocalCheck),seen=[];
 const result=runChecks(checks,{write(){},run:c=>{seen.push(c.key);return {status:c.key===checks[1].key?0:1,output:tap};}});
 assert.deepEqual(seen,checks.map(c=>c.key));assert.deepEqual(result.failures,[checks[0].key,checks[2].key]);assert.equal(result.passed,false);
});
test('empty applicable selection does no work',async()=>{
 const {runChecks}=await import('../scripts/run-game-release-preflight.mjs');assert.deepEqual(runChecks([],{write(){},run(){assert.fail();}}),{passed:true,failures:[]});
});
test('toilet sync runner executes only its current Node command with one deadline',async()=>{
 const {runToiletMarketCheck}=await import('../scripts/run-game-release-preflight.mjs');const calls=[];
 const result=runToiletMarketCheck(TOILET_MARKET_CHECK,{now:()=>0,spawn:(exe,args,options)=>{calls.push({exe,args,options});return {status:0,stdout:tap};}});
 assert.equal(result.status,0);assert.equal(calls.length,1);assert.equal(calls[0].exe,process.execPath);
 assert.deepEqual(calls[0].args,TOILET_MARKET_CHECK.command.split(' ').slice(1));assert.equal(calls[0].options.timeout,180000);assert(!calls[0].options.shell);
 const times=[0,180001];let ran=false;const expired=runToiletMarketCheck(TOILET_MARKET_CHECK,{now:()=>times.shift(),spawn:()=>{ran=true;}});assert.equal(ran,false);assert.equal(expired.error,'ETIMEDOUT');
});
test('incomplete skipped cancelled and failed current output never becomes PASS',async()=>{
 const {runChecks}=await import('../scripts/run-game-release-preflight.mjs');const c=currentLocalCheck('verify-game-steam-auth');
 for(const bad of [{status:1,output:tap},{status:0,output:'historical PASS'},{status:0,output:tap.replace('# skipped 0','# skipped 1')},{status:0,signal:'SIGTERM',output:tap}])assert.equal(runChecks([c],{write(){},run:()=>bad}).passed,false);
});
