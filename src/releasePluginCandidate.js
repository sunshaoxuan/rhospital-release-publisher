const fs=require('node:fs'),path=require('node:path');
const {git,text}=require('./changeValidationGit');
const {loadReleasePlugin,createReleaseContext,fail}=require('./releasePlugin');
const {hostContextOptions}=require('./releasePluginContext');
const {executeReleasePlugin}=require('./releasePluginRunner');
const {validateDocuments}=require('./releasePluginDocuments');
const {receiptStore,hash}=require('./changeValidationReceipts');

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
      selectedKeys:[...plan.units.map(unit=>unit.id),...(plan.documents.length?['core.documents']:[])],
      documents,changedPaths:identity.changedPaths,baseline:identity.baseline,candidateTree:text(repositoryRoot,'rev-parse',identity.commit+'^{tree}')};
  } finally {plan?.close();fs.rmSync(workspace,{recursive:true,force:true});}
}
module.exports={candidateIdentity,executePluginCandidate,validatePluginCandidate:executePluginCandidate};
