const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test,temporaryDirectory}=require('./helpers/ownedFixtures').fixtureLifecycle(require('node:test'));
const {createPlan}=require('../src/releasePublisherCore');
const {summaryPlan,projectJob,createPreviewStore}=require('../src/releaseConsoleView');
process.env.RELEASE_PUBLISHER_TEST_MODE='true';
const sampleXml='';
function tempProject(){
 const root=temporaryDirectory('release-publisher-console-');
 fs.writeFileSync(path.join(root,'mvnw.cmd'),'@echo off\n');
 fs.writeFileSync(path.join(root,'docker-compose.yml'),'services:\n  hospital-backend:\n    image: hospital-backend:fixture\n');
 const catalog=path.join(root,'src/main/java/com/zly/hospital/service/catalog');
 fs.mkdirSync(catalog,{recursive:true});fs.writeFileSync(path.join(catalog,'CatalogDatabaseUpgradeService.java'),'class Catalog { private static final int MARKER_VERSION = 20; }');
 return root;
}
const appSource=()=>fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

test('runtime source exposes fatal-gated observation and visible active job heartbeat states', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'releasePublisherCore.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(core, /status: 'ROLLED_BACK'/);
  assert.match(core, /status: 'RECOVERY_REQUIRED'/);
  assert.match(core, /automatic_rollback_validation=PASS/);
  assert.match(core, /game_cutover_observation=PASS/);
  assert.match(core, /cutoverCommittedAt/);
  assert.match(core, /全链路致命故障阈值未满足/);
  assert.match(core, /fatal_rollback_decision/);
  assert.match(core, /stepRemainingSeconds/);
  assert.match(app, /value === 'RECOVERING'/);
  assert.match(app, /新版本已生效，安全观察中/);
  assert.match(app, /refreshProductionImageOnly/);
  assert.match(app, /buildPipelinePhases/);
  assert.match(app, /准备发布源/);
  assert.match(app, /批量测试与构建/);
  assert.match(app, /全链路观察/);
  assert.match(app, /'verify-game-static-delivery',\s*'verify-relations-release', 'verify-tradepool-release'/);
  assert.match(app, /致命故障恢复/);
  assert.match(app, /step\.recoveryOnly/);
  assert.match(app, /距超时约/);
  assert.match(server, /'ROLLED_BACK', 'RECOVERY_REQUIRED'/);
  assert.match(server, /job\.cutoverCommitted === true/);
  assert.match(server, /job\.recoveryBoundaryEntered === true/);
  assert.match(server, /论坛生产 Compose 修改已经开始/);
  assert.match(server, /等待全链路致命故障复核/);
});

test('pipeline phases follow execution order when game build starts', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const sourceMembers = app.match(/key: 'source'[\s\S]*?members: \[([\s\S]*?)\]\s*},\s*\{ key: 'build'/);
  const buildMembers = app.match(/key: 'build'[\s\S]*?members: \[([\s\S]*?)\]\s*},\s*\{ key: 'delivery'/);
  const deliveryMembers = app.match(/key: 'delivery'[\s\S]*?members: \[([\s\S]*?)\]\s*},\s*\{ key: 'static'/);
  const dataMembers = app.match(/key: 'data'[\s\S]*?members: \[([\s\S]*?)\]\s*},\s*\{ key: 'switch'/);
  const observeMembers = app.match(/key: 'observe'[\s\S]*?members: \[([\s\S]*?)\]\s*},\s*\{ key: 'cleanup'/);

  assert.ok(sourceMembers);
  assert.ok(buildMembers);
  assert.ok(deliveryMembers);
  assert.ok(dataMembers);
  assert.ok(observeMembers);
  assert.match(sourceMembers[1], /game-meelok-readiness/);
  assert.match(buildMembers[1], /test-game-backend[\s\S]*build-image/);
  assert.match(deliveryMembers[1], /resolve-ssh-target[\s\S]*game-prd2-migration-readiness[\s\S]*read-remote-compose[\s\S]*game-database-preflight[\s\S]*validate-game-database-migration-compatibility[\s\S]*publish-image/);
  assert.doesNotMatch(dataMembers[1], /game-database-preflight|forum-preflight/);
  assert.match(observeMembers[1], /final-runtime-check[\s\S]*game-prd2-runtime-contract[\s\S]*verify-game-static-delivery/);
  assert.match(app, /key: 'cleanup'[\s\S]*cleanup-game-release-containers[\s\S]*key: 'recovery'/);

  const phaseBlock = app.match(/const phaseDefinitions = \[([\s\S]*?)\n    \];/);
  assert.ok(phaseBlock);
  const assignedKeys = new Set([...phaseBlock[1].matchAll(/members:\s*\[([\s\S]*?)\]/g)]
    .flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1])));
  const root = tempProject(sampleXml);
  const env = {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  };
  const gamePlan = createPlan(root, {appTag: '2026070702', includeStackDeploy: true}, env);
  const dualNodePlan = createPlan(root, {appTag: '2026070702', includeStackDeploy: true,
    requireStandbyCandidate: true}, env);
  const forumPlan = createPlan(root, {
    releaseTarget: 'forum', forumImageMode: 'build', appTag: '2026071501', includeStackDeploy: true
  }, env);
  assert.deepEqual(gamePlan.steps.filter(step => !assignedKeys.has(step.key)).map(step => step.key), []);
  assert.deepEqual(dualNodePlan.steps.filter(step => !assignedKeys.has(step.key)).map(step => step.key), []);
  assert.deepEqual(forumPlan.steps.filter(step => !assignedKeys.has(step.key)).map(step => step.key), []);

  const phaseContext = vm.createContext({});
  vm.runInContext(app.slice(app.indexOf('  function buildPipelinePhases('),
    app.indexOf('  function renderChangeAnalysis(')), phaseContext);
  const productionShapedSteps = [
    {key: 'git-fetch', status: 'done'},
    {key: 'validate-game-sso-source', status: 'done'},
    {key: 'validate-game-source-impact', status: 'running'},
    {key: 'test-game-backend', status: 'pending'},
    {key: 'build-game-static-assets', status: 'pending'},
    {key: 'validate-game-image', status: 'pending'},
    {key: 'build-image', status: 'pending'},
    {key: 'resolve-ssh-target', status: 'pending'}
  ];
  const phases = JSON.parse(JSON.stringify(phaseContext.buildPipelinePhases(productionShapedSteps)));
  assert.deepEqual(phases.map(phase => phase.title), [
    '准备发布源', '批量测试与构建', '交付镜像与连接校验'
  ]);
  assert.equal(phases[0].validation, '3 项检查，点击查看本阶段的检查与日志');
  assert.equal(phases[1].validation, '4 项检查，点击查看本阶段的检查与日志');
  assert.equal(phases[0].status, 'running');assert.equal(phases[1].status, 'pending');
  for (const status of ['pending', 'running', 'done', 'failed']) {
    const readinessPhases = phaseContext.buildPipelinePhases([
      {key: 'game-meelok-readiness', status}, {key: 'git-fetch', status: 'pending'},
      {key: 'build-image', status: 'pending'}
    ]);
    assert.equal(readinessPhases[0].key, 'phase-source');
    assert.equal(readinessPhases[0].validation, '2 项检查，点击查看本阶段的检查与日志');
    assert.equal(readinessPhases[0].status, status === 'done' ? 'pending' : status);
    assert.equal(readinessPhases[1].status, 'pending');
  }
  assert.equal(gamePlan.steps.some(step => step.key.includes('standby-candidate')), false);
  const candidatePhases = phaseContext.buildPipelinePhases(dualNodePlan.steps.filter(step =>
    ['verify-game-standby-candidate', 'accept-game-standby-candidate'].includes(step.key)));
  assert.deepEqual(Array.from(candidatePhases, phase => phase.title),
    ['数据安全与迁移', '备用接管版本验收']);
});

test('page defaults every target load to master and only preserves a branch during commit refresh', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(app, /async function loadBranches\(preserveSelection = false\)/);
  assert.match(app, /preserveSelection\s*&&\s*gitBranch\.dataset\.loaded === 'true'/);
  assert.match(app, /await loadBranches\(true\);/);
  assert.match(html, /<option value="master">读取中<\/option>/);
});

test('step backgrounds communicate execution status instead of final-check type', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.doesNotMatch(css, /\.flow-node\.final-node\s*\{[^}]*background\s*:/s);
  assert.doesNotMatch(css, /\.step\.final-step\s*\{[^}]*background\s*:/s);
  assert.match(css, /\.flow-node\s*\{[^}]*background:\s*#fffdf6;/s);
  assert.match(css, /\.step\s*\{[^}]*background:\s*#fffdf6;/s);
  assert.match(css, /\.flow-node\.running\s*\{\s*background:\s*var\(--lavender\);/);
  assert.match(css, /\.step\.running\s*\{\s*background:\s*var\(--lavender\);/);
  assert.match(css, /\.flow-node\.checked\.final-node\s*\{\s*background:\s*var\(--mint\);/);
  assert.match(css, /\.step\.checked\s*\{\s*background:\s*var\(--mint\);/);
  assert.match(css, /\.flow-node\.failed\s*\{\s*background:\s*#ffd8cf;/);
  assert.match(css, /\.step\.failed\s*\{\s*background:\s*#ffd8cf;/);
  const context=vm.createContext({});vm.runInContext(app.slice(app.indexOf('  function executionClasses('),app.indexOf('  function statusWithDuration(')),context);
  for(const base of ['step','flow-node']){
    assert(!context.executionClasses({status:'pending',finalCheck:true},base).includes('checked'));
    assert(context.executionClasses({status:'done',finalCheck:true},base).includes('checked'));
    assert(context.executionClasses({status:'failed',finalCheck:false},base).includes('failed'));
  }
});

test('forum pipeline groups backup before cutover and labels its normal recovery evidence accurately', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  assert.match(app, /key: 'delivery'[\s\S]*'forum-preflight'[\s\S]*'publish-image'/);
  assert.match(app, /key: 'data'[\s\S]*'backup-forum-release'[\s\S]*key: 'switch'/);
  assert.match(app, /members\.every\(step => step\.key === 'forum-rollback-command'\)/);
  assert.match(app, /'记录论坛恢复入口'/);
});

test('page keeps a visible vertical scrollbar for content below the viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.match(css, /html\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(css, /html::\-webkit-scrollbar\s*\{[^}]*width:\s*14px;/s);
  assert.match(css, /html::\-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--line\);/s);
  assert.doesNotMatch(css, /body\s*\{[^}]*(?:overflow-y:\s*(?:hidden|clip)|overflow:\s*(?:hidden|clip))/s);
});

test('plan loading and image labels distinguish target from production compose', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.doesNotMatch(html, />未生成</);
  assert.match(html, /本次计划发布镜像/);
  assert.match(html, /生产编排当前镜像/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /pipeline-loading/);
  assert.match(html, /本地发布配置镜像/);
  assert.match(html, /本地发布配置 APP_TAG/);
  assert.match(html, /Catalog 预期版本/);
  assert.match(html, /id="publisher-version-panel"/);
  assert.match(html, /id="publisher-runtime-version"/);
  assert.match(html, /id="publisher-repository-version"/);
  assert.match(app, /catalogSchemaVersion\.textContent/);
  assert.match(app, /requestJson\('\/api\/version'\)/);
  assert.match(app, /version\.status/);
  assert.match(css, /\.publisher-version\.version-up_to_date/);
  assert.match(app, /productionImageFlow/);
  assert.match(app, /remoteOnlineResolved: remote.resolved/);
  assert.match(app, /remoteOnlineResolved: false/);
  assert.match(app, /renderProductionImage/);
  assert.match(app, /async function refreshProductionImageOnly/);
  assert.match(app, /setStaticValue/);
  assert.match(css, /loading-spinner/);
  assert.match(css, /animation: refresh-spin 0.8s linear infinite/);
});

test('commit selector includes a refresh control wired to the git refresh endpoint', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.match(html, /id="git-refresh"/);
  assert.match(html, /aria-label="刷新提交列表"/);
  assert.match(app, /requestJson\('\/api\/git\/refresh', \{method: 'POST'\}\)/);
  assert.match(app, /gitRefresh\.addEventListener\('click'/);
  assert.match(css, /\.select-action-row\s*\{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 44px;/);
});

test('release console exposes game and forum targets with target-aware API payloads', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(html, /id="release-target"/);
  assert.match(html, /id="change-analysis"/);
  assert.match(html, /option value="game">游戏后端<\/option>/);
  assert.match(html, /option value="forum">论坛<\/option>/);
  assert.match(html, /id="forum-image-mode"/);
  assert.match(html, /option value="build">构建并上传新镜像<\/option>/);
  assert.match(html, /option value="reuse">复用生产已有镜像<\/option>/);
  assert.match(html, /id="remote-rehearsal"/);
  assert.match(html, /未配置隔离前置演练清单/);
  assert.match(html, /id="deploy-toggle-label"/);
  assert.match(app, /releaseTarget:\s*releaseTarget\.value/);
  assert.match(app, /forumImageMode:\s*forumImageMode\.value/);
  assert.match(app, /releaseChangedOnly:\s*true/);
  assert.match(app, /remoteRehearsal:\s*remoteRehearsal\.checked/);
  assert.match(app, /remoteRehearsalAvailable/);
  assert.match(app, /remoteRehearsalAvailable:\s*latestConfig\?\.remoteRehearsalAvailable/);
  assert.match(app, /临时根目录创建、删除、恢复对象，并只读检查 Web 路由/);
  assert.match(app, /--远程前置演练|远程前置演练/);
  assert.match(app, /api\/changes/);
  assert.match(app, /recommendedTarget === 'game'/);
  assert.match(app, /function renderChangeAnalysis/);
  assert.match(app, /gitBranch\.disabled = reuseForumImage/);
  assert.match(app, /gitBranchField\.hidden = reuseForumImage/);
  assert.match(app, /将复用生产已有镜像/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.step-title\s*>\s*div,[\s\S]*?min-width:\s*0/);
  assert.match(css, /word-break:\s*break-all/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(app, /api\/config\?releaseTarget=/);
  assert.doesNotMatch(html, /id="docker-context"|id="remote-ssh-target"|id="remote-compose-dir"/);
  assert.doesNotMatch(app, /getElementById\('docker-context'\)|getElementById\('remote-ssh-target'\)|getElementById\('remote-compose-dir'\)/);
  assert.doesNotMatch(app, /dockerContext:\s*dockerContext|remoteSshTarget:\s*remoteSshTarget|remoteComposeDir:\s*remoteComposeDir/);
  assert.match(app, /config\.dockerServerName/);
  assert.match(app, /const requestId = \+\+configLoadRequestId/);
  assert.match(app, /requestId !== configLoadRequestId/);
  assert.match(app, /fields\.serverName\.textContent = config\.dockerServerName \|\| config\.dockerContext/);
  assert.match(server, /resolveReleaseTargetDockerServerName\(releaseTarget/);
  assert.match(server, /resolveReleaseTargetSshTarget\(releaseTarget/);
  assert.match(app, /执行论坛 Compose 发布/);
  assert.match(app, /function compactBranchLabel/);
  assert.match(app, /option\.title = branch\.name/);
  assert.doesNotMatch(app, /previousTarget !== config\.releaseTarget/);
  assert.doesNotMatch(server, /RELEASE_PUBLISHER_FORUM_REMOTE_COMPOSE_DIR/);
  assert.match(server, /远端镜像查询目标由发布器配置固定管理/);
  assert.match(server, /pathname === '\/api\/version'/);
  assert.match(server, /capturePublisherRuntimeVersion/);
  assert.match(server, /RELEASE_PUBLISHER_REHEARSAL_GATEWAY_STATIC_CONFIG/);
  assert.match(server, /assertReleaseTargetChanged/);
  assert.match(server, /gitCommit:\s*analysis\.targetCommit/);
  assert.match(server, /createReleaseWorktree\([\s\S]*?body\.gitCommit/);
  assert.match(server, /executePlan\(executionRoot/);
  assert.match(server, /logs:\s*\[sourceSetupLog\]\.concat\(progress\.logs \|\| \[\]\)/);
  assert.match(server, /removeReleaseWorktree\(projectRoot, publisherRepositoryRoot, job\.id\)/);
});


test('summary and selected-step projections omit unrelated raw output and preserve actual job state',()=>{
 const steps=[{key:'one',title:'First',status:'running',command:'private-command-one',validation:'check one',logs:Array.from({length:700},(_,i)=>'line '+i)},
  {key:'two',title:'Second',status:'pending',command:'unrelated-command',validation:'unrelated-check',logs:['unrelated-log']}];
 const plan={releaseTarget:'game',steps,config:{imageTag:'fixture'}},job={id:'job1',status:'RUNNING',currentStepKey:'one',plan,logs:['aggregate-only']};
 const summary=projectJob(job,{revision:1});
 assert.equal(summary.status,'RUNNING');assert.equal(summary.currentStepKey,'one');assert.equal(summary.plan.steps.length,2);
 for(const value of ['private-command-one','check one','unrelated-command','unrelated-check','unrelated-log','aggregate-only'])assert(!JSON.stringify(summary).includes(value),value);
 const detail=projectJob(job,{view:'step',stepKey:'one',revision:2});
 assert.equal(detail.stepDetail.command,'private-command-one');assert.equal(detail.stepDetail.logs.length,500);
 assert.equal(detail.stepDetail.logCount,700);assert.equal(detail.stepDetail.logsTruncated,true);
 assert(!JSON.stringify(detail).includes('unrelated-command'));assert(!Object.hasOwn(detail,'logs'));
 assert.deepEqual(projectJob(job,{view:'step',stepKey:'one',includeLogs:true}).logs,['aggregate-only']);
 assert.throws(()=>projectJob(job,{view:'unknown'}));assert.throws(()=>projectJob(job,{stepKey:'one'}));
 assert.throws(()=>projectJob(job,{includeLogs:true}));assert.throws(()=>projectJob(job,{view:'step',stepKey:'missing'}),/不可用/);
 assert.equal(plan.steps[0].logs.length,700);assert.equal(job.logs.length,1);
 assert(summaryPlan(plan).steps.every(step=>!Object.hasOwn(step,'command')));
});
test('preview details are immutable bounded expiring read-only snapshots',()=>{
 let clock=0;const store=createPreviewStore({now:()=>clock});
 const original={steps:[{key:'one',command:'owned',logs:[]}]},preview=store.put(original);
 original.steps[0].command='mutated';assert.equal(store.step(preview.previewId,'one').stepDetail.command,'owned');
 assert.throws(()=>store.step(preview.previewId,'missing'),/不可用/);
 for(let index=0;index<4;index++)store.put({steps:[{key:'one',command:'other'}]});
 assert.throws(()=>store.step(preview.previewId,'one'),/过期/);
 const current=store.put(original);clock=300000;assert.throws(()=>store.step(current.previewId,'one'),/过期/);
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),execute=server.slice(server.indexOf("pathname === '/api/execute'"),server.indexOf("pathname === '/api/jobs/active'"));
 assert(execute.includes('prepareReleaseRequest(body, true)'));assert(!execute.includes('previewStore'));
});
function previewHarness(){
 const source=appSource(),calls=[],rendered=[],statuses=[],errors=[];
 const field=()=>({classList:{contains:()=>false}});
 const context=vm.createContext({AbortController,activeJobId:'',planFlight:null,planRequestId:0,activeView:'overview',displayedJobId:'',currentPlan:null,selectedDetail:null,
  payload:()=>context.inputs,inputs:{appTag:'one'},fields:{targetImageFlow:field(),targetImage:field(),productionImageFlow:field()},
  pipeline:{setAttribute(){}},setStatus:(...args)=>statuses.push(args),renderPlanLoading(){},renderStepOptions(){},renderSelectedStep(){},invalidateDetail(){},
  setStaticValue(){},renderPlanError:message=>errors.push(message),renderPlan:plan=>rendered.push(plan),loadSelectedDetail(){},
  requestJson:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))});
 vm.runInContext(source.slice(source.indexOf('  function invalidatePlanRequest()'),source.indexOf('  async function execute()')),context);
 return {context,calls,rendered,statuses,errors};
}
test('actual preview request code coalesces requests and rejects stale or aborted completion',async()=>{
 const h=previewHarness(),first=h.context.plan(),duplicate=h.context.plan();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/plan?view=summary');
 h.calls[0].resolve({id:'one'});await Promise.all([first,duplicate]);assert.equal(h.rendered.length,1);
 const obsolete=h.context.plan();h.context.inputs={appTag:'two'};const current=h.context.plan();
 assert.equal(h.calls.length,3);assert(h.calls[1].options.signal.aborted);
 h.calls[2].resolve({id:'two'});await current;h.calls[1].resolve({id:'stale'});assert.equal(await obsolete,null);
 assert.deepEqual(h.rendered.map(plan=>plan.id),['one','two']);assert.equal(h.errors.length,0);
 h.context.activeJobId='active';await h.context.plan();assert.equal(h.calls.length,3);
});
test('successful preview retry clears error status and empty TAG sends no plan request',async()=>{
 const h=previewHarness(),failed=h.context.plan();h.calls[0].reject(Error('controlled failure'));await assert.rejects(failed,/controlled failure/);
 assert.equal(h.errors.length,1);const retry=h.context.plan();h.calls[1].resolve({id:'fixed'});await retry;
 assert.deepEqual(h.statuses.at(-1),['发布流程已生成','success']);
 h.context.inputs={appTag:''};assert.equal(await h.context.plan(),null);assert.equal(h.calls.length,2);
});
test('selected-step responses require current tab selection epoch source and server revision',()=>{
 const source=appSource(),rendered=[];
 const context=vm.createContext({activeView:'details',detailEpoch:2,detailSource:()=> 'job:current',selectedStepKey:'one',detailRevision:0,selectedDetail:null,
  detailError:'',aggregateLogs:{open:false},renderSelectedStep:()=>rendered.push(true),renderLogs(){},document:{getElementById:()=>({textContent:''})}});
 vm.runInContext(source.slice(source.indexOf('  function acceptStepDetail('),source.indexOf('  async function loadSelectedDetail(')),context);
 const apply=(revision,epoch=2,identity='job:current',key='one')=>context.acceptStepDetail({viewRevision:revision,stepDetail:{key,text:'r'+revision}},epoch,identity,key);
 apply(3);assert.equal(context.selectedDetail.text,'r3');apply(2);apply(4,1);apply(5,2,'job:old');apply(6,2,'job:current','other');
 context.activeView='overview';apply(7);assert.equal(rendered.length,1);assert.equal(context.selectedDetail.text,'r3');
});

test('unavailable plan errors end loading while active job details remain visible',()=>{
 const source=appSource(),messages=[],fields={targetImageFlow:{},targetImage:{}};
 const context=vm.createContext({status:{textContent:'',className:''},fields,currentPlan:null,activeJobId:'',
  pipeline:{getAttribute:()=> 'true'},setStaticValue:(field,value)=>{field.value=value;},renderPlanError:message=>messages.push(message)});
 vm.runInContext(source.slice(source.indexOf('  function setStatus('),source.indexOf('  function ',source.indexOf('  function setStatus(')+5)),context);
 context.setStatus('version locked','error');assert.equal(fields.targetImage.value,'计划未就绪');assert.deepEqual(messages,['version locked']);
 context.currentPlan={};context.setStatus('job failure','error');assert.equal(messages.length,1);
 context.currentPlan=null;context.activeJobId='active';context.setStatus('network unavailable','error');assert.equal(messages.length,1);
});
