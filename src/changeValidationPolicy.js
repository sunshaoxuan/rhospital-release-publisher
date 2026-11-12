const path = require('node:path');

const APP_GATE_INPUTS = [
  'scripts/changeValidationGate.mjs', 'scripts/releasePublisherPolicy.mjs',
  'scripts/validate-release-candidate-commit.mjs', 'scripts/Validate-ReleasePlanPrePush.ps1',
  'scripts/Push-VerifiedMaster.ps1', '.githooks/pre-commit', '.githooks/pre-push',
  'src/test/js/changeValidationGate.test.mjs'
];
const RESIDENT_INPUTS = [
  'scripts/migration/20261108_add_resident_reward_ledger.sql',
  'scripts/validation/resident-reward/schema-preflight-readonly.sql',
  'scripts/validation/resident-reward/schema-readonly.sql',
  'src/test/js/residentSchemaOracle.test.cjs',
  ...['ResidentRewardAccount','ResidentRewardDay','ResidentRewardReceipt']
    .map(n=>'src/main/java/com/zly/hospital/model/resident/'+n+'.java')
];
const POLICY_FILES = ['src/changeValidationPolicy.js','src/changeValidationRunner.js','src/changeValidationReceipts.js',
  'src/residentMigrationCheck.js','src/localCheckLeaves.js','src/changeValidationGit.js','src/designValidationLeaves.json','src/designEvidenceInputs.json'];
const PUBLISHER_GATE_INPUTS = [...POLICY_FILES,'.gitattributes','src/localCheckPolicy.js','scripts/run-game-release-preflight.mjs',
  'scripts/validate-local-change.mjs','.githooks/pre-commit','.githooks/pre-push',
  'test/changeValidationPolicy.test.js','test/changeValidationRunner.test.js',
  'test/localCheckLeaves.test.js','test/localCheckPolicy.test.js',
  'test/fixtures/toilet-market-node-spec.json'];

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
    if(repository==='game'&&['.gitattributes','docs/evidence/bacteria-question-center-20261020/ACCEPTANCE.json'].includes(file)) {selected.add('design-evidence');continue;}
    if(document(file)) {docs.push(file);continue;}
    if(repository==='game' && APP_GATE_INPUTS.includes(file)) selected.add('game-gate');
    else if(repository==='game' && RESIDENT_INPUTS.slice(0,4).includes(file)) selected.add('resident-schema');
    else if(repository==='game' && file==='scripts/bacteria-lab/validate-design-evidence.mjs') {selected.add('game-gate');selected.add('design-evidence');}
    else if(repository==='game' && file==='scripts/bacteria-lab/design-validation-leaves.json') selected.add('game-gate');
    else if(repository==='game' && ['scripts/bacteria-lab/validate-stall-monitor-evidence.mjs','scripts/bacteria-lab/r34-source-successor.mjs',
      'src/test/js/bacteriaStallMonitorEvidence.test.mjs','src/test/js/bacteriaQueueMotionEvidence.test.mjs','src/test/js/designEvidenceGate.test.mjs'].includes(file)) selected.add('design-evidence');
    else if(repository==='publisher' && PUBLISHER_GATE_INPUTS.includes(file)) selected.add('publisher-gate');
    else unmapped.push(file);
  }
  if(unmapped.length) throw new Error('UNMAPPED_CHANGE: register owned checks before validation: '+unmapped.join(', '));
  const checks=[];
  if(docs.length) checks.push({key:'documents',kind:'documents',inputs:docs,timeoutSeconds:30});
  if(selected.has('resident-schema')) checks.push({key:'resident-schema',kind:'resident',inputs:RESIDENT_INPUTS,
    timeoutSeconds:240,images:['postgres:18.6-alpine','postgres:16-alpine']});
  if(selected.has('game-gate')) checks.push({key:'game-gate',kind:'node-tests',inputs:[...APP_GATE_INPUTS,
    'scripts/bacteria-lab/validate-design-evidence.mjs','scripts/bacteria-lab/design-validation-leaves.json'],
    tests:['src/test/js/changeValidationGate.test.mjs'],timeoutSeconds:180});
  if(selected.has('design-evidence')) checks.push({key:'design-evidence',kind:'node-tests',inputs:require('./designEvidenceInputs.json').files,
    dependencies:['pngjs'],tests:['src/test/js/bacteriaStallMonitorEvidence.test.mjs','src/test/js/bacteriaQueueMotionEvidence.test.mjs','src/test/js/designEvidenceGate.test.mjs'],timeoutSeconds:180});
  if(selected.has('publisher-gate')) checks.push({key:'publisher-gate',kind:'node-tests',inputs:PUBLISHER_GATE_INPUTS,
    tests:['test/changeValidationPolicy.test.js','test/changeValidationRunner.test.js','test/localCheckLeaves.test.js','test/localCheckPolicy.test.js'],timeoutSeconds:180});
  return {schema:1,repository,changedPaths:paths,checks,scope:'local-change',productionActions:false};
}

module.exports={planChanges,safePath,document,APP_GATE_INPUTS,RESIDENT_INPUTS,POLICY_FILES,PUBLISHER_GATE_INPUTS};
