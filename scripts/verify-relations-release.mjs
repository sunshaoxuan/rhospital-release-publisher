import {pathToFileURL} from 'node:url';

import {
  evaluate,
  isBrowserInfrastructureFailure,
  isIgnoredTelemetryEntry,
  resolveStaticDeliveryPrerequisites,
  runBrowserCapabilityProbe,
  useChromeTarget
} from './verify-game-static-delivery.mjs';

const RELATIONS_ROUTE = '/relations';
const DEFAULT_RELATIONS_TIMEOUT_MS = 120000;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

export function readRelationsDebugSnapshot(runtimeDebug, serializedSnapshot) {
  const runtimeSnapshot = runtimeDebug?.getSnapshot?.();
  if (runtimeSnapshot) return runtimeSnapshot;
  if (!serializedSnapshot) return null;
  try {
    return JSON.parse(serializedSnapshot);
  } catch {
    return null;
  }
}

export function isRelationsRefreshCycleComplete({
  snapshot,
  selectedNodeId,
  refreshButtonDisabled,
  statusHidden,
  refreshLoadingGuard
}) {
  return refreshButtonDisabled === false
    && statusHidden === true
    && refreshLoadingGuard?.graphRequestCount === 1
    && refreshLoadingGuard?.graphResponseCount === 1
    && refreshLoadingGuard?.graphOkResponseCount === 1
    && refreshLoadingGuard?.snapshotMutationCount > 0
    && refreshLoadingGuard?.graphRequestSequence > 0
    && refreshLoadingGuard?.graphOkResponseSequence > refreshLoadingGuard.graphRequestSequence
    && refreshLoadingGuard?.latestSnapshotMutationSequence > refreshLoadingGuard.graphOkResponseSequence
    && snapshot?.mainNodeId === selectedNodeId
    && snapshot?.sceneObjectsReady === true;
}

export function relationsInteractionExpression(timeoutMs) {
  return `(() => (async () => {
    const timeoutMs = ${JSON.stringify(timeoutMs)};
    const parseDebugSnapshot = ${readRelationsDebugSnapshot.toString()};
    const refreshCycleComplete = ${isRelationsRefreshCycleComplete.toString()};
    const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await sleep(100);
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const hasEmailKey = (value, seen = new WeakSet()) => {
      if (!value || typeof value !== 'object') return false;
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) return value.some(item => hasEmailKey(item, seen));
      return Object.entries(value).some(([key, child]) =>
        key.toLocaleLowerCase('en-US').includes('email') || hasEmailKey(child, seen));
    };
    const hasEmailValue = (value, seen = new WeakSet()) => {
      if (typeof value === 'string') return /[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}/i.test(value);
      if (!value || typeof value !== 'object') return false;
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) return value.some(item => hasEmailValue(item, seen));
      return Object.values(value).some(child => hasEmailValue(child, seen));
    };
    const readSnapshot = () => parseDebugSnapshot(
      window.__relationsGraphDebug,
      document.getElementById('relations-shell')?.dataset.relationsDebugSnapshot);
    const initialGraphCapture = await waitFor(() => {
      const capture = window.__relationsReleaseInitialGraphCapture;
      return capture?.complete === true ? capture : null;
    }, 'initial page relation API response capture');
    const graphContentType = String(initialGraphCapture.contentType || '');
    const graph = initialGraphCapture.payload;
    const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const graphLinks = Array.isArray(graph?.links) ? graph.links : [];
    const hospitalNodeRows = graphNodes.filter(node => node?.kind === 'HOSPITAL');
    const guildNodeRows = graphNodes.filter(node => node?.kind === 'GUILD');
    const hospitalIds = new Set();
    let missingHospitalIdCount = 0;
    let duplicateHospitalIdCount = 0;
    let hospitalNodeIdMismatchCount = 0;
    for (const node of hospitalNodeRows) {
      if (node?.hospitalId == null) {
        missingHospitalIdCount += 1;
        continue;
      }
      const hospitalId = String(node.hospitalId);
      if (hospitalIds.has(hospitalId)) duplicateHospitalIdCount += 1;
      hospitalIds.add(hospitalId);
      if (node.id !== 'hospital:' + hospitalId) hospitalNodeIdMismatchCount += 1;
    }
    const directorNodeCount = graphNodes.filter(node => node?.kind === 'DIRECTOR').length;
    const heroNodeCount = graphNodes.filter(node => node?.kind === 'HERO').length;
    const unsupportedNodeKindCount = graphNodes.filter(node =>
      node?.kind !== 'HOSPITAL' && node?.kind !== 'GUILD').length;
    const legacyIdentityRelationTypeCount = Array.isArray(graph?.relationTypes)
      ? graph.relationTypes.filter(type => type?.key === 'DIRECTOR_OF' || type?.key === 'HERO_OF').length
      : 0;
    const legacyIdentityLinkCount = graphLinks.filter(link =>
      link?.type === 'DIRECTOR_OF' || link?.type === 'HERO_OF').length;
    const hospitalNodeIds = new Set(hospitalNodeRows.map(node => node.id));
    const relatedHospitalNodeIds = new Set();
    for (const link of graphLinks) {
      const sourceId = typeof link?.source === 'object' ? link.source?.id : link?.source;
      const targetId = typeof link?.target === 'object' ? link.target?.id : link?.target;
      if (hospitalNodeIds.has(sourceId)) relatedHospitalNodeIds.add(sourceId);
      if (hospitalNodeIds.has(targetId)) relatedHospitalNodeIds.add(targetId);
    }
    const initialSnapshot = await waitFor(() => {
      const snapshot = readSnapshot();
      return snapshot?.sceneObjectsReady === true ? snapshot : null;
    }, 'initial complete relation scene');
    const hospitalNodes = hospitalNodeRows.filter(node =>
      relatedHospitalNodeIds.has(node.id)
      && (String(node.hospitalName || '').trim() || String(node.personName || '').trim()));
    const searchUrl = document.body.dataset.relationsSearchApi || '/api/admin/relations/hospitals/search';
    const requestSearch = async value => {
      const separator = searchUrl.includes('?') ? '&' : '?';
      const response = await fetch(searchUrl + separator + 'q=' + encodeURIComponent(value) + '&limit=8', {
        credentials: 'same-origin',
        headers: {Accept: 'application/json'}
      });
      const contentType = response.headers.get('content-type') || '';
      let matches = [];
      try {
        matches = await response.json();
      } catch {}
      return {
        status: response.status,
        json: contentType.includes('application/json'),
        matches: Array.isArray(matches) ? matches : []
      };
    };
    let selected = null;
    let searchChecks = null;
    for (const hospital of hospitalNodes.slice(0, 8)) {
      const hospitalName = String(hospital.hospitalName || '').trim();
      const directorName = String(hospital.personName || '').trim();
      if (!hospitalName || !directorName) continue;
      const hospitalNameSearch = await requestSearch(hospitalName);
      const hospitalNameMatch = hospitalNameSearch.matches.find(item =>
        item?.nodeId === hospital.id && String(item.email || '').includes('@')) || null;
      if (!hospitalNameMatch) continue;
      const email = String(hospitalNameMatch.email || '').trim();
      const directorNameSearch = await requestSearch(directorName);
      const emailSearch = await requestSearch(email);
      const directorNameMatch = directorNameSearch.matches.some(item => item?.nodeId === hospital.id);
      const emailMatch = emailSearch.matches.some(item => item?.nodeId === hospital.id);
      selected = hospitalNameMatch;
      searchChecks = {
        hospitalName: hospitalNameSearch,
        directorName: directorNameSearch,
        email: emailSearch,
        directorNameMatch,
        emailMatch
      };
      if (directorNameMatch && emailMatch) break;
    }
    const selectedEmail = String(selected?.email || '');
    const graphSerialized = JSON.stringify(graph || {}).toLocaleLowerCase('en-US');
    const graphContainsSelectedEmail = Boolean(selectedEmail)
      && graphSerialized.includes(selectedEmail.toLocaleLowerCase('en-US'));

    let selectedSnapshot = null;
    let selectedRelationCount = null;
    let filteredSnapshot = null;
    let refreshedSnapshot = null;
    let refreshCompleted = false;
    let explicitSelectionRequired = false;
    const refreshLoadingGuard = {
      observedPending: false,
      heldDuringPending: true,
      pendingSubmitDispatched: false,
      searchRequestCount: 0,
      graphRequestCount: 0,
      graphResponseCount: 0,
      graphOkResponseCount: 0,
      snapshotMutationCount: 0,
      eventSequence: 0,
      graphRequestSequence: 0,
      graphOkResponseSequence: 0,
      latestSnapshotMutationSequence: 0,
      mainNodePreserved: true
    };
    if (selected) {
      const input = document.getElementById('node-search');
      const beforeSubmitSnapshot = readSnapshot();
      input.value = selectedEmail;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      const searchForm = document.getElementById('node-search-form');
      if (typeof searchForm.requestSubmit === 'function') searchForm.requestSubmit();
      else searchForm.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      const results = document.getElementById('search-results');
      const button = await waitFor(() => {
        const buttons = Array.from(results.querySelectorAll('button.search-result-button'));
        return buttons.find(candidate => candidate.textContent.includes(selectedEmail)) || null;
      }, 'matching hospital search result');
      const beforeSelectionSnapshot = readSnapshot();
      explicitSelectionRequired = !beforeSubmitSnapshot?.mainNodeId
        && !beforeSelectionSnapshot?.mainNodeId
        && !beforeSelectionSnapshot?.selectedNodeId;
      button.click();
      selectedSnapshot = await waitFor(() => {
        const snapshot = readSnapshot();
        return snapshot?.mainNodeId === selected.nodeId
          && snapshot?.selectedNodeId === selected.nodeId
          && snapshot?.sceneObjectsReady === true
          ? snapshot
          : null;
      }, 'selected main hospital with synchronized scene objects');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      selectedSnapshot = readSnapshot();
      const selectedRelationCountText = String(
        document.getElementById('selected-relation-count')?.textContent || '').trim();
      const normalizedSelectedRelationCount = selectedRelationCountText.replace(/[,，]/g, '');
      selectedRelationCount = /^[0-9]+$/.test(normalizedSelectedRelationCount)
        ? Number(normalizedSelectedRelationCount)
        : null;

      const toggleAll = document.getElementById('toggle-all-types');
      if ((readSnapshot()?.activeTypes || []).length > 0) toggleAll.click();
      await waitFor(() => (readSnapshot()?.activeTypes || []).length === 0, 'all relationship types disabled');
      const hideIsolated = document.getElementById('hide-isolated');
      if (!hideIsolated.checked) {
        hideIsolated.checked = true;
        hideIsolated.dispatchEvent(new Event('change', {bubbles: true}));
      }
      filteredSnapshot = await waitFor(() => {
        const snapshot = readSnapshot();
        return snapshot?.mainNodeId === selected.nodeId
          && snapshot?.activeTypes?.length === 0
          && snapshot?.renderedLinkCount === 0
          && snapshot?.renderedNodeCount === 1
          && snapshot?.sceneObjectsReady === true
          ? snapshot
          : null;
      }, 'main hospital retained while isolated nodes are hidden');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      filteredSnapshot = readSnapshot();

      const refreshButton = document.getElementById('refresh-graph');
      const relationsShell = document.getElementById('relations-shell');
      let refreshCycleStarted = false;
      const snapshotObserver = new MutationObserver(records => {
        if (!refreshCycleStarted) return;
        for (const record of records) {
          if (record.attributeName !== 'data-relations-debug-snapshot') continue;
          refreshLoadingGuard.snapshotMutationCount += 1;
          refreshLoadingGuard.latestSnapshotMutationSequence = ++refreshLoadingGuard.eventSequence;
        }
      });
      snapshotObserver.observe(relationsShell, {
        attributes: true,
        attributeFilter: ['data-relations-debug-snapshot']
      });
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        const requestInput = args[0];
        const requestUrl = typeof requestInput === 'string'
          ? requestInput
          : String(requestInput?.url || requestInput || '');
        if (requestUrl.includes('/api/admin/relations/hospitals/search')) {
          refreshLoadingGuard.searchRequestCount += 1;
        }
        const isGraphRequest = requestUrl.includes('/api/admin/relations')
          && !requestUrl.includes('/api/admin/relations/hospitals/search');
        const responsePromise = originalFetch.apply(window, args);
        if (!isGraphRequest) return responsePromise;
        refreshLoadingGuard.graphRequestCount += 1;
        refreshLoadingGuard.graphRequestSequence = ++refreshLoadingGuard.eventSequence;
        return Promise.resolve(responsePromise).then(response => {
          refreshLoadingGuard.graphResponseCount += 1;
          if (response?.ok === true) {
            refreshLoadingGuard.graphOkResponseCount += 1;
            refreshLoadingGuard.graphOkResponseSequence = ++refreshLoadingGuard.eventSequence;
          }
          return response;
        }, error => {
          refreshLoadingGuard.graphResponseCount += 1;
          throw error;
        });
      };
      try {
        refreshCycleStarted = true;
        refreshButton.click();
        while (refreshButton.disabled) {
          refreshLoadingGuard.observedPending = true;
          if (input.disabled !== true || document.getElementById('node-search-button')?.disabled !== true) {
            refreshLoadingGuard.heldDuringPending = false;
          }
          if (readSnapshot()?.mainNodeId !== selected.nodeId) refreshLoadingGuard.mainNodePreserved = false;
          if (!refreshLoadingGuard.pendingSubmitDispatched) {
            refreshLoadingGuard.pendingSubmitDispatched = true;
            if (typeof searchForm.requestSubmit === 'function') searchForm.requestSubmit();
            else searchForm.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
          }
          await sleep(25);
        }
        refreshedSnapshot = await waitFor(() => {
          const snapshot = readSnapshot();
          const status = document.getElementById('graph-status');
          const complete = refreshCycleComplete({
            snapshot,
            selectedNodeId: selected.nodeId,
            refreshButtonDisabled: refreshButton.disabled,
            statusHidden: status?.hidden === true,
            refreshLoadingGuard
          });
          if (!complete) return null;
          refreshCompleted = true;
          return snapshot;
        }, 'relations graph refresh with retained main hospital');
      } finally {
        snapshotObserver.disconnect();
        window.fetch = originalFetch;
      }
    }

    return {
      graphApi: {
        source: 'initial-page-response',
        status: initialGraphCapture.status,
        json: graphContentType.includes('application/json'),
        nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
        linkCount: graphLinks.length,
        hospitalNodeCount: hospitalNodeRows.length,
        guildNodeCount: guildNodeRows.length,
        uniqueHospitalIdCount: hospitalIds.size,
        missingHospitalIdCount,
        duplicateHospitalIdCount,
        hospitalNodeIdMismatchCount,
        directorNodeCount,
        heroNodeCount,
        unsupportedNodeKindCount,
        legacyIdentityRelationTypeCount,
        legacyIdentityLinkCount,
        hasEmailKey: hasEmailKey(graph),
        containsAnyEmailValue: hasEmailValue(graph),
        containsSelectedEmail: graphContainsSelectedEmail
      },
      searchApi: {
        allQueriesOk: Boolean(searchChecks)
          && ['hospitalName', 'directorName', 'email'].every(key =>
            searchChecks[key].status === 200 && searchChecks[key].json),
        resultCounts: searchChecks ? {
          hospitalName: searchChecks.hospitalName.matches.length,
          directorName: searchChecks.directorName.matches.length,
          email: searchChecks.email.matches.length
        } : {hospitalName: 0, directorName: 0, email: 0},
        hospitalNameMatched: Boolean(selected),
        directorNameMatched: searchChecks?.directorNameMatch === true,
        emailMatched: searchChecks?.emailMatch === true,
        selectedNodeId: selected?.nodeId || '',
        selectedHospitalIdPresent: selected?.hospitalId != null,
        selectedHospitalNamePresent: Boolean(String(selected?.hospitalName || '').trim()),
        selectedEmailPresent: Boolean(selectedEmail && selectedEmail.includes('@'))
      },
      initialSnapshot,
      selectedSnapshot,
      selectedRelationCount,
      filteredSnapshot,
      refreshedSnapshot,
      refreshCompleted,
      explicitSelectionRequired,
      refreshLoadingGuard
    };
  })())()`;
}

export async function runRelationsProbe({
  chromePath,
  gateway,
  host,
  mappedHosts,
  token,
  timeoutMs = DEFAULT_RELATIONS_TIMEOUT_MS,
  cdpTimeoutMs
}) {
  const hostRules = [...new Set([...mappedHosts, 'hero-hospital.icu'])]
    .map(mappedHost => `MAP ${mappedHost} ${gateway.ip}`)
    .concat(['EXCLUDE localhost'])
    .join(',');
  return useChromeTarget({
    chromePath,
    extraArguments: [`--host-resolver-rules=${hostRules}`],
    startupTimeoutMs: cdpTimeoutMs,
    cdpTimeoutMs
  }, async client => {
    const responses = new Map();
    const requestUrls = new Map();
    const failures = [];
    const runtimeErrors = [];
    let pageReadyObserved = false;
    let preReadySearchRequestCount = 0;
    client.on('Network.requestWillBeSent', params => {
      const url = params.request?.url || '';
      requestUrls.set(params.requestId, url);
      if (!pageReadyObserved && url.includes('/api/admin/relations/hospitals/search')) {
        preReadySearchRequestCount += 1;
      }
    });
    client.on('Network.responseReceived', params => {
      const response = params.response || {};
      responses.set(params.requestId, {
        url: response.url || '',
        status: Number(response.status || 0),
        mimeType: response.mimeType || '',
        headers: normalizedHeaders(response.headers)
      });
    });
    client.on('Network.loadingFailed', params => failures.push({
      url: requestUrls.get(params.requestId) || '',
      errorText: params.errorText || 'network request failed',
      canceled: params.canceled === true
    }));
    client.on('Runtime.exceptionThrown', params => runtimeErrors.push({
      source: 'runtime-exception',
      message: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'runtime exception',
      url: params.exceptionDetails?.url || params.exceptionDetails?.stackTrace?.callFrames?.[0]?.url || ''
    }));
    client.on('Runtime.consoleAPICalled', params => {
      if (params.type !== 'error') return;
      runtimeErrors.push({
        source: 'console',
        message: (params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        url: params.stackTrace?.callFrames?.[0]?.url || ''
      });
    });
    client.on('Log.entryAdded', params => {
      if (params.entry?.level !== 'error') return;
      runtimeErrors.push({
        source: 'browser-log',
        message: params.entry.text || 'browser log error',
        url: params.entry.url || ''
      });
    });

    await Promise.all([
      client.send('Network.enable'),
      client.send('Runtime.enable'),
      client.send('Page.enable'),
      client.send('Log.enable')
    ]);
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const initialFetch = window.fetch;
        window.fetch = (...args) => {
          const requestInput = args[0];
          const requestUrl = typeof requestInput === 'string'
            ? requestInput
            : String(requestInput?.url || requestInput || '');
          const responsePromise = initialFetch.apply(window, args);
          const isGraphRequest = requestUrl.includes('/api/admin/relations')
            && !requestUrl.includes('/api/admin/relations/hospitals/search');
          if (!isGraphRequest || window.__relationsReleaseInitialGraphCapture) return responsePromise;
          const capture = window.__relationsReleaseInitialGraphCapture = {
            requestUrl,
            status: 0,
            contentType: '',
            payload: null,
            complete: false
          };
          Promise.resolve(responsePromise).then(response => {
            capture.status = Number(response?.status || 0);
            capture.contentType = response?.headers?.get?.('content-type') || '';
            return response.clone().json();
          }).then(payload => {
            capture.payload = payload;
            capture.complete = true;
          }, () => {
            capture.complete = true;
          });
          return responsePromise;
        };
        document.addEventListener('DOMContentLoaded', () => {
        const parseDebugSnapshot = ${readRelationsDebugSnapshot.toString()};
        const input = document.getElementById('node-search');
        const button = document.getElementById('node-search-button');
        const form = document.getElementById('node-search-form');
        const shell = document.getElementById('relations-shell');
        const guard = window.__relationsReleaseLoadingGuard = {
          initialDisabled: input?.disabled === true && button?.disabled === true,
          observedPending: false,
          heldDuringPending: true,
          pendingSubmitDispatched: false,
          mainNodeChanged: false,
          completed: false
        };
        const sample = () => {
          const snapshot = parseDebugSnapshot(
            window.__relationsGraphDebug,
            shell?.dataset.relationsDebugSnapshot);
          const ready = Boolean(snapshot)
            && input?.disabled === false
            && button?.disabled === false
            && document.getElementById('graph-status')?.hidden === true;
          if (ready) {
            guard.completed = true;
            return;
          }
          guard.observedPending = true;
          if (input?.disabled !== true || button?.disabled !== true) guard.heldDuringPending = false;
          if (shell?.dataset.mainNodeId || shell?.dataset.selectedNodeId) guard.mainNodeChanged = true;
          requestAnimationFrame(sample);
        };
        sample();
        queueMicrotask(() => {
          if (!input || !form) return;
          input.value = 'relations-loading-guard';
          guard.pendingSubmitDispatched = true;
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        });
        }, {once: true});
      })();`
    });
    for (const cookieHost of [...new Set(mappedHosts)]) {
      await client.send('Network.setCookie', {
        name: 'token',
        value: token,
        domain: cookieHost,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax'
      });
    }

    await client.send('Page.navigate', {url: `https://${host}${RELATIONS_ROUTE}`});
    const deadline = Date.now() + timeoutMs;
    let pageState = null;
    while (Date.now() < deadline) {
      await delay(250);
      pageState = await evaluate(client, `(() => ({
        href: location.href,
        pathname: location.pathname,
        title: document.title,
        loadingGuard: window.__relationsReleaseLoadingGuard || null,
        ready: Boolean(window.__relationsGraphDebug?.getSnapshot?.()
          || document.getElementById('relations-shell')?.dataset.relationsDebugSnapshot)
          && window.__relationsReleaseLoadingGuard?.completed === true
          && document.getElementById('node-search')?.disabled === false
          && document.getElementById('graph-status')?.hidden === true
      }))()`);
      if (pageState?.ready || pageState?.pathname !== RELATIONS_ROUTE) break;
    }
    pageReadyObserved = pageState?.ready === true;

    let interaction = null;
    if (pageState?.ready) {
      interaction = await evaluate(client, relationsInteractionExpression(timeoutMs));
    }
    await delay(500);
    return {
      gateway: gateway.name,
      host,
      route: RELATIONS_ROUTE,
      pageState,
      preReadySearchRequestCount,
      interaction,
      responses: [...responses.values()],
      failures,
      runtimeErrors
    };
  });
}

function fixedAtOrigin(snapshot) {
  const node = snapshot?.mainNode;
  return Boolean(node) && ['x', 'y', 'z', 'fx', 'fy', 'fz'].every(key => node[key] === 0);
}

function hasUniqueFixedMain(snapshot) {
  return snapshot?.fixedNodeIds?.length === 1
    && snapshot.fixedNodeIds[0] === snapshot.mainNodeId
    && snapshot.selectedNodeId === snapshot.mainNodeId
    && fixedAtOrigin(snapshot);
}

const SCENE_EVIDENCE_COUNT_FIELDS = Object.freeze([
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
]);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasCompleteSceneEvidence(snapshot) {
  return snapshot?.sceneObjectsReady === true
    && SCENE_EVIDENCE_COUNT_FIELDS.every(field => isNonNegativeInteger(snapshot?.[field]));
}

function overviewSceneMatches(snapshot, expectedLinkCount) {
  return snapshot?.overviewLineObjectCount === 1
    && snapshot.overviewLinkCount === expectedLinkCount
    && snapshot.overviewGeometrySegmentCount === expectedLinkCount;
}

function focusedSceneMatches(snapshot) {
  return snapshot?.focusedLinkObjectCount === snapshot?.focusedLinkCount
    && snapshot?.focusedDirectedLinkCount <= snapshot?.focusedLinkCount
    && snapshot?.focusedArrowObjectCount === snapshot?.focusedDirectedLinkCount;
}

function adaptiveSceneLabelsMatch(snapshot, adaptiveLabelCap) {
  return snapshot?.spriteLabelCount > 0
    && snapshot.spriteLabelCount === snapshot.expectedSpriteLabelCount
    && Number.isInteger(adaptiveLabelCap)
    && snapshot.spriteLabelCount <= adaptiveLabelCap
    && snapshot.spriteLabelCount < snapshot.renderedNodeCount;
}

function clearedSceneMatches(snapshot) {
  return hasCompleteSceneEvidence(snapshot)
    && snapshot.renderedNodeCount === 1
    && snapshot.renderedLinkCount === 0
    && overviewSceneMatches(snapshot, 0)
    && snapshot.focusedLinkCount === 0
    && snapshot.selectedLinkCount === 0
    && snapshot.focusedLinkObjectCount === 0
    && snapshot.focusedDirectedLinkCount === 0
    && snapshot.focusedArrowObjectCount === 0
    && snapshot.expectedSpriteLabelCount === 1
    && snapshot.spriteLabelCount === 1;
}

export function summarizeRelationsProbe(result) {
  const failedResponses = (result.responses || []).filter(entry =>
    Number(entry.status) >= 400 && !isIgnoredTelemetryEntry(entry));
  const networkFailures = (result.failures || []).filter(entry =>
    !entry.canceled && !isIgnoredTelemetryEntry(entry));
  const runtimeErrors = (result.runtimeErrors || []).filter(entry => !isIgnoredTelemetryEntry(entry));
  const interaction = result.interaction || {};
  const graphApi = interaction.graphApi || null;
  const initialSnapshot = interaction.initialSnapshot;
  const selectedSnapshot = interaction.selectedSnapshot;
  const guildNodeCount = graphApi?.guildNodeCount;
  const adaptiveLabelCap = Number.isInteger(guildNodeCount) && guildNodeCount >= 0
    ? 120 + guildNodeCount + 1
    : null;
  return {
    gateway: result.gateway,
    pageReady: result.pageState?.ready === true
      && result.pageState?.pathname === RELATIONS_ROUTE,
    initialLoadingGuardValid: result.pageState?.loadingGuard?.initialDisabled === true
      && result.pageState?.loadingGuard?.observedPending === true
      && result.pageState?.loadingGuard?.heldDuringPending === true
      && result.pageState?.loadingGuard?.pendingSubmitDispatched === true
      && result.pageState?.loadingGuard?.mainNodeChanged === false
      && result.pageState?.loadingGuard?.completed === true
      && result.preReadySearchRequestCount === 0,
    graphApi,
    searchApi: interaction.searchApi || null,
    initialSceneValid: hasCompleteSceneEvidence(initialSnapshot)
      && initialSnapshot.apiNodeCount === graphApi?.nodeCount
      && initialSnapshot.apiLinkCount === graphApi?.linkCount
      && initialSnapshot.renderedNodeCount === graphApi?.nodeCount
      && initialSnapshot.renderedLinkCount === graphApi?.linkCount
      && overviewSceneMatches(initialSnapshot, graphApi?.linkCount)
      && focusedSceneMatches(initialSnapshot)
      && adaptiveSceneLabelsMatch(initialSnapshot, adaptiveLabelCap)
      && initialSnapshot.selectedLinkCount === 0,
    selectedMainValid: hasUniqueFixedMain(interaction.selectedSnapshot),
    filteredMainValid: hasUniqueFixedMain(interaction.filteredSnapshot)
      && interaction.filteredSnapshot?.activeTypes?.length === 0
      && interaction.filteredSnapshot?.renderedLinkCount === 0
      && interaction.filteredSnapshot?.overviewLinkCount === 0
      && interaction.filteredSnapshot?.renderedNodeCount === 1,
    filteredSceneValid: clearedSceneMatches(interaction.filteredSnapshot),
    refreshedMainValid: interaction.refreshCompleted === true
      && hasUniqueFixedMain(interaction.refreshedSnapshot)
      && interaction.refreshedSnapshot?.activeTypes?.length === 0
      && interaction.refreshedSnapshot?.renderedLinkCount === 0
      && interaction.refreshedSnapshot?.overviewLinkCount === 0
      && interaction.refreshedSnapshot?.renderedNodeCount === 1,
    refreshedSceneValid: interaction.refreshCompleted === true
      && clearedSceneMatches(interaction.refreshedSnapshot),
    sceneObjectsReady: selectedSnapshot?.sceneObjectsReady === true,
    overviewBatchValid: hasCompleteSceneEvidence(selectedSnapshot)
      && selectedSnapshot.apiNodeCount === graphApi?.nodeCount
      && selectedSnapshot.apiLinkCount === graphApi?.linkCount
      && selectedSnapshot.renderedNodeCount === graphApi?.nodeCount
      && selectedSnapshot.renderedLinkCount === graphApi?.linkCount
      && overviewSceneMatches(selectedSnapshot, graphApi?.linkCount),
    adaptiveLabelsValid: hasCompleteSceneEvidence(selectedSnapshot)
      && adaptiveSceneLabelsMatch(selectedSnapshot, adaptiveLabelCap),
    focusedLinksValid: hasCompleteSceneEvidence(selectedSnapshot)
      && selectedSnapshot.selectedLinkCount > 0
      && selectedSnapshot.focusedLinkCount === selectedSnapshot.selectedLinkCount
      && selectedSnapshot.focusedLinkObjectCount === selectedSnapshot.focusedLinkCount,
    focusedArrowsValid: hasCompleteSceneEvidence(selectedSnapshot)
      && focusedSceneMatches(selectedSnapshot),
    selectedRelationCountValid: isNonNegativeInteger(interaction.selectedRelationCount)
      && isNonNegativeInteger(selectedSnapshot?.selectedLinkCount)
      && interaction.selectedRelationCount === selectedSnapshot.selectedLinkCount,
    explicitSelectionRequired: interaction.explicitSelectionRequired === true,
    refreshLoadingGuardValid: interaction.refreshLoadingGuard?.observedPending === true
      && interaction.refreshLoadingGuard?.heldDuringPending === true
      && interaction.refreshLoadingGuard?.pendingSubmitDispatched === true
      && interaction.refreshLoadingGuard?.searchRequestCount === 0
      && interaction.refreshLoadingGuard?.graphRequestCount === 1
      && interaction.refreshLoadingGuard?.graphResponseCount === 1
      && interaction.refreshLoadingGuard?.graphOkResponseCount === 1
      && interaction.refreshLoadingGuard?.snapshotMutationCount > 0
      && interaction.refreshLoadingGuard?.graphRequestSequence > 0
      && interaction.refreshLoadingGuard?.graphOkResponseSequence
        > interaction.refreshLoadingGuard.graphRequestSequence
      && interaction.refreshLoadingGuard?.latestSnapshotMutationSequence
        > interaction.refreshLoadingGuard.graphOkResponseSequence
      && interaction.refreshLoadingGuard?.mainNodePreserved === true,
    failedResponseCount: failedResponses.length,
    networkFailureCount: networkFailures.length,
    runtimeErrorCount: runtimeErrors.length,
    ignoredTelemetryFailureCount: (result.failures || []).filter(entry =>
      !entry.canceled && isIgnoredTelemetryEntry(entry)).length,
    ignoredTelemetryRuntimeErrorCount: (result.runtimeErrors || []).filter(isIgnoredTelemetryEntry).length
  };
}

export function assertRelationsProbe(summary) {
  const errors = [];
  if (!summary.pageReady) errors.push('administrator relations page did not become ready');
  if (!summary.initialLoadingGuardValid) {
    errors.push('hospital search loading guard failed before the graph became ready');
  }
  if (summary.graphApi?.status !== 200 || !summary.graphApi?.json) {
    errors.push('graph API did not return HTTP 200 JSON');
  }
  if (summary.graphApi?.source !== 'initial-page-response') {
    errors.push('graph API evidence did not come from the initial page response');
  }
  if (!(summary.graphApi?.nodeCount > 0)) errors.push('graph API returned no nodes');
  if (!(summary.graphApi?.hospitalNodeCount > 0)) errors.push('graph API returned no hospital nodes');
  if (summary.graphApi?.hospitalNodeCount !== summary.graphApi?.uniqueHospitalIdCount
      || summary.graphApi?.duplicateHospitalIdCount !== 0) {
    errors.push('hospital nodes were not unique by hospital ID');
  }
  if (summary.graphApi?.missingHospitalIdCount !== 0
      || summary.graphApi?.hospitalNodeIdMismatchCount !== 0) {
    errors.push('hospital node IDs did not match hospital:<hospitalId>');
  }
  if (summary.graphApi?.nodeCount
      !== summary.graphApi?.hospitalNodeCount + summary.graphApi?.guildNodeCount) {
    errors.push('graph API returned nodes outside the hospital and guild model');
  }
  if (summary.graphApi?.directorNodeCount !== 0 || summary.graphApi?.heroNodeCount !== 0
      || summary.graphApi?.unsupportedNodeKindCount !== 0) {
    errors.push('graph API retained director, hero, or unsupported nodes');
  }
  if (summary.graphApi?.legacyIdentityRelationTypeCount !== 0
      || summary.graphApi?.legacyIdentityLinkCount !== 0) {
    errors.push('graph API retained legacy director or hero identity relations');
  }
  if (summary.graphApi?.hasEmailKey !== false) errors.push('graph API exposed an email field or omitted isolation evidence');
  if (summary.graphApi?.containsAnyEmailValue !== false) {
    errors.push('graph API exposed an email-shaped value or omitted isolation evidence');
  }
  if (summary.graphApi?.containsSelectedEmail !== false) {
    errors.push('graph API exposed the selected hospital email value or omitted isolation evidence');
  }
  if (!summary.searchApi?.allQueriesOk) errors.push('hospital search API did not return HTTP 200 JSON for all query fields');
  if (!summary.searchApi?.hospitalNameMatched) errors.push('hospital name search did not return the hospital');
  if (!summary.searchApi?.directorNameMatched) errors.push('director name search did not return the hospital');
  if (!summary.searchApi?.emailMatched) errors.push('email search did not return the hospital');
  if (!summary.searchApi?.selectedNodeId) errors.push('hospital search query returned no matching hospital');
  if (!summary.searchApi?.selectedHospitalIdPresent || !summary.searchApi?.selectedHospitalNamePresent) {
    errors.push('hospital search result missed hospital identity fields');
  }
  if (!summary.searchApi?.selectedEmailPresent) errors.push('hospital search result missed email');
  if (!summary.explicitSelectionRequired) errors.push('hospital query selected a main node before an explicit result click');
  if (!summary.initialSceneValid) {
    errors.push('initial full scene did not match graph API node and relation totals with complete scene evidence');
  }
  if (!summary.selectedMainValid) errors.push('selected hospital was not the unique main node fixed at the origin');
  if (!summary.filteredMainValid) errors.push('main hospital was not retained after disabling relations and hiding isolated nodes');
  if (!summary.filteredSceneValid) {
    errors.push('filtered all-off scene retained geometry or omitted scene object evidence');
  }
  if (!summary.refreshedMainValid) errors.push('main hospital was not retained at the origin after refresh');
  if (!summary.refreshedSceneValid) {
    errors.push('refreshed all-off scene retained geometry or omitted scene object evidence');
  }
  if (!summary.sceneObjectsReady) errors.push('relation graph scene objects did not report synchronized evidence');
  if (!summary.overviewBatchValid) {
    errors.push('overview scene object and geometry did not cover every active logical relation');
  }
  if (!summary.adaptiveLabelsValid) {
    errors.push('actual Sprite labels did not match the expected adaptive label set or cap');
  }
  if (!summary.focusedLinksValid) {
    errors.push('selected hospital had no relation or actual focused links did not match its logical selected relations');
  }
  if (!summary.focusedArrowsValid) {
    errors.push('actual focused arrow objects did not match the logical directed relation count');
  }
  if (!summary.selectedRelationCountValid) {
    errors.push('selected relation detail count did not match the logical selected relation count');
  }
  if (!summary.refreshLoadingGuardValid) errors.push('hospital search loading guard failed while the graph refreshed');
  if (summary.failedResponseCount > 0) errors.push(`${summary.failedResponseCount} responses returned 4xx/5xx`);
  if (summary.networkFailureCount > 0) errors.push(`${summary.networkFailureCount} network requests failed`);
  if (summary.runtimeErrorCount > 0) errors.push(`${summary.runtimeErrorCount} browser runtime errors were captured`);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return summary;
}

export function safeErrorMessage(error) {
  return String(error?.message || error || 'relations release validation failed')
    .replace(/\b[0-9A-Z._%+-]+@[0-9A-Z.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b[0-9A-Za-z_-]+\.\d{10,}\.[0-9A-Za-z_-]+\b/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

async function runProbeWithInfrastructureRetry(options, {
  probeRunner,
  infrastructureRetries,
  onRetry
}) {
  for (let attempt = 1; attempt <= infrastructureRetries + 1; attempt += 1) {
    try {
      const result = await probeRunner(options);
      return {result, summary: assertRelationsProbe(summarizeRelationsProbe(result)), attempts: attempt};
    } catch (error) {
      const retryable = isBrowserInfrastructureFailure({error});
      if (!retryable || attempt > infrastructureRetries) throw error;
      onRetry({attempt, nextAttempt: attempt + 1});
    }
  }
  throw new Error('relations browser infrastructure retry loop ended unexpectedly');
}

export async function runRelationsRelease(args, {
  prerequisiteResolver = resolveStaticDeliveryPrerequisites,
  capabilityProbe = runBrowserCapabilityProbe,
  probeRunner = runRelationsProbe,
  log = console.log,
  errorLog = console.error
} = {}) {
  if (args.help) {
    log('Usage: node scripts/verify-relations-release.mjs --app-tag TAG --auth-token-file FILE');
    return;
  }
  const prerequisites = prerequisiteResolver(args);
  const capability = await capabilityProbe({
    chromePath: prerequisites.chromePath,
    cdpTimeoutMs: prerequisites.cdpTimeoutMs
  });
  log(`relations_release_browser=PASS framebuffer=${capability.statusName || capability.status || 'Complete'}`);
  const timeoutMs = Number(args['relations-timeout-ms'] || DEFAULT_RELATIONS_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Relations timeout must be greater than zero');
  }
  const mappedHosts = [...new Set([prerequisites.gameHost, 'hero-hospital.icu'])];
  for (const gateway of prerequisites.gateways) {
    const validated = await runProbeWithInfrastructureRetry({
      chromePath: prerequisites.chromePath,
      gateway,
      host: prerequisites.gameHost,
      mappedHosts,
      token: prerequisites.token,
      timeoutMs,
      cdpTimeoutMs: prerequisites.cdpTimeoutMs
    }, {
      probeRunner,
      infrastructureRetries: prerequisites.browserInfrastructureRetries,
      onRetry: ({attempt, nextAttempt}) => errorLog(
        `relations_release_browser_retry=START gateway=${gateway.name} failed_attempt=${attempt} next_attempt=${nextAttempt}`)
    });
    const summary = validated.summary;
    log([
      'relations_release_gateway=PASS',
      `gateway=${gateway.name}`,
      `attempts=${validated.attempts}`,
      `graph_nodes=${summary.graphApi.nodeCount}`,
      `hospital_nodes=${summary.graphApi.hospitalNodeCount}`,
      `guild_nodes=${summary.graphApi.guildNodeCount}`,
      `graph_links=${summary.graphApi.linkCount}`,
      `search_hospital_results=${summary.searchApi.resultCounts.hospitalName}`,
      `search_director_results=${summary.searchApi.resultCounts.directorName}`,
      `search_email_results=${summary.searchApi.resultCounts.email}`,
      'query_modes=hospitalName,directorName,email',
      'search_email=present',
      'graph_email=absent',
      'explicit_selection=required',
      'search_loading_guard=present',
      'main_node=origin-fixed',
      'filtered_refresh=preserved',
      `ignored_telemetry_failures=${summary.ignoredTelemetryFailureCount}`,
      `ignored_telemetry_errors=${summary.ignoredTelemetryRuntimeErrorCount}`
    ].join(' '));
  }
  log(`relations_release_validation=PASS gateways=${prerequisites.gateways.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRelationsRelease(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(`relations_release_validation=FAIL reason=${JSON.stringify(safeErrorMessage(error))}`);
    process.exitCode = 1;
  });
}
