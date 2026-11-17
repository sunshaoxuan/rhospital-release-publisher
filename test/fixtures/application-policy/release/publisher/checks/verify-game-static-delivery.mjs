import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
let BROWSER_INFRASTRUCTURE_ERROR_PATTERN, BrowserInfrastructureError, CdpClient, DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES, DEFAULT_CDP_TIMEOUT_MS, DEFAULT_GATEWAYS, DEFAULT_ORIGIN_BUDGET_BYTES, DEFAULT_TIMEOUT_MS, IGNORED_TELEMETRY_HOSTS, MINIMUM_TOKEN_VALIDITY_MS, assertBrowserCapability, browserDiagnosticSuffix, chromeArguments, chromeCleanupEvidence, delay, evaluate, hasIgnoredTelemetryHost, isBrowserInfrastructureFailure, isIgnoredTelemetryEntry, nonNegativeInteger, normalizedHeaders, observeChromeClose, positiveNumber, readToken, requestJson, requireNode22, resolveChrome, resolveProbeHosts, resolveStaticDeliveryPrerequisites, runBrowserCapabilityProbe, stopChrome, summarizeProbe, useChromeTarget, waitForFile, withProbeQuery, hostRunChromeProbe;
export function configureBrowserHost(host) {
 if(host.RELEASE_BROWSER_HOST_API_VERSION!=='release-browser-host/v1')throw new Error('Browser host API mismatch');
 ({BROWSER_INFRASTRUCTURE_ERROR_PATTERN, BrowserInfrastructureError, CdpClient, DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES, DEFAULT_CDP_TIMEOUT_MS, DEFAULT_GATEWAYS, DEFAULT_ORIGIN_BUDGET_BYTES, DEFAULT_TIMEOUT_MS, IGNORED_TELEMETRY_HOSTS, MINIMUM_TOKEN_VALIDITY_MS, assertBrowserCapability, browserDiagnosticSuffix, chromeArguments, chromeCleanupEvidence, delay, evaluate, hasIgnoredTelemetryHost, isBrowserInfrastructureFailure, isIgnoredTelemetryEntry, nonNegativeInteger, normalizedHeaders, observeChromeClose, positiveNumber, readToken, requestJson, requireNode22, resolveChrome, resolveProbeHosts, resolveStaticDeliveryPrerequisites, runBrowserCapabilityProbe, stopChrome, summarizeProbe, useChromeTarget, waitForFile, withProbeQuery,runChromeProbe:hostRunChromeProbe}=host);
}
export async function runChromeProbe(parameters) {
 const policy=JSON.parse(fs.readFileSync(new URL('../game-policy.json',import.meta.url),'utf8'));
 return hostRunChromeProbe({...parameters,readyExpression:fs.readFileSync(new URL('../../../'+policy.browser.probe.readyExpression,import.meta.url),'utf8'),cookieName:policy.browser.probe.cookieName});
}
export { BROWSER_INFRASTRUCTURE_ERROR_PATTERN, BrowserInfrastructureError, CdpClient, DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES, DEFAULT_CDP_TIMEOUT_MS, DEFAULT_GATEWAYS, DEFAULT_ORIGIN_BUDGET_BYTES, DEFAULT_TIMEOUT_MS, IGNORED_TELEMETRY_HOSTS, MINIMUM_TOKEN_VALIDITY_MS, assertBrowserCapability, browserDiagnosticSuffix, chromeArguments, chromeCleanupEvidence, delay, evaluate, hasIgnoredTelemetryHost, isBrowserInfrastructureFailure, isIgnoredTelemetryEntry, nonNegativeInteger, normalizedHeaders, observeChromeClose, positiveNumber, readToken, requestJson, requireNode22, resolveChrome, resolveProbeHosts, resolveStaticDeliveryPrerequisites, runBrowserCapabilityProbe, stopChrome, summarizeProbe, useChromeTarget, waitForFile, withProbeQuery };

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
export function probeFailureEvidence(result, limit = 10) {
  const responses = Array.isArray(result?.responses) ? result.responses : [];
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  const runtimeErrors = Array.isArray(result?.runtimeErrors) ? result.runtimeErrors : [];
  const failedResponses = responses.filter(entry => Number(entry.status) >= 400);
  const networkFailures = failures.filter(entry => !entry.canceled);
  return {
    gateway: result.gateway,
    host: result.host,
    route: result.route,
    state: result.state,
    failures: networkFailures.filter(entry => !isIgnoredTelemetryEntry(entry)).slice(0, limit),
    runtimeErrors: runtimeErrors.filter(entry => !isIgnoredTelemetryEntry(entry)).slice(0, limit),
    ignoredTelemetryFailures: networkFailures.filter(isIgnoredTelemetryEntry).slice(0, limit),
    ignoredTelemetryRuntimeErrors: runtimeErrors.filter(isIgnoredTelemetryEntry).slice(0, limit),
    failedResponses: failedResponses.slice(0, limit).map(entry => ({
      url: entry.url,
      status: entry.status,
      mimeType: entry.mimeType
    }))
  };
}
export function assertProbe(summary, { warm, steam, originBudgetBytes = DEFAULT_ORIGIN_BUDGET_BYTES }) {
  const errors = [];
  if (!summary.launched) errors.push(`game did not reach FirstFloor, state=${JSON.stringify(summary.loadState)}`);
  if (summary.assetCount === 0) errors.push('no /assets/ requests were observed');
  if (summary.badResponseCount > 0) errors.push(`${summary.badResponseCount} asset responses returned 4xx/5xx`);
  if (summary.missingCacheHeader > 0) errors.push(`${summary.missingCacheHeader} asset responses missed X-Cache`);
  if (summary.networkFailureCount > 0) errors.push(`${summary.networkFailureCount} network requests failed`);
  if (summary.runtimeErrorCount > 0) errors.push(`${summary.runtimeErrorCount} browser runtime errors were captured`);
  if (summary.missBytes > originBudgetBytes) {
    errors.push(`origin MISS bytes ${summary.missBytes} exceeded budget ${originBudgetBytes}`);
  }
  if (warm && (summary.cacheStatuses.MISS || 0) > 0) {
    errors.push(`warm pass still had ${summary.cacheStatuses.MISS} cache MISS responses`);
  }
  if (steam && summary.jsModuleCount === 0) errors.push('Steam pass observed no ES module responses');
  if (errors.length > 0) {
    throw new Error(`${summary.gateway} ${summary.host}${summary.route}: ${errors.join('; ')}`);
  }
}
function infrastructureErrorMessage(error) {
  return String(error?.message || error || 'browser infrastructure failure').replace(/\s+/g, ' ').slice(0, 500);
}
export async function runValidatedChromeProbe({
  probeOptions,
  validationOptions,
  infrastructureRetries = DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES,
  rotateProbeKeyOnRetry = true,
  probeRunner = runChromeProbe,
  onRetry = () => {}
}) {
  const baseProbeKey = probeOptions.probeKey;
  for (let attempt = 1; attempt <= infrastructureRetries + 1; attempt += 1) {
    const probeKey = rotateProbeKeyOnRetry && attempt > 1
      ? `${baseProbeKey}-infra-retry-${attempt - 1}`
      : baseProbeKey;
    let result;
    try {
      result = await probeRunner({...probeOptions, probeKey});
      const summary = summarizeProbe(result);
      assertProbe(summary, validationOptions);
      return {result, summary, attempts: attempt, probeKey};
    } catch (error) {
      const retryable = isBrowserInfrastructureFailure({result, error});
      if (!retryable || attempt > infrastructureRetries) {
        if (result) error.probeResult = result;
        throw error;
      }
      await onRetry({attempt, result, error, nextAttempt: attempt + 1});
    }
  }
  throw new Error('Browser infrastructure retry loop ended unexpectedly');
}
function browserCapabilityReceipt(capability) {
  return [
    'game_static_delivery_browser=PASS',
    `renderer=${JSON.stringify(capability.renderer || 'unknown')}`,
    `webgl=${JSON.stringify(capability.version || 'unknown')}`,
    `framebuffer=${capability.statusName || capability.status}`,
    `viewport=${(capability.viewport || []).join('x')}`,
    `dpr=${capability.devicePixelRatio}`,
    `texture=${(capability.texture || []).join('x')}`
  ].join(' ');
}
export async function runStaticDelivery(args, {
  capabilityProbe = runBrowserCapabilityProbe,
  probeRunner = runChromeProbe,
  log = console.log,
  errorLog = console.error
} = {}) {
  if (args.help) {
    log('Usage: node scripts/verify-game-static-delivery.mjs --app-tag TAG --auth-token-file FILE [--check-prerequisites]');
    return;
  }
  const prerequisites = resolveStaticDeliveryPrerequisites(args);
  const capability = await capabilityProbe({
    chromePath: prerequisites.chromePath,
    cdpTimeoutMs: prerequisites.cdpTimeoutMs
  });
  log(browserCapabilityReceipt(capability));
  if (args['check-prerequisites']) {
    log(`game_static_delivery_prerequisites=PASS token=readable chrome=webgl-ready gateways=${prerequisites.gateways.length} game_host=${prerequisites.gameHost} steam_host=${prerequisites.steamHost}`);
    return;
  }
  const {
    appTag,
    token,
    chromePath,
    timeoutMs,
    cdpTimeoutMs,
    browserInfrastructureRetries,
    originBudgetBytes,
    gateways,
    gameHost,
    steamHost
  } = prerequisites;
  const mappedHosts = [...new Set([gameHost, steamHost])];

  const receipts = [];
  for (const gateway of gateways) {
    const probeKey = `${appTag}-${gateway.name}`;
    const retryLogger = pass => async ({attempt, result, error, nextAttempt}) => {
      if (result) errorLog(`game_static_delivery_retry_evidence=${JSON.stringify(probeFailureEvidence(result))}`);
      errorLog(`game_static_delivery_browser_retry=START gateway=${gateway.name} pass=${pass} failed_attempt=${attempt} next_attempt=${nextAttempt} reason=${JSON.stringify(infrastructureErrorMessage(error))}`);
    };
    const coldResult = await runValidatedChromeProbe({
      probeOptions: {
        chromePath,
        gateway,
        host: gameHost,
        mappedHosts,
        route: '/run/newGame',
        token,
        probeKey,
        timeoutMs,
        cdpTimeoutMs
      },
      validationOptions: {warm: false, steam: false, originBudgetBytes},
      infrastructureRetries: browserInfrastructureRetries,
      rotateProbeKeyOnRetry: true,
      probeRunner,
      onRetry: retryLogger('cold')
    });
    receipts.push({pass: 'cold', attempts: coldResult.attempts, ...coldResult.summary});

    const warmResult = await runValidatedChromeProbe({
      probeOptions: {
        chromePath,
        gateway,
        host: gameHost,
        mappedHosts,
        route: '/run/newGame',
        token,
        probeKey: coldResult.probeKey,
        timeoutMs,
        cdpTimeoutMs
      },
      validationOptions: {warm: true, steam: false, originBudgetBytes},
      infrastructureRetries: browserInfrastructureRetries,
      rotateProbeKeyOnRetry: false,
      probeRunner,
      onRetry: retryLogger('warm')
    });
    receipts.push({pass: 'warm', attempts: warmResult.attempts, ...warmResult.summary});

    const steamResult = await runValidatedChromeProbe({
      probeOptions: {
        chromePath,
        gateway,
        host: steamHost,
        mappedHosts,
        route: '/run/newGameSteam',
        token,
        probeKey: coldResult.probeKey,
        timeoutMs,
        cdpTimeoutMs
      },
      validationOptions: {warm: true, steam: true, originBudgetBytes},
      infrastructureRetries: browserInfrastructureRetries,
      rotateProbeKeyOnRetry: false,
      probeRunner,
      onRetry: retryLogger('steam')
    });
    receipts.push({pass: 'steam', attempts: steamResult.attempts, ...steamResult.summary});
  }
  for (const receipt of receipts) log(JSON.stringify(receipt));
  log(`game_static_delivery_validation=PASS probes=${receipts.length}`);
}
export function reportStaticDeliveryFailure(error, {prerequisites = false, errorLog = console.error} = {}) {
  if (error.chromeDiagnostic) errorLog(`game_static_delivery_browser_diagnostic=${JSON.stringify(error.chromeDiagnostic)}`);
  if (error.chromeCleanupErrors?.length) {
    errorLog(`game_static_delivery_cleanup=FAIL evidence=${JSON.stringify(chromeCleanupEvidence(error))}`);
  }
  if (error.probeResult) {
    errorLog(`game_static_delivery_evidence=${JSON.stringify(probeFailureEvidence(error.probeResult))}`);
  }
  const label = prerequisites
    ? 'game_static_delivery_prerequisites'
    : 'game_static_delivery_validation';
  errorLog(`${label}=FAIL ${error.stack || error.message}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  if(!args['host-browser-helper'])throw new Error('Explicit browser host API required');
  configureBrowserHost(await import(pathToFileURL(args['host-browser-helper']).href));
  runStaticDelivery(args).catch(error => {
    reportStaticDeliveryFailure(error, {prerequisites: process.argv.includes('--check-prerequisites')});
    process.exitCode = 1;
  });
}
