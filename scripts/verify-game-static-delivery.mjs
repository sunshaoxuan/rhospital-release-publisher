import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_GATEWAYS = [
  { name: 'riven', ip: '45.94.40.77' },
  { name: 'vmiss', ip: '64.83.37.55' }
];
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_ORIGIN_BUDGET_BYTES = 240 * 1024 * 1024;
const MINIMUM_TOKEN_VALIDITY_MS = 2 * 60 * 60 * 1000;
const IGNORED_TELEMETRY_HOSTS = new Set(['bam.nr-data.net']);

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

export function resolveProbeHosts(args = {}, env = process.env) {
  const normalizeHost = (value, label) => {
    const host = String(value || '').trim().toLowerCase();
    if (!host || host.includes('://') || host.includes('/') || host.includes(':')) {
      throw new Error(`${label} must be a hostname without protocol, path or port`);
    }
    return host;
  };
  return {
    gameHost: normalizeHost(args['game-host'] || env.RHOSPITAL_GAME_HOST || 'rhospital.cc', 'Game host'),
    steamHost: normalizeHost(
      args['steam-host'] || env.RHOSPITAL_STEAM_HOST || 'rhospital-api-services.com',
      'Steam host')
  };
}

function requireNode22() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22 || typeof WebSocket !== 'function') {
    throw new Error('Static delivery verification requires Node.js 22 or newer with global WebSocket support');
  }
}

function resolveChrome(explicitPath, env = process.env) {
  const candidates = [
    explicitPath,
    env.RHOSPITAL_RELEASE_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const chrome = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!chrome) {
    throw new Error('Chrome executable is missing; set RHOSPITAL_RELEASE_CHROME_PATH');
  }
  return chrome;
}

function readToken(tokenFile) {
  if (!tokenFile || !fs.existsSync(tokenFile) || !fs.statSync(tokenFile).isFile()) {
    throw new Error('Authenticated smoke token file is missing; set RHOSPITAL_RELEASE_AUTH_TOKEN_FILE');
  }
  const raw = fs.readFileSync(tokenFile, 'utf8').trim();
  const token = raw.startsWith('token=') ? raw.slice('token='.length).trim() : raw;
  if (!token) throw new Error('Authenticated smoke token file is empty');
  const parts = token.split('.');
  const expiry = parts.length === 3 ? Number(parts[1]) : Number.NaN;
  if (!Number.isSafeInteger(expiry)) {
    throw new Error('Authenticated smoke token format is invalid');
  }
  if (expiry - Date.now() < MINIMUM_TOKEN_VALIDITY_MS) {
    throw new Error('Authenticated smoke token expires in less than two hours; rotate the controlled token file');
  }
  return token;
}

function positiveNumber(value, label, {allowZero = false} = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`);
  }
  return number;
}

export function resolveStaticDeliveryPrerequisites(args = {}, env = process.env) {
  requireNode22();
  const appTag = String(args['app-tag'] || env.RHOSPITAL_RELEASE_APP_TAG || '').trim();
  if (!appTag) throw new Error('Release app tag is required');
  const token = readToken(args['auth-token-file'] || env.RHOSPITAL_RELEASE_AUTH_TOKEN_FILE);
  const chromePath = resolveChrome(args.chrome, env);
  const timeoutMs = positiveNumber(
    args['timeout-ms'] || env.RHOSPITAL_RELEASE_BROWSER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    'Browser timeout');
  const originBudgetBytes = positiveNumber(
    args['origin-budget-bytes'] || env.RHOSPITAL_RELEASE_ORIGIN_BUDGET_BYTES || DEFAULT_ORIGIN_BUDGET_BYTES,
    'Origin byte budget',
    {allowZero: true});
  const gateways = DEFAULT_GATEWAYS.map(gateway => ({
    ...gateway,
    ip: String(args[`${gateway.name}-ip`]
      || env[`RHOSPITAL_RELEASE_${gateway.name.toUpperCase()}_IP`]
      || gateway.ip).trim()
  }));
  for (const gateway of gateways) {
    if (net.isIP(gateway.ip) === 0) throw new Error(`${gateway.name} gateway must be an IP address`);
  }
  const {gameHost, steamHost} = resolveProbeHosts(args, env);
  return {appTag, token, chromePath, timeoutMs, originBudgetBytes, gateways, gameHost, steamHost};
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for Chrome debugging file: ${filePath}`);
}

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`Chrome debugging request failed: ${response.statusCode}`));
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      });
    });
    request.on('error', reject);
    request.end();
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => this.handleMessage(event.data));
  }

  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) {
      listener(message.params || {});
    }
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function withProbeQuery(rawUrl, probeKey) {
  const url = new URL(rawUrl);
  url.searchParams.set('releaseProbe', probeKey);
  return url.toString();
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result?.value;
}

export async function runChromeProbe({ chromePath, gateway, host, mappedHosts, route, token, probeKey, timeoutMs }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-release-smoke-'));
  const debugFile = path.join(userDataDir, 'DevToolsActivePort');
  const hostRules = [
    ...new Set([...mappedHosts, 'hero-hospital.icu'])
  ].map(mappedHost => `MAP ${mappedHost} ${gateway.ip}`).concat([
    'EXCLUDE localhost'
  ]).join(',');
  const child = spawn(chromePath, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=DnsOverHttps',
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--host-resolver-rules=${hostRules}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let client;
  try {
    await waitForFile(debugFile);
    const [port] = fs.readFileSync(debugFile, 'utf8').trim().split(/\r?\n/);
    const target = await requestJson(`http://127.0.0.1:${port}/json/new?about%3Ablank`, 'PUT');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();

    const responses = new Map();
    const requestUrls = new Map();
    const failures = [];
    const runtimeErrors = [];
    client.on('Network.requestWillBeSent', params => {
      requestUrls.set(params.requestId, params.request?.url || '');
    });
    client.on('Network.responseReceived', params => {
      const response = params.response || {};
      responses.set(params.requestId, {
        url: response.url,
        status: response.status,
        mimeType: response.mimeType,
        headers: normalizedHeaders(response.headers),
        encodedDataLength: 0
      });
    });
    client.on('Network.loadingFinished', params => {
      const response = responses.get(params.requestId);
      if (response) response.encodedDataLength = Number(params.encodedDataLength || 0);
    });
    client.on('Network.loadingFailed', params => failures.push({
      requestId: params.requestId,
      url: requestUrls.get(params.requestId) || '',
      errorText: params.errorText,
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
      if (params.entry?.level === 'error') runtimeErrors.push({
        source: 'browser-log',
        message: params.entry.text || 'browser log error',
        url: params.entry.url || ''
      });
    });
    client.on('Fetch.requestPaused', async params => {
      try {
        const nextUrl = withProbeQuery(params.request.url, probeKey);
        await client.send('Fetch.continueRequest', { requestId: params.requestId, url: nextUrl });
      } catch (error) {
        failures.push({
          requestId: params.requestId,
          url: params.request?.url || '',
          errorText: error.message,
          canceled: false
        });
        await client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' });
      }
    });

    await Promise.all([
      client.send('Network.enable'),
      client.send('Runtime.enable'),
      client.send('Page.enable'),
      client.send('Log.enable'),
      client.send('Fetch.enable', { patterns: mappedHosts.map(mappedHost => ({
        urlPattern: `*://${mappedHost}/assets/*`,
        requestStage: 'Request'
      })) })
    ]);
    for (const cookieHost of mappedHosts) {
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

    const targetUrl = `https://${host}${route}`;
    await client.send('Page.navigate', { url: targetUrl });
    const deadline = Date.now() + timeoutMs;
    let state = null;
    while (Date.now() < deadline) {
      await delay(1000);
      state = await evaluate(client, `(() => ({
        href: location.href,
        title: document.title,
        loadState: window.__RHOSPITAL_LOAD_STATE__ || null,
        firstFloor: Boolean(window.game?.scene?.isActive?.('FirstFloor'))
      }))()`);
      if (state?.firstFloor || state?.loadState?.phase === 'launched') break;
      if (state?.loadState?.phase?.endsWith('-error') || state?.loadState?.phase === 'asset-timeout') break;
    }
    await delay(1500);
    return {
      gateway: gateway.name,
      host,
      route,
      state,
      responses: [...responses.values()],
      failures,
      runtimeErrors
    };
  } finally {
    try { client?.close(); } catch {}
    child.kill();
    await delay(200);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

export function summarizeProbe(result) {
  const assetResponses = result.responses.filter(entry => {
    try { return new URL(entry.url).pathname.startsWith('/assets/'); } catch { return false; }
  });
  const jsResponses = assetResponses.filter(entry => {
    try { return new URL(entry.url).pathname.endsWith('.js'); } catch { return false; }
  });
  const badResponses = assetResponses.filter(entry => Number(entry.status) >= 400);
  const cacheStatuses = {};
  let missBytes = 0;
  let missingCacheHeader = 0;
  for (const response of assetResponses) {
    const cacheStatus = (response.headers['x-cache'] || '').toUpperCase();
    if (!cacheStatus) missingCacheHeader += 1;
    cacheStatuses[cacheStatus || 'MISSING'] = (cacheStatuses[cacheStatus || 'MISSING'] || 0) + 1;
    if (cacheStatus === 'MISS') missBytes += Number(response.encodedDataLength || 0);
  }
  const networkFailures = result.failures.filter(entry => !entry.canceled);
  const actionableNetworkFailures = networkFailures.filter(entry => !isIgnoredTelemetryEntry(entry));
  const actionableRuntimeErrors = result.runtimeErrors.filter(entry => !isIgnoredTelemetryEntry(entry));
  return {
    gateway: result.gateway,
    host: result.host,
    route: result.route,
    launched: Boolean(result.state?.firstFloor || result.state?.loadState?.phase === 'launched'),
    finalUrl: result.state?.href || '',
    loadState: result.state?.loadState || null,
    assetCount: assetResponses.length,
    jsModuleCount: jsResponses.length,
    badResponseCount: badResponses.length,
    missingCacheHeader,
    cacheStatuses,
    missBytes,
    networkFailureCount: actionableNetworkFailures.length,
    runtimeErrorCount: actionableRuntimeErrors.length,
    ignoredTelemetryFailureCount: networkFailures.length - actionableNetworkFailures.length,
    ignoredTelemetryRuntimeErrorCount: result.runtimeErrors.length - actionableRuntimeErrors.length
  };
}

export function isIgnoredTelemetryEntry(entry) {
  const url = typeof entry === 'string' ? '' : entry?.url || '';
  const message = typeof entry === 'string' ? entry : entry?.message || entry?.errorText || '';
  if (hasIgnoredTelemetryHost(url)) return true;
  const referencedUrls = String(message).match(/https?:\/\/[^\s)'\"]+/g) || [];
  return referencedUrls.some(hasIgnoredTelemetryHost);
}

function hasIgnoredTelemetryHost(value) {
  try {
    return IGNORED_TELEMETRY_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function probeFailureEvidence(result, limit = 10) {
  const failedResponses = result.responses.filter(entry => Number(entry.status) >= 400);
  const networkFailures = result.failures.filter(entry => !entry.canceled);
  return {
    gateway: result.gateway,
    host: result.host,
    route: result.route,
    state: result.state,
    failures: networkFailures.filter(entry => !isIgnoredTelemetryEntry(entry)).slice(0, limit),
    runtimeErrors: result.runtimeErrors.filter(entry => !isIgnoredTelemetryEntry(entry)).slice(0, limit),
    ignoredTelemetryFailures: networkFailures.filter(isIgnoredTelemetryEntry).slice(0, limit),
    ignoredTelemetryRuntimeErrors: result.runtimeErrors.filter(isIgnoredTelemetryEntry).slice(0, limit),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/verify-game-static-delivery.mjs --app-tag TAG --auth-token-file FILE [--check-prerequisites]');
    return;
  }
  const prerequisites = resolveStaticDeliveryPrerequisites(args);
  if (args['check-prerequisites']) {
    console.log(`game_static_delivery_prerequisites=PASS token=readable chrome=available gateways=${prerequisites.gateways.length} game_host=${prerequisites.gameHost} steam_host=${prerequisites.steamHost}`);
    return;
  }
  const {appTag, token, chromePath, timeoutMs, originBudgetBytes, gateways, gameHost, steamHost} = prerequisites;
  const mappedHosts = [...new Set([gameHost, steamHost])];

  const receipts = [];
  for (const gateway of gateways) {
    const probeKey = `${appTag}-${gateway.name}`;
    const coldResult = await runChromeProbe({
      chromePath, gateway, host: gameHost, mappedHosts, route: '/run/newGame', token, probeKey, timeoutMs
    });
    const cold = summarizeProbe(coldResult);
    if (!cold.launched || cold.badResponseCount > 0 || cold.networkFailureCount > 0 || cold.runtimeErrorCount > 0) {
      console.error(`game_static_delivery_evidence=${JSON.stringify(probeFailureEvidence(coldResult))}`);
    }
    assertProbe(cold, { warm: false, steam: false, originBudgetBytes });
    receipts.push({ pass: 'cold', ...cold });

    const warm = summarizeProbe(await runChromeProbe({
      chromePath, gateway, host: gameHost, mappedHosts, route: '/run/newGame', token, probeKey, timeoutMs
    }));
    assertProbe(warm, { warm: true, steam: false, originBudgetBytes });
    receipts.push({ pass: 'warm', ...warm });

    const steam = summarizeProbe(await runChromeProbe({
      chromePath, gateway, host: steamHost, mappedHosts, route: '/run/newGameSteam', token, probeKey, timeoutMs
    }));
    assertProbe(steam, { warm: true, steam: true, originBudgetBytes });
    receipts.push({ pass: 'steam', ...steam });
  }
  for (const receipt of receipts) console.log(JSON.stringify(receipt));
  console.log(`game_static_delivery_validation=PASS probes=${receipts.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const label = process.argv.includes('--check-prerequisites')
      ? 'game_static_delivery_prerequisites'
      : 'game_static_delivery_validation';
    console.error(`${label}=FAIL ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
