const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,execFileSync}=require('node:child_process');
const {createPlan,executePlan,runPowerShell}=require('../src/releasePublisherCore');
const {resolvePluginContextFile}=require('../src/releasePluginCandidate');
require('./helpers/applicationPolicyFixture').enterFixturePolicy();
const env={RELEASE_PUBLISHER_TEST_MODE:'true',RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'};
function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gate-scope-')),before=process.env.RELEASE_PUBLISHER_CONFIG;
 put(root,'publisher-config.json',JSON.stringify({releaseTargets:{game:{dockerServer:'fixture'},forum:{dockerServer:'fixture'}},dockerServers:{fixture:{host:'92.113.124.185',username:'fixture'}}}));
 process.env.RELEASE_PUBLISHER_CONFIG=path.join(root,'publisher-config.json');
 const close=()=>{if(before===undefined)delete process.env.RELEASE_PUBLISHER_CONFIG;else process.env.RELEASE_PUBLISHER_CONFIG=before;fs.rmSync(root,{recursive:true,force:true});};
 try{const result=run(root);if(result?.then)return result.finally(close);close();return result;}catch(error){close();throw error;}
}
function put(root,file,value){const full=path.join(root,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,value);}
const runtimeFile=target=>target==='game'?'src/main/resources/value.txt':'integrations/flarum/value.txt';
function plugin(target){
 return {apiVersion:'release-plugin/v1',pluginId:'fixture.'+target,target,
  coverage:[{paths:[runtimeFile(target)],prefixes:[],units:['opaque.source']}],
  units:[{id:'opaque.source',phase:'source',requires:['engine-context@1','node-test@1'],inputs:['leaf.test.mjs',runtimeFile(target)],
   run:{kind:'node-test',entrypoints:['leaf.test.mjs'],timeoutSeconds:15,protocol:'tap-v1'}}],migrations:[]};
}
function project(root){
 require('./helpers/applicationPolicyFixture').seedApplicationPolicy(root);
 put(root,'mvnw.cmd','@echo off\n');put(root,'docker-compose.yml','services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n');
 put(root,'src/main/java/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.java','class CatalogDatabaseUpgradeService { private static final int MARKER_VERSION = 20; }');
 for(const target of ['game','forum'])put(root,'release/publisher/'+target+'.json',JSON.stringify(plugin(target)));
 for(const file of ['integrations/flarum/Dockerfile','integrations/flarum/04-rhospital-secret.sh','integrations/flarum/05-rhospital-env.sh'])put(root,file,'# isolated fixture');
 for(const target of ['game','forum'])put(root,runtimeFile(target),'baseline');
 put(root,'leaf.test.mjs',"import test from 'node:test';import fs from 'node:fs';test('selected value',()=>{const context=JSON.parse(fs.readFileSync(process.env.RELEASE_CONTEXT_FILE,'utf8'));if(fs.readFileSync(context.target==='game'?'src/main/resources/value.txt':'integrations/flarum/value.txt','utf8')==='fail')throw Error('controlled current fault');});");
}
test('game Source is generic and fixed production safety stays in the actual plan',()=>fixture(root=>{
 project(root);const plan=createPlan(root,{appTag:'20261117',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);
 for(const key of ['validate-game-source-impact','test-game-backend','build-image','game-database-preflight','backup-game-release','pre-deploy-checklist','deploy-stack','final-runtime-check','verify-game-static-assets-predeploy','verify-game-static-delivery','game-rollback-decision','game-fatal-rollback-decision'])assert(keys.includes(key),key);
 assert.match(plan.steps.find(s=>s.key==='validate-game-source-impact').command,/validate-plugin-candidate\.mjs.*--phase release-source.*--target game/);
 assert(!keys.includes('validate-game-release-preflight'));assert(!keys.includes('opaque.source'));
 assert(keys.indexOf('validate-game-source-impact')<keys.indexOf('test-game-backend'));
 assert.deepEqual(plan.config.pluginProtocol.unitIds,['opaque.source']);
}));
test('game and forum formal executePlan use the real generated Source CLI and stop before production',async()=>{
 for(const target of ['game','forum'])await fixture(async root=>{
  project(root);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
  git('init','-b','master');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','baseline');
  const baseline=git('rev-parse','HEAD');put(root,runtimeFile(target),'candidate');
  const mandatory=target==='game'?['test-game-backend','verify-game-static-assets-predeploy','pre-deploy-checklist','final-runtime-check','verify-game-static-delivery']:['validate-forum-source','forum-preflight','final-runtime-check'];
  put(root,'release/release-impact.json',JSON.stringify({schemaVersion:1,assessmentId:'20261117-fixture-'+target,summary:'Isolated formal controller contract',
   targets:{[target]:{riskLevel:'low',codeImpact:'Selected fixture source and fixed production safety',databaseImpact:'none',checklistDecision:'checklist-updated',
    coveredRuntimePaths:[runtimeFile(target)],requiredChecks:[...mandatory,'opaque.source'].map(stepKey=>({stepKey,reason:'Isolated candidate contract'}))}}}));
  git('add',runtimeFile(target),'release/release-impact.json');git('commit','-m','candidate');
  const context=path.join(root,'trusted-context.json');put(root,'trusted-context.json','{}');git('config','--local','release.pluginContextFile',context);
  assert.equal(resolvePluginContextFile(root),fs.realpathSync(context));
  const other=path.join(root,'second-context.json');put(root,'second-context.json','{}');
  assert.throws(()=>resolvePluginContextFile(root,other),/SOURCE_MISMATCH/);
  git('config','--local','--add','release.pluginContextFile',context);
  assert.throws(()=>resolvePluginContextFile(root),/AMBIGUOUS/);git('config','--local','--unset-all','release.pluginContextFile');
  git('config','--local','release.pluginContextFile',context);
  const candidate=git('rev-parse','HEAD'),request={releaseTarget:target,forumImageMode:'build',appTag:'20261117',dryRun:false,includeStackDeploy:true,boundary:'before-production',gitCommit:candidate,
   changeAnalysis:{targets:{[target]:{changed:true,baselineCommit:baseline,changedPaths:[runtimeFile(target)],ignoredPaths:['release/release-impact.json']}}}};
  const environment={...process.env,...env,RELEASE_PUBLISHER_TEST_MODE:'false',RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG,RELEASE_PUBLISHER_HISTORY_FILE:path.join(root,'history.json'),RELEASE_PUBLISHER_SEMANTIC_DIAGNOSIS:'false'};
  delete environment.RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE;
  const plan=createPlan(root,request,environment),sourceKey=target==='game'?'validate-game-source-impact':'validate-forum-source';
  const source=plan.steps.find(s=>s.key===sourceKey),commands=[];
  // Production adapters are fakes. The exact generated Source PowerShell command runs.
  // Forum fixed Maven/bash safety tail is inspected structurally and never launched here.
  const sourceCommand=target==='forum'?source.command.split('; if ($LASTEXITCODE')[0]:source.command;
  const runCommand=async(cwd,command,childEnv,onChunk,...rest)=>{
   commands.push(command);const step=plan.steps.find(s=>s.command===command);
   assert(!step?.productionAction,'production adapter must never run');
   if(command===source.command)return runPowerShell(cwd,sourceCommand,childEnv,onChunk,...rest);
   onChunk?.('isolated_adapter=PASS\n');return 'isolated_adapter=PASS\n';
  };
  const first=await executePlan(root,request,environment,{runCommand});
  assert.equal(first.status,'BEFORE_PRODUCTION_PASS',JSON.stringify(first.logs));
  assert.equal(first.productionActions,0);assert.equal(first.pluginValidation.counts.executed,1);assert.equal(first.pluginValidation.counts.reused,0);
  assert.equal(first.pluginValidation.candidateTree,git('rev-parse','HEAD^{tree}'));
  assert.equal(commands.filter(c=>c===source.command).length,1);
  assert(first.plan.steps.filter(s=>s.productionAction).every(s=>s.status==='pending'));
  if(target==='forum')assert.match(source.command,/ForumFlarumImageAssetTest,ForumSearchMigrationContractTest,ForumDeploymentConfigTest/);
  const secondRun=await executePlan(root,request,environment,{runCommand});
  assert.equal(secondRun.status,'BEFORE_PRODUCTION_PASS');assert.equal(secondRun.pluginValidation.counts.executed,0);assert.equal(secondRun.pluginValidation.counts.reused,1);
  put(root,runtimeFile(target),'fail');git('add',runtimeFile(target));git('commit','-m','failing leaf');
  const failed=await executePlan(root,{...request,gitCommit:git('rev-parse','HEAD')},environment,{runCommand:async(cwd,command,childEnv,onChunk,...rest)=>{
   if(command.includes('validate-plugin-candidate.mjs'))return runPowerShell(cwd,target==='forum'?command.split('; if ($LASTEXITCODE')[0]:command,childEnv,onChunk,...rest);
   const step=plan.steps.find(s=>s.command===command);assert(!step?.productionAction);return 'isolated_adapter=PASS\n';
  }});
  assert.equal(failed.status,'ERROR');assert.equal(failed.plan.steps.find(s=>s.key===sourceKey).status,'failed');
  assert(failed.plan.steps.filter(s=>s.productionAction).every(s=>s.status==='pending'));
 });
});
test('manifest admissions reject missing malformed target and fixed-key collisions before commands',()=>fixture(root=>{
 project(root);const request={appTag:'20261117',dryRun:false,includeStackDeploy:true},environment={...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG};
 for(const target of ['game','forum']){
  const file='release/publisher/'+target+'.json',options={...request,releaseTarget:target,forumImageMode:'build'};
  fs.unlinkSync(path.join(root,file));assert.throws(()=>createPlan(root,options,environment),/manifest required/);
  put(root,file,'{');assert.throws(()=>createPlan(root,options,environment));
  const wrong=plugin(target);wrong.target='wrong';put(root,file,JSON.stringify(wrong));assert.throws(()=>createPlan(root,options,environment),/target mismatch/);
  const collision=plugin(target);collision.coverage[0].units=['final-runtime-check'];collision.units[0].id='final-runtime-check';put(root,file,JSON.stringify(collision));
  assert.throws(()=>createPlan(root,options,environment),/collid|reserved|core/i);
  put(root,file,JSON.stringify(plugin(target)));
 }
}));

test('actual forum reuse plan retains database admission backup and runtime safety',()=>fixture(root=>{
 project(root);const plan=createPlan(root,{releaseTarget:'forum',forumImageMode:'reuse',appTag:'20261112',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);for(const key of ['validate-existing-forum-image','forum-preflight','backup-forum-release','deploy-forum-compose','final-runtime-check','forum-rollback-command'])assert(keys.includes(key),key);
 assert(!keys.includes('validate-game-release-preflight'));
}));

test('history retains probe state and error through hundreds of local heartbeats with bounded output',()=>fixture(root=>{
 project(root);
 const core=require('../src/releasePublisherCore'),plan=core.createPlan(root,{appTag:'20261113',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const step=plan.steps.find(s=>s.key==='commit-game-cutover');
 step.status='failed';step.logs=['rollout_state=updating healthy_target=0','x'.repeat(10000)+'ERROR: original probe stalled',...Array.from({length:300},(_,i)=>'[RUNNING] 观察 已运行 '+i+' 秒，等待命令输出'),'ERROR: outer timeout'];
 const history=core.buildHistoryEntry('RECOVERY_REQUIRED',plan,[],[]),saved=history.stepSummary.find(s=>s.key===step.key).logs;
 assert(saved.some(l=>l.startsWith('rollout_state=')));assert(saved.some(l=>l.endsWith('ERROR: original probe stalled')));
 assert(saved.some(l=>l==='ERROR: outer timeout'));assert.equal(saved.filter(l=>l.startsWith('[RUNNING]')).length,4);assert(saved.every(l=>l.length<8100));
 for(const target of ['fixture-host',{user:'fixture',host:'fixture-host',port:2222,keyPath:'fixture-key'}]) {
  const command=core.remoteSshCommand(target,'echo read-only');
  for(const value of ['BatchMode=yes','ConnectTimeout=10','ConnectionAttempts=1','ServerAliveInterval=10','ServerAliveCountMax=3'])assert(command.includes(value));
 }
}));

test('actual generated observer bounds hung Docker reads and retains required safety predicates',()=>fixture(root=>{
 project(root);const core=require('../src/releasePublisherCore'),plan=core.createPlan(root,{appTag:'20261113',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const bash=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:\\Program Files','Git','bin','bash.exe'):'bash';
 const script=key=>Buffer.from(plan.steps.find(s=>s.key===key).command.match(/remoteScript = '([A-Za-z0-9+/=]+)'/)[1],'base64').toString();
 // Real GNU timeout executes a fake Docker in a child shell. No real Docker,
 // SSH, production host or database is contacted by any scenario.
 const fixtureShell=`
export RELEASE_PUBLISHER_ROLLOUT_TIMEOUT_SECONDS=0
fixture_docker() {
 case "$1 $2" in
  'service inspect')
   [ "$MODE" != hung ] || sleep 5
   case "$*" in
    *ContainerSpec.Image*) echo hospital-backend:20261113;;
    *ContainerSpec.Env*) printf 'IMAGE_TAG=20261113\\nFORUM_SSO_ENABLED=true\\nFORUM_SSO_SECRET_FILE=/run/secrets/forum_sso_secret\\n';;
    *ContainerSpec.Secrets*) echo forum_sso_secret;;
    *UpdateStatus*) echo completed;;
    *Replicas*) echo 1;;
   esac;;
  'service ps') printf 'hospital-backend:20261113|Running now\\n'; [ "$MODE" != old ] || printf 'hospital-backend:20261101|Running now\\n';;
  'ps -q') echo fixture-container;;
  'inspect fixture-container')
   case "$*" in
    *Config.Image*) echo hospital-backend:20261113;;
    *State.Health*) if [ "$MODE" = unhealthy ]; then echo unhealthy; else echo healthy; fi;;
    *Config.Env*) printf 'IMAGE_TAG=20261113\\nFORUM_SSO_ENABLED=true\\nFORUM_SSO_SECRET_FILE=/run/secrets/forum_sso_secret\\n';;
   esac;;
  'exec fixture-container')
   case "$*" in *SHA256SUMS*) [ "$MODE" != checksum ];; *) [ "$MODE" != secret ];; esac;;
  'stack services') echo fixture-stack;;
  *) return 87;;
 esac
}
export -f fixture_docker
timeout() {
 [ "$1" = --signal=TERM ] && [ "$2" = --kill-after=2s ] && [ "$3" = 15s ] && [ "$4" = docker ] || return 88
 shift 4
 command timeout --kill-after=1s 0.5s bash -c 'fixture_docker "$@"' fixture "$@"
}
`;
 for(const mode of ['healthy','hung','secret','checksum','old','unhealthy']) {
  const result=spawnSync(bash,['-c',fixtureShell+'\n'+script('commit-game-cutover')],{env:{...process.env,MODE:mode},encoding:'utf8',windowsHide:true,timeout:15000});
  const text=result.stdout+result.stderr;assert(!result.error,String(result.error));
  if(mode==='healthy'){assert.equal(result.status,0,text);assert(text.includes('game_cutover_observation=PASS'));}
  else {assert.notEqual(result.status,0,text);assert(!text.includes('game_cutover_observation=PASS'));if(mode==='hung')assert.match(text,/probe timed out: service\/inspect/);}
 }
 assert(script('final-runtime-check').includes('[ "$update_state" = completed ]'));
 assert(script('commit-game-cutover').includes('[ "$update_state" = updating ]'));
}));

test('formal prefix binds exact migration declarations before any production action',()=>fixture(async root=>{
 project(root);const migration='scripts/migration/20261117_fixture.sql';
 put(root,migration,"\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\nSELECT 1;\nCOMMIT;\nSELECT 1;\n");
 const request={appTag:'20261117',dryRun:false,includeStackDeploy:true,boundary:'before-production',
  changeAnalysis:{targets:{game:{changedPaths:[migration]}}}};
 const environment={...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG,RELEASE_PUBLISHER_HISTORY_FILE:path.join(root,'migration-history.json')};
 const report={protocol:'release-candidate-validation/v1',state:'PASS',scope:'before-production',prefixState:'PREFIX_PASS',target:'game',pluginId:'fixture.game',
  productionActions:0,selectedKeys:['opaque.source'],migrationDeclarations:[migration],counts:{selected:1,executed:1,reused:0,pending:0}};
 const run=declarations=>executePlan(root,request,environment,{runCommand:async(_cwd,command)=>{
  const plan=createPlan(root,request,environment);assert(!plan.steps.find(step=>step.command===command)?.productionAction);
  return command.includes('validate-plugin-candidate.mjs')?JSON.stringify({...report,migrationDeclarations:declarations}):'isolated_adapter=PASS\n';
 }});
 assert.equal((await run([migration])).status,'BEFORE_PRODUCTION_PASS');
 for(const declarations of [[],[migration,migration],[migration,'scripts/migration/extra.sql']]){
  const result=await run(declarations);assert.equal(result.status,'ERROR');
  assert.equal(result.plan.steps.find(step=>step.key==='validate-game-source-impact').status,'failed');
  assert(result.plan.steps.filter(step=>step.productionAction).every(step=>step.status==='pending'));
 }
}));
