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
    overviewLinkCount: 18,
    overviewGeometrySegmentCount: 18,
    overviewLineObjectCount: 1,
    focusedLinkCount: 3,
    selectedLinkCount: 3,
    focusedLinkObjectCount: 3,
    focusedDirectedLinkCount: 2,
    focusedArrowObjectCount: 2,
    expectedSpriteLabelCount: 8,
    spriteLabelCount: 8,
    sceneObjectsReady: true,
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

function initialSnapshot(overrides = {}) {
  return snapshot({
    focusedLinkCount: 0,
    selectedLinkCount: 0,
    focusedLinkObjectCount: 0,
    focusedDirectedLinkCount: 0,
    focusedArrowObjectCount: 0,
    mainNodeId: null,
    selectedNodeId: null,
    mainNode: null,
    fixedNodeIds: [],
    ...overrides
  });
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
        source: 'initial-page-response',
        status: 200,
        json: true,
        nodeCount: 24,
        linkCount: 18,
        hospitalNodeCount: 20,
        guildNodeCount: 4,
        uniqueHospitalIdCount: 20,
        missingHospitalIdCount: 0,
        duplicateHospitalIdCount: 0,
        hospitalNodeIdMismatchCount: 0,
        directorNodeCount: 0,
        heroNodeCount: 0,
        unsupportedNodeKindCount: 0,
        legacyIdentityRelationTypeCount: 0,
        legacyIdentityLinkCount: 0,
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
      initialSnapshot: initialSnapshot(),
      selectedSnapshot: snapshot(),
      selectedRelationCount: 3,
      filteredSnapshot: snapshot({
        renderedNodeCount: 1,
        renderedLinkCount: 0,
        overviewLinkCount: 0,
        overviewGeometrySegmentCount: 0,
        focusedLinkCount: 0,
        selectedLinkCount: 0,
        focusedLinkObjectCount: 0,
        focusedDirectedLinkCount: 0,
        focusedArrowObjectCount: 0,
        expectedSpriteLabelCount: 1,
        spriteLabelCount: 1,
        activeTypes: []
      }),
      refreshedSnapshot: snapshot({
        renderedNodeCount: 1,
        renderedLinkCount: 0,
        overviewLinkCount: 0,
        overviewGeometrySegmentCount: 0,
        focusedLinkCount: 0,
        selectedLinkCount: 0,
        focusedLinkObjectCount: 0,
        focusedDirectedLinkCount: 0,
        focusedArrowObjectCount: 0,
        expectedSpriteLabelCount: 1,
        spriteLabelCount: 1,
        activeTypes: []
      }),
      refreshCompleted: true,
      explicitSelectionRequired: true,
      refreshLoadingGuard: {
        observedPending: true,
        heldDuringPending: true,
        pendingSubmitDispatched: true,
        searchRequestCount: 0,
        graphRequestCount: 1,
        graphResponseCount: 1,
        graphOkResponseCount: 1,
        snapshotMutationCount: 1,
        eventSequence: 3,
        graphRequestSequence: 1,
        graphOkResponseSequence: 2,
        latestSnapshotMutationSequence: 3,
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
  assert.equal(summary.graphApi.hospitalNodeCount, 20);
  assert.equal(summary.graphApi.uniqueHospitalIdCount, 20);
  assert.equal(summary.initialLoadingGuardValid, true);
  assert.equal(summary.searchApi.selectedEmailPresent, true);
  assert.equal(summary.searchApi.emailMatched, true);
  assert.equal(summary.explicitSelectionRequired, true);
  assert.equal(summary.refreshLoadingGuardValid, true);
  assert.equal(summary.initialSceneValid, true);
  assert.equal(summary.overviewBatchValid, true);
  assert.equal(summary.adaptiveLabelsValid, true);
  assert.equal(summary.sceneObjectsReady, true);
  assert.equal(summary.focusedLinksValid, true);
  assert.equal(summary.focusedArrowsValid, true);
  assert.equal(summary.selectedRelationCountValid, true);
  assert.equal(summary.selectedMainValid, true);
  assert.equal(summary.filteredMainValid, true);
  assert.equal(summary.filteredSceneValid, true);
  assert.equal(summary.refreshedMainValid, true);
  assert.equal(summary.refreshedSceneValid, true);
  assert.equal(assertRelationsProbe(summary), summary);
});

test('fails closed when hospital IDs duplicate or legacy person nodes return', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  Object.assign(result.interaction.graphApi, {
    nodeCount: 26,
    hospitalNodeCount: 20,
    guildNodeCount: 4,
    uniqueHospitalIdCount: 19,
    duplicateHospitalIdCount: 1,
    missingHospitalIdCount: 1,
    hospitalNodeIdMismatchCount: 1,
    directorNodeCount: 1,
    heroNodeCount: 1,
    unsupportedNodeKindCount: 2,
    legacyIdentityRelationTypeCount: 2,
    legacyIdentityLinkCount: 2
  });

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /not unique by hospital ID/);
    assert.match(error.message, /did not match hospital:<hospitalId>/);
    assert.match(error.message, /outside the hospital and guild model/);
    assert.match(error.message, /retained director, hero, or unsupported nodes/);
    assert.match(error.message, /retained legacy director or hero identity relations/);
    return true;
  });
});

test('fails closed when a legacy identity link survives without its relation type', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.graphApi.legacyIdentityRelationTypeCount = 0;
  result.interaction.graphApi.legacyIdentityLinkCount = 1;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /retained legacy director or hero identity relations/);
    return true;
  });
});

test('fails closed when the initial rendered scene loses API nodes or relations', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  Object.assign(result.interaction.initialSnapshot, {
    renderedNodeCount: 23,
    renderedLinkCount: 17,
    overviewLinkCount: 17,
    overviewGeometrySegmentCount: 17
  });

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /initial full scene did not match graph API node and relation totals/);
    return true;
  });
});

test('rejects an independently sampled graph response that could drift at a natural expiry boundary', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.graphApi.source = 'independent-probe-response';
  result.interaction.graphApi.linkCount = 17;
  for (const phase of ['initialSnapshot', 'selectedSnapshot']) {
    Object.assign(result.interaction[phase], {
      apiLinkCount: 17,
      renderedLinkCount: 17,
      overviewLinkCount: 17,
      overviewGeometrySegmentCount: 17
    });
  }

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /graph API evidence did not come from the initial page response/);
    return true;
  });
});

test('fails closed when the explicitly selected hospital has no relation', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  Object.assign(result.interaction.selectedSnapshot, {
    focusedLinkCount: 0,
    selectedLinkCount: 0,
    focusedLinkObjectCount: 0,
    focusedDirectedLinkCount: 0,
    focusedArrowObjectCount: 0
  });
  result.interaction.selectedRelationCount = 0;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /selected hospital had no relation/);
    return true;
  });
});

test('fails closed when the overview scene object or geometry does not cover every active logical link', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.selectedSnapshot.overviewGeometrySegmentCount = 17;
  result.interaction.selectedSnapshot.overviewLineObjectCount = 2;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /overview scene object and geometry did not cover every active logical relation/);
    return true;
  });
});

test('fails closed when actual Sprite labels differ from the expected adaptive set or exceed the cap', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.selectedSnapshot.renderedNodeCount = 200;
  result.interaction.selectedSnapshot.expectedSpriteLabelCount = 126;
  result.interaction.selectedSnapshot.spriteLabelCount = 126;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /actual Sprite labels did not match the expected adaptive label set or cap/);
    return true;
  });
});

test('fails closed when focused scene links, arrows, or selected detail count diverge from logical counts', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  result.interaction.selectedSnapshot.focusedLinkCount = 2;
  result.interaction.selectedSnapshot.focusedLinkObjectCount = 2;
  result.interaction.selectedSnapshot.focusedArrowObjectCount = 1;
  result.interaction.selectedRelationCount = 2;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /actual focused links did not match its logical selected relations/);
    assert.match(error.message, /actual focused arrow objects did not match the logical directed relation count/);
    assert.match(error.message, /selected relation detail count did not match the logical selected relation count/);
    return true;
  });
});

test('fails closed when required scene evidence fields are omitted', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const requiredSnapshotFields = [
    'sceneObjectsReady',
    'apiNodeCount',
    'apiLinkCount',
    'renderedNodeCount',
    'renderedLinkCount',
    'overviewLinkCount',
    'overviewGeometrySegmentCount',
    'overviewLineObjectCount',
    'focusedLinkCount',
    'selectedLinkCount',
    'focusedLinkObjectCount',
    'focusedDirectedLinkCount',
    'focusedArrowObjectCount',
    'expectedSpriteLabelCount',
    'spriteLabelCount'
  ];
  for (const field of requiredSnapshotFields) {
    const result = passingResult();
    delete result.interaction.selectedSnapshot[field];
    assert.throws(
      () => assertRelationsProbe(summarizeRelationsProbe(result)),
      undefined,
      `missing ${field} must fail closed`
    );
  }
  const result = passingResult();
  delete result.interaction.selectedRelationCount;
  assert.throws(
    () => assertRelationsProbe(summarizeRelationsProbe(result)),
    /selected relation detail count did not match the logical selected relation count/
  );
});

test('fails closed when initial, filtered, or refreshed scene evidence fields are omitted', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const requiredSceneFields = [
    'sceneObjectsReady',
    'apiNodeCount',
    'apiLinkCount',
    'renderedNodeCount',
    'renderedLinkCount',
    'overviewLinkCount',
    'overviewGeometrySegmentCount',
    'overviewLineObjectCount',
    'focusedLinkCount',
    'selectedLinkCount',
    'focusedLinkObjectCount',
    'focusedDirectedLinkCount',
    'focusedArrowObjectCount',
    'expectedSpriteLabelCount',
    'spriteLabelCount'
  ];
  const phases = [
    ['initialSnapshot', /initial full scene did not match graph API node and relation totals/],
    ['filteredSnapshot', /filtered all-off scene retained geometry or omitted scene object evidence/],
    ['refreshedSnapshot', /refreshed all-off scene retained geometry or omitted scene object evidence/]
  ];
  for (const [phase, errorPattern] of phases) {
    for (const field of requiredSceneFields) {
      const result = passingResult();
      delete result.interaction[phase][field];
      assert.throws(
        () => assertRelationsProbe(summarizeRelationsProbe(result)),
        errorPattern,
        `${phase} missing ${field} must fail closed`
      );
    }
  }
});

test('fails closed when filtered or refreshed scene objects retain any relation geometry', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  Object.assign(result.interaction.filteredSnapshot, {
    overviewGeometrySegmentCount: 1,
    focusedLinkObjectCount: 1
  });
  Object.assign(result.interaction.refreshedSnapshot, {
    overviewLineObjectCount: 2,
    focusedArrowObjectCount: 1
  });

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /filtered all-off scene retained geometry/);
    assert.match(error.message, /refreshed all-off scene retained geometry/);
    return true;
  });
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

test('fails closed when graph email isolation evidence is omitted', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  const result = passingResult();
  delete result.interaction.graphApi.hasEmailKey;
  delete result.interaction.graphApi.containsAnyEmailValue;
  delete result.interaction.graphApi.containsSelectedEmail;

  assert.throws(() => assertRelationsProbe(summarizeRelationsProbe(result)), error => {
    assert.match(error.message, /email field or omitted isolation evidence/);
    assert.match(error.message, /email-shaped value or omitted isolation evidence/);
    assert.match(error.message, /selected hospital email value or omitted isolation evidence/);
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

test('fails closed when refresh request, response, or ordered snapshot cycle evidence is missing', async () => {
  const {summarizeRelationsProbe, assertRelationsProbe} = await verifier();
  for (const field of [
    'graphRequestCount',
    'graphResponseCount',
    'graphOkResponseCount',
    'snapshotMutationCount',
    'graphRequestSequence',
    'graphOkResponseSequence',
    'latestSnapshotMutationSequence'
  ]) {
    const result = passingResult();
    delete result.interaction.refreshLoadingGuard[field];
    assert.throws(
      () => assertRelationsProbe(summarizeRelationsProbe(result)),
      /loading guard failed while the graph refreshed/,
      `missing refresh cycle field ${field} must fail closed`
    );
  }
});

test('browser probe continuously samples pending windows and submits guarded searches', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'verify-relations-release.mjs'), 'utf8');

  assert.match(source, /requestAnimationFrame\(sample\)/);
  assert.match(source, /preReadySearchRequestCount/);
  assert.match(source, /queueMicrotask\(\(\) =>/);
  assert.match(source, /while \(refreshButton\.disabled\)/);
  assert.match(source, /refreshLoadingGuard\.searchRequestCount/);
  assert.match(source, /pendingSubmitDispatched/);
  assert.match(source, /legacyIdentityLinkCount = graphLinks\.filter/);
  assert.match(source, /hasEmailKey !== false/);
  assert.match(source, /selectedRelationCountText\.replace\(\/\[,，\]\/g/);
  assert.match(source, /dataset\.relationsDebugSnapshot/);
  assert.match(source, /snapshotMutationCount/);
  assert.match(source, /__relationsReleaseInitialGraphCapture/);
  assert.doesNotMatch(source, /const graphResponse = await fetch/);
  assert.doesNotMatch(source, /previousDebugHandle/);
});

test('dataset snapshot fallback completes a refresh cycle without a runtime debug handle', async () => {
  const {
    readRelationsDebugSnapshot,
    isRelationsRefreshCycleComplete,
    relationsInteractionExpression
  } = await verifier();
  const fallbackSnapshot = snapshot({
    renderedNodeCount: 1,
    renderedLinkCount: 0,
    overviewLinkCount: 0,
    overviewGeometrySegmentCount: 0,
    focusedLinkCount: 0,
    selectedLinkCount: 0,
    focusedLinkObjectCount: 0,
    focusedDirectedLinkCount: 0,
    focusedArrowObjectCount: 0,
    expectedSpriteLabelCount: 1,
    spriteLabelCount: 1,
    activeTypes: []
  });
  const parsed = readRelationsDebugSnapshot(undefined, JSON.stringify(fallbackSnapshot));
  const refreshLoadingGuard = {
    graphRequestCount: 1,
    graphResponseCount: 1,
    graphOkResponseCount: 1,
    snapshotMutationCount: 1,
    graphRequestSequence: 1,
    graphOkResponseSequence: 2,
    latestSnapshotMutationSequence: 3
  };

  assert.deepEqual(parsed, fallbackSnapshot);
  assert.equal(isRelationsRefreshCycleComplete({
    snapshot: parsed,
    selectedNodeId: 'hospital:17',
    refreshButtonDisabled: false,
    statusHidden: true,
    refreshLoadingGuard
  }), true);
  assert.equal(isRelationsRefreshCycleComplete({
    snapshot: parsed,
    selectedNodeId: 'hospital:17',
    refreshButtonDisabled: false,
    statusHidden: true,
    refreshLoadingGuard: {...refreshLoadingGuard, snapshotMutationCount: 0}
  }), false);
  assert.equal(isRelationsRefreshCycleComplete({
    snapshot: parsed,
    selectedNodeId: 'hospital:17',
    refreshButtonDisabled: false,
    statusHidden: true,
    refreshLoadingGuard: {
      ...refreshLoadingGuard,
      graphOkResponseSequence: 3,
      latestSnapshotMutationSequence: 2
    }
  }), false, 'a residual snapshot mutation before the successful response cannot complete refresh');
  assert.equal(readRelationsDebugSnapshot(undefined, '{invalid-json'), null);
  assert.doesNotThrow(() => new Function(`return ${relationsInteractionExpression(5000)}`));
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
