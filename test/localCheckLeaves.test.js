const test=require('node:test'),assert=require('node:assert/strict');
const {selectLeaves,runLeaves}=require('../src/localCheckLeaves');
const {currentLocalCheck}=require('../src/localCheckPolicy');
const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
test('shared current behavior leaves execute once and report both owners',async()=>{
 const checks=['verify-bacteria-region-covers','verify-bacteria-authoritative-challenges'].map(currentLocalCheck),seen=new Set(),observed=[];
 const plan=selectLeaves(checks);assert(plan.leaves.length<checks.reduce((n,c)=>n+plan.owners.get(c.key).length,0));
 const result=await runLeaves(checks,{onCheck:c=>observed.push(c.key),run:async leaf=>{assert(!seen.has(leaf.id));seen.add(leaf.id);assert(leaf.args.includes('--require'));return {status:0,output};}});
 assert(result.passed);assert.deepEqual(observed,checks.map(c=>c.key));
});
test('failed incomplete skipped and timed out leaves never produce a parent success',async()=>{
 const checks=[currentLocalCheck('verify-game-steam-auth')];
 for(const result of [{status:1,output},{status:0,output:'PASS'},{status:0,output:output.replace('# skipped 0','# skipped 1')},{status:null,error:'ETIMEDOUT',output}])await assert.rejects(runLeaves(checks,{run:async()=>result}));
});
test('unknown altered and recursive commands are rejected before executing work',async()=>{
 const c=currentLocalCheck('verify-game-steam-auth');let ran=false;
 await assert.rejects(runLeaves([{...c,command:c.command+' && npm test'}],{run:async()=>{ran=true;}}));assert.equal(ran,false);
 assert.throws(()=>selectLeaves([c,c]));
});
