const path=require('node:path');
const {catalog,doubleCheckLocalChecks,assertLocalCheckResult}=require('./localCheckPolicy');
const {assertNodeResult}=require('./changeValidationRunner');
function selectLeaves(checks) {
  doubleCheckLocalChecks(checks);
  const leaves=new Map(),owners=new Map();
  for(const check of checks) {
    const spec=catalog[check.key],ids=[];
    const specs=[...spec.tests.map(file=>({args:['--experimental-vm-modules','--test','--test-concurrency=1',file],test:true})),
      ...(spec.checks||[]).map(args=>({args,test:false}))];
    for(const leaf of specs) {
      const id=JSON.stringify(leaf.args);ids.push(id);
      if(!leaves.has(id))leaves.set(id,{...leaf,id,timeoutSeconds:check.timeoutSeconds});
    }
    owners.set(check.key,ids);
  }
  return {leaves:[...leaves.values()],owners};
}
async function runLeaves(checks,{root=process.cwd(),run,write=()=>{},onCheck=()=>{}}) {
  const plan=selectLeaves(checks),results=new Map(),elapsed=new Map();
  const guard=path.resolve(__dirname,'currentBehaviorGuard.cjs');
  for(const leaf of plan.leaves) {
    const owners=checks.filter(c=>plan.owners.get(c.key).includes(leaf.id));
    const remaining=Math.min(...owners.map(c=>c.timeoutSeconds*1000-(elapsed.get(c.key)||0)));
    if(remaining<=0)throw new Error('Parent validation budget exhausted: '+leaf.id);
    write('preflight_leaf_begin='+leaf.id+'\n');
    const started=Date.now(),result=await run({...leaf,args:['--require',guard,...leaf.args],root,timeoutSeconds:remaining/1000},write);
    for(const owner of owners)elapsed.set(owner.key,(elapsed.get(owner.key)||0)+(Date.now()-started));
    if(result.status!==0||result.signal||result.error)
      throw new Error('Leaf failed: '+leaf.id+' exit='+result.status+' signal='+(result.signal||'none')+' error='+(result.error||'none'));
    if(leaf.test)assertNodeResult(result);
    else if(!result.output?.trim())throw new Error('Missing leaf output: '+leaf.id);
    results.set(leaf.id,result);
  }
  for(const check of checks) {
    const output=plan.owners.get(check.key).map(id=>results.get(id).output).join('\n');
    assertLocalCheckResult(check,{status:0,output});
    onCheck(check,{status:0,output});
    write('preflight_current_behavior=PASS key='+check.key+'\n');
    write('preflight_check=PASS key='+check.key+'\n');
  }
  write('game_release_preflight=PASS checks='+checks.length+' leaves='+plan.leaves.length+'\n');
  return {passed:true,failures:[],leaves:plan.leaves.length};
}
module.exports={selectLeaves,runLeaves};
