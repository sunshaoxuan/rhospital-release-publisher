const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {seedApplicationPolicy}=require('./helpers/applicationPolicyFixture');
const {PROFILE,validateApplicationPolicy,loadApplicationPolicy,runWithApplicationPolicy,applicationPolicyIdentity}=require('../src/applicationReleasePolicy');
const {selectedRuntimeChecks,runtimeCheckCommands}=require('../src/applicationRuntimeChecks');
process.env.RELEASE_PUBLISHER_TEST_MODE='true';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'application-policy-'));seedApplicationPolicy(root);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const put=(root,file,text)=>{const full=path.join(root,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,text);};
const read=root=>JSON.parse(fs.readFileSync(path.join(root,PROFILE),'utf8'));

test('browser host exposes its versioned generic API without launching a browser',async()=>{
 const host=await import('../scripts/release-browser-host.mjs');
 assert.equal(host.RELEASE_BROWSER_HOST_API_VERSION,'release-browser-host/v1');
 for(const key of ['chromeCleanupEvidence','evaluate','isBrowserInfrastructureFailure','isIgnoredTelemetryEntry','resolveStaticDeliveryPrerequisites','runBrowserCapabilityProbe','useChromeTarget'])assert.equal(typeof host[key],'function');
});

test('browser gateway resolution reads only the publisher environment manifest', async t => {
 const root = fixture(t);
 const {readBrowserGateways} = await import('../scripts/release-browser-host.mjs');
 const manifest = path.join(root, 'gateway.json');
 const gateways = [{id:'edge-one',host:'192.0.2.10'}, {id:'edge-two',host:'192.0.2.11'}];
 const write = (entries, schemaVersion = 1) => fs.writeFileSync(manifest, JSON.stringify({schemaVersion, gateways:entries}));
 write(gateways);
 assert.deepEqual(readBrowserGateways(manifest), [
   {name:'edge-one',ip:'192.0.2.10'}, {name:'edge-two',ip:'192.0.2.11'}
 ]);
 assert.throws(() => readBrowserGateways(), /config is required/);
 write(gateways, 2);
 assert.throws(() => readBrowserGateways(manifest), /config version/);
 for (const invalid of [[], [gateways[0], gateways[0]], [gateways[0], {...gateways[1],host:gateways[0].host}],
   [gateways[0], {...gateways[1],host:'invalid.example'}]]) {
   write(invalid);
   assert.throws(() => readBrowserGateways(manifest), /distinct gateway IDs and IPv4 addresses/);
 }
});

test('immutable candidate policy ignores dirty files and binds the actual owned source bundle',t=>{
 const root=fixture(t),env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key];
 const git=(...args)=>execFileSync('git',['-C',root,...args],{env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','policy');
 const candidate=git('rev-parse','HEAD'),policy=loadApplicationPolicy(root,candidate),file=read(root).databaseAudit.source;
 fs.appendFileSync(path.join(root,file),'\n// uncommitted drift\n');
 const unchanged=loadApplicationPolicy(root,candidate);assert.equal(unchanged.identity.ownedInputHash,policy.identity.ownedInputHash);assert.equal(unchanged.read(file),policy.read(file));
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','policy input');
 const changed=loadApplicationPolicy(root,git('rev-parse','HEAD'));assert.notEqual(changed.identity.ownedInputHash,policy.identity.ownedInputHash);
 runWithApplicationPolicy(policy,()=>assert.equal(applicationPolicyIdentity().candidateCommit,candidate));
 assert.throws(()=>policy.read('undeclared.txt'),/UNDECLARED_INPUT_READ/);
});

test('missing ownership, protocol drift and authority escalation fail before any command',t=>{
 const root=fixture(t),original=read(root);
 for(const change of [p=>p.apiVersion='unknown',p=>p.inputs=[],p=>p.databaseAudit.source='../secret',p=>p.catalog.className='bad;command',p=>p.migrationRules.finalizations[0].statement='DROP TABLE assets;',p=>p.runtimeChecks=[{id:'final-runtime-check',paths:[],prefixes:[],kind:'http-get',path:'/',status:200,timeoutSeconds:5}],p=>p.credentials='forbidden']){
   const data=structuredClone(original);change(data);assert.throws(()=>validateApplicationPolicy(data));
 }
 fs.unlinkSync(path.join(root,original.databaseAudit.source));assert.throws(()=>loadApplicationPolicy(root,'latest'));
});

test('application Node checks export immutable declared inputs, strip host secrets and require terminal completion',t=>{
 const root=fixture(t),data=read(root),entry='release/publisher/checks/fixture.mjs';
 put(root,entry,"if(process.env.RELEASE_TEST_SECRET)process.exit(9);console.log('fixture_check=PASS');\n");
 data.inputs.push(entry);data.nodeChecks.push({id:'application.fixture-node',entrypoint:entry,completion:{kind:'marker',value:'fixture_check=PASS'}});put(root,PROFILE,JSON.stringify(data));
 const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key];
 const git=(...args)=>execFileSync('git',['-C',root,...args],{env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','node check');
 const candidate=git('rev-parse','HEAD'),expectedPolicy=loadApplicationPolicy(root,candidate).identity.ownedInputHash;
 const {runApplicationNodeCheck,validateCompletion}=require('../src/applicationNodeCheck');
 const previous=process.env.RELEASE_TEST_SECRET;process.env.RELEASE_TEST_SECRET='fixture-must-not-export';
 try{const result=runApplicationNodeCheck({root,candidate,id:'application.fixture-node',expectedPolicy,timeoutSeconds:5});assert.equal(result.state,'PASS');assert.equal(result.policyHash,expectedPolicy);}
 finally{if(previous===undefined)delete process.env.RELEASE_TEST_SECRET;else process.env.RELEASE_TEST_SECRET=previous;}
 assert.throws(()=>runApplicationNodeCheck({root,candidate,id:'application.fixture-node',expectedPolicy:'0'.repeat(64)}),/identity mismatch/);
 assert.equal(validateCompletion(data.nodeChecks.at(-1).completion,'fixture_check=PASS\ntruncated'),false);
 assert.equal(validateCompletion({kind:'json',protocol:'fixture-v1'},'{"status":"PASS","protocol":"wrong"}'),false);
 assert.throws(()=>runApplicationNodeCheck({root,candidate,id:'application.fixture-node',expectedPolicy},{launch:()=>({status:0,stdout:'fixture_check=PASS\ntruncated'})}),/completion protocol/);
});

test('a new business check changes only application policy and preserves mandatory stage ordering',t=>{
 const root=fixture(t),data=read(root);
 const check={id:'application.new-business',paths:['src/main/resources/new-feature.txt'],prefixes:[],kind:'http-get',path:'/api/new-feature/status',status:200,timeoutSeconds:5};
 data.runtimeChecks.push(check);put(root,PROFILE,JSON.stringify(data));
 put(root,'mvnw.cmd','@echo off\n');put(root,'docker-compose.yml','services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n');
 put(root,data.sources.catalog,'class Schema { private static final int MARKER_VERSION = 20; }');
 put(root,'release/publisher/game.json',JSON.stringify({apiVersion:'release-plugin/v1',pluginId:'fixture.game',target:'game',coverage:[{paths:['new.test.mjs'],prefixes:[],units:['source']}],units:[{id:'source',phase:'source',requires:['engine-context@1','node-test@1'],inputs:['new.test.mjs'],run:{kind:'node-test',entrypoints:['new.test.mjs'],protocol:'tap-v1',timeoutSeconds:5}}],migrations:[]}));
 const core=require.resolve('../src/releasePublisherCore'),before=crypto.createHash('sha256').update(fs.readFileSync(core)).digest('hex');
 const requiredChecks=['test-game-backend','verify-game-static-assets-predeploy','pre-deploy-checklist','final-runtime-check',
   'verify-game-static-delivery',check.id].map(stepKey=>({stepKey,reason:'Verify the declared fixture behavior'}));
 put(root,'release/release-impact.json',JSON.stringify({schemaVersion:1,assessmentId:'fixture-business',summary:'Fixture runtime impact assessment',
   targets:{game:{riskLevel:'low',coveredRuntimePaths:check.paths,codeImpact:'Check the fixture feature behavior',
     databaseImpact:'none',checklistDecision:'checklist-updated',requiredChecks}}}));
 const request={appTag:'fixture',dryRun:true,includeStackDeploy:true,
   changeAnalysis:{targets:{game:{changed:true,changedPaths:check.paths,ignoredPaths:['release/release-impact.json']}}}};
 const env={RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'};
 const plan=require(core).createPlan(root,request,env);
 const index=key=>plan.steps.findIndex(step=>step.key===key);
 assert(index('final-runtime-check')<index(check.id));assert(index(check.id)<index('game-config-compensation'));
 const encoded=plan.steps.find(step=>step.key===check.id).command.match(/\$remoteScript = ['"]([A-Za-z0-9+/=]+)['"]/);
 assert(encoded);assert(Buffer.from(encoded[1],'base64').toString('utf8').includes('/api/new-feature/status'));
 assert.equal(plan.steps.find(step=>step.key===check.id).productionAction,false);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(core)).digest('hex'),before);
 assert.deepEqual(selectedRuntimeChecks(data,new Set()),[]);
 assert.deepEqual(selectedRuntimeChecks(data,new Set([check.id])),[check]);
 const assessment=JSON.parse(fs.readFileSync(path.join(root,'release/release-impact.json'),'utf8'));
 assessment.targets.game.requiredChecks.pop();
 put(root,'release/release-impact.json',JSON.stringify(assessment));
 assert.equal(require(core).createPlan(root,request,env).steps.some(step=>step.key===check.id),false);
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
 const run=code=>spawnSync(bash,['-c','set -eu\ncurl() { printf '+code+'; }\n'+runtimeCheckCommands(check).join('\n')],{encoding:'utf8'});
 assert.equal(run(200).status,0);assert.notEqual(run(500).status,0);
 const rejected=runtimeCheckCommands({...check,status:403});assert.equal(spawnSync(bash,['-c','set -eu\ncurl() { printf 403; }\n'+rejected.join('\n')]).status,0);
});
