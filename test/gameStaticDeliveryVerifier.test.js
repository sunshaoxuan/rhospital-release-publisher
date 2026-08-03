const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function verifier() {
  const script = path.resolve(__dirname, '..', 'scripts', 'verify-game-static-delivery.mjs');
  return import(pathToFileURL(script).href);
}

function passingResult(overrides = {}) {
  return {
    gateway: 'riven',
    host: 'rhospital.cc',
    route: '/run/newGame',
    state: {
      href: 'https://rhospital.cc/run/newGame',
      firstFloor: true,
      loadState: { phase: 'launched', progress: 1 }
    },
    responses: [
      {
        url: 'https://rhospital.cc/assets/js/main.js?h=abc&releaseProbe=test',
        status: 200,
        headers: { 'x-cache': 'HIT' },
        encodedDataLength: 1024
      }
    ],
    failures: [],
    runtimeErrors: [],
    ...overrides
  };
}

function smokeToken(validityMs = 24 * 60 * 60 * 1000) {
  return `MTE3OQ.${Date.now() + validityMs}.controlled-signature`;
}

test('summarizes successful hashed module delivery and cache status', async () => {
  const { summarizeProbe } = await verifier();
  const summary = summarizeProbe(passingResult());

  assert.equal(summary.launched, true);
  assert.equal(summary.assetCount, 1);
  assert.equal(summary.jsModuleCount, 1);
  assert.equal(summary.cacheStatuses.HIT, 1);
  assert.equal(summary.badResponseCount, 0);
});

test('records New Relic collector failures separately from game failures', async () => {
  const { summarizeProbe, assertProbe, probeFailureEvidence } = await verifier();
  const result = passingResult({
    failures: [{
      url: 'https://bam.nr-data.net/jserrors/1/abc',
      errorText: 'net::ERR_FAILED',
      canceled: false
    }],
    runtimeErrors: [{
      source: 'browser-log',
      message: 'Failed to load resource: net::ERR_FAILED',
      url: 'https://bam.nr-data.net/jserrors/1/abc'
    }, {
      source: 'console',
      message: 'Access to fetch at https://bam.nr-data.net/events/1/abc was blocked by CORS',
      url: 'https://rhospital.cc/run/newGame'
    }]
  });

  const summary = summarizeProbe(result);
  const evidence = probeFailureEvidence(result);
  assert.equal(summary.networkFailureCount, 0);
  assert.equal(summary.runtimeErrorCount, 0);
  assert.equal(summary.ignoredTelemetryFailureCount, 1);
  assert.equal(summary.ignoredTelemetryRuntimeErrorCount, 2);
  assert.equal(evidence.failures.length, 0);
  assert.equal(evidence.runtimeErrors.length, 0);
  assert.equal(evidence.ignoredTelemetryFailures.length, 1);
  assert.equal(evidence.ignoredTelemetryRuntimeErrors.length, 2);
  assert.doesNotThrow(() => assertProbe(summary, { warm: false, steam: false }));
});

test('keeps application resource and runtime failures blocking', async () => {
  const { summarizeProbe, assertProbe } = await verifier();
  const summary = summarizeProbe(passingResult({
    failures: [{
      url: 'https://rhospital.cc/assets/js/main.js',
      errorText: 'net::ERR_FAILED',
      canceled: false
    }],
    runtimeErrors: [{
      source: 'runtime-exception',
      message: 'ReferenceError: gameBoot is not defined',
      url: 'https://rhospital.cc/assets/js/main.js'
    }]
  }));

  assert.equal(summary.networkFailureCount, 1);
  assert.equal(summary.runtimeErrorCount, 1);
  assert.throws(() => assertProbe(summary, { warm: false, steam: false }), /network requests failed/);
});

test('resolves independent game and Steam hosts from release environment', async () => {
  const { resolveProbeHosts } = await verifier();

  assert.deepEqual(resolveProbeHosts({}, {
    RHOSPITAL_GAME_HOST: 'game.example.test',
    RHOSPITAL_STEAM_HOST: 'steam.example.test'
  }), {
    gameHost: 'game.example.test',
    steamHost: 'steam.example.test'
  });
  assert.throws(() => resolveProbeHosts({ 'steam-host': 'https://steam.example.test' }, {}),
    /Steam host must be a hostname/);
});

test('prerequisite check fails closed when the controlled token file is missing', async () => {
  const {resolveStaticDeliveryPrerequisites} = await verifier();

  assert.throws(() => resolveStaticDeliveryPrerequisites({
    'app-tag': '20260803',
    'auth-token-file': path.join(os.tmpdir(), 'missing-rhospital-smoke-token'),
    chrome: process.execPath
  }, {}), /Authenticated smoke token file is missing/);
});

test('prerequisite check validates token, Chrome, gateways and hosts without network access', async t => {
  const {resolveStaticDeliveryPrerequisites} = await verifier();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-prerequisites-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const tokenFile = path.join(root, 'smoke-token.txt');
  const controlledToken = smokeToken();
  fs.writeFileSync(tokenFile, `token=${controlledToken}\n`, 'utf8');

  const result = resolveStaticDeliveryPrerequisites({
    'app-tag': '20260803',
    'auth-token-file': tokenFile,
    chrome: process.execPath,
    'riven-ip': '192.0.2.45',
    'vmiss-ip': '192.0.2.64',
    'game-host': 'game.example.test',
    'steam-host': 'steam.example.test'
  }, {});

  assert.equal(result.appTag, '20260803');
  assert.equal(result.token, controlledToken);
  assert.equal(result.chromePath, process.execPath);
  assert.deepEqual(result.gateways.map(gateway => gateway.ip), ['192.0.2.45', '192.0.2.64']);
  assert.equal(result.gameHost, 'game.example.test');
  assert.equal(result.steamHost, 'steam.example.test');
});

test('prerequisite check rejects invalid gateway addresses and numeric limits', async t => {
  const {resolveStaticDeliveryPrerequisites} = await verifier();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-prerequisites-invalid-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const tokenFile = path.join(root, 'smoke-token.txt');
  fs.writeFileSync(tokenFile, `${smokeToken()}\n`, 'utf8');
  const base = {'app-tag': '20260803', 'auth-token-file': tokenFile, chrome: process.execPath};

  assert.throws(() => resolveStaticDeliveryPrerequisites({...base, 'riven-ip': 'not-an-ip'}, {}),
    /riven gateway must be an IP address/);
  assert.throws(() => resolveStaticDeliveryPrerequisites({...base, 'timeout-ms': '0'}, {}),
    /Browser timeout must be greater than zero/);
});

test('prerequisite check rejects malformed and expiring smoke tokens', async t => {
  const {resolveStaticDeliveryPrerequisites} = await verifier();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-prerequisites-token-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const tokenFile = path.join(root, 'smoke-token.txt');
  const base = {'app-tag': '20260804', 'auth-token-file': tokenFile, chrome: process.execPath};

  fs.writeFileSync(tokenFile, 'not-an-application-token\n', 'utf8');
  assert.throws(() => resolveStaticDeliveryPrerequisites(base, {}), /token format is invalid/);

  fs.writeFileSync(tokenFile, `${smokeToken(30 * 60 * 1000)}\n`, 'utf8');
  assert.throws(() => resolveStaticDeliveryPrerequisites(base, {}), /expires in less than two hours/);
});

test('prerequisite CLI reports readiness without exposing the token', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-prerequisites-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const tokenFile = path.join(root, 'smoke-token.txt');
  const controlledToken = smokeToken();
  fs.writeFileSync(tokenFile, `${controlledToken}\n`, 'utf8');
  const script = path.resolve(__dirname, '..', 'scripts', 'verify-game-static-delivery.mjs');
  const result = spawnSync(process.execPath, [
    script,
    '--app-tag', '20260803',
    '--auth-token-file', tokenFile,
    '--chrome', process.execPath,
    '--riven-ip', '192.0.2.45',
    '--vmiss-ip', '192.0.2.64',
    '--game-host', 'game.example.test',
    '--steam-host', 'steam.example.test',
    '--check-prerequisites'
  ], {encoding: 'utf8'});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /game_static_delivery_prerequisites=PASS/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(controlledToken));
});

test('prerequisite CLI uses a distinct failure marker', () => {
  const script = path.resolve(__dirname, '..', 'scripts', 'verify-game-static-delivery.mjs');
  const result = spawnSync(process.execPath, [
    script,
    '--app-tag', '20260803',
    '--auth-token-file', path.join(os.tmpdir(), 'missing-rhospital-smoke-token-cli'),
    '--chrome', process.execPath,
    '--check-prerequisites'
  ], {encoding: 'utf8'});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /game_static_delivery_prerequisites=FAIL/);
  assert.doesNotMatch(result.stderr, /game_static_delivery_validation=FAIL/);
});

test('warm validation rejects cache misses', async () => {
  const { summarizeProbe, assertProbe } = await verifier();
  const result = passingResult();
  result.responses[0].headers['x-cache'] = 'MISS';
  const summary = summarizeProbe(result);

  assert.throws(() => assertProbe(summary, { warm: true, steam: false }), /warm pass still had 1 cache MISS/);
});

test('validation rejects failed resources, missing cache headers and incomplete loading', async () => {
  const { summarizeProbe, assertProbe, probeFailureEvidence } = await verifier();
  const result = passingResult({
    state: { href: 'https://rhospital.cc/run/newGame', firstFloor: false, loadState: { phase: 'asset-timeout' } },
    responses: [{
      url: 'https://rhospital.cc/assets/js/main.js?h=abc',
      status: 504,
      headers: {},
      encodedDataLength: 100
    }],
    failures: [{ errorText: 'net::ERR_TIMED_OUT', canceled: false }]
  });
  const summary = summarizeProbe(result);
  const evidence = probeFailureEvidence(result);

  assert.equal(evidence.failedResponses[0].status, 504);
  assert.equal(evidence.failures[0].errorText, 'net::ERR_TIMED_OUT');
  assert.deepEqual(evidence.runtimeErrors, []);

  assert.throws(() => assertProbe(summary, { warm: false, steam: true }), error => {
    assert.match(error.message, /did not reach FirstFloor/);
    assert.match(error.message, /returned 4xx\/5xx/);
    assert.match(error.message, /missed X-Cache/);
    assert.match(error.message, /network requests failed/);
    return true;
  });
});

test('validation rejects cold-cache origin bytes above the configured budget', async () => {
  const { summarizeProbe, assertProbe } = await verifier();
  const result = passingResult();
  result.responses[0].headers['x-cache'] = 'MISS';
  result.responses[0].encodedDataLength = 5000;
  const summary = summarizeProbe(result);

  assert.throws(() => assertProbe(summary, {
    warm: false,
    steam: false,
    originBudgetBytes: 1024
  }), /origin MISS bytes 5000 exceeded budget 1024/);
});
