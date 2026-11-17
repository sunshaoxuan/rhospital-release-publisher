const fs=require('node:fs'),path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
const {hash}=require('./changeValidationReceipts');
const {git,manifest}=require('./changeValidationGit');
const {createPlanSourceReader}=require('./releasePlanSources');
const scope=new AsyncLocalStorage();
const PROFILE='release/publisher/game-policy.json';
const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
function reject(code){throw new Error('APPLICATION_POLICY_'+code);}
function safeFile(file){if(typeof file!=='string'||!file||file.length>512||/[\\:\x00-\x20]/.test(file)||path.posix.isAbsolute(file)||file.split('/').some(p=>!p||p==='.'||p==='..'))reject('UNSAFE_PATH');return file;}
function list(value,min=0){if(!Array.isArray(value)||value.length<min||value.length>128||new Set(value.map(v=>JSON.stringify(v))).size!==value.length)reject('INVALID_LIST');return value;}
function shape(value,fields){if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...fields].sort().join('|'))reject('INVALID_FIELDS');}
function validateApplicationPolicy(data){
 shape(data,['apiVersion','target','sources','catalog','databaseAudit','migrationRules','formats','scheduler','beforeRollbackSql','runtimeChecks','legacyRuntimeChecks','nodeChecks','browser','shellChecks','inputs']);
 if(data.apiVersion!=='application-release-policy/v1'||data.target!=='game')reject('VERSION_OR_TARGET');
 shape(data.sources,['catalog','properties','productionProperties','token','main']);Object.values(data.sources).forEach(safeFile);
 shape(data.catalog,['marker','className','imagePaths','requiredColumns','requiredIndexes']);
 if(!identifier.test(data.catalog.marker)||!/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(data.catalog.className))reject('INVALID_CLASS');
 list(data.catalog.imagePaths,1).forEach(safeFile);
 for(const field of ['requiredColumns','requiredIndexes'])for(const name of list(data.catalog[field]))if(!identifier.test(name))reject('INVALID_IDENTIFIER');
 shape(data.databaseAudit,['source','className']);safeFile(data.databaseAudit.source);if(!identifier.test(data.databaseAudit.className))reject('INVALID_CLASS');
 const rules=data.migrationRules;shape(rules,['designRetirement','inventoryBackup','readonlyQueries','preconditions','finalizations','admissions','controlledDeletes']);
 safeFile(rules.designRetirement);shape(rules.inventoryBackup,['migration','table']);safeFile(rules.inventoryBackup.migration);if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(rules.inventoryBackup.table))reject('INVALID_IDENTIFIER');
 for(const rule of list(rules.readonlyQueries)){shape(rule,['pathPattern','source']);new RegExp(rule.pathPattern);safeFile(rule.source);}
 for(const rule of list(rules.preconditions)){shape(rule,['migration','block','requiredTokens']);safeFile(rule.migration);if(!identifier.test(rule.block))reject('INVALID_BLOCK');list(rule.requiredTokens,1).forEach(s=>{if(typeof s!=='string'||s.length>256)reject('INVALID_TOKEN');});}
 for(const rule of list(rules.finalizations)){shape(rule,['migration','statement']);safeFile(rule.migration);if(!/^ALTER TABLE [a-z_][a-z0-9_]* ALTER COLUMN [a-z_][a-z0-9_]* SET DEFAULT '[A-Za-z0-9_]+', ALTER COLUMN [a-z_][a-z0-9_]* SET NOT NULL;$/.test(rule.statement))reject('UNSAFE_FINALIZATION');}
 for(const rule of list(rules.admissions)){shape(rule,['migration','requiredPattern']);safeFile(rule.migration);new RegExp(rule.requiredPattern);}
 for(const rule of list(rules.controlledDeletes)){shape(rule,['table','alias','snapshot']);if(!Object.values(rule).every(v=>identifier.test(v))||!rule.snapshot.startsWith('tmp_'))reject('UNSAFE_DELETE_CONTRACT');}
 const ids=new Set();for(const format of list(data.formats,1)){shape(format,['id','migrations','allOrNone','marker','floorQuery','classes']);if(!identifier.test(format.id)||ids.has(format.id)||typeof format.allOrNone!=='boolean'||!/^\.[a-z0-9.-]+$/.test(format.marker))reject('INVALID_FORMAT');ids.add(format.id);list(format.migrations,1).forEach(safeFile);list(format.classes,1).forEach(safeFile);if(typeof format.floorQuery!=='string'||format.floorQuery.length>8192||!/\bBEGIN READ ONLY;/i.test(format.floorQuery))reject('INVALID_FLOOR');}
 shape(data.scheduler,['migration','guard','executors','floorQuery','observationQuery']);safeFile(data.scheduler.migration);safeFile(data.scheduler.guard);safeFile(data.scheduler.observationQuery);for(const executor of list(data.scheduler.executors,1))if(!identifier.test(executor))reject('INVALID_EXECUTOR');
 safeFile(data.beforeRollbackSql);list(data.inputs,1).forEach(safeFile);
 const referenced=[data.databaseAudit.source,data.scheduler.guard,data.scheduler.observationQuery,data.beforeRollbackSql,...rules.readonlyQueries.map(r=>r.source)];
 if(referenced.some(file=>!data.inputs.includes(file)))reject('UNDECLARED_INPUT');
 const checks=new Set();for(const check of list(data.runtimeChecks)){
   if(check.kind==='http-get'){shape(check,['id','paths','prefixes','kind','path','status','timeoutSeconds']);if(!/^\/[A-Za-z0-9/_?=&.-]*$/.test(check.path)||!Number.isInteger(check.status)||check.status<100||check.status>599)reject('INVALID_RUNTIME_CHECK');}
   else if(check.kind==='node-check'){shape(check,['id','paths','prefixes','kind','nodeCheck','args','timeoutSeconds']);if(!data.nodeChecks.some(node=>node.id===check.nodeCheck)||!Array.isArray(check.args)||check.args.length>64||check.args.some(arg=>typeof arg!=='string'||/[\x00-\x1f]/.test(arg)||arg.length>4096||arg.startsWith('$')&&!['$appTag','$authTokenFile','$browserHost','$sshTarget','$sshKey','$sshPort'].includes(arg)))reject('INVALID_NODE_ARGUMENT');}
   else reject('INVALID_RUNTIME_CHECK');
   if(!/^application\.[a-z][a-z0-9.-]{0,86}$/.test(check.id)||checks.has(check.id)||!Number.isInteger(check.timeoutSeconds)||check.timeoutSeconds<1||check.timeoutSeconds>(check.kind==='http-get'?60:3600))reject('INVALID_RUNTIME_CHECK');checks.add(check.id);list(check.paths).forEach(safeFile);list(check.prefixes).forEach(p=>{if(!p.endsWith('/'))reject('INVALID_PREFIX');safeFile(p.slice(0,-1));});
 }
 for(const check of list(data.legacyRuntimeChecks)){shape(check,['id','pathPattern','nodeCheck']);if(checks.has(check.id)||typeof check.id!=='string'||check.nodeCheck!==null&&!data.nodeChecks.some(node=>node.id===check.nodeCheck))reject('DUPLICATE_OR_MISSING_CHECK');checks.add(check.id);new RegExp(check.pathPattern);}
 const nodeIds=new Set();for(const check of list(data.nodeChecks)){shape(check,['id','entrypoint','completion']);if(!/^application\.[a-z][a-z0-9.-]{0,86}$/.test(check.id)||nodeIds.has(check.id))reject('INVALID_NODE_CHECK');nodeIds.add(check.id);safeFile(check.entrypoint);if(!data.inputs.includes(check.entrypoint))reject('UNDECLARED_INPUT');if(check.completion.kind==='marker'){shape(check.completion,['kind','value']);if(!/^[a-z0-9_]+=PASS$/.test(check.completion.value))reject('INVALID_COMPLETION');}else if(check.completion.kind==='json'){shape(check.completion,['kind','protocol']);if(!/^[a-z0-9.-]+$/.test(check.completion.protocol))reject('INVALID_COMPLETION');}else reject('INVALID_COMPLETION');}
 shape(data.browser,['delivery','prerequisites','probe','heartbeat']);if(!nodeIds.has(data.browser.delivery)||!nodeIds.has(data.browser.prerequisites))reject('MISSING_BROWSER_CHECK');
 shape(data.browser.probe,['route','cookieName','readyExpression']);if(!/^\/[A-Za-z0-9/_?=&.-]*$/.test(data.browser.probe.route)||!identifier.test(data.browser.probe.cookieName))reject('INVALID_BROWSER_PROBE');safeFile(data.browser.probe.readyExpression);if(!data.inputs.includes(data.browser.probe.readyExpression))reject('UNDECLARED_INPUT');
 validateHeartbeat(data.browser.heartbeat);
 shape(data.shellChecks,['catalogLogs','catalogPostDeploy','runtimeProbes','startupLog']);for(const file of Object.values(data.shellChecks)){safeFile(file);if(!data.inputs.includes(file))reject('UNDECLARED_INPUT');}
 return data;
}
function loadApplicationPolicy(root,commit='latest'){
 let candidate=commit,entries;
 if(commit==='latest'&&!(process.env.RELEASE_PUBLISHER_TEST_MODE==='true'&&!fs.existsSync(path.join(root,'.git')))){try{candidate=git(root,['rev-parse','HEAD']).toString('utf8').trim();}catch{reject('EXACT_CANDIDATE_REQUIRED');}}
 if(candidate!=='latest'){if(!/^[a-f0-9]{40}$/i.test(candidate))candidate=git(root,['rev-parse',candidate+'^{commit}']).toString('utf8').trim();entries=manifest(root,candidate);}
 const reader=createPlanSourceReader(root,candidate);
 const read=file=>{safeFile(file);if(entries){const entry=entries.get(file);if(!entry||!['100644','100755'].includes(entry.mode))reject('UNSAFE_OR_MISSING_INPUT');}else{const target=path.resolve(root,file);if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())reject('UNSAFE_INPUT');}return reader(file,true);};
 const raw=read(PROFILE);if(Buffer.byteLength(raw)>1024*1024)reject('TOO_LARGE');
 const data=validateApplicationPolicy(JSON.parse(raw));const texts=new Map();
 for(const file of data.inputs){const text=read(file);if(Buffer.byteLength(text)>4*1024*1024)reject('INPUT_TOO_LARGE');texts.set(file,text);}
 const owned=Object.fromEntries([...texts].map(([file,text])=>[file,hash(text.replace(/\r\n/g,'\n'))]));
 const identity=Object.freeze({protocol:data.apiVersion,candidateCommit:candidate,profilePath:PROFILE,profileSha256:hash(raw),normalization:'UTF8_LF',ownedInputHash:hash({data,owned})});
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(data);
 new (require('node:vm').Script)(texts.get(data.browser.probe.readyExpression));
 if(!new RegExp('\\bclass\\s+'+data.databaseAudit.className+'\\b').test(texts.get(data.databaseAudit.source)))reject('AUDIT_CLASS_MISMATCH');
 return {data,identity,profileText:raw,root:path.resolve(root),read:file=>{if(!texts.has(file))reject('UNDECLARED_INPUT_READ');return texts.get(file);}};
}
function runWithApplicationPolicy(policy,body){return scope.run(policy,body);}
function current(){const value=scope.getStore();if(!value)reject('CONTEXT_REQUIRED');return value;}
function applicationPolicy(){return current().data;}
function applicationPolicyText(file){return current().read(file);}
function applicationPolicyIdentity(){return current().identity;}
function applicationPolicyRoot(){return current().root;}
function withApplicationPolicy(root,request,body){return runWithApplicationPolicy(loadApplicationPolicy(root,request.gitCommit||'latest'),body);}
function enterTestPolicy(policy){if(process.env.RELEASE_PUBLISHER_TEST_MODE!=='true')reject('TEST_CONTEXT_FORBIDDEN');scope.enterWith(policy);}
function validateHeartbeat(spec){shape(spec,['path','method','status','equals','anyPresent']);if(!/^\/[A-Za-z0-9/_?=&.-]*$/.test(spec.path)||!['GET','POST'].includes(spec.method)||!Number.isInteger(spec.status)||spec.status<200||spec.status>=400||!spec.equals||typeof spec.equals!=='object'||Array.isArray(spec.equals)||Object.entries(spec.equals).some(([key,value])=>!identifier.test(key)||value!==null&&!['string','number','boolean'].includes(typeof value))||list(spec.anyPresent).some(key=>!identifier.test(key)))reject('INVALID_HEARTBEAT');return spec;}
module.exports={PROFILE,validateApplicationPolicy,validateHeartbeat,loadApplicationPolicy,runWithApplicationPolicy,withApplicationPolicy,applicationPolicy,applicationPolicyText,applicationPolicyIdentity,applicationPolicyRoot,enterTestPolicy};
