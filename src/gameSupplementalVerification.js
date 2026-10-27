const core = require('./releasePublisherCore');

// A separate verification receipt never changes a release job/history outcome.
// No persisted command is executed, and no deployment/cleanup/recovery step is selected.
function supplementalSteps(job, contract, env=process.env) {
  const plan=job?.plan, config=plan?.config, remote=config?.remoteImageTarget;
  if(job?.status!=='RECOVERY_REQUIRED' || !job.historyEntryId || plan?.releaseTarget!=='game' || plan.dryRun!==false
      || !/^[a-f0-9]{40}$/.test(plan.gitCommit) || !/^[A-Za-z0-9_.-]+$/.test(plan.appTag)
      || plan.imageTag!=='hospital-backend:'+plan.appTag || remote?.host!=='92.113.124.185' || remote.user!=='root'
      || remote.target!=='root@92.113.124.185' || String(remote.port)!=='22'
      || config.stackName!=='hospital_stack' || config.containerName!=='hospital-backend'
      || config.remoteComposeDir!=='/opt/1panel/docker/compose/hospital-stack') throw new Error('Unsupported supplemental verification target');
  const failed=plan.steps.filter(step=>step.status==='failed').map(step=>step.key);
  if(failed.length!==1 || failed[0]!=='game-prd2-runtime-contract'
      || !job.completedStepKeys?.includes('final-runtime-check') || !job.completedStepKeys.includes('validate-game-startup-contract')
      || !contract) throw new Error('Unsupported failed release boundary');
  const startup=plan.steps.find(step=>step.key==='validate-game-startup-contract');
  const matches=(startup.logs||[]).flatMap(line=>[...String(line).matchAll(/game_startup_contract=PASS checker=check-login-signing-key image=(sha256:[a-f0-9]{64})/g)].map(m=>m[1]));
  if(new Set(matches).size!==1) throw new Error('Missing unique candidate image evidence');
  const wrap=commands=>core.remoteSshCommand(remote,core.remoteBashScriptCommand(commands));
  return {imageId:matches[0], deferredChecks:[{key:'verify-tradepool-release',reason:'container_temporary_compilation_requires_explicit_scope_confirmation',timeout:120,
    command:wrap(core.tradePoolPostDeployCheckCommand(config.remoteComposeDir,config.stackName,config.containerName,config.catalogSchemaVersion))}], steps:[
    {key:'game-prd2-runtime-contract',protocol:'game_prd2_runtime_contract=PASS',timeout:180,
      command:wrap(core.gamePrd2RuntimeContractCommands(config.remoteComposeDir,config.stackName,config.containerName,contract))},
    {key:'verify-game-static-delivery',protocol:'game_static_delivery_validation=PASS probes=6',timeout:2100,
      command:core.gameStaticDeliveryCheckCommand(plan.appTag,env)},
    {key:'verify-relations-release',protocol:'relations_release_validation=PASS',timeout:900,
      command:core.relationsReleaseCheckCommand(plan.appTag,env)}
  ]};
}
module.exports={supplementalSteps};
