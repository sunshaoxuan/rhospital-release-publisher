const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {executeCandidate, createTransport, PRIMARY, STANDBY, LOCK} = require('../src/gameStandbyCandidate');

function fixture(t) {
  const parent = path.join(__dirname, '.standby-tests');
  fs.mkdirSync(parent, {recursive: true});
  const cwd = fs.mkdtempSync(path.join(parent, 'candidate-'));
  t.after(() => { fs.rmSync(cwd, {recursive: true, force: true});
    if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); });
  const settings = {candidateId: crypto.randomUUID(), imageTag: 'hospital-backend:test',
    configVersion: 'b'.repeat(64), docker: {mode: 'local'}, ssh: {}, cutoverScript: 'guarded-primary-script'};
  const calls = [];
  const state = {accepted: crypto.randomUUID(), secretVersion: crypto.randomUUID(),
    imageId: `sha256:${'a'.repeat(64)}`, configurationId: 'c'.repeat(64), stopped: true,
    fail: '', ready: true, previousAccepted: null};
  const identityRoot = path.join(cwd, '.release-candidates', settings.candidateId);
  fs.mkdirSync(identityRoot, {recursive: true});
  fs.writeFileSync(path.join(identityRoot, 'build-image.id'), state.imageId);
  state.overrides = {};
  const options = {cwd,
    async run(file, args) {
      calls.push({file, args});
      if (file === 'git') return 'd'.repeat(40);
      if (args.includes('inspect')) return state.imageId;
      assert.ok(args.includes('save'));
      assert.equal(args.at(-1), state.imageId);
      fs.writeFileSync(args[args.indexOf('--output') + 1], 'immutable-archive');
      return '';
    },
    transport: {
      async upload(node, file) {
        calls.push({node, action: 'upload', bytes: fs.readFileSync(file, 'utf8')});
        if (state.fail === 'partial' && node === STANDBY) throw new Error('partial upload');
      },
      async request(node, action, payload) {
        calls.push({node, action});
        if (state.fail === 'unreachable' && node === STANDBY) throw new Error('unreachable');
        if (action === 'capabilities') return {protocol: 1, node, sharedLock: LOCK,
          versionedCandidates: true, atomicAcceptance: true, pinnedCutover: true, noSecretOutput: true};
        if (action === 'begin') return {candidateId: payload.candidateId, operationId: payload.operationId,
          ready: state.ready && node !== state.blockedNode};
        if (action === 'finish-upload') return {...payload, finished: state.fail !== 'cleanup'};
        if (action === 'prepare' && state.previousAccepted === null) state.previousAccepted = state.accepted;
        if (action === 'prepare' || action === 'verify') return {...payload, protocol: 1, node,
          imageId: state.fail === 'identity' ? `sha256:${'e'.repeat(64)}` : payload.imageId,
          configurationId: state.fail === 'config' ? '' : state.configurationId,
          secretVersion: state.secretVersion, previousAccepted: state.previousAccepted,
          standbyStopped: state.stopped, jobsDisabled: true, databaseUnchanged: true,
          localConnections: true, productionSemantics: true, secretsReady: true,
          isolatedCandidate: true, complete: true, leakedSecret: 'NEVER_PERSIST_THIS', ...state.overrides};
        if (action === 'cutover' && state.fail === 'primary') throw new Error('A failed');
        if (action === 'verify-runtime' && state.fail === 'runtime') return {...payload, node, healthy: false};
        if (action === 'accept') {
          if (state.accepted !== payload.previousAccepted && state.accepted !== payload.candidateId) throw new Error('CAS');
          state.accepted = payload.candidateId;
          if (state.fail === 'accept-timeout') throw new Error('ambiguous commit');
          return {...payload, accepted: true, standbyStopped: true};
        }
        return {...payload, node, submitted: true, healthy: true};
      }
    }};
  return {settings, state, calls, options, exec: action => executeCandidate(action, settings, options)};
}

test('one immutable archive reaches A/B; B stays dormant; acceptance is explicit and idempotent', async t => {
  const f = fixture(t);
  const old = f.state.accepted;
  const staged = await f.exec('distribute');
  assert.equal(f.state.accepted, old);
  assert.equal(staged.accepted, false);
  assert.equal(f.calls.filter(c => c.args && c.args.includes('save')).length, 1);
  assert.deepEqual(f.calls.filter(c => c.action === 'upload').map(c => [c.node, c.bytes]),
    [[PRIMARY, 'immutable-archive'], [STANDBY, 'immutable-archive']]);
  await f.exec('verify');
  await f.exec('cutover');
  assert.equal(f.state.accepted, old);
  assert.equal((await f.exec('accept')).accepted, true);
  await f.exec('accept');
  assert.equal(f.state.accepted, f.settings.candidateId);
  assert.equal(f.state.stopped, true);
  const journal = fs.readFileSync(path.join(f.options.cwd, '.release-candidates', f.settings.candidateId, 'candidate.json'), 'utf8');
  assert.doesNotMatch(journal, /NEVER_PERSIST_THIS|leakedSecret/);
  assert.ok(!fs.existsSync(path.join(f.options.cwd, '.release-candidates', f.settings.candidateId, 'image.tar')));
});

for (const failure of ['unreachable', 'identity', 'config', 'partial']) {
  test(`${failure} prevents readiness and retains previous acceptance`, async t => {
    const f = fixture(t);
    const old = f.state.accepted;
    f.state.fail = failure;
    await assert.rejects(f.exec('distribute'));
    assert.equal(f.state.accepted, old);
    assert.ok(!f.calls.some(c => c.action === 'cutover' || c.action === 'accept'));
    assert.ok(!fs.existsSync(path.join(f.options.cwd, '.release-candidates', f.settings.candidateId, 'image.tar')));
  });
}

test('partial transfer can retry the identical candidate without rebuilding', async t => {
  const f = fixture(t);
  f.state.fail = 'partial';
  await assert.rejects(f.exec('distribute'));
  f.state.fail = '';
  await f.exec('distribute');
  await f.exec('verify');
  assert.ok(!f.calls.some(c => c.args && c.args.includes('build')));
});

test('image or config drift on retry is rejected', async t => {
  const f = fixture(t);
  await f.exec('distribute');
  f.state.imageId = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(f.exec('distribute'), /build_identity_mismatch/);
  f.state.configurationId = 'e'.repeat(64);
  await assert.rejects(f.exec('verify'), /configuration_changed/);
});

test('missing build IID fails before node contact or image transfer', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.options.cwd, '.release-candidates', f.settings.candidateId, 'build-image.id'));
  await assert.rejects(f.exec('distribute'), /build_identity_missing/);
  assert.deepEqual(f.calls, []);
});

test('mutable tag drift from the built IID blocks first distribution', async t => {
  const f = fixture(t);
  f.state.imageId = `sha256:${'e'.repeat(64)}`;
  await assert.rejects(f.exec('distribute'), /build_identity_mismatch/);
  assert.ok(!f.calls.some(call => call.action === 'upload' || call.args?.includes('save')));
});

test('shared node lock conflict blocks staging; local concurrent operations also fail closed', async t => {
  const f = fixture(t);
  assert.equal(LOCK, '/etc/rhospital-ha/stage.lock');
  f.state.ready = false;
  await assert.rejects(f.exec('distribute'), /preparation_busy/);
  f.state.ready = true;
  const pending = f.exec('distribute');
  await assert.rejects(f.exec('distribute'), /preparation_busy/);
  await pending;
});

test('B lock refusal never cleans up another B operation reservation', async t => {
  const f = fixture(t);
  f.state.blockedNode = STANDBY;
  await assert.rejects(f.exec('distribute'), /preparation_busy/);
  assert.deepEqual(f.calls.filter(call => call.action === 'finish-upload').map(call => call.node), [PRIMARY]);
});

test('a different flock path cannot claim compatibility with background staging', async t => {
  const f = fixture(t);
  const original = f.options.transport.request;
  f.options.transport.request = async (node, action, payload) => {
    const receipt = await original(node, action, payload);
    return action === 'capabilities' && node === STANDBY
      ? {...receipt, sharedLock: '/opt/rhospital-dr/stage.lock'} : receipt;
  };
  await assert.rejects(f.exec('distribute'), /contract_unavailable/);
  assert.ok(!f.calls.some(call => call.action === 'upload'));
});

test('upload paths fence concurrent attempts by an independent operation ID', async () => {
  const calls = [];
  const transport = createTransport({user: 'root'}, async (file, args) => { calls.push({file, args}); return ''; });
  const candidateId = crypto.randomUUID();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await transport.upload(STANDBY, 'image.tar', candidateId, first);
  await transport.upload(STANDBY, 'image.tar', candidateId, second);
  assert.notEqual(calls[0].args.at(-1), calls[1].args.at(-1));
  assert.ok(calls[0].args.at(-1).endsWith(`${candidateId}.${first}.tar`));
});

test('unconfirmed owned reservation cleanup blocks the otherwise complete candidate', async t => {
  const f = fixture(t);
  const old = f.state.accepted;
  f.state.fail = 'cleanup';
  await assert.rejects(f.exec('distribute'), /upload_cleanup_failed/);
  assert.equal(f.state.accepted, old);
  assert.ok(!f.calls.some(call => call.action === 'cutover'));
});

test('an existing production standby requires a verified prior acceptance baseline', async t => {
  const f = fixture(t);
  f.state.overrides.previousAccepted = null;
  await assert.rejects(f.exec('distribute'), /configuration_missing/);
  assert.ok(!f.calls.some(call => call.action === 'cutover' || call.action === 'accept'));
});

test('B running, missing secrets or production semantics block cutover', async t => {
  const f = fixture(t);
  await f.exec('distribute');
  f.state.stopped = false;
  await assert.rejects(f.exec('cutover'), /readiness_failed/);
  assert.ok(!f.calls.some(c => c.action === 'cutover'));
});

test('A failure and failed final runtime never advance B acceptance', async t => {
  const f = fixture(t);
  const old = f.state.accepted;
  await f.exec('distribute');
  f.state.fail = 'primary';
  await assert.rejects(f.exec('cutover'));
  assert.equal(f.state.accepted, old);
  f.state.fail = 'runtime';
  await assert.rejects(f.exec('accept'), /primary_identity_mismatch/);
  assert.equal(f.state.accepted, old);
});

for (const key of ['secretsReady', 'jobsDisabled', 'databaseUnchanged', 'localConnections',
  'productionSemantics', 'isolatedCandidate', 'complete']) {
  test(`${key} is a mandatory pre-cutover constraint`, async t => {
    const f = fixture(t);
    await f.exec('distribute');
    f.state.overrides[key] = false;
    await assert.rejects(f.exec('cutover'), /readiness_failed/);
    assert.ok(!f.calls.some(c => c.action === 'cutover'));
  });
}

test('missing helper capability and conflicting CAS fail closed', async t => {
  const f = fixture(t);
  const original = f.options.transport.request;
  f.options.transport.request = async (node, action, payload) => {
    if (action === 'capabilities') return {};
    return original(node, action, payload);
  };
  await assert.rejects(f.exec('distribute'), /contract_unavailable/);
  assert.ok(!f.calls.some(c => c.action === 'upload'));
  f.options.transport.request = original;
  await f.exec('distribute');
  f.state.accepted = crypto.randomUUID();
  await assert.rejects(f.exec('accept'), /CAS/);
});

test('lost acceptance response is reconciled by idempotent acceptance retry', async t => {
  const f = fixture(t);
  await f.exec('distribute');
  f.state.fail = 'accept-timeout';
  await assert.rejects(f.exec('accept'), /ambiguous commit/);
  assert.equal(f.state.accepted, f.settings.candidateId);
  f.state.fail = '';
  assert.equal((await f.exec('accept')).accepted, true);
});

test('SSH pins host keys; helper output and errors stay private', async () => {
  const calls = [];
  const transport = createTransport({user: 'root'}, async (file, args, input) => {
    calls.push({file, args, input});
    return 'SECRET malformed response';
  });
  await assert.rejects(transport.request(STANDBY, 'verify', {}), error => {
    assert.equal(error.message, 'standby_candidate=invalid_receipt'); return true;
  });
  assert.ok(calls[0].args.includes('StrictHostKeyChecking=yes'));
  assert.ok(calls[0].args.includes(`root@${STANDBY}`));
});

test('CLI errors expose only a safe classification, never malformed input', () => {
  const encoded = Buffer.from(JSON.stringify({candidateId: 'SECRET_INPUT'})).toString('base64');
  const result = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 'game-standby-candidate.cjs'), 'distribute'], {encoding: 'utf8', input: encoded});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /standby_candidate=FAIL code=invalid_input/);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_INPUT/);
});

test('Windows PowerShell pipes oversized candidate settings without native argument limits',
  {skip: process.platform !== 'win32'}, () => {
    const encoded = Buffer.from(JSON.stringify({candidateId: 'SECRET_INPUT',
      cutoverScript: 'x'.repeat(65536)})).toString('base64');
    const cli = path.join(__dirname, '..', 'scripts', 'game-standby-candidate.cjs');
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const command = `$candidateRequest = '${encoded}'; $candidateRequest | & ${quote(process.execPath)} ${quote(cli)} distribute; exit $LASTEXITCODE\n`;
    const result = spawnSync('powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
      {encoding: 'utf8', input: command, timeout: 30000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /standby_candidate=FAIL code=invalid_input/);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET_INPUT/);
  });
