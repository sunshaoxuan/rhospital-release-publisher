const test=require('node:test'),assert=require('node:assert/strict');
const {selectLeaves,runLeaves}=require('../src/localCheckLeaves');
const {BACTERIA_AUTHORITATIVE_CHECK,TOILET_MARKET_CHECK}=require('../src/localCheckPolicy');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const steam={key:'verify-game-steam-auth',command:'node --test src/test/js/steamLogin.test.cjs',timeoutSeconds:120};
const design={key:'verify-design-level-packages',command:'node --test src/test/js/bacteriaPathDifficulty.test.mjs src/test/js/designLevelPackage.test.mjs src/test/js/designWorker.test.mjs src/test/js/bacteriaSharedRules.test.mjs && node scripts/bacteria-lab/build-level-catalog.mjs --check && node scripts/bacteria-lab/validate-design-evidence.mjs',timeoutSeconds:1800};
test('design and authoritative shared tests have one executable leaf with both owners',()=>{
  const plan=selectLeaves([design,BACTERIA_AUTHORITATIVE_CHECK]);
  const shared=plan.leaves.filter(l=>l.args.includes('src/test/js/bacteriaConcurrentSelection.test.mjs'));
  assert.equal(shared.length,1);
  assert(plan.owners.get(design.key).includes(shared[0].id));assert(plan.owners.get(BACTERIA_AUTHORITATIVE_CHECK.key).includes(shared[0].id));
  assert(plan.leaves.length<plan.owners.get(design.key).length+plan.owners.get(BACTERIA_AUTHORITATIVE_CHECK.key).length);
  const evidence=plan.leaves.find(l=>l.args[0]==='scripts/bacteria-lab/validate-design-evidence.mjs');
  assert(evidence.args.includes('--leaf-plan-v1'),'new candidates must reject the old opaque publisher runner');
});
test('finite leaf selection preserves pinned contracts and rejects shell injections and unmapped aggregates',()=>{
  const p=selectLeaves([TOILET_MARKET_CHECK,BACTERIA_AUTHORITATIVE_CHECK,steam]);
  assert.equal(p.owners.size,3);assert.equal(p.leaves.length,10);
  assert.throws(()=>selectLeaves([{...steam,command:steam.command+'; npm test'}]));
  assert.throws(()=>selectLeaves([steam,steam]));
});
test('every leaf needs authentic complete output; failure cannot become a parent PASS',async()=>{
  const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';let runs=0;
  const r=await runLeaves([steam],{run:async()=>{runs++;return {status:0,output};}});assert(r.passed);assert.equal(runs,1);
  await assert.rejects(runLeaves([steam],{run:async()=>({status:0,output:'PASS'})}),/completion/);
  await assert.rejects(runLeaves([steam],{run:async()=>({status:1,output})}),/Leaf failed/);
});
test('actual publisher CLI uses shell-free leaves and reports genuine Node success and failure',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'preflight-leaf-'));
  try {
    const file=path.join(root,'src/test/js/steamLogin.test.cjs');fs.mkdirSync(path.dirname(file),{recursive:true});
    const args=[path.resolve(__dirname,'../scripts/run-game-release-preflight.mjs'),'--checks-base64',Buffer.from(JSON.stringify({version:1,checks:[steam]})).toString('base64')];
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    fs.writeFileSync(file,"require('node:test')('controlled positive',()=>{});");
    let result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:10000,windowsHide:true});
    assert.equal(result.status,0,result.stdout+result.stderr);assert(result.stdout.includes('game_release_preflight=PASS checks=1 leaves=1'));
    fs.writeFileSync(file,"require('node:test')('controlled negative',()=>{throw new Error('expected failure');});");
    result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:10000,windowsHide:true});
    assert.notEqual(result.status,0);assert(!result.stdout.includes('game_release_preflight=PASS'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('shared leaves execute once; extra manifest entries and recursive evidence are rejected before work',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dedup-leaf-'));
  try {
    const dir=path.join(root,'scripts/bacteria-lab');fs.mkdirSync(dir,{recursive:true});
    const manifest=require('../src/designValidationLeaves.json');
    fs.writeFileSync(path.join(dir,'design-validation-leaves.json'),JSON.stringify(manifest));
    const evidence=path.join(dir,'validate-design-evidence.mjs');fs.writeFileSync(evidence,'// controlled non-recursive evidence fixture');
    const seen=new Set();const run=async leaf=>{
      assert(!seen.has(leaf.id),'duplicate leaf execution');seen.add(leaf.id);
      const output=leaf.test?'# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n':
        leaf.args[0].includes('validate-authoritative')?'PASS bacteria authoritative challenge paths, privacy, lifecycle and final source binding':
        leaf.args[0].includes('validate-design')?'PASS: final desktop/mobile geometry, browser functions, console and resource responses':'controlled build check complete';
      return {status:0,output};
    };
    const result=await runLeaves([design,BACTERIA_AUTHORITATIVE_CHECK],{root,run});assert(result.passed);
    assert.equal(seen.size,selectLeaves([design,BACTERIA_AUTHORITATIVE_CHECK]).leaves.length);
    const forbid=async()=>assert.fail('invalid selection executed');
    fs.writeFileSync(evidence,"import 'node:child_process';");
    await assert.rejects(runLeaves([design],{root,run:forbid}),/nested/);
    fs.writeFileSync(evidence,'// leaf');fs.writeFileSync(path.join(dir,'design-validation-leaves.json'),JSON.stringify({...manifest,tests:[...manifest.tests,'unrelated.test.js']}));
    await assert.rejects(runLeaves([design],{root,run:forbid}),/ownership differs/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
