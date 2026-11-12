const path = require('node:path');

const APP_GATE_INPUTS = [
  "scripts/changeValidationGate.mjs",
  "scripts/releasePublisherPolicy.mjs",
  "scripts/validate-release-candidate-commit.mjs",
  "scripts/Validate-ReleasePlanPrePush.ps1",
  "scripts/Push-VerifiedMaster.ps1",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  "src/test/js/changeValidationGate.test.mjs",
  "scripts/releaseFinalPreflight.mjs",
  "scripts/releasePreflightCache.mjs",
  "scripts/validation/source-bindings.mjs",
  "src/test/js/releaseCurrentBehavior.test.mjs"
];
const RESIDENT_INPUTS = [
  'scripts/migration/20261108_add_resident_reward_ledger.sql',
  'scripts/validation/resident-reward/schema-preflight-readonly.sql',
  'scripts/validation/resident-reward/schema-readonly.sql',
  'src/test/js/residentSchemaOracle.test.cjs',
  ...['ResidentRewardAccount','ResidentRewardDay','ResidentRewardReceipt']
    .map(n=>'src/main/java/com/zly/hospital/model/resident/'+n+'.java')
];
const POLICY_FILES = ["src/changeValidationPolicy.js", "src/changeValidationRunner.js", "src/changeValidationReceipts.js", "src/residentMigrationCheck.js", "src/changeValidationGit.js", "src/currentBehaviorInputs.json", "src/publisherGateInputs.json"];
const PUBLISHER_GATE_INPUTS = [...["src/changeValidationPolicy.js", "src/changeValidationRunner.js", "src/changeValidationReceipts.js", "src/residentMigrationCheck.js", "src/changeValidationGit.js", "src/currentBehaviorInputs.json", "src/publisherGateInputs.json", ".gitattributes", "src/localCheckPolicy.js", "src/localCheckLeaves.js", "src/currentBehaviorChecks.json", "src/currentBehaviorGuard.cjs", "src/manualArchiveChecks.json", "src/designValidationLeaves.json", "scripts/run-game-release-preflight.mjs", "scripts/audit-historical-evidence.mjs", "scripts/validate-local-change.mjs", ".githooks/pre-commit", ".githooks/pre-push", "test/changeValidationPolicy.test.js", "test/changeValidationRunner.test.js", "test/localCheckLeaves.test.js", "test/localCheckPolicy.test.js", "test/fullGateScope.test.js", "test/fixtures/toilet-market-node-spec.json", "test/releasePublisherCore.test.js"],...require('./publisherGateInputs.json').files];

const gateBase=[...POLICY_FILES,'src/localCheckPolicy.js','src/currentBehaviorChecks.json'];
const publisherGroups=[
 {key:'publisher-policy',tests:['test/changeValidationPolicy.test.js'],inputs:[...POLICY_FILES,'test/changeValidationPolicy.test.js']},
 {key:'publisher-runner',tests:['test/changeValidationRunner.test.js'],inputs:[...POLICY_FILES,'.gitattributes','test/changeValidationRunner.test.js']},
 {key:'publisher-contract',tests:['test/localCheckPolicy.test.js'],inputs:[...gateBase,'test/localCheckPolicy.test.js']},
 {key:'publisher-leaves',tests:['test/localCheckLeaves.test.js'],inputs:[...gateBase,'src/localCheckLeaves.js','src/currentBehaviorGuard.cjs','test/localCheckLeaves.test.js']},
 {key:'publisher-plan',tests:['test/fullGateScope.test.js'],inputs:PUBLISHER_GATE_INPUTS.filter(file=>!['test/changeValidationPolicy.test.js','test/changeValidationRunner.test.js','test/localCheckPolicy.test.js','test/localCheckLeaves.test.js'].includes(file))}
];

function safePath(file) {
  if (typeof file!=='string' || !file || path.posix.isAbsolute(file) || /[\\:\x00-\x1f]/.test(file)
      || file.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error('Invalid change path: '+file);
  return file;
}
function document(file) {
  return /^(?:AGENTS|CHANGELOG|README)\.md$/.test(file)
    || /^(?:docs|release\/evidence)\/.+\.(?:md|json)$/.test(file)
    || file==='release/release-impact.json';
}
function planChanges(repository, changedPaths) {
  if (!['game','publisher'].includes(repository) || !Array.isArray(changedPaths)) throw new Error('Invalid change scope');
  const paths=[...new Set(changedPaths.map(safePath))].sort(), selected=new Set(), unmapped=[];
  const docs=[];
  for(const file of paths) {
    if(repository==='game'&&['.gitattributes','docs/evidence/bacteria-question-center-20261020/.gitattributes','src/test/js/evidenceAttributes.test.mjs'].includes(file)) {selected.add('evidence-attributes');continue;}

    if(document(file)) {docs.push(file);continue;}
    if(repository==='game' && APP_GATE_INPUTS.includes(file)) selected.add('game-gate');
    else if(repository==='game' && RESIDENT_INPUTS.slice(0,4).includes(file)) selected.add('resident-schema');
    else if(repository==='game' && (require('./currentBehaviorInputs.json').tests.includes(file)
      || /^scripts\/validation\/current\//.test(file)||file==='src/test/resources/design/user-60x60-32color-request.json')) selected.add('current-behavior');
    else if(repository==='game' && (/Archive\.test\.mjs$/.test(file)||/Evidence\.test\.mjs$/.test(file)
      || /^scripts\/bacteria-lab\/(?:validate-.+-evidence|r34-source-successor)\.mjs$/.test(file)
      || file==='scripts/bacteria-lab/design-validation-leaves.json')) selected.add('archive-syntax');
    else if(repository==='publisher' && PUBLISHER_GATE_INPUTS.includes(file)) {for(const group of publisherGroups)if(group.inputs.includes(file))selected.add(group.key);}
    else unmapped.push(file);
  }
  if(unmapped.length) throw new Error('UNMAPPED_CHANGE: register owned checks before validation: '+unmapped.join(', '));
  const checks=[];
  if(docs.length) checks.push({key:'documents',kind:'documents',inputs:docs,timeoutSeconds:30});
  if(selected.has('resident-schema')) checks.push({key:'resident-schema',kind:'resident',inputs:RESIDENT_INPUTS,
    timeoutSeconds:240,images:['postgres:18.6-alpine','postgres:16-alpine']});
  if(selected.has('evidence-attributes')) checks.push({key:'evidence-attributes',kind:'node-tests',inputs:[
    '.gitattributes','docs/evidence/bacteria-question-center-20261020/.gitattributes','src/test/js/evidenceAttributes.test.mjs'],tests:['src/test/js/evidenceAttributes.test.mjs'],timeoutSeconds:30});
  if(selected.has('game-gate')) checks.push({key:'game-gate',kind:'node-tests',inputs:APP_GATE_INPUTS,
    tests:['src/test/js/changeValidationGate.test.mjs','src/test/js/releaseCurrentBehavior.test.mjs'],timeoutSeconds:180});
  if(selected.has('current-behavior')) {const owned=require('./currentBehaviorInputs.json');checks.push({key:'current-behavior',kind:'node-tests',inputs:owned.files,tests:owned.tests,timeoutSeconds:300});}
  if(selected.has('archive-syntax')) checks.push({key:'archive-syntax',kind:'syntax',inputs:paths.filter(file=>/\.(?:mjs|cjs|js)$/.test(file)&&!APP_GATE_INPUTS.includes(file)),timeoutSeconds:30});
  for(const group of publisherGroups)if(selected.has(group.key))checks.push({...group,kind:'node-tests',inputs:[...new Set(group.inputs)],timeoutSeconds:180});
  return {schema:1,repository,changedPaths:paths,checks,scope:'local-change',productionActions:false};
}

module.exports={planChanges,safePath,document,APP_GATE_INPUTS,RESIDENT_INPUTS,POLICY_FILES,PUBLISHER_GATE_INPUTS};
