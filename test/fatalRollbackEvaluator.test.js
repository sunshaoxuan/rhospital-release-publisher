const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

async function evaluator() {
  return import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'evaluate-game-fatal-rollback.mjs')).href);
}

test('application heartbeat predicates reject status, type and identity drift',async()=>{
 const {matchesHeartbeat}=await evaluator();
 const spec={path:'/api/fixture',method:'GET',status:200,equals:{valid:false},anyPresent:['id','name']};
 assert.equal(matchesHeartbeat(spec,200,{valid:false,id:7}),true);
 for(const [status,body] of [[500,{valid:false,id:7}],[200,{valid:0,id:7}],[200,{valid:false}],[200,null],[200,[]]])assert.equal(matchesHeartbeat(spec,status,body),false);
 assert.throws(()=>matchesHeartbeat({...spec,path:'http://uncontrolled'},200,{valid:false,id:7}));
});

test('fatal rollback requires three complete chain failures with a healthy database', async () => {
  const {decideFatalRollback} = await evaluator();
  const rounds = Array.from({length: 3}, () => ({
    gatewayCount: 2,
    gatewayFailures: 2,
    origin: false,
    remoteBusiness: false,
    database: true
  }));
  assert.deepEqual(decideFatalRollback(rounds), {
    decision: 'ROLLBACK_CONFIRMED',
    reason: 'three_round_full_chain_failure_with_healthy_database'
  });
});

test('one healthy path holds the target', async () => {
  const {decideFatalRollback} = await evaluator();
  const rounds = [
    {gatewayCount: 2, gatewayFailures: 2, origin: false, remoteBusiness: false, database: true},
    {gatewayCount: 2, gatewayFailures: 1, origin: false, remoteBusiness: false, database: true},
    {gatewayCount: 2, gatewayFailures: 2, origin: false, remoteBusiness: false, database: true}
  ];
  assert.equal(decideFatalRollback(rounds).decision, 'HOLD_TARGET');
});

test('database failure holds the target for infrastructure review', async () => {
  const {decideFatalRollback} = await evaluator();
  const rounds = Array.from({length: 3}, () => ({
    gatewayCount: 2,
    gatewayFailures: 2,
    origin: false,
    remoteBusiness: false,
    database: false
  }));
  assert.deepEqual(decideFatalRollback(rounds), {
    decision: 'HOLD_TARGET',
    reason: 'database_or_infrastructure_unhealthy'
  });
});

test('production-host business heartbeat holds the target during publisher network failure', async () => {
  const {decideFatalRollback} = await evaluator();
  const rounds = Array.from({length: 3}, () => ({
    gatewayCount: 2,
    gatewayFailures: 2,
    origin: false,
    remoteBusiness: true,
    database: true
  }));
  assert.equal(decideFatalRollback(rounds).decision, 'HOLD_TARGET');
});
