const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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

test('summarizes successful hashed module delivery and cache status', async () => {
  const { summarizeProbe } = await verifier();
  const summary = summarizeProbe(passingResult());

  assert.equal(summary.launched, true);
  assert.equal(summary.assetCount, 1);
  assert.equal(summary.jsModuleCount, 1);
  assert.equal(summary.cacheStatuses.HIT, 1);
  assert.equal(summary.badResponseCount, 0);
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

test('warm validation rejects cache misses', async () => {
  const { summarizeProbe, assertProbe } = await verifier();
  const result = passingResult();
  result.responses[0].headers['x-cache'] = 'MISS';
  const summary = summarizeProbe(result);

  assert.throws(() => assertProbe(summary, { warm: true, steam: false }), /warm pass still had 1 cache MISS/);
});

test('validation rejects failed resources, missing cache headers and incomplete loading', async () => {
  const { summarizeProbe, assertProbe } = await verifier();
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
