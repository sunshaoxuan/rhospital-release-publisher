// Only a genuine completed preflight may suppress duplicate formal-source tests.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {hash,receiptStore}=require('./changeValidationReceipts');
const executorFiles=['preflightCoverage.js','localCheckLeaves.js','currentBehaviorGuard.cjs','currentBehaviorChecks.json','changeValidationRunner.js','changeValidationReceipts.js'];
function git(root,...args) {
 const env={...process.env};for(const k of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[k];
 return execFileSync('git',['-C',root,...args],{env,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
}
function coverageIdentity(root,keys) {
 if(!Array.isArray(keys)||new Set(keys).size!==keys.length)throw new Error('Invalid preflight coverage selection');
 const catalog=require('./currentBehaviorChecks.json');
 if(keys.some(k=>!Object.hasOwn(catalog,k)))throw new Error('Unknown covered preflight check');
 const tree=git(root,'write-tree');
 return {kind:'completed-preflight-coverage/v2',tree,keys:[...keys].sort(),
   executorsCanonicalSha256:Object.fromEntries(executorFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f),'utf8').replace(/\r\n/g,'\n'))])),
   node:hash(fs.readFileSync(process.execPath)),version:process.version,
   environment:hash(Object.fromEntries(['NODE_OPTIONS','NODE_PATH','NODE_ENV','TZ','LANG'].map(k=>[k,process.env[k]||''])))};
}
function store(root){return receiptStore(path.join(git(root,'rev-parse','--path-format=absolute','--git-common-dir'),'change-validation'));}
function assertResults(keys,results) {
 if(!Array.isArray(results)||results.length!==keys.length||new Set(results.map(r=>r.key)).size!==keys.length
   ||keys.some(k=>!results.some(r=>r.key===k)))throw new Error('Incomplete preflight coverage');
 for(const result of results)require('./changeValidationRunner').assertNodeResult(result);
}
function writeCoverage(root,keys,results) {
 if(!fs.existsSync(path.join(root,'.git')))return false; // Non-Git isolated test fixtures cannot issue build authority.
 assertResults(keys,results);
 const identity=coverageIdentity(root,keys);
 const rawExecutorSha256=Object.fromEntries(executorFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
 store(root).write(identity,{state:'PASS',protocol:'completed-preflight-coverage/v2',rawExecutorSha256,results});
 return true;
}
function requireCoverage(root,keys) {
 const result=store(root).read(coverageIdentity(root,keys));
 if(result?.protocol!=='completed-preflight-coverage/v2')throw new Error('Missing authentic completed preflight coverage');
 assertResults(keys,result.results);return true;
}
module.exports={coverageIdentity,writeCoverage,requireCoverage,executorFiles};
