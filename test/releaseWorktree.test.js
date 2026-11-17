const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const test = require('node:test');

const {
  createReleaseWorktree,
  removeReleaseWorktree
} = require('../src/releaseWorktree');

test('creates a clean detached release worktree without changing developer files', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'release-worktree-'));
  const sourceRoot = path.join(sandbox, 'source');
  const publisherRoot = path.join(sandbox, 'publisher');
  fs.mkdirSync(sourceRoot, {recursive: true});
  fs.mkdirSync(publisherRoot, {recursive: true});
  runGit(sourceRoot, ['init']);
  runGit(sourceRoot, ['config', 'user.name', 'Test']);
  runGit(sourceRoot, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(sourceRoot, 'runtime.txt'), 'committed', 'utf8');
  runGit(sourceRoot, ['add', 'runtime.txt']);
  runGit(sourceRoot, ['commit', '-m', 'baseline']);
  const commit = runGit(sourceRoot, ['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(path.join(sourceRoot, 'runtime.txt'), 'developer work', 'utf8');

  const jobId = '1786020000000-a1b2c3';
  const worktree = createReleaseWorktree(sourceRoot, publisherRoot, jobId, commit);

  assert.equal(fs.readFileSync(path.join(sourceRoot, 'runtime.txt'), 'utf8'), 'developer work');
  assert.equal(fs.readFileSync(path.join(worktree, 'runtime.txt'), 'utf8'), 'committed');
  assert.equal(runGit(worktree, ['status', '--porcelain']).stdout, '');
  assert.equal(runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim(), commit);

  const cleanup = removeReleaseWorktree(sourceRoot, publisherRoot, jobId);
  assert.equal(cleanup.removed, true);
  assert.equal(fs.existsSync(worktree), false);
  fs.rmSync(sandbox, {recursive: true, force: true});
});

test('rejects unsafe worktree identifiers and incomplete commits', () => {
  assert.throws(() => createReleaseWorktree('C:\\source', 'C:\\publisher', '../bad', 'a'.repeat(40)),
    /任务 ID 无效/);
  assert.throws(() => createReleaseWorktree('C:\\source', 'C:\\publisher', '1786020000000-a1b2', 'abc1234'),
    /完整提交号/);
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  return result;
}

const {loadReleasePlugin,createReleaseContext,validatePlugin}=require('../src/releasePlugin');
const {executeReleasePlugin,assertPluginResult}=require('../src/releasePluginRunner');

function pluginFixture() {
  const temporary=path.join(__dirname,'../.task-tmp');fs.mkdirSync(temporary,{recursive:true});
  const root=fs.mkdtempSync(path.join(temporary,'plugin-fixture-'));
  const repo=path.join(root,'repo'),artifacts=path.join(root,'artifacts');
  fs.mkdirSync(repo);fs.mkdirSync(artifacts);
  runGit(repo,['init','-b','master']);runGit(repo,['config','user.name','Fixture']);runGit(repo,['config','user.email','fixture@example.invalid']);
  const unit={id:'opaque.check',phase:'source',requires:['engine-context@1','node-module@1'],inputs:['leaf.mjs','value.txt'],
    run:{kind:'node-module',entrypoint:'leaf.mjs',args:[],timeoutSeconds:15,protocol:'check-result-v1'}};
  const plugin={apiVersion:'release-plugin/v1',pluginId:'fixture.application',target:'fixture',
    coverage:[{paths:['value.txt','second.txt'],prefixes:[],units:[unit.id]}],units:[unit],migrations:[]};
  fs.mkdirSync(path.join(repo,'release/publisher'),{recursive:true});
  fs.writeFileSync(path.join(repo,'value.txt'),'fixture input');fs.writeFileSync(path.join(repo,'second.txt'),'second input');
  fs.writeFileSync(path.join(repo,'leaf.mjs'),`import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync(process.env.RELEASE_CONTEXT_FILE,'utf8'));
if(c.apiVersion!=='release-context/v1'||!c.candidateRoot||!c.checkRoot||!c.artifactRoot||process.env.RHOSPITAL_RELEASE_PUBLISHER_ROOT||!process.env.NODE_OPTIONS.startsWith('--import file:')||process.env.PATH&&!c.tools?.node)process.exit(2);
console.log(JSON.stringify({protocol:'check-result-v1',unitId:c.unitId,state:'PASS',inputDigest:c.inputDigest,checks:1,passed:1,failed:0,skipped:0,cancelled:0,todo:0}));`);
  fs.writeFileSync(path.join(repo,'leaf.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('explicit exported context',()=>{const c=JSON.parse(fs.readFileSync(process.env.RELEASE_CONTEXT_FILE));assert.equal(c.apiVersion,'release-context/v1');assert.equal(fs.readFileSync('value.txt','utf8'),'fixture input');});`);
  function commit() {
    fs.writeFileSync(path.join(repo,'release/publisher/fixture.json'),JSON.stringify(plugin));
    runGit(repo,['add','.']);runGit(repo,['commit','-m','fixture candidate']);return runGit(repo,['rev-parse','HEAD']).stdout.trim();
  }
  let candidate=commit();
  const load=()=>loadReleasePlugin({repositoryRoot:repo,candidateCommit:candidate,manifestPath:'release/publisher/fixture.json',target:'fixture',changedPaths:['value.txt'],workspaceRoot:root});
  const context=plan=>createReleaseContext({candidateRoot:plan.sourceRoot,checkRoot:plan.sourceRoot,artifactRoot:artifacts,target:'fixture',
    capabilities:['engine-context@1','node-module@1','node-test@1'],nodeExecutable:process.execPath,environment:{}});
  return {root,repo,plugin,unit,load,context,candidate:()=>candidate,commit:()=>{candidate=commit();},options:{boundary:'before-production',stage:'precheck',receiptsDirectory:path.join(root,'receipts')},
    close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('plugin data alone joins the same real exported prefix and reuses owned evidence across phases',async()=>{
  const f=pluginFixture();let first,second,third;
  try {
    f.plugin.units.push({id:'tap.check',phase:'source',requires:['engine-context@1','node-test@1'],inputs:['leaf.test.mjs','value.txt'],
      run:{kind:'node-test',entrypoints:['leaf.test.mjs'],timeoutSeconds:15,protocol:'tap-v1'}});
    f.plugin.coverage[0].units.push('tap.check');f.commit();first=f.load();
    fs.writeFileSync(path.join(f.repo,'release/publisher/fixture.json'),'{dirty and invalid');
    const before=await executeReleasePlugin(first,f.context(first),f.options);
    assert.deepEqual(before.counts,{selected:2,executed:2,reused:0,pending:0});assert.equal(before.state,'PREFIX_PASS');assert.equal(before.productionActions,0);
    let lookups=0;
    await assert.rejects(executeReleasePlugin(first,null,{...f.options,storeFactory:()=>{lookups++;throw Error('must not read');}}),/MISSING_RELEASE_CONTEXT/);
    const missing=f.context(first);missing.capabilities=['engine-context@1'];
    await assert.rejects(executeReleasePlugin(first,missing,{...f.options,storeFactory:()=>{lookups++;}}),/MISSING_CONTEXT_CAPABILITY/);assert.equal(lookups,0);
    second=f.load();assert.notEqual(second.sourceRoot,first.sourceRoot);
    fs.mkdirSync(path.join(f.root,'unrelated'));fs.writeFileSync(path.join(f.root,'unrelated/broken-history.json'),'{');
    const formal=await executeReleasePlugin(second,f.context(second),{...f.options,stage:'formal'});
    assert.deepEqual(formal.counts,{selected:2,executed:0,reused:2,pending:0});
    const coreFiles=['releasePlugin.js','releasePluginRunner.js'];
    const coreBefore=coreFiles.map(p=>fs.readFileSync(path.join(__dirname,'../src',p),'utf8'));
    f.plugin.units.push({...structuredClone(f.unit),id:'added.by.data'});f.plugin.coverage[0].units.push('added.by.data');f.commit();third=f.load();
    const added=await executeReleasePlugin(third,f.context(third),{...f.options,stage:'formal'});
    assert.deepEqual(added.counts,{selected:3,executed:1,reused:2,pending:0});
    assert.deepEqual(coreFiles.map(p=>fs.readFileSync(path.join(__dirname,'../src',p),'utf8')),coreBefore);
    const baseline=f.candidate();f.plugin.units.find(u=>u.id==='added.by.data').run.timeoutSeconds=14;f.commit();
    const metadata=loadReleasePlugin({repositoryRoot:f.repo,candidateCommit:f.candidate(),baselineCommit:baseline,
      manifestPath:'release/publisher/fixture.json',target:'fixture',changedPaths:['release/publisher/fixture.json'],workspaceRoot:f.root});
    try {assert.deepEqual(metadata.units.map(u=>u.id),['added.by.data']);}finally{metadata.close();}
    const drift=path.join(third.sourceRoot,'value.txt');fs.chmodSync(drift,0o600);fs.writeFileSync(drift,'drift');
    await assert.rejects(executeReleasePlugin(third,f.context(third),f.options),/PLUGIN_INPUT_DRIFT/);
    await assert.rejects(executeReleasePlugin(second,f.context(second),{...f.options,boundary:'deploy'}),/UNSUPPORTED_EXECUTION_BOUNDARY/);
  } finally {first?.close();second?.close();third?.close();f.close();}
});

test('plugin admission and complete protocols reject unsafe declarations before leaf execution',async()=>{
  const f=pluginFixture();let plan;
  try {
    validatePlugin(f.plugin);
    const mutations=[p=>p.apiVersion='unknown',p=>p.units.push(structuredClone(p.units[0])),p=>p.units[0].run.kind='business-name',
      p=>p.units[0].inputs.push('../escape'),p=>p.units[0].inputs.push('C:/escape'),p=>p.productionAction=false,
      p=>p.units[0].run.command='inline code',p=>p.coverage[0].units.push('unknown'),p=>p.units[0].inputs.push('value.txt'),
      p=>p.units[0].run.entrypoint='not-owned.mjs',p=>p.units[0].run.timeoutSeconds=3601,p=>p.coverage.push(structuredClone(p.coverage[0]))];
    for(const mutate of mutations){const p=structuredClone(f.plugin);mutate(p);assert.throws(()=>validatePlugin(p));}
    f.plugin.units[0].requires.push('unknown@1');f.commit();assert.throws(()=>f.load(),/UNSUPPORTED_CAPABILITY/);
    f.plugin.units[0].requires.pop();f.commit();plan=f.load();
    const valid={status:0,output:JSON.stringify({protocol:'check-result-v1',unitId:f.unit.id,state:'PASS',inputDigest:'bound',checks:1,passed:1,failed:0,skipped:0,cancelled:0,todo:0})};
    assertPluginResult(f.unit,valid,'bound');
    for(const result of [{...valid,status:1},{...valid,signal:'SIGTERM'},{...valid,output:'{}'},{...valid,output:valid.output.replace('"skipped":0','"skipped":1')},
      {...valid,error:'timeout'},{...valid,output:valid.output.replace('bound','different')}])assert.throws(()=>assertPluginResult(f.unit,result,'bound'));
    const tap={...f.unit,run:{kind:'node-test'}};
    const good='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';assertPluginResult(tap,{status:0,output:good},'');
    for(const output of ['',good.replace('# fail 0\n',''),good.replace('# todo 0','# todo 1'),good+'not ok 1\n'])assert.throws(()=>assertPluginResult(tap,{status:0,output},''));
    f.plugin.units[0].phase='pre-deploy';f.commit();const pending=f.load();
    try {const result=await executeReleasePlugin(pending,f.context(pending),f.options);assert.deepEqual(result.counts,{selected:1,executed:0,reused:0,pending:1});}finally{pending.close();}
    const rootContext=f.context(plan);assert.throws(()=>createReleaseContext({...rootContext,environment:{NODE_OPTIONS:'--import hidden'}}),/UNDECLARED_ENVIRONMENT/);
    let writes=0;
    await assert.rejects(executeReleasePlugin(plan,rootContext,{...f.options,storeFactory:()=>({read:()=>null,write:()=>{writes++;}}),run:async()=>{
      const file=path.join(plan.sourceRoot,'value.txt');fs.chmodSync(file,0o600);fs.writeFileSync(file,'during execution');return {...valid,output:valid.output.replace('bound',require('../src/changeValidationReceipts').hash(Object.fromEntries(f.unit.inputs.slice().sort().map(p=>[p,plan.inputDigests[p]]))))};
    }}),/PLUGIN_INPUT_DRIFT/);assert.equal(writes,0);
    f.plugin.units[0].phase='source';f.commit();
    const oid=runGit(f.repo,['rev-parse','HEAD:value.txt']).stdout.trim();
    runGit(f.repo,['update-index','--cacheinfo','120000,'+oid+',value.txt']);runGit(f.repo,['commit','-m','unsafe link mode']);
    assert.throws(()=>loadReleasePlugin({repositoryRoot:f.repo,candidateCommit:runGit(f.repo,['rev-parse','HEAD']).stdout.trim(),
      manifestPath:'release/publisher/fixture.json',target:'fixture',changedPaths:['value.txt'],workspaceRoot:f.root}),/UNSAFE_OR_MISSING_CANDIDATE_INPUT/);
  } finally {plan?.close();f.close();}
});

test('native staged adapter validates dynamic docs and reuses the same locked dependency unit formally',async()=>{
  const f=pluginFixture();
  try {
    const baseline=f.candidate(),dependencies=path.join(f.root,'installed/node_modules'),pkg=path.join(dependencies,'fixture-dep');fs.mkdirSync(pkg,{recursive:true});
    fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'fixture-dep',version:'1.0.0'}));fs.writeFileSync(path.join(pkg,'index.js'),'module.exports=1;');
    fs.writeFileSync(path.join(f.repo,'package.json'),JSON.stringify({dependencies:{'fixture-dep':'1.0.0'}}));
    fs.writeFileSync(path.join(f.repo,'package-lock.json'),JSON.stringify({packages:{'node_modules/fixture-dep':{version:'1.0.0'}}}));
    f.unit.requires.push('node-dependencies@1');f.unit.dependencies=['fixture-dep'];f.unit.inputs.push('package.json','package-lock.json');
    f.plugin.coverage[0].paths.push('package.json','package-lock.json');f.commit();
    fs.writeFileSync(path.join(f.repo,'README.md'),'candidate document');runGit(f.repo,['add','README.md']);
    const {validatePluginCandidate}=require('../src/releasePluginCandidate');
    const options={phase:'source',target:'fixture',manifestPath:'release/publisher/fixture.json',baseline,environment:{},
      workspaceRoot:f.root,dependencyRoot:dependencies,receiptsDirectory:f.options.receiptsDirectory};
    const staged=await validatePluginCandidate(f.repo,options);
    assert.equal(staged.protocol,'release-candidate-validation/v1');assert.equal(staged.state,'PASS');assert.equal(staged.scope,'before-production');
    assert.equal(staged.candidateTree,runGit(f.repo,['write-tree']).stdout.trim());
    assert.deepEqual(staged.counts,{selected:1,executed:1,reused:0,pending:0});assert.deepEqual(staged.documents,{files:1,executed:1,reused:0});
    runGit(f.repo,['commit','-m','actual candidate']);
    const formal=await validatePluginCandidate(f.repo,{...options,phase:'release-source',environment:{PATH:'irrelevant lookup change'},requireReceipts:true});
    assert.deepEqual(formal.counts,{selected:1,executed:0,reused:1,pending:0});assert.deepEqual(formal.documents,{files:1,executed:0,reused:1});
    fs.appendFileSync(path.join(pkg,'index.js'),'// dependency drift');
    await assert.rejects(validatePluginCandidate(f.repo,{...options,phase:'release-source',requireReceipts:true}),/MISSING_PLUGIN_RECEIPT/);
    fs.writeFileSync(path.join(f.repo,'README.md'),'[bad](missing-current.md)');runGit(f.repo,['add','README.md']);
    await assert.rejects(validatePluginCandidate(f.repo,options),/Broken new document link/);
  } finally {f.close();}
});

test('controlled tool admission rejects remote target and missing image declarations without launching Docker',async()=>{
  const f=pluginFixture();let plan;
  try {
    f.unit.requires.push('local-tools@1');assert.throws(()=>validatePlugin(f.plugin),/MISSING_LOCAL_IMAGE_DECLARATION/);
    f.unit.images=[];f.unit.tools=['node','docker'];f.commit();plan=f.load();
    const config=path.join(f.root,'docker-config');fs.mkdirSync(config);fs.writeFileSync(path.join(config,'config.json'),'{}');
    const context=createReleaseContext({...f.context(plan),capabilities:[...f.context(plan).capabilities,'local-tools@1'],
      tools:Object.fromEntries(['java','python','git','docker','cmd'].map(k=>[k,process.execPath])),dockerHost:'tcp://remote.invalid:2375',dockerConfigRoot:config});
    let lookups=0;
    await assert.rejects(executeReleasePlugin(plan,context,{...f.options,storeFactory:()=>{lookups++;}}),/LOCAL_DOCKER_ENDPOINT_REQUIRED/);assert.equal(lookups,0);
  } finally {plan?.close();f.close();}
});

test('selected tool subset executes positively and ignores unrequested Java or Docker drift',async()=>{
  const f=pluginFixture();let plan;
  try {
    f.unit.requires.push('local-tools@1');f.unit.tools=['node'];f.unit.images=[];f.commit();plan=f.load();
    const context=createReleaseContext({...f.context(plan),capabilities:[...f.context(plan).capabilities,'local-tools@1'],
      tools:{node:process.execPath,java:'unrequested-missing-java'},dockerHost:'unrequested-remote-target'});
    const result=await executeReleasePlugin(plan,context,f.options);assert.deepEqual(result.counts,{selected:1,executed:1,reused:0,pending:0});
    context.tools.java='another-unrequested-java';context.dockerHost='another-unused-target';
    const reused=await executeReleasePlugin(plan,context,{...f.options,stage:'formal',requireReceipts:true});
    assert.deepEqual(reused.counts,{selected:1,executed:0,reused:1,pending:0});
  } finally {plan?.close();f.close();}
});

test('real child failure retains bounded redacted diagnostics and never issues PASS',async()=>{
  const f=pluginFixture();let plan;
  try {
    fs.appendFileSync(path.join(f.repo,'leaf.mjs'),"\nprocess.stderr.write('diagnostic-stack-marker');process.exit(7);\n");f.commit();plan=f.load();
    const events=[];
    await assert.rejects(executeReleasePlugin(plan,f.context(plan),{...f.options,write:event=>events.push(event)}),/diagnostic-stack-marker/);
    const failure=events.find(event=>event.result==='FAILED');assert(failure);assert.equal(failure.exit,7);assert.match(failure.stderr,/diagnostic-stack-marker/);
    assert(!events.some(event=>event.result==='EXECUTED'||event.result==='REUSED'));
    const {failureDiagnostic}=require('../src/releasePluginRunner');
    const redacted=failureDiagnostic('opaque','formal',{status:1,signal:'SIGTERM',error:'Authorization: Bearer fixtureCredential',
      output:'x'.repeat(5000)+'\nPASSWORD=fixturePassword\nAPI_KEY=fixtureKey',diagnostics:'account=fixture@example.invalid\nTOKEN=fixtureToken'});
    assert(redacted.stdout.length<=4000);assert(redacted.stderr.length<=4000);assert.equal(redacted.signal,'SIGTERM');
    assert(!JSON.stringify(redacted).includes('fixturePassword'));assert(!JSON.stringify(redacted).includes('fixtureKey'));
    assert(!JSON.stringify(redacted).includes('fixtureCredential'));assert(!JSON.stringify(redacted).includes('fixtureToken'));assert(!JSON.stringify(redacted).includes('fixture@example.invalid'));
  } finally {plan?.close();f.close();}
});

test('native Node worker context retains inner TAP totals and rejects real skip or TODO',async()=>{
  const f=pluginFixture();let plan;
  try {
    f.unit.requires=['engine-context@1','node-test@1'];f.unit.inputs=['leaf.test.mjs','value.txt'];
    f.unit.run={kind:'node-test',entrypoints:['leaf.test.mjs'],timeoutSeconds:15,protocol:'tap-v1'};
    const positive="import test from 'node:test';import assert from 'node:assert/strict';test('first',()=>assert.equal(process.env.NODE_TEST_CONTEXT,'child-v8'));test('second',()=>{});\n";
    fs.writeFileSync(path.join(f.repo,'leaf.test.mjs'),positive);f.commit();plan=f.load();
    const result=await executeReleasePlugin(plan,f.context(plan),f.options);assert.equal(result.counts.executed,1);
    const records=fs.readdirSync(f.options.receiptsDirectory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(f.options.receiptsDirectory,name),'utf8')));
    assert.equal(records.length,1);assert.match(records[0].result.execution.output,/^# tests 2$/m);assert.match(records[0].result.execution.output,/^# pass 2$/m);
    assert.doesNotMatch(records[0].result.execution.output,/# [ℹ#] tests/);
    assert.throws(()=>createReleaseContext({...f.context(plan),environment:{NODE_TEST_CONTEXT:'child-v8'}}),/UNDECLARED_ENVIRONMENT/);
    for(const declaration of ["test.skip('must reject skip',()=>{});","test.todo('must reject TODO');"]) {
      fs.writeFileSync(path.join(f.repo,'leaf.test.mjs'),positive+declaration);f.commit();const negative=f.load();
      try {await assert.rejects(executeReleasePlugin(negative,f.context(negative),f.options),/INCOMPLETE_PLUGIN_TAP/);}finally{negative.close();}
    }
    assert.equal(fs.readdirSync(f.options.receiptsDirectory).filter(name=>name.endsWith('.json')).length,1);
  } finally {plan?.close();f.close();}
});
