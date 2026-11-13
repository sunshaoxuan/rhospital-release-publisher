const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {reports,toolIdentity}=require('./skinAdminCheck');

function assertProtocol(result,classes){
 if(result?.state!=='PASS'||result.protocol!=='bacteria-operator/v1'
  ||JSON.stringify(result.testClasses)!==JSON.stringify(classes)
  ||!Number.isInteger(result.tests)||result.tests<classes.length)throw new Error('Incomplete bacteria operator protocol');
}
function runBacteria(root,classes,seconds=900,launch=spawnSync){
 if(!classes.length||new Set(classes).size!==classes.length||classes.some(c=>!/^Bacteria\w+Test$/.test(c)))throw new Error('Invalid bacteria test selection');
 const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key];
 const args=['-q','-DskipTests=false','-Dmaven.test.skip=false','-Dtest='+classes.join(','),'test'];
 const started=Date.now();
 const r=process.platform==='win32'?launch('cmd.exe',['/d','/c','mvnw.cmd',...args],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:seconds*1000,maxBuffer:8*1024*1024})
  :launch('sh',['./mvnw',...args],{cwd:root,env,encoding:'utf8',timeout:seconds*1000,maxBuffer:8*1024*1024});
 if(r.status!==0||r.signal||r.error)throw new Error('Bacteria operator JVM failed\n'+((r.stdout||'')+(r.stderr||'')).slice(-12000));
 const result={state:'PASS',protocol:'bacteria-operator/v1',testClasses:classes,tests:reports(root,classes,started)};
 assertProtocol(result,classes);return result;
}
module.exports={runBacteria,assertProtocol,toolIdentity};
