const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {createPlan,requiresFeatureRuntimeCheck}=require('../src/releasePublisherCore');
const {catalog,currentLocalCheck,doubleCheckLocalChecks}=require('../src/localCheckPolicy');
const {selectLeaves,runLeaves}=require('../src/localCheckLeaves');
const env={RELEASE_PUBLISHER_TEST_MODE:'true',RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'};
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gate-scope-')),before=process.env.RELEASE_PUBLISHER_CONFIG;try{put(root,'publisher-config.json',JSON.stringify({releaseTargets:{game:{dockerServer:'fixture'},forum:{dockerServer:'fixture'}},dockerServers:{fixture:{host:'92.113.124.185',username:'fixture'}}}));process.env.RELEASE_PUBLISHER_CONFIG=path.join(root,'publisher-config.json');return run(root);}finally{if(before===undefined)delete process.env.RELEASE_PUBLISHER_CONFIG;else process.env.RELEASE_PUBLISHER_CONFIG=before;fs.rmSync(root,{recursive:true,force:true});}}
function put(root,file,value){const full=path.join(root,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,value);}
function project(root){
 put(root,'mvnw.cmd','@echo off\n');put(root,'docker-compose.yml','services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n');
 put(root,'src/main/java/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.java','class CatalogDatabaseUpgradeService { private static final int MARKER_VERSION = 20; }');
}
test('all registered features have bounded current contracts, manual archives stay outside selected leaves',()=>{
 const checks=Object.keys(catalog).map(currentLocalCheck);assert.equal(checks.length,22);assert(catalog['verify-resident-exchange-presentation']);doubleCheckLocalChecks(checks);
 const plan=selectLeaves(checks);assert.equal(new Set(plan.leaves.map(l=>l.id)).size,plan.leaves.length);
 for(const leaf of plan.leaves)assert(!/Evidence\.test|validate-.*evidence|docs\/evidence|readiness|npm/.test(leaf.id),leaf.id);
 assert(plan.leaves.length<checks.reduce((n,c)=>n+plan.owners.get(c.key).length,0));
});
test('runtime scope follows affected feature and shared authentication; unknown scope remains conservative',()=>{
 const analysis=paths=>({targets:{game:{changedPaths:paths}}});
 for(const key of ['verify-relations-release','verify-tradepool-release']) {
  assert.equal(requiresFeatureRuntimeCheck(key,analysis(['src/main/resources/static/js/design/Paint.mjs'])),false);
  assert.equal(requiresFeatureRuntimeCheck(key,analysis(['src/main/java/com/zly/hospital/service/TokenService.java'])),true);
  assert.equal(requiresFeatureRuntimeCheck(key,undefined),true);
  assert.equal(requiresFeatureRuntimeCheck(key,analysis([]),{requiredChecks:[{stepKey:key}]}),true);
 }
 assert(requiresFeatureRuntimeCheck('verify-relations-release',analysis(['src/main/resources/templates/relations.html'])));
 assert(requiresFeatureRuntimeCheck('verify-tradepool-release',analysis(['src/main/java/com/zly/hospital/service/ToiletMarketService.java'])));
});
test('actual game plan keeps production safety and replaces every displayed local command coherently',()=>fixture(root=>{
 project(root);
 const plan=createPlan(root,{appTag:'20261112',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);
 for(const key of ['test-game-backend','build-image','game-database-preflight','backup-game-release','pre-deploy-checklist','deploy-stack','final-runtime-check','verify-game-static-assets-predeploy','verify-game-static-delivery','game-rollback-decision','game-fatal-rollback-decision'])assert(keys.includes(key),key);
 const sso=plan.steps.find(s=>s.key==='validate-game-sso-source');assert(!sso.command.includes('merge-base --is-ancestor'));assert(sso.command.includes('MARKER_VERSION'));
 assert.deepEqual(plan.dryRunChecks,[]);
 assert(plan.steps.find(s=>s.key==='final-runtime-check').command);
}));
test('actual forum reuse plan retains database admission backup and runtime safety',()=>fixture(root=>{
 project(root);const plan=createPlan(root,{releaseTarget:'forum',forumImageMode:'reuse',appTag:'20261112',dryRun:true,includeStackDeploy:true},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const keys=plan.steps.map(s=>s.key);for(const key of ['validate-existing-forum-image','forum-preflight','backup-forum-release','deploy-forum-compose','final-runtime-check','forum-rollback-command'])assert(keys.includes(key),key);
 assert(!keys.includes('validate-game-release-preflight'));
}));
test('actual R34-shaped plan carries all five current contracts without historical validators',()=>fixture(root=>{
 project(root);const file='src/main/resources/static/js/design/probe.mjs';put(root,file,'// controlled candidate');
 const keys=['verify-toilet-market','verify-bacteria-authoritative-challenges','verify-bacteria-gates','verify-game-steam-auth','verify-design-level-packages'];
 const mandatory=['test-game-backend','verify-game-static-assets-predeploy','pre-deploy-checklist','final-runtime-check','verify-game-static-delivery'];
 const target=(coveredRuntimePaths,checks)=>({checklistDecision:'existing-checks-sufficient',riskLevel:'low',codeImpact:'Controlled fixture validates current check ownership and production boundaries',databaseImpact:'none',coveredRuntimePaths,requiredChecks:checks.map(stepKey=>({stepKey,reason:'Controlled current candidate coverage for '+stepKey}))});
 put(root,'release/release-impact.json',JSON.stringify({schemaVersion:1,assessmentId:'20261112-current-checks',summary:'Controlled current behavior selection',targets:{game:target([file],[...mandatory,...keys,'verify-game-steam-runtime']),forum:target([],['validate-forum-source','forum-preflight','final-runtime-check'])}}));
 const digest=text=>require('node:crypto').createHash('sha256').update(text).digest('hex');
 put(root,'src/main/resources/bacteria-level-validator.js','current bundle');
 put(root,'scripts/bacteria-lab/server-validator-entry.mjs','current source');
 put(root,'scripts/bacteria-lab/server-validator-manifest.json',JSON.stringify({bundleSha256:digest('current bundle'),sources:{'scripts/bacteria-lab/server-validator-entry.mjs':digest('current source')}}));
 const request={appTag:'20261112',dryRun:true,includeStackDeploy:true,changeAnalysis:{targets:{game:{changed:true,changedPaths:[file],ignoredPaths:['release/release-impact.json']}}}};
 const plan=createPlan(root,request,{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG});
 const preflight=plan.steps.find(s=>s.key==='validate-game-release-preflight');
 const checks=JSON.parse(Buffer.from(preflight.command.match(/--checks-base64 '?([A-Za-z0-9+/=]+)'?/)[1],'base64').toString()).checks;
 assert.deepEqual(checks.map(c=>c.key).sort(),keys.sort());doubleCheckLocalChecks(checks);
 for(const check of checks){const step=plan.steps.find(s=>s.key===check.key);assert.equal(step.command,check.command);assert.equal(step.coveredByPreflight,preflight.key);assert(!/validate-.+evidence|Evidence\.test/.test(step.command));}
 assert(!plan.steps.some(s=>s.key==='verify-relations-release'||s.key==='verify-tradepool-release'));
 assert.equal(plan.dryRunChecks.length,1);assert.equal(plan.dryRunChecks[0].state,'PASS');
 put(root,'src/main/resources/bacteria-level-validator.js','stale bundle');
 assert.throws(()=>createPlan(root,request,{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG}),/artifact drift/);
 assert.equal(createPlan(root,{...request,dryRun:false},{...env,RELEASE_PUBLISHER_CONFIG:process.env.RELEASE_PUBLISHER_CONFIG}).dryRunChecks.length,0);
}));
test('archive guard rejects actual sync async and subprocess history reads while current fixtures work',()=>fixture(root=>{
 const guard=path.resolve(__dirname,'../src/currentBehaviorGuard.cjs'),script=path.join(root,'probe.cjs');
 put(root,'current.json','{}');put(root,'docs/evidence/old.json','corrupt old bytes');
 const run=code=>{fs.writeFileSync(script,code);return spawnSync(process.execPath,['--require',guard,script],{cwd:root,encoding:'utf8',windowsHide:true});};
 assert.equal(run("require('fs').readFileSync('current.json');").status,0);
 for(const code of ["require('fs').readFileSync('docs/evidence/old.json');","require('fs').promises.readFile('docs/evidence/missing.json');","require('child_process').execFileSync('git',['show','old:secret']);"]) {
  const result=run(code);assert.notEqual(result.status,0);assert.match(result.stderr,/ARCHIVE_DEPENDENCY|GIT_HISTORY/);
 }
}));
test('actual release CLI ignores corrupt unrelated archive, rejects current failure and rejects archive access',()=>fixture(root=>{
 const check=currentLocalCheck('verify-game-steam-auth');
 const args=[path.resolve(__dirname,'../scripts/run-game-release-preflight.mjs'),'--checks-base64',Buffer.from(JSON.stringify({version:1,checks:[check]})).toString('base64')];
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 const run=()=>spawnSync(process.execPath,args,{cwd:root,env:childEnv,encoding:'utf8',timeout:10000,windowsHide:true});
 put(root,'docs/evidence/unrelated.json','invalid history');
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('current',()=>{});");
 let result=run();assert.equal(result.status,0,result.stdout+result.stderr);
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('current',()=>{throw Error('current fault');});");
 result=run();assert.notEqual(result.status,0);assert(!result.stdout.includes('game_release_preflight=PASS'));assert.match(result.stdout+result.stderr,/exit=1/);
 put(root,'src/test/js/steamLogin.test.cjs',"require('node:test')('bad dependency',()=>require('fs').readFileSync('docs/evidence/unrelated.json'));");
 result=run();assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/ARCHIVE_DEPENDENCY/);
}));
test('manual audit is explicit and unavailable in routine selection',()=>{
 assert.throws(()=>currentLocalCheck('manual-archive'));
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/audit-historical-evidence.mjs')],{encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Select an explicit archive check/);
});

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
