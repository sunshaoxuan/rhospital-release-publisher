const fs=require('node:fs'),path=require('node:path');
const {git,text}=require('./changeValidationGit');
const {loadReleasePlugin,createReleaseContext,fail}=require('./releasePlugin');
const {hostContextOptions,selectedTools,localEnvironment}=require('./releasePluginContext');
const {execFile}=require('node:child_process');
const {executeReleasePlugin}=require('./releasePluginRunner');
const {validateDocuments}=require('./releasePluginDocuments');
const {receiptStore,hash}=require('./changeValidationReceipts');

function resolvePluginContextFile(repositoryRoot,explicit='',environment={}) {
  let configured='';
  try {
    const values=text(repositoryRoot,'config','--local','--get-all','release.pluginContextFile').split(/\r?\n/).filter(Boolean);
    if(values.length>1)fail('AMBIGUOUS_PLUGIN_CONTEXT_CONFIGURATION');configured=values[0]||'';
  } catch(error) {if(error.message?.startsWith('AMBIGUOUS_'))throw error;}
  const supplied=[explicit,environment.RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE].filter(Boolean);
  const files=[configured,...supplied].filter(Boolean);
  for(const file of files)if(typeof file!=='string'||!path.isAbsolute(file)||!fs.existsSync(file)||!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())fail('INVALID_PLUGIN_CONTEXT_CONFIGURATION');
  const resolved=files.map(file=>fs.realpathSync(file));
  if(new Set(resolved).size>1)fail('PLUGIN_CONTEXT_SOURCE_MISMATCH');
  return resolved[0]||'';
}

function candidateIdentity(repositoryRoot,{phase,baseline,commit,remote}={}) {
  if(!['commit','source','push','remote','release-source'].includes(phase))fail('UNKNOWN_CANDIDATE_PHASE');
  const head=text(repositoryRoot,'rev-parse','HEAD'),tree=text(repositoryRoot,'write-tree');
  const staged=phase==='commit'||phase==='source';
  if(staged) {
    const branch=text(repositoryRoot,'branch','--show-current');
    if(branch!=='master'&&!/^codex\/[a-z0-9][a-z0-9/-]*$/.test(branch))fail('DEDICATED_TASK_BRANCH_REQUIRED');
    if(fs.existsSync(text(repositoryRoot,'rev-parse','--path-format=absolute','--git-path','MERGE_HEAD')))fail('EXPLICIT_INTEGRATION_BASE_REQUIRED');
    commit=git(repositoryRoot,['commit-tree',tree,'-p',head], 'Detached staged validation candidate\n').toString('utf8').trim();
  } else commit=commit||head;
  if(!/^[a-f0-9]{40}$/.test(commit||'')||text(repositoryRoot,'rev-parse',commit+'^{commit}')!==commit)fail('EXACT_CANDIDATE_REQUIRED');
  if(!baseline&&phase==='commit')baseline=head;
  if(!baseline&&['push','remote'].includes(phase))baseline=remote&&!/^0+$/.test(remote)?remote:text(repositoryRoot,'rev-parse',commit+'^');
  if(!/^[a-f0-9]{40}$/.test(baseline||'')||text(repositoryRoot,'merge-base',baseline,commit)!==baseline)fail('EXPLICIT_ANCESTOR_BASELINE_REQUIRED');
  if(phase==='remote'&&text(repositoryRoot,'ls-remote','origin','refs/heads/master').split(/\s+/)[0]!==commit)fail('REMOTE_CANDIDATE_MISMATCH');
  if(phase==='push'&&remote&&text(repositoryRoot,'ls-remote','origin','refs/heads/master').split(/\s+/)[0]!==remote)fail('REMOTE_BASELINE_CHANGED');
  const changedPaths=git(repositoryRoot,['diff','--name-only','-z',baseline,commit]).toString('utf8').split('\0').filter(Boolean);
  return {head,tree,commit,baseline,changedPaths,staged};
}

// Live capability admission is cheap and independent of signed business receipts.
async function admitPluginTools(plan,context,{signal}={}) {
  const contracts={
    node:{args:['--version'],pattern:/^v[0-9]+\.[0-9]+\./m},
    git:{args:['--version'],pattern:/^git version [0-9]+\./m},
    python:{args:['--version'],pattern:/^Python [0-9]+\.[0-9]+\./m},
    java:{args:['-version'],pattern:/(?:openjdk|java) version "?[0-9]+\./m},
    docker:{args:['--version'],pattern:/Docker version [0-9]+\./m},
    cmd:{args:['/d','/c','ver'],pattern:/[0-9]+\.[0-9]+\.[0-9]+/},
    powershell:{args:['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],pattern:/^[0-9]+\.[0-9]+\./m}
  };
  const seen=new Set();
  // Clear Windows ambient defaults before launching tools, as the worker does.
  const probe=String.raw`const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const request=JSON.parse(fs.readFileSync(0,'utf8'));
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,request.environment);
const result=spawnSync(request.executable,request.args,{env:{...process.env},encoding:'utf8',shell:false,windowsHide:true,timeout:5000,maxBuffer:32768});
process.stdout.write(JSON.stringify({status:result.status,signal:result.signal,error:result.error?.code||'',output:(result.stdout||'')+(result.stderr||'')}));
`;
  for(const unit of plan.units.filter(unit=>['source','artifact'].includes(unit.phase)&&unit.requires.includes('local-tools@1'))) {
    const environment=localEnvironment(unit,context),tools=selectedTools(unit,context);
    for(const [key,executable] of Object.entries(tools)) {
      const contract=contracts[key];if(!contract)fail('UNKNOWN_TOOL_ADMISSION',key);
      const identity=hash({key,executable,args:contract.args,environment});if(seen.has(identity))continue;seen.add(identity);
      if(signal?.aborted)fail('PLUGIN_CANCELLED');
      const result=await new Promise(resolve=>{
        const child=execFile(context.nodeExecutable,['-e',probe],{cwd:context.checkRoot,env:{...context.environment},signal,
          windowsHide:true,shell:false,timeout:7000,maxBuffer:65536},(error,stdout)=>{
          if(error)return resolve({status:null,error:error.code||'PROBE_FAILED'});
          try{resolve(JSON.parse(stdout));}catch{resolve({status:null,error:'INVALID_PROBE_RESULT'});}
        });
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({executable,args:contract.args,environment}));
      });
      if(signal?.aborted)fail('PLUGIN_CANCELLED');
      if(result.status!==0||result.signal||result.error||!contract.pattern.test(result.output||''))fail('PLUGIN_TOOL_NOT_CALLABLE',key);
    }
  }
}

async function executePluginCandidate(repositoryRoot,options={}) {
  const {target,manifestPath,phase='source',signal,write=()=>{},environment,contextOptions={},requireReceipts=['push','remote'].includes(phase)}=options;
  const identity=candidateIdentity(repositoryRoot,{...options,phase});
  const common=text(repositoryRoot,'rev-parse','--path-format=absolute','--git-common-dir');
  const parent=options.workspaceRoot||path.join(common,'release-plugin-work');fs.mkdirSync(parent,{recursive:true});
  const workspace=fs.mkdtempSync(path.join(parent,'candidate-'));
  const artifacts=options.artifactRoot||path.join(workspace,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const dockerConfig=path.join(workspace,'docker-config');fs.mkdirSync(dockerConfig);fs.writeFileSync(path.join(dockerConfig,'config.json'),JSON.stringify({auths:{}}));
  const receiptsDirectory=options.receiptsDirectory||path.join(common,'release-plugin-receipts');let plan;
  try {
    plan=loadReleasePlugin({repositoryRoot,candidateCommit:identity.commit,baselineCommit:identity.baseline,manifestPath,target,
      changedPaths:identity.changedPaths,workspaceRoot:workspace});
    const context=createReleaseContext(hostContextOptions(plan,{...contextOptions,artifactRoot:artifacts,
      dependencyRoot:options.dependencyRoot||contextOptions.dependencyRoot||path.join(repositoryRoot,'node_modules'),
      environment:{...environment,...contextOptions.environment},dockerConfigRoot:dockerConfig}));
    await admitPluginTools(plan,context,{signal});
    // All selected-unit admission, including tools, precedes any document or business receipt read.
    let documents={files:0,executed:0,reused:0};
    const beforeExecute=()=>{if(plan.documents.length) {
      const baseFile=file=>{try{return git(repositoryRoot,['show',identity.baseline+':'+file]).toString('utf8');}catch{return '';}};
      const documentIdentity={schema:'plugin-documents/v1',target,files:Object.fromEntries(plan.documents.map(file=>[file,plan.inputDigests[file]||'absent'])),
        baseline:Object.fromEntries(plan.documents.map(file=>[file,hash(baseFile(file))])),
        executor:hash(fs.readFileSync(path.join(__dirname,'releasePluginDocuments.js'),'utf8').replace(/\r\n/g,'\n'))};
      const store=receiptStore(receiptsDirectory),prior=store.read(documentIdentity);
      if(prior?.protocol==='documents/v1')documents={files:plan.documents.length,executed:0,reused:1};
      else {
        if(requireReceipts)fail('MISSING_DOCUMENT_RECEIPT');
        store.write(documentIdentity,validateDocuments(plan.sourceRoot,plan.documents,{baseFile,
          exists:file=>{try{return Boolean(text(repositoryRoot,'cat-file','-e',identity.commit+':'+file)==='');}catch{return false;}}}));
        documents={files:plan.documents.length,executed:1,reused:0};
      }
    }};
    const result=await executeReleasePlugin(plan,context,{boundary:'before-production',stage:phase==='release-source'?'formal':'precheck',
      receiptsDirectory,requireReceipts,signal,write,beforeExecute});
    if(identity.staged&&(text(repositoryRoot,'rev-parse','HEAD')!==identity.head||text(repositoryRoot,'write-tree')!==identity.tree))fail('STAGED_CANDIDATE_CHANGED');
    return {...result,state:'PASS',protocol:'release-candidate-validation/v1',scope:'before-production',prefixState:result.state,
      pluginId:plan.pluginId,target:plan.target,migrationDeclarations:plan.migrations,
      selectedKeys:[...plan.units.map(unit=>unit.id),...(plan.documents.length?['core.documents']:[])],
      documents,changedPaths:identity.changedPaths,baseline:identity.baseline,candidateTree:text(repositoryRoot,'rev-parse',identity.commit+'^{tree}')};
  } finally {plan?.close();fs.rmSync(workspace,{recursive:true,force:true});}
}
module.exports={candidateIdentity,executePluginCandidate,validatePluginCandidate:executePluginCandidate,resolvePluginContextFile,admitPluginTools};
