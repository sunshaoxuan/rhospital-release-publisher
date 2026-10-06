const assert = require('node:assert/strict');

// Reviewed entrypoints, not arbitrary npm aggregates. Shared library calls stay
// inside the owning validator; another feature's acceptance is selected separately.
const policies = {
  'verify-game-epidemic-flow': {inputs: ['src/test/js/epidemicBossSweep.test.mjs', 'scripts/validation/verify-epidemic-flow.cjs']},
  'verify-game-medical-contest-entry': {inputs: ['src/test/js/medicalContestEntry.test.mjs']},
  'verify-game-client-fingerprint': {inputs: ['src/test/js/clientFingerprint.test.mjs']},
  'verify-game-hospital-skin-fallback': {inputs: ['src/test/js/hospitalSkinTexture.test.mjs']},
  'verify-game-steam-auth': {inputs: ['src/test/js/steamLogin.test.cjs']},
  'verify-game-void-rewards': {inputs: ['scripts/validation/void-rewards/validate-evidence.mjs'], marker: 'Void reward final evidence PASS'},
  'verify-bacteria-region-covers': {inputs: [
    'src/test/js/bacteriaRegionCovers.test.mjs', 'src/test/js/bacteriaCoverReveal.test.mjs',
    'src/test/js/bacteriaMobileLayout.test.mjs', 'src/test/js/bacteriaConcurrentSelection.test.mjs',
    'src/test/js/bacteriaNormalStartup.test.mjs', 'src/test/js/bacteriaSpeed.test.mjs',
    'src/test/js/bacteriaRegionCoverEvidence.test.mjs', 'src/test/js/bacteriaQueueDistribution.test.mjs',
    'src/test/js/bacteriaComplexSearch.test.mjs', 'src/test/js/bacteriaSharedRules.test.mjs',
    'scripts/bacteria-lab/validate-region-cover-evidence.mjs',
    'scripts/bacteria-lab/validate-queue-distribution-evidence.mjs'
  ], marker: 'PASS four-lane distribution, split background, decision proof, real editor/save/game and final source bindings'},
  'verify-game-doorplate-ui': {inputs: ['scripts/tests/empty-hospital-ui.test.mjs', 'scripts/tests/doorplate-countdown.test.mjs',
    'scripts/tests/world-chat.test.mjs', 'scripts/validation/world-chat/verify-empty-doorplate.mjs'], json: 'doorplate'},
  'verify-bacteria-result-ui': {inputs: ['src/test/js/bacteriaResultDialog.test.mjs', 'scripts/bacteria-lab/validate-result-dialog-evidence.mjs'], marker: 'bacteria result dialog final evidence passed', protocol: 'marker'},
  'verify-bacteria-entry-style': {inputs: ['src/test/js/bacteriaLabEntry.test.mjs', 'scripts/bacteria-lab/validate-entry-style-evidence.mjs'], marker: 'PASS: entry dimensions, safe areas, browser errors, image hashes and final intent receipt'},
  'verify-game-special-clinic-atlas': {inputs: ['scripts/validation/special-clinic/validate-evidence.mjs'], marker: 'PASS: special-clinic PostgreSQL, one-request mutations, responsive runtime and source-bound evidence'},
  'verify-design-level-packages': {inputs: ['src/test/js/bacteriaPathDifficulty.test.mjs', 'src/test/js/designLevelPackage.test.mjs',
    'src/test/js/designWorker.test.mjs', 'src/test/js/bacteriaSharedRules.test.mjs',
    'scripts/bacteria-lab/build-level-catalog.mjs', 'scripts/bacteria-lab/validate-design-evidence.mjs'],
    marker: 'PASS: final desktop/mobile geometry, browser functions, console and resource responses'},
  'verify-game-potion-lab': {inputs: ['scripts/verify-potion-lab-release.mjs'], json: 'potion', protocol: 'json'},
  'verify-game-emergency-guard': {inputs: ['scripts/verify-emergency-guard-release.mjs'], json: 'emergency', protocol: 'json'}
};

function commandInputs(command) {
  if (/\bnpm\b|run-game-release-preflight|refresh-release-evidence|validate-master-integration-evidence/.test(command))
    throw new Error('Coupled or aggregate local preflight command');
  return [...command.replaceAll('\\','/').matchAll(/(?:src\/test\/(?:js|resources)|scripts)[/][A-Za-z0-9_./-]+\.(?:mjs|cjs|js)\b/g)].map(match => match[0]);
}

function doubleCheckLocalChecks(checks, selected = checks) {
  assert(Array.isArray(checks) && Array.isArray(selected), 'Invalid local check selection');
  const keys = checks.map(check => check.key);
  assert.equal(new Set(keys).size, keys.length, 'Duplicated local check');
  assert.deepEqual([...keys].sort(), selected.map(check => check.key).sort(), 'Local check selection mismatch');
  for (const check of checks) {
    const policy = policies[check.key];
    assert(policy, 'Unregistered local check: ' + check.key);
    const expected = selected.find(step => step.key === check.key);
    assert.equal(check.command, expected.command, 'Local check command mismatch: ' + check.key);
    if (expected.timeoutSeconds !== undefined) assert.equal(check.timeoutSeconds, expected.timeoutSeconds, 'Local check timeout mismatch');
    const inputs = commandInputs(check.command);
    assert.equal(new Set(inputs).size, inputs.length, 'Repeated local check input: ' + check.key);
    assert.deepEqual([...inputs].sort(), [...policy.inputs].sort(), 'Cross-feature or missing local check input: ' + check.key);
  }
  return true;
}

function assertLocalCheckResult(check, result) {
  const policy = policies[check.key];
  const fail = () => { throw new Error('Incomplete or failed preflight: ' + check.key); };
  if (!policy || result?.status !== 0 || result.error || result.signal) fail();
  const output = (result.output || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (!output.trim() || /^\s*not ok\b/m.test(output) || /(?:preflight_check|game_release_preflight)=FAIL/.test(output)) fail();
  const totals = name => [...output.matchAll(new RegExp('^\\s*[#\\u2139]\\s*' + name + '\\s+(\\d+)\\s*$', 'gm'))].map(match => Number(match[1]));
  const tests = totals('tests'), passed = totals('pass');
  if (tests.length || !['json', 'marker'].includes(policy.protocol)) {
    if (!tests.length || tests.some((n, i) => n < 1 || passed[i] !== n)
      || ['pass','fail','skipped','cancelled','todo'].some(name => totals(name).length !== tests.length)
      || ['fail','skipped','cancelled','todo'].some(name => totals(name).some(n => n !== 0))) fail();
  }
  if (/^\s*(?:ok|not ok)\b[^\r\n]*#\s*(?:SKIP|TODO)\b/mi.test(output)) fail();
  if (policy.marker && !output.includes(policy.marker)) fail();
  if (policy.json) {
    let report;
    try { report = JSON.parse(output.trim().split(/\r?\n/).at(-1)); } catch { fail(); }
    if (policy.json === 'potion' && !(report.result === 'PASS' && report.checkCount === 6 && report.sourceCount > 0)) fail();
    if (policy.json === 'emergency' && !(report.status === 'PASS' && report.protocol === 'emergency-hospital-v1' && report.checks === 6 && report.sources > 0)) fail();
    if (policy.json === 'doorplate' && !(report.result === 'PASS' && report.files > 0)) fail();
  }
  return true;
}

module.exports = {doubleCheckLocalChecks, assertLocalCheckResult};
