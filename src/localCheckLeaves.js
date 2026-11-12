const fs=require('node:fs'),path=require('node:path');
const {doubleCheckLocalChecks,assertLocalCheckResult}=require('./localCheckPolicy');
const {assertNodeResult}=require('./changeValidationRunner');
const design=require('./designValidationLeaves.json');
const supported=new Set(['verify-toilet-market','verify-bacteria-authoritative-challenges','verify-bacteria-gates','verify-game-steam-auth','verify-design-level-packages']);
function selectLeaves(checks) {
  doubleCheckLocalChecks(checks);
  const leaves=new Map(),owners=new Map();
  for(const check of checks) {
    if(!supported.has(check.key))throw new Error('UNMAPPED_LEAF: register finite leaf ownership for '+check.key);
    const specs=[];
    const normalized=check.command.replaceAll('; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };',' && ');
    for(const command of normalized.split(/\s*&&\s*/)) {
      const tokens=command.trim().split(/\s+/);
      if(tokens.shift()!=='node'||tokens.some(t=>!/^[-\w./]+$/.test(t)))throw new Error('Only registered shell-free Node leaves are allowed');
      const test=tokens.includes('--test')||tokens.some(t=>/\.test\.(?:mjs|cjs|js)$/.test(t));
      const files=tokens.filter(t=>!t.startsWith('--'));
      if(test) {
        if(tokens.some(t=>t.startsWith('--')&&!['--test','--test-concurrency=1'].includes(t)))throw new Error('Unregistered Node test option');
        // The pinned toilet protocol requires one authentic combined TAP summary.
        if(check.key==='verify-toilet-market')specs.push({args:['--test','--test-concurrency=1',...files],test:true});
        else for(const file of files)specs.push({args:['--test','--test-concurrency=1',file],test:true});
      } else specs.push({args:tokens[0]==='scripts/bacteria-lab/validate-design-evidence.mjs'?[...tokens,'--leaf-plan-v1']:tokens,test:false});
    }
    if(check.key==='verify-design-level-packages') {
      for(const file of design.tests)specs.push({args:['--test','--test-concurrency=1',file],test:true});
      for(const args of design.checks)specs.push({args,test:false});
    }
    const ids=[];
    for(const spec of specs) {
      const id=JSON.stringify(spec.args);
      if(ids.includes(id))continue;
      ids.push(id);
      if(!leaves.has(id))leaves.set(id,{...spec,id,timeoutSeconds:check.timeoutSeconds});
      else leaves.get(id).timeoutSeconds=Math.min(leaves.get(id).timeoutSeconds,check.timeoutSeconds);
    }
    owners.set(check.key,ids);
  }
  return {leaves:[...leaves.values()],owners};
}
async function runLeaves(checks,{root=process.cwd(),run,write=()=>{}}) {
  const plan=selectLeaves(checks),results=new Map(),elapsed=new Map();
  // All selection and manifest checks precede execution.
  if(checks.some(c=>c.key==='verify-design-level-packages')) {
    const actual=JSON.parse(fs.readFileSync(path.join(root,'scripts/bacteria-lab/design-validation-leaves.json'),'utf8'));
    if(JSON.stringify(actual)!==JSON.stringify(design))throw new Error('Design leaf ownership differs from committed policy');
    if(/child_process|execFile|spawn\s*\(/.test(fs.readFileSync(path.join(root,'scripts/bacteria-lab/validate-design-evidence.mjs'),'utf8')))throw new Error('Evidence leaf may not start nested test runners');
  }
  for(const leaf of plan.leaves) {
    const owners=checks.filter(c=>plan.owners.get(c.key).includes(leaf.id));
    const remaining=Math.min(...owners.map(c=>c.timeoutSeconds*1000-(elapsed.get(c.key)||0)));
    if(remaining<=0)throw new Error('Parent validation budget exhausted: '+leaf.id);
    write('preflight_leaf_begin='+leaf.id+'\n');
    const started=Date.now(),result=await run({...leaf,timeoutSeconds:remaining/1000},write);
    for(const owner of owners)elapsed.set(owner.key,(elapsed.get(owner.key)||0)+(Date.now()-started));
    if(result.status!==0||result.signal||result.error)throw new Error('Leaf failed: '+leaf.id);
    if(leaf.test)assertNodeResult(result);
    else if(!result.output?.trim())throw new Error('Missing leaf output: '+leaf.id);
    results.set(leaf.id,result);
  }
  for(const check of checks) {
    const output=plan.owners.get(check.key).map(id=>results.get(id).output).join('\n');
    assertLocalCheckResult(check,{status:0,output});
    write('preflight_check=PASS key='+check.key+'\n');
  }
  write('game_release_preflight=PASS checks='+checks.length+' leaves='+plan.leaves.length+'\n');
  return {passed:true,failures:[],leaves:plan.leaves.length};
}
module.exports={selectLeaves,runLeaves};
