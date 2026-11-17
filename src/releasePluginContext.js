const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {hash}=require('./changeValidationReceipts');
const {regular,fail}=require('./releasePlugin');

function treeFiles(root) {
  const files={};let bytes=0,count=0;
  function visit(relative='') {
    for(const name of fs.readdirSync(path.join(root,relative)).sort()) {
      const file=relative?relative+'/'+name:name,full=path.join(root,file),stat=fs.lstatSync(full);
      if(stat.isSymbolicLink())fail('LINKED_PLUGIN_DEPENDENCY',file);
      if(stat.isDirectory())visit(file);
      else {
        if(!stat.isFile()||(bytes+=stat.size)>64*1024*1024||++count>16384)fail('INVALID_DEPENDENCY_CLOSURE');
        files[file]=hash(fs.readFileSync(full));
      }
    }
  }
  visit();return files;
}
function dependencyClosure(unit,context) {
  if(!unit.requires.includes('node-dependencies@1'))return {};
  if(!unit.dependencies?.length||!unit.inputs.includes('package.json')||!unit.inputs.includes('package-lock.json')||!context.dependencyRoot)fail('MISSING_DECLARED_DEPENDENCIES');
  const lock=JSON.parse(fs.readFileSync(regular(context.checkRoot,'package-lock.json'),'utf8'));
  const result={},pending=[...unit.dependencies];
  while(pending.length) {
    const name=pending.pop();if(Object.hasOwn(result,name))continue;
    if(!/^(@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/.test(name)||Object.keys(result).length>=128)fail('INVALID_DEPENDENCY_NAME');
    const root=path.join(context.dependencyRoot,name);
    if(!fs.existsSync(root)||!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())fail('MISSING_DEPENDENCY',name);
    const packageFile=regular(root,'package.json'),pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
    if(pkg.name!==name||pkg.version!==lock.packages?.['node_modules/'+name]?.version)fail('DEPENDENCY_LOCK_MISMATCH',name);
    result[name]={root,version:pkg.version,files:treeFiles(root)};
    pending.push(...Object.keys(pkg.dependencies||{}));
  }
  return result;
}
function localEnvironment(context) {
  const tools=context.tools,environment={...context.environment};
  for(const key of ['java','python','docker','git','cmd'])if(!tools?.[key]||!path.isAbsolute(tools[key])||!fs.statSync(tools[key]).isFile())fail('MISSING_LOCAL_TOOL',key);
  const systemRoot=environment.SystemRoot;
  environment.PATH=[...new Set(Object.values(tools).map(p=>path.dirname(p)).concat(systemRoot?[path.join(systemRoot,'System32'),systemRoot]:[]))].join(path.delimiter);
  environment.JAVA_HOME=path.dirname(path.dirname(tools.java));environment.ComSpec=tools.cmd;
  if(!/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(context.dockerHost||'')&&!/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(context.dockerHost||''))fail('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  if(!context.dockerConfigRoot||hash(JSON.parse(fs.readFileSync(regular(context.dockerConfigRoot,'config.json'),'utf8')))!==hash({auths:{}}))fail('CREDENTIAL_FREE_DOCKER_CONFIG_REQUIRED');
  environment.DOCKER_HOST=context.dockerHost;environment.DOCKER_CONFIG=context.dockerConfigRoot;
  return environment;
}
function localIdentity(unit,context) {
  if(!unit.requires.includes('local-tools@1'))return {};
  const environment=localEnvironment(context),tools=Object.fromEntries(Object.entries(context.tools).map(([k,file])=>[k,{path:file,digest:hash(fs.readFileSync(file))}]));
  const run=args=>execFileSync(context.tools.docker,args,{env:environment,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024}).trim();
  const daemon=run(['info','--format','{{.ID}}|{{.OSType}}']);
  if(!daemon.endsWith('|linux'))fail('LOCAL_DOCKER_LINUX_REQUIRED');
  const images={};
  for(const name of unit.images||[]) {
    const digest=run(['image','inspect',name,'--format','{{.Id}}']);
    if(!/^sha256:[a-f0-9]{64}$/.test(digest))fail('INVALID_LOCAL_IMAGE_ID',name);images[name]=digest;
  }
  return {tools,daemon,images,endpoint:context.dockerHost,environment:hash(Object.fromEntries(Object.entries(environment).filter(([k])=>!['TEMP','TMP','DOCKER_CONFIG'].includes(k))))};
}
function installDependencies(closure,root) {
  for(const [name,spec] of Object.entries(closure))for(const file of Object.keys(spec.files)) {
    const source=regular(spec.root,file),destination=path.join(root,'node_modules',name,file);
    if(hash(fs.readFileSync(source))!==spec.files[file])fail('DEPENDENCY_CHANGED_DURING_COPY');
    if(fs.existsSync(destination)) {
      if(hash(fs.readFileSync(regular(root,'node_modules/'+name+'/'+file)))!==spec.files[file])fail('DEPENDENCY_EXPORT_DRIFT');
    } else {fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
  }
}
function hostContextOptions(plan,{artifactRoot,dependencyRoot,environment,tools,dockerHost,dockerConfigRoot}={}) {
  if(!environment||typeof environment!=='object')fail('EXPLICIT_HOST_ENVIRONMENT_REQUIRED');
  const capabilities=['engine-context@1','node-test@1','node-module@1'];
  const needed=new Set(plan.units.flatMap(u=>u.requires));
  const semantic=Object.fromEntries(['SystemRoot','TEMP','TMP','TZ','LANG','NODE_ENV'].filter(k=>typeof environment[k]==='string').map(k=>[k,environment[k]]));
  if(needed.has('local-tools@1')) {
    const resolve=(name,hint)=>{
      if(hint&&fs.existsSync(hint))return fs.realpathSync(hint);
      const extension=process.platform==='win32'?'.exe':'';
      for(const folder of String(environment.PATH||environment.Path||'').split(path.delimiter)) {
        if(folder&&fs.existsSync(path.join(folder,name+extension)))return fs.realpathSync(path.join(folder,name+extension));
      }
      fail('MISSING_LOCAL_TOOL',name);
    };
    tools=tools||{java:resolve('java',environment.JAVA_HOME&&path.join(environment.JAVA_HOME,'bin','java.exe')),
      python:resolve('python',environment.PYTHON),docker:resolve('docker'),git:resolve('git'),cmd:resolve('cmd',environment.ComSpec)};
    dockerHost=dockerHost||environment.DOCKER_HOST;
    if(!dockerHost)fail('EXPLICIT_LOCAL_DOCKER_TARGET_REQUIRED');
    if(!dockerConfigRoot)fail('EXPLICIT_CREDENTIAL_FREE_DOCKER_CONFIG_REQUIRED');
    const configFile=path.join(dockerConfigRoot,'config.json');
    if(!fs.existsSync(configFile)||fs.lstatSync(configFile).isSymbolicLink()||hash(JSON.parse(fs.readFileSync(configFile,'utf8')))!==hash({auths:{}}))fail('CREDENTIAL_FREE_DOCKER_CONFIG_REQUIRED');
    capabilities.push('local-tools@1');
    for(const key of ['MAVEN_OPTS','MAVEN_ARGS','MAVEN_SKIP_RC'])if(environment[key])semantic[key]=environment[key];
  }
  if(needed.has('node-dependencies@1')) {
    if(!dependencyRoot)fail('EXPLICIT_DEPENDENCY_ROOT_REQUIRED');capabilities.push('node-dependencies@1');
  }
  return {candidateRoot:plan.sourceRoot,checkRoot:plan.sourceRoot,artifactRoot,target:plan.target,capabilities,
    nodeExecutable:process.execPath,environment:semantic,tools:tools||{},dependencyRoot:needed.has('node-dependencies@1')?dependencyRoot:'',dockerHost:dockerHost||'',dockerConfigRoot:dockerConfigRoot||''};
}
function assertDependencyExport(closure,root) {
  for(const [name,spec] of Object.entries(closure))if(hash(treeFiles(path.join(root,'node_modules',name)))!==hash(spec.files))fail('DEPENDENCY_EXPORT_DRIFT',name);
}
module.exports={hostContextOptions,dependencyClosure,installDependencies,assertDependencyExport,localIdentity,localEnvironment};
