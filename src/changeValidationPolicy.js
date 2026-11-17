const path=require('node:path');
const retirement=require('../docs/design/release-plugin-publisher-retirement.json');
const POLICY_FILES=['src/changeValidationPolicy.js','src/changeValidationRunner.js','src/changeValidationReceipts.js','src/changeValidationGit.js','src/publisherGateInputs.json','docs/design/release-plugin-publisher-retirement.json'];
const pluginInputs=['src/releasePlugin.js','src/releasePluginRunner.js','src/releasePluginContext.js','src/releasePluginCandidate.js','src/releasePluginDocuments.js',
  'scripts/validate-plugin-candidate.mjs','src/changeValidationReceipts.js','src/changeValidationGit.js','src/releaseWorktree.js','test/releaseWorktree.test.js'];
const PUBLISHER_GATE_INPUTS=[...new Set([...POLICY_FILES,...pluginInputs,...require('./publisherGateInputs.json').files,
  'src/releaseFlowAcceptance.js','test/fullGateScope.test.js','test/releasePublisherCore.test.js','test/helpers/ownedFixtures.js',
  'release-publisher.config.json','server.js',
  'scripts/run-release-console.ps1','scripts/build-windows-service.ps1','scripts/install-windows-service.ps1','scripts/uninstall-windows-service.ps1','service/RHospitalReleaseConsoleService.cs',
  'src/publisherVersion.js','src/publisherOperationLock.js','src/releaseWorktree.js','src/gameStandbyCandidate.js'])];
const CONSOLE_INPUTS=[
  "public/app.js",
  "public/index.html",
  "public/release-status.js",
  "public/styles.css",
  "release-publisher.config.json",
  "scripts/check-game-runtime-secrets.py",
  "scripts/check-game-startup.py",
  "scripts/game-deployment-transaction.py",
  "scripts/game-retry-baseline.py",
  "server.js",
  "src/bacteriaInventoryBackup.js",
  "src/changeValidationGit.js",
  "src/changeValidationReceipts.js",
  "src/gameCodegraphCutover.js",
  "src/gameDeploymentTransaction.js",
  "src/gameFormalProductionTransition.js",
  "src/gameMaintenanceHealth.js",
  "src/gameMeelokMaintenance.js",
  "src/gameProductionConfigGuard.js",
  "src/gameProductionDatabase.js",
  "src/gameRecoveryIdentity.js",
  "src/gameRetryBaseline.js",
  "src/gameRuntimeSecrets.js",
  "src/gameSigningBinding.js",
  "src/gameStandbyCandidate.js",
  "src/gameStartupContract.js",
  "src/gameTechnologyFormatCutover.js",
  "src/meelokRecoverySupervisor.js",
  "src/publisherOperationLock.js",
  "src/publisherVersion.js",
  "src/releaseConsoleView.js",
  "src/releaseDiagnostics.js",
  "src/releaseJobStore.js",
  "src/releaseOutcomeStatus.js",
  "src/releasePlugin.js",
  "src/releasePluginCandidate.js",
  "src/releasePluginContext.js",
  "src/releasePluginDocuments.js",
  "src/releasePluginRunner.js",
  "src/releasePublisherCore.js",
  "src/releasePlanSources.js",
  "src/releaseWorktree.js",
  "src/tomcatSecurityCheck.js",
  "test/helpers/ownedFixtures.js",
  "test/releaseConsole.test.js"
,

];
const SOURCE_INPUTS=[
  "release-publisher.config.json",
  "scripts/check-game-runtime-secrets.py",
  "scripts/check-game-startup.py",
  "scripts/game-deployment-transaction.py",
  "scripts/game-retry-baseline.py",
  "scripts/validate-plugin-candidate.mjs",
  "src/bacteriaInventoryBackup.js",
  "src/changeValidationGit.js",
  "src/changeValidationReceipts.js",
  "src/gameCodegraphCutover.js",
  "src/gameDeploymentTransaction.js",
  "src/gameFormalProductionTransition.js",
  "src/gameMaintenanceHealth.js",
  "src/gameMeelokMaintenance.js",
  "src/gameProductionConfigGuard.js",
  "src/gameProductionDatabase.js",
  "src/gameRecoveryIdentity.js",
  "src/gameRetryBaseline.js",
  "src/gameRuntimeSecrets.js",
  "src/gameSigningBinding.js",
  "src/gameStandbyCandidate.js",
  "src/gameStartupContract.js",
  "src/gameTechnologyFormatCutover.js",
  "src/meelokRecoverySupervisor.js",
  "src/releaseDiagnostics.js",
  "src/releasePlugin.js",
  "src/releasePluginCandidate.js",
  "src/releasePluginContext.js",
  "src/releasePluginDocuments.js",
  "src/releasePluginRunner.js",
  "src/releasePublisherCore.js",
  "src/releasePlanSources.js",
  "src/tomcatSecurityCheck.js",
  "test/fullGateScope.test.js"
,

];
const APPLICATION_POLICY_INPUTS=["src/applicationReleasePolicy.js","src/applicationRuntimeChecks.js","src/applicationNodeCheck.js","scripts/run-application-check.mjs","scripts/release-browser-host.mjs","test/helpers/applicationPolicyFixture.js","test/fixtures/application-policy/release/publisher/checks/verify-emergency-guard-release.mjs","test/fixtures/application-policy/release/publisher/checks/verify-game-static-delivery.mjs","test/fixtures/application-policy/release/publisher/checks/verify-relations-release.mjs","test/fixtures/application-policy/release/publisher/game-policy.json","test/fixtures/application-policy/release/publisher/policy/before-rollback.sql","test/fixtures/application-policy/release/publisher/policy/browser-ready.js","test/fixtures/application-policy/release/publisher/policy/catalog-logs.sh","test/fixtures/application-policy/release/publisher/policy/catalog-post-deploy.sh","test/fixtures/application-policy/release/publisher/policy/catalog-preflight.sql","test/fixtures/application-policy/release/publisher/policy/ReleaseDatabaseAudit.java","test/fixtures/application-policy/release/publisher/policy/runtime-probes.sh","test/fixtures/application-policy/release/publisher/policy/scheduler-guard.py","test/fixtures/application-policy/release/publisher/policy/scheduler-observation.sql","test/fixtures/application-policy/release/publisher/policy/startup-log.sh"];
CONSOLE_INPUTS.push(...APPLICATION_POLICY_INPUTS);
SOURCE_INPUTS.push(...APPLICATION_POLICY_INPUTS);
PUBLISHER_GATE_INPUTS.push(...APPLICATION_POLICY_INPUTS);
const RECOVERY_INPUTS=[...new Set([...SOURCE_INPUTS.filter(file=>!['test/fullGateScope.test.js','scripts/validate-plugin-candidate.mjs'].includes(file)),
 'scripts/game-service-recovery.mjs','scripts/game-service-recovery.py','test/gameRecoverySafety.test.js','test/gameTechnologyFormatCutover.test.js','test/gameCodegraphCutover.test.js','test/bacteriaInventoryBackup.test.js','test/codegraphPrerequisites_test.py','test/fixtures/codegraph/guild-classes.json','src/gameSupplementalVerification.js','scripts/verify-game-supplemental.cjs','test/gameSupplementalVerification.test.js','scripts/evaluate-game-fatal-rollback.mjs','test/fatalRollbackEvaluator.test.js'])];
const groups=[
 {key:'publisher-policy',tests:['test/changeValidationPolicy.test.js'],inputs:[...POLICY_FILES,'test/changeValidationPolicy.test.js']},
 {key:'publisher-runner',tests:['test/changeValidationRunner.test.js'],inputs:[...POLICY_FILES,...pluginInputs,'src/releasePluginDocuments.js','.gitattributes','test/changeValidationRunner.test.js']},
 {key:'publisher-console',tests:['test/releaseConsole.test.js'],inputs:CONSOLE_INPUTS},
 {key:'publisher-outcome',tests:['test/releaseOutcomeStatus.test.js'],inputs:['src/releaseOutcomeStatus.js','public/release-status.js','scripts/read-game-runtime-status.py','test/releaseOutcomeStatus.test.js']},
 {key:'publisher-recovery',tests:['test/gameRecoverySafety.test.js','test/gameTechnologyFormatCutover.test.js','test/gameCodegraphCutover.test.js','test/bacteriaInventoryBackup.test.js','test/gameSupplementalVerification.test.js','test/fatalRollbackEvaluator.test.js'],inputs:RECOVERY_INPUTS},
 {key:'publisher-version',tests:['test/publisherVersionScope.test.js'],inputs:['src/publisherVersion.js','src/publisherLegacyBarrier.js','test/publisherVersionScope.test.js']},
 {key:'publisher-plugin',tests:['test/releaseWorktree.test.js'],inputs:pluginInputs},
 {key:'publisher-plan',tests:['test/releasePublisherCore.test.js','test/releasePlanSources.test.js','test/applicationReleasePolicy.test.js','test/chromeTargetLifecycle.test.js'],inputs:[...PUBLISHER_GATE_INPUTS.filter(file=>file!=='test/fullGateScope.test.js'),'test/releasePlanSources.test.js','test/applicationReleasePolicy.test.js','test/chromeTargetLifecycle.test.js']},
 {key:'publisher-source',tests:['test/fullGateScope.test.js'],inputs:SOURCE_INPUTS}
];
function safePath(file){
 if(typeof file!=='string'||!file||path.posix.isAbsolute(file)||/[\\:\x00-\x1f]/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid change path: '+file);
 return file;
}
function document(file){
 return /^(?:AGENTS|CHANGELOG|README)\.md$/.test(file)||/^(?:docs|release\/evidence)\/.+\.(?:md|json)$/.test(file)
   ||/^docs\/evidence\/.+\.(?:png|jpg|jpeg)$/.test(file)||['src/manualArchiveChecks.json','src/designValidationLeaves.json','src/designEvidenceInputs.json'].includes(file);
}
function planChanges(repository,changedPaths){
 if(repository!=='publisher'||!Array.isArray(changedPaths))throw new Error('Application checks require their committed release plugin');
 const paths=[...new Set(changedPaths.map(safePath))].sort(),selected=new Set(),docs=[],unmapped=[];
 for(const file of paths){
  if(file==='docs/design/release-plugin-publisher-retirement.json'){selected.add('publisher-policy');continue;}
  if(document(file)){docs.push(file);continue;}
  if(retirement.files.includes(file)){for(const key of retirement.checks)selected.add(key);continue;}
  let keys=[];
  if(['src/changeValidationGit.js','src/changeValidationReceipts.js'].includes(file))keys=['publisher-policy','publisher-runner','publisher-plugin','publisher-source'];
  else if(['src/changeValidationPolicy.js','src/publisherGateInputs.json','test/changeValidationPolicy.test.js'].includes(file))keys=['publisher-policy','publisher-runner'];
  else if(file==='src/changeValidationRunner.js')keys=groups.map(group=>group.key);
  else if(['test/changeValidationRunner.test.js','.gitattributes','.githooks/pre-commit','.githooks/pre-push','scripts/validate-local-change.mjs'].includes(file))keys=['publisher-runner'];
  else if(['test/releaseWorktree.test.js','src/releaseWorktree.js'].includes(file))keys=['publisher-plugin'];
  else if(pluginInputs.includes(file))keys=['publisher-plugin','publisher-source'];
  else if(['test/gameCodegraphCutover.test.js','test/bacteriaInventoryBackup.test.js','test/codegraphPrerequisites_test.py','test/gameRecoverySafety.test.js','test/gameTechnologyFormatCutover.test.js','scripts/game-service-recovery.mjs','scripts/game-service-recovery.py'].includes(file))keys=['publisher-recovery'];
  else if(['src/publisherVersion.js','src/publisherLegacyBarrier.js','test/publisherVersionScope.test.js'].includes(file))keys=['publisher-version'];
  else if(['src/releasePublisherCore.js','src/releasePlanSources.js',...APPLICATION_POLICY_INPUTS].includes(file)||file==='src/codegraphPrerequisites.py')keys=['publisher-plan','publisher-source','publisher-console','publisher-recovery'];
  else if(['test/releasePlanSources.test.js','test/applicationReleasePolicy.test.js'].includes(file))keys=['publisher-plan'];
  else if(["scripts/verify-game-static-delivery.mjs","scripts/verify-relations-release.mjs","scripts/verify-emergency-guard-release.mjs","test/gameStaticDeliveryVerifier.test.js","test/relationsReleaseVerifier.test.js","test/emergencyGuardRelease.test.js"].includes(file)||file==='test/chromeTargetLifecycle.test.js')keys=['publisher-plan'];
  else if(['src/gameSupplementalVerification.js','test/gameSupplementalVerification.test.js','scripts/evaluate-game-fatal-rollback.mjs','test/fatalRollbackEvaluator.test.js'].includes(file))keys=['publisher-recovery'];
  else if(file==='server.js')keys=['publisher-plan','publisher-console'];
  else if(file==='test/fullGateScope.test.js')keys=['publisher-source'];
  else if(['src/releaseOutcomeStatus.js','public/release-status.js'].includes(file))keys=['publisher-console','publisher-outcome'];
  else if(['scripts/read-game-runtime-status.py','test/releaseOutcomeStatus.test.js'].includes(file))keys=['publisher-outcome'];
  else if(['public/app.js','public/index.html','public/styles.css','src/releaseConsoleView.js','test/releaseConsole.test.js'].includes(file))keys=['publisher-console'];
  else if(PUBLISHER_GATE_INPUTS.includes(file))keys=['publisher-plan'];
  else unmapped.push(file);
  for(const key of keys)selected.add(key);
 }
 if(unmapped.length)throw new Error('UNMAPPED_CHANGE: '+unmapped.join(', '));
 const checks=groups.filter(g=>selected.has(g.key)).map(g=>({...g,kind:'node-tests',inputs:[...new Set(g.inputs)],timeoutSeconds:g.key==='publisher-plan'?420:g.key==='publisher-recovery'?300:180}));
 if(docs.length)checks.unshift({key:'documents',kind:'documents',inputs:docs,timeoutSeconds:30});
 return {schema:1,repository,changedPaths:paths,checks,scope:'local-change',productionActions:false};
}
module.exports={planChanges,safePath,document,POLICY_FILES,PUBLISHER_GATE_INPUTS,CONSOLE_INPUTS};
