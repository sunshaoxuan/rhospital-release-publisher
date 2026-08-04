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
  assert.throws(() => resolveStaticDeliveryPrerequisites({...base, 'browser-infrastructure-retries': '1.5'}, {}),
    /Browser infrastructure retries must be a non-negative integer/);
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

test('prerequisite readiness runs the browser capability probe without exposing the token', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-prerequisites-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const tokenFile = path.join(root, 'smoke-token.txt');
  const controlledToken = smokeToken();
  fs.writeFileSync(tokenFile, `${controlledToken}\n`, 'utf8');
  const {runStaticDelivery} = await verifier();
  const lines = [];
  let capabilityRuns = 0;
  await runStaticDelivery({
    'app-tag': '20260803',
    'auth-token-file': tokenFile,
    chrome: process.execPath,
    'riven-ip': '192.0.2.45',
    'vmiss-ip': '192.0.2.64',
    'game-host': 'game.example.test',
    'steam-host': 'steam.example.test',
    'check-prerequisites': true
  }, {
    capabilityProbe: async () => {
      capabilityRuns += 1;
      return {
        context: true,
        version: 'WebGL 2 test',
        renderer: 'SwiftShader test',
        viewport: [800, 600],
        devicePixelRatio: 1,
        texture: [1280, 720],
        statusName: 'Complete',
        complete: true,
        error: 0
      };
    },
    log: line => lines.push(line)
  });

  assert.equal(capabilityRuns, 1);
  assert.match(lines.join('\n'), /game_static_delivery_browser=PASS/);
  assert.match(lines.join('\n'), /game_static_delivery_prerequisites=PASS/);
  assert.doesNotMatch(lines.join('\n'), new RegExp(controlledToken));
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

test('browser capability requires a complete framebuffer and zero WebGL errors', async () => {
  const {assertBrowserCapability, BrowserInfrastructureError} = await verifier();
  const passing = {
    context: true,
    complete: true,
    statusName: 'Complete',
    error: 0
  };

  assert.equal(assertBrowserCapability(passing), passing);
  assert.throws(() => assertBrowserCapability({context: false}), BrowserInfrastructureError);
  assert.throws(() => assertBrowserCapability({context: true, complete: false, statusName: 'Unsupported', error: 0}),
    /Framebuffer Unsupported/);
  assert.throws(() => assertBrowserCapability({...passing, error: 1285}), /glError=1285/);
});

test('CDP requests fail within their own timeout and clear pending work', async () => {
  const {CdpClient, BrowserInfrastructureError} = await verifier();
  class SilentSocket extends EventTarget {
    constructor() {
      super();
      this.readyState = WebSocket.OPEN;
    }
    send() {}
    close() {
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(new Event('close'));
    }
  }
  const socket = new SilentSocket();
  const client = new CdpClient('ws://example.test', {
    requestTimeoutMs: 20,
    webSocketFactory: () => socket
  });

  await assert.rejects(client.send('Runtime.evaluate'), error => {
    assert.ok(error instanceof BrowserInfrastructureError);
    assert.equal(error.code, 'CDP_REQUEST_TIMEOUT');
    assert.match(error.message, /Runtime\.evaluate timed out/);
    return true;
  });
  assert.equal(client.pending.size, 0);
  client.close();
});

test('isolated retry recovers a framebuffer infrastructure failure with a fresh probe key', async () => {
  const {runValidatedChromeProbe} = await verifier();
  let runs = 0;
  const keys = [];
  const failed = passingResult({
    state: {href: 'https://rhospital.cc/run/newGame', firstFloor: false, loadState: null},
    runtimeErrors: [{
      source: 'runtime-exception',
      message: 'Error: Framebuffer status: Framebuffer Unsupported',
      url: 'https://rhospital.cc/assets/js/vendor/phaser.esm.js'
    }]
  });
  const result = await runValidatedChromeProbe({
    probeOptions: {probeKey: '20260805-riven'},
    validationOptions: {warm: false, steam: false},
    infrastructureRetries: 1,
    probeRunner: async options => {
      runs += 1;
      keys.push(options.probeKey);
      return runs === 1 ? failed : passingResult();
    }
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.summary.launched, true);
  assert.deepEqual(keys, ['20260805-riven', '20260805-riven-infra-retry-1']);
});

test('application runtime failures remain fail closed without browser retry', async () => {
  const {runValidatedChromeProbe} = await verifier();
  let runs = 0;
  await assert.rejects(runValidatedChromeProbe({
    probeOptions: {probeKey: 'application-failure'},
    validationOptions: {warm: false, steam: false},
    infrastructureRetries: 1,
    probeRunner: async () => {
      runs += 1;
      return passingResult({
        state: {href: 'https://rhospital.cc/run/newGame', firstFloor: false, loadState: null},
        runtimeErrors: [{
          source: 'runtime-exception',
          message: 'ReferenceError: gameBoot is not defined',
          url: 'https://rhospital.cc/assets/js/main.js'
        }]
      });
    }
  }), /browser runtime errors were captured/);
  assert.equal(runs, 1);
});

test('repeated browser infrastructure failures stop after the configured retry budget', async () => {
  const {runValidatedChromeProbe, BrowserInfrastructureError} = await verifier();
  let runs = 0;
  await assert.rejects(runValidatedChromeProbe({
    probeOptions: {probeKey: 'cdp-timeout'},
    validationOptions: {warm: false, steam: false},
    infrastructureRetries: 1,
    probeRunner: async () => {
      runs += 1;
      throw new BrowserInfrastructureError('CDP Runtime.evaluate timed out after 20ms', 'CDP_REQUEST_TIMEOUT');
    }
  }), /CDP Runtime\.evaluate timed out/);
  assert.equal(runs, 2);
});
