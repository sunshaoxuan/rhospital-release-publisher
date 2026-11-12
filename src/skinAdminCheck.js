const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
function run(command,args,options={}){
 const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,...options});
 if(r.status!==0||r.error||r.signal)throw new Error('Skin check command failed: '+command+'\n'+(r.stdout||'').slice(-1000)+(r.stderr||'').slice(-1800));
 return (r.stdout||'')+(r.stderr||'');
}
function toolIdentity(){
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):
  run(process.platform==='win32'?'where.exe':'which',['java']).trim().split(/\r?\n/)[0];
 return {java:run(java,['-version']),javaSha256:crypto.createHash('sha256').update(fs.readFileSync(java)).digest('hex'),
  python:run('python',['--version']),javaHome:process.env.JAVA_HOME||'',mavenEnvironment:crypto.createHash('sha256').update(JSON.stringify(['MAVEN_OPTS','MAVEN_ARGS','MAVEN_SKIP_RC'].map(k=>process.env[k]||''))).digest('hex')};
}
function reports(root,classes,notBefore=0){
 const folder=path.join(root,'target/surefire-reports'),files=fs.readdirSync(folder);let total=0;
 for(const name of classes){
  const matching=files.filter(f=>f.startsWith('TEST-')&&f.endsWith('.'+name+'.xml'));
  if(matching.length!==1)throw new Error('Missing or ambiguous Surefire class: '+name);
  if(fs.statSync(path.join(folder,matching[0])).mtimeMs<notBefore-1000)throw new Error('Stale Surefire result: '+name);
  const header=fs.readFileSync(path.join(folder,matching[0]),'utf8').match(/<testsuite\b[^>]*>/)?.[0];
  const value=key=>Number(header?.match(new RegExp('\\b'+key+'="(\\d+)"'))?.[1]??NaN);
  if(!(value('tests')>0)||['failures','errors','skipped'].some(k=>value(k)!==0))throw new Error('Incomplete Surefire PASS: '+name);
  total+=value('tests');
 }return total;
}
function assertProtocol(result,classes){
 if(result?.state!=='PASS'||result.protocol!=='skin-admin/v1'||result.classes!==classes.length||!(result.tests>=classes.length)
  ||result.migration?.state!=='PASS'||result.migration?.protocol!=='skin-migration/v1'||result.migration?.version!=='18.6'||result.migration?.checks?.length<8)
  throw new Error('Incomplete skin admin completion protocol');
}
function runSkin(root,classes,seconds=1200){
 if(!classes.length||new Set(classes).size!==classes.length||classes.some(c=>!/^\w+Test$/.test(c)))throw new Error('Invalid skin test selection');
 const args=['-q','-DskipTests=false','-Dmaven.test.skip=false','-Dtest='+classes.join(','),'test'];
 const started=Date.now();
 const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key];
 try{
  if(process.platform==='win32')run('cmd.exe',['/d','/c','mvnw.cmd',...args],{cwd:root,env,timeout:seconds*1000});
  else run('sh',['./mvnw',...args],{cwd:root,env,timeout:seconds*1000});
 }catch(error){
  const folder=path.join(root,'target/surefire-reports');
  const details=fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>f.startsWith('TEST-')&&f.endsWith('.xml')).flatMap(f=>{
   const text=fs.readFileSync(path.join(folder,f),'utf8');return [...text.matchAll(/<(?:failure|error)\b[^>]*message="([^"]*)"[^>]*>/g)].map(m=>f+': '+m[1]);
  }):[];
  throw new Error(error.message+'\n'+details.join('\n').slice(0,14000));
 }
 const tests=reports(root,classes,started);
 run(process.execPath,['--check','src/main/resources/static/js/adminSkins.mjs'],{cwd:root,env,timeout:30000});
 const output=run('python',['scripts/validation/skins/migration-check.py'],{cwd:root,env,timeout:240000});
 const migration=JSON.parse(output.trim().split(/\r?\n/).at(-1));
 const result={state:'PASS',protocol:'skin-admin/v1',classes:classes.length,tests,migration};assertProtocol(result,classes);return result;
}
module.exports={runSkin,reports,assertProtocol,toolIdentity};
