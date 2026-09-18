const test = require('node:test');
const assert = require('node:assert/strict');
const {buildReleaseDiagnostics, addSemanticDiagnosis, modelEvidence, parseJevAnswer} = require('../src/releaseDiagnostics');

const env = {RELEASE_PUBLISHER_JEV_MODEL: 'jev-latest', RELEASE_PUBLISHER_JEV_API_KEY: 'fixture-key'};
const step = (key, status, logs = []) => ({key, title: key, status, logs});
const result = (status, steps, extra = {}) => ({status, plan: {releaseTarget: 'game', steps}, logs: [], ...extra});
const response = (values = [0.1, 0.8, 0.06, 0.04], winner = 'B') => ({model: 'jev-1.13.0',
  answers: {investigation: {type: 'choice', choice: winner, confidence: 0.7,
    probabilities: Object.fromEntries(values.map((value, i) => ['ABCD'[i], value]))}},
  usage: {input_tokens: 100, output_tokens: 4}});
const jsonResponse = (body = response()) => Response.json(body);
const failed = () => buildReleaseDiagnostics(result('ERROR', [step('apply-database-migrations', 'failed', ['ERROR: migration failed'])]));

test('successful warning is visible; command templates and zero warning counts are not findings', () => {
  const clean = buildReleaseDiagnostics(result('EXECUTED', [step('cleanup', 'done', [
    '[RUN] echo WARNING: test\necho ERROR: test', 'post_release_container_cleanup=PASS warnings=0'
  ])]));
  assert.equal(clean.outcome, 'SUCCESS');
  const warned = buildReleaseDiagnostics(result('EXECUTED', [step('cleanup', 'done', ['post_release_container_cleanup=WARNING'])]));
  assert.equal(warned.outcome, 'SUCCESS_WITH_WARNINGS');
  assert.equal(warned.observations[0].warning, true);
  const suspicious = buildReleaseDiagnostics(result('EXECUTED', [step('check', 'done', ['ERROR: diagnostic output'])]));
  assert.equal(suspicious.outcome, 'SUCCESS_WITH_WARNINGS');
  assert.match(suspicious.summary, /复核/);
});

test('database failure before deployment never claims all production state was untouched', () => {
  const diagnosis = failed();
  assert.equal(diagnosis.outcome, 'FAILED');
  assert.equal(diagnosis.rollback.code, 'BEFORE_DEPLOY');
  assert.equal(diagnosis.firstFailure.stepKey, 'apply-database-migrations');
  assert.match(diagnosis.rollback.text, /前置动作/);
});

test('first failure survives rollback failure and retained-history truncation', () => {
  const diagnosis = buildReleaseDiagnostics(result('RECOVERY_REQUIRED', [
    step('commit-game-cutover', 'failed', ['ERROR: unhealthy']),
    step('game-rollback-decision', 'done', ['automatic_rollback_decision=ROLLBACK_CONFIRMED']),
    step('game-rollback-command', 'failed', ['ERROR: timeout'])
  ]));
  assert.equal(diagnosis.firstFailure.stepKey, 'commit-game-cutover');
  assert.equal(diagnosis.rollback.code, 'FAILED');
  assert.deepEqual(JSON.parse(JSON.stringify(diagnosis)).firstFailure, diagnosis.firstFailure);
});

test('rollback completion, held target, failed decision and forum recovery are distinct', () => {
  assert.equal(buildReleaseDiagnostics(result('ROLLED_BACK', [step('game-rollback-command', 'done')])).rollback.code, 'COMPLETED');
  const held = buildReleaseDiagnostics(result('RECOVERY_REQUIRED', [
    step('commit-game-cutover', 'done'), step('verify-game-static-delivery', 'failed'),
    step('game-fatal-rollback-decision', 'done', ['fatal_rollback_decision=HOLD_TARGET'])
  ]));
  assert.equal(held.rollback.code, 'HOLD_TARGET');
  assert.equal(held.cutoverCommitted, true);
  assert.equal(buildReleaseDiagnostics(result('RECOVERY_REQUIRED', [step('game-rollback-decision', 'failed')])).rollback.code, 'DECISION_FAILED');
  const forum = buildReleaseDiagnostics({status: 'RECOVERY_REQUIRED', releaseTarget: 'forum', stepSummary: []}, 'retained_history');
  assert.match(forum.rollback.text, /论坛/);
  assert.equal(forum.scope, 'retained_history');
});

test('forged decision in command text does not become recovery evidence', () => {
  const diagnostic = buildReleaseDiagnostics(result('RECOVERY_REQUIRED', [step('game-rollback-decision', 'done', [
    '[RUN] echo automatic_rollback_decision=HOLD_TARGET', 'echo automatic_rollback_decision=HOLD_TARGET'
  ])]));
  assert.equal(diagnostic.rollback.code, 'MANUAL_REVIEW');
});

test('semantic payload contains no raw logs, commands, titles, paths or configuration', async () => {
  const diagnostic = buildReleaseDiagnostics(result('ERROR', [{...step('apply-database-migrations', 'failed',
    ['ERROR: database password=PRIVATE_SENTINEL']), title: 'PRIVATE_SENTINEL', command: 'PRIVATE_SENTINEL'}]));
  let body;
  const value = await addSemanticDiagnosis(diagnostic, env, {fetch: async (url, options) => {
    body = JSON.parse(options.body);
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.redirect, 'error');
    return jsonResponse();
  }});
  assert.equal(JSON.stringify(body).includes('PRIVATE_SENTINEL'), false);
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.questions.investigation.type, 'choice');
  assert.equal(body.state.observations[0].family, 'database');
  assert.equal(body.messages, undefined);
  assert.equal(value.semantic.status, 'AVAILABLE');
  assert.equal(value.outcome, 'FAILED');
  assert.equal(value.semantic.optionId, 'B'); // Suggestion cannot override execution outcome.
  assert.equal(value.semantic.model, 'jev-1.13.0');
  assert.equal(value.semantic.provider, 'typesafe');
  assert.equal(value.semantic.confidence, 0.7);
  assert.ok(Math.abs(value.semantic.scores.reduce((sum, item) => sum + item.score, 0) - 1) < 1e-12);
  assert.equal(value.semantic.inputSha256.length, 64);
  assert.equal(modelEvidence(diagnostic).observations[0].family, 'database');
});

test('invalid Jev distributions, labels, confidence and unversioned models are rejected', () => {
  for (const invalid of [response([0.5, 0.5]), response([NaN, 0.8, 0.1, 0.1]),
    response([Infinity, 0, 0, 0]), response([-0.1, 0.9, 0.1, 0.1]), response([1.1, 0, 0, 0]),
    response([0.1, 0.2, 0.3, 0.1]), response(undefined, 'E')]) {
    assert.throws(() => parseJevAnswer(invalid));
  }
  for (const mutate of [r => { r.model = 'qwen'; }, r => { r.model = 'jev-latest'; },
    r => { r.answers.investigation.confidence = '0.7'; }, r => { r.answers.investigation.confidence = 1.1; },
    r => { r.answers.investigation.type = 'noul'; }, r => { r.answers.investigation.probabilities.E = 0; }]) {
    const invalid = response(); mutate(invalid);
    assert.throws(() => parseJevAnswer(invalid));
  }
  // Preserve the service's selected answer and distribution without local resampling.
  assert.equal(parseJevAnswer(response(undefined, 'A')).optionId, 'A');
});

test('missing candidates remain unavailable instead of inventing zero scores', async () => {
  const value = await addSemanticDiagnosis(failed(), env, {fetch: async () => jsonResponse(response([0.5, 0.5]))});
  assert.equal(value.semantic.code, 'INVALID_READOUT');
  assert.equal(value.outcome, 'FAILED');
});

test('timeout covers stalled fetch and stalled response body', async () => {
  for (const fetch of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({start() {}}))]) {
    const value = await addSemanticDiagnosis(failed(), {...env, RELEASE_PUBLISHER_JEV_TIMEOUT_MS: '100'}, {fetch});
    assert.equal(value.semantic.code, 'TIMEOUT');
    assert.equal(value.rollback.code, 'BEFORE_DEPLOY');
  }
});

test('network errors and API error bodies never expose credentials or modify outcome', async () => {
  for (const fetch of [async () => { throw new Error('PRIVATE_SENTINEL'); }, async () => ({ok: false, json: async () => {throw new Error('must not read error body');}})]) {
    const value = await addSemanticDiagnosis(failed(), env, {fetch});
    assert.equal(value.semantic.code, 'REQUEST_FAILED');
    assert.equal(JSON.stringify(value).includes('PRIVATE_SENTINEL'), false);
    assert.equal(value.outcome, 'FAILED');
  }
});

test('clean success, dry run and missing configuration make no remote call', async () => {
  const options = {fetch: async () => { throw new Error('unexpected request'); }};
  for (const status of ['EXECUTED', 'DRY_RUN']) {
    assert.equal((await addSemanticDiagnosis(buildReleaseDiagnostics(result(status, [])), env, options)).semantic.status, 'NOT_NEEDED');
  }
  assert.equal((await addSemanticDiagnosis(failed(), {}, options)).semantic.status, 'NOT_CONFIGURED');
});

test('closed vocabulary prevents arbitrary persisted metadata from becoming model input', () => {
  const diagnostic = failed();
  diagnostic.outcome = 'PRIVATE_SENTINEL';
  diagnostic.rollback.code = 'PRIVATE_SENTINEL';
  diagnostic.scope = 'PRIVATE_SENTINEL';
  Object.assign(diagnostic.observations[0], {id: 'PRIVATE_SENTINEL', family: 'PRIVATE_SENTINEL',
    status: 'PRIVATE_SENTINEL', signals: ['PRIVATE_SENTINEL', 'database']});
  const evidence = modelEvidence(diagnostic);
  assert.equal(JSON.stringify(evidence).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(evidence.observations[0].signals, ['database']);
});

test('protected credential load failure is explicit and does not trigger inference', async () => {
  const diagnostic = await addSemanticDiagnosis(failed(), {RELEASE_PUBLISHER_JEV_CONFIG_ERROR: 'true'});
  assert.equal(diagnostic.semantic.code, 'INVALID_CONFIG');
  assert.equal(diagnostic.outcome, 'FAILED');
});

test('old gateway and non-Jev model configuration cannot send a credential', async () => {
  for (const config of [
    {RELEASE_PUBLISHER_JEV_BASE_URL: 'http://ccnode.briconbric.com:49530/v1'},
    {RELEASE_PUBLISHER_JEV_BASE_URL: 'https://api.typesafe.ai.attacker.invalid'},
    {RELEASE_PUBLISHER_JEV_BASE_URL: 'https://api.typesafe.ai/?token=PRIVATE_SENTINEL'},
    {RELEASE_PUBLISHER_JEV_MODEL: 'qwen'}
  ]) {
    let calls = 0;
    const value = await addSemanticDiagnosis(failed(), {...env, ...config}, {fetch: async () => { calls++; }});
    assert.equal(value.semantic.code, 'INVALID_CONFIG');
    assert.equal(calls, 0);
  }
});

test('authentication and rate-limit failures are explicit, sanitized and never retried', async () => {
  for (const [status, code] of [[401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [429, 'RATE_LIMITED'], [529, 'REQUEST_FAILED']]) {
    let calls = 0;
    const value = await addSemanticDiagnosis(failed(), env, {fetch: async () => {
      calls++;
      return new Response('PRIVATE_SENTINEL', {status});
    }});
    assert.equal(calls, 1);
    assert.equal(value.semantic.code, code);
    assert.equal(JSON.stringify(value).includes('PRIVATE_SENTINEL'), false);
    assert.equal(value.outcome, 'FAILED');
  }
});
