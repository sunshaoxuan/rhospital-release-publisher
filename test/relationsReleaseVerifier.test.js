const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

async function verifier() {
  const script = path.resolve(__dirname, '..', 'scripts', 'verify-relations-release.mjs');
  return import(pathToFileURL(script).href);
}

function snapshot(overrides = {}) {
  return {
    apiNodeCount: 24,
    apiLinkCount: 18,
    renderedNodeCount: 24,
    renderedLinkCount: 18,
    mainNodeId: 'hospital:17',
    selectedNodeId: 'hospital:17',
    mainNode: {
      id: 'hospital:17',
      x: 0,
      y: 0,
      z: 0,
      fx: 0,
      fy: 0,
      fz: 0
    },
    fixedNodeIds: ['hospital:17'],
    activeTypes: ['FRIENDSHIP'],
    ...overrides
  };
}

function passingResult(overrides = {}) {
  return {
    gateway: 'riven',
    host: 'rhospital.cc',
    route: '/relations',
    pageState: {
      href: 'https://rhospital.cc/relations',
      pathname: '/relations',
      title: '关系星图 | 英雄荣光医院',
      loadingGuard: {
        initialDisabled: true,
        observedPending: true,
        heldDuringPending: true,
        pendingSubmitDispatched: true,
        mainNodeChanged: false,
        completed: true
      },
      ready: true
    },
    interaction: {
      graphApi: {
        status: 200,
        json: true,
        nodeCount: 24,
        linkCount: 18,
        hasEmailKey: false,
        containsAnyEmailValue: false,
        containsSelectedEmail: false
      },
      searchApi: {
        allQueriesOk: true,
        resultCounts: {hospitalName: 1, directorName: 1, email: 1},
        hospitalNameMatched: true,
        directorNameMatched: true,
        emailMatched: true,
        selectedNodeId: 'hospital:17',
        selectedHospitalIdPresent: true,
        selectedHospitalNamePresent: true,
        selectedEmailPresent: true
      },
      selectedSnapshot: snapshot(),
      filteredSnapshot: snapshot({
        renderedNodeCount: 1,
        renderedLinkCount: 0,
        activeTypes: []
      }),
      refreshedSnapshot: snapshot({
        renderedNodeCount: 1,
        renderedLinkCount: 0,
        activeTypes: []
      }),
      refreshCompleted: true,
      explicitSelectionRequired: true,
      refreshLoadingGuard: {
        observedPending: true,
        heldDuringPending: true,
        pendingSubmitDispatched: true,
        searchRequestCount: 0,
        mainNodePreserved: true
      }
    },
    preReadySearchRequestCount: 0,
    responses: [
      {url: 'https://rhospital.cc/relations', status: 200},
      {url: 'https://rhospital.cc/api/admin/relations', status: 200},
      {url: 'https://rhospital.cc/api/admin/relations/hospitals/search?q=sample', status: 200}
    ],
    failures: [],
    runtimeErrors: [],
    ...overrides
  };
}

test('accepts a real-page-shaped result with private search email and public graph isolation', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const summary = summarizeRelationsProbe(passingResult());

  assert.equal(summary.pageReady, true);
  assert.equal(summary.graphApi.hasEmailKey, false);
  assert.equal(summary.initialLoadingGuardValid, true);
  assert.equal(summary.searchApi.selectedEmailPresent, true);
  assert.equal(summary.searchApi.emailMatched, true);
  assert.equal(summary.explicitSelectionRequired, true);
  assert.equal(summary.refreshLoadingGuardValid, true);
  assert.equal(summary.selectedMainValid, true);
  assert.equal(summary.filteredMainValid, true);
  assert.equal(summary.refreshedMainValid, true);
  assert.equal(assertRelationsProbe(summary), summary);
});

test('fails closed when graph email isolation or hospital search result shape regresses', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.graphApi.hasEmailKey = true;
  result.interaction.graphApi.containsAnyEmailValue = true;
  result.interaction.graphApi.containsSelectedEmail = true;
  result.interaction.searchApi.selectedEmailPresent = false;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /graph API exposed an email field/);
    assert.match(error.message, /graph API exposed an email-shaped value/);
    assert.match(error.message, /graph API exposed the selected hospital email value/);
    assert.match(error.message, /hospital search result missed email/);
    return true;
  });
});

test('fails closed when any query field, explicit selection, or continuous loading guard regresses', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.pageState.loadingGuard.heldDuringPending = false;
  result.preReadySearchRequestCount = 1;
  result.interaction.searchApi.allQueriesOk = false;
  result.interaction.searchApi.hospitalNameMatched = false;
  result.interaction.searchApi.directorNameMatched = false;
  result.interaction.searchApi.emailMatched = false;
  result.interaction.explicitSelectionRequired = false;
  result.interaction.refreshLoadingGuard.heldDuringPending = false;
  result.interaction.refreshLoadingGuard.searchRequestCount = 1;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /loading guard failed before the graph became ready/);
    assert.match(error.message, /all query fields/);
    assert.match(error.message, /hospital name search/);
    assert.match(error.message, /director name search/);
    assert.match(error.message, /email search/);
    assert.match(error.message, /before an explicit result click/);
    assert.match(error.message, /loading guard failed while the graph refreshed/);
    return true;
  });
});

test('browser probe continuously samples pending windows and submits guarded searches', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'verify-relations-release.mjs'), 'utf8');

  assert.match(source, /requestAnimationFrame\(sample\)/);
  assert.match(source, /preReadySearchRequestCount/);
  assert.match(source, /queueMicrotask\(\(\) =>/);
  assert.match(source, /while \(refreshButton\.disabled\)/);
  assert.match(source, /refreshLoadingGuard\.searchRequestCount/);
  assert.match(source, /pendingSubmitDispatched/);
});

test('fails closed when the selected main node moves, is duplicated, or disappears after refresh', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.selectedSnapshot.mainNode.x = 12;
  result.interaction.selectedSnapshot.fixedNodeIds.push('hospital:99');
  result.interaction.refreshedSnapshot.mainNodeId = null;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /unique main node fixed at the origin/);
    assert.match(error.message, /not retained at the origin after refresh/);
    return true;
  });
});

test('captures failed responses, network failures and browser runtime errors as blockers', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const summary = summarizeRelationsProbe(passingResult({
    responses: [{url: 'https://rhospital.cc/js/relations.bundle.js', status: 503}],
    failures: [{url: 'https://rhospital.cc/api/admin/relations', errorText: 'net::ERR_FAILED', canceled: false}],
    runtimeErrors: [{
      source: 'console',
      message: 'TypeError: graphData is undefined',
      url: 'https://rhospital.cc/js/relations.bundle.js'
    }]
  }));

  assert.equal(summary.failedResponseCount, 1);
  assert.equal(summary.networkFailureCount, 1);
  assert.equal(summary.runtimeErrorCount, 1);
  assert.throws(() => assertRelationsProbe(summary), error => {
    assert.match(error.message, /responses returned 4xx\/5xx/);
    assert.match(error.message, /network requests failed/);
    assert.match(error.message, /browser runtime errors were captured/);
    return true;
  });
});

test('validates both configured gateways and sanitizes token or email values', async () => {
  const {runRelationsRelease, safeErrorMessage} = await verifier();
  const controlledToken = 'controlled.9999999999999.signature';
  const privateEmail = 'private-hospital@example.test';
  const probeGateways = [];
  const lines = [];
  await runRelationsRelease({'app-tag': '2026081002'}, {
    prerequisiteResolver: () => ({
      appTag: '2026081002',
      token: controlledToken,
      chromePath: 'chrome-test',
      timeoutMs: 120000,
      cdpTimeoutMs: 15000,
      browserInfrastructureRetries: 1,
      gateways: [
        {name: 'riven', ip: '192.0.2.45'},
        {name: 'vmiss', ip: '192.0.2.64'}
      ],
      gameHost: 'game.example.test'
    }),
    capabilityProbe: async () => ({statusName: 'Complete'}),
    probeRunner: async options => {
      probeGateways.push(options.gateway.name);
      assert.equal(options.token, controlledToken);
      return passingResult({gateway: options.gateway.name, privateEmail});
    },
    log: line => lines.push(line),
    errorLog: line => lines.push(line)
  });

  assert.deepEqual(probeGateways, ['riven', 'vmiss']);
  assert.match(lines.join('\n'), /relations_release_gateway=PASS gateway=riven/);
  assert.match(lines.join('\n'), /relations_release_gateway=PASS gateway=vmiss/);
  assert.match(lines.join('\n'), /relations_release_validation=PASS gateways=2/);
  assert.doesNotMatch(lines.join('\n'), new RegExp(controlledToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(lines.join('\n'), new RegExp(privateEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const sanitized = safeErrorMessage(new Error(`email=${privateEmail} token=${controlledToken}`));
  assert.match(sanitized, /\[redacted-email\]/);
  assert.match(sanitized, /\[redacted-token\]/);
  assert.doesNotMatch(sanitized, new RegExp(privateEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(sanitized, new RegExp(controlledToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
