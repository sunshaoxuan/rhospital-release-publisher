import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_GATEWAYS = [
  { name: 'riven', ip: '45.94.40.77' },
  { name: 'vmiss', ip: '64.83.37.55' }
];
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_CDP_TIMEOUT_MS = 15000;
const DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES = 1;
const DEFAULT_ORIGIN_BUDGET_BYTES = 240 * 1024 * 1024;
const MINIMUM_TOKEN_VALIDITY_MS = 2 * 60 * 60 * 1000;
const IGNORED_TELEMETRY_HOSTS = new Set(['bam.nr-data.net']);
const BROWSER_INFRASTRUCTURE_ERROR_PATTERN = /(?:Framebuffer (?:Unsupported|Incomplete)|WebGL context|CDP .* timed out|Chrome debugging|DevTools|target closed|session closed|socket closed|browser disconnected|GPU process|renderer process)/i;

export class BrowserInfrastructureError extends Error {
  constructor(message, code = 'BROWSER_INFRASTRUCTURE_FAILURE') {
    super(message);
    this.name = 'BrowserInfrastructureError';
    this.code = code;
  }
}

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

function nonNegativeInteger(value, label) {
  const number = positiveNumber(value, label, {allowZero: true});
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} must be a non-negative integer`);
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
  const cdpTimeoutMs = positiveNumber(
    args['cdp-timeout-ms'] || env.RHOSPITAL_RELEASE_CDP_TIMEOUT_MS || DEFAULT_CDP_TIMEOUT_MS,
    'CDP timeout');
  const browserInfrastructureRetries = nonNegativeInteger(
    args['browser-infrastructure-retries']
      ?? env.RHOSPITAL_RELEASE_BROWSER_INFRASTRUCTURE_RETRIES
      ?? DEFAULT_BROWSER_INFRASTRUCTURE_RETRIES,
    'Browser infrastructure retries');
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
  return {
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
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(
  filePath,
  timeoutMs = 15000,
  child,
  browserStderr = () => '',
  browserSpawnError = () => null
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    if (browserSpawnError()) {
      throw new BrowserInfrastructureError(
        `Chrome failed to start: ${browserSpawnError().message}`,
        'CHROME_SPAWN_FAILURE');
    }
    if (child && child.exitCode !== null) {
      throw new BrowserInfrastructureError(
        `Chrome exited before DevTools became ready, code=${child.exitCode}${browserDiagnosticSuffix(browserStderr())}`,
        'CHROME_EARLY_EXIT');
    }
    await delay(100);
  }
  throw new BrowserInfrastructureError(
    `Timed out waiting for Chrome debugging file after ${timeoutMs}ms${browserDiagnosticSuffix(browserStderr())}`,
    'CHROME_STARTUP_TIMEOUT');
}

function requestJson(url, method = 'GET', timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new BrowserInfrastructureError(
            `Chrome debugging request failed: ${response.statusCode}`,
            'CHROME_DEBUGGING_HTTP_FAILURE'));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new BrowserInfrastructureError(
            `Chrome debugging response was invalid JSON: ${error.message}`,
            'CHROME_DEBUGGING_INVALID_JSON'));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new BrowserInfrastructureError(
      `Chrome debugging request timed out after ${timeoutMs}ms`,
      'CHROME_DEBUGGING_TIMEOUT')));
    request.on('error', error => reject(error instanceof BrowserInfrastructureError
      ? error
      : new BrowserInfrastructureError(`Chrome debugging request failed: ${error.message}`, 'CHROME_DEBUGGING_IO')));
    request.end();
  });
}

export class CdpClient {
  constructor(webSocketUrl, {requestTimeoutMs = DEFAULT_CDP_TIMEOUT_MS, webSocketFactory} = {}) {
    this.socket = webSocketFactory ? webSocketFactory(webSocketUrl) : new WebSocket(webSocketUrl);
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket.addEventListener('message', event => this.handleMessage(event.data));
    this.socket.addEventListener('close', () => this.rejectPending(
      new BrowserInfrastructureError('CDP socket closed', 'CDP_SOCKET_CLOSED')));
    this.socket.addEventListener('error', () => this.rejectPending(
      new BrowserInfrastructureError('CDP socket failed', 'CDP_SOCKET_ERROR')));
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new BrowserInfrastructureError(
        `CDP socket open timed out after ${this.requestTimeoutMs}ms`,
        'CDP_OPEN_TIMEOUT')), this.requestTimeoutMs);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new BrowserInfrastructureError('CDP socket failed while opening', 'CDP_OPEN_ERROR'));
      }, { once: true });
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
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

  send(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BrowserInfrastructureError(
          `CDP ${method} timed out after ${timeoutMs}ms`,
          'CDP_REQUEST_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BrowserInfrastructureError(`CDP ${method} send failed: ${error.message}`, 'CDP_SEND_FAILURE'));
      }
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending(new BrowserInfrastructureError('CDP client closed', 'CDP_CLIENT_CLOSED'));
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

export async function evaluate(client, expression) {
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

function browserDiagnosticSuffix(value) {
  const diagnostic = String(value || '').trim().replace(/\s+/g, ' ').slice(-500);
  return diagnostic ? `, stderr=${diagnostic}` : '';
}

function chromeArguments(userDataDir, extraArguments = []) {
  return [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=DnsOverHttps',
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    ...extraArguments,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ];
}

async function stopChrome(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    delay(timeoutMs)
  ]);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
  } else {
    try { child.kill('SIGKILL'); } catch {}
  }
}

export async function useChromeTarget({chromePath, extraArguments = [], startupTimeoutMs, cdpTimeoutMs}, action) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-release-smoke-'));
  const debugFile = path.join(userDataDir, 'DevToolsActivePort');
  const stderr = [];
  let spawnError = null;
  const child = spawn(chromePath, chromeArguments(userDataDir, extraArguments), {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  child.once('error', error => { spawnError = error; });
  child.stderr?.on('data', chunk => stderr.push(chunk.toString()));
  const browserStderr = () => stderr.join('').slice(-2000);

  let client;
  try {
    if (spawnError) {
      throw new BrowserInfrastructureError(`Chrome failed to start: ${spawnError.message}`, 'CHROME_SPAWN_FAILURE');
    }
    await waitForFile(debugFile, startupTimeoutMs, child, browserStderr, () => spawnError);
    const [port] = fs.readFileSync(debugFile, 'utf8').trim().split(/\r?\n/);
    const target = await requestJson(`http://127.0.0.1:${port}/json/new?about%3Ablank`, 'PUT', cdpTimeoutMs);
    client = new CdpClient(target.webSocketDebuggerUrl, {requestTimeoutMs: cdpTimeoutMs});
    await client.open();
    return await action(client);
  } catch (error) {
    if (error instanceof BrowserInfrastructureError) {
      error.message += browserDiagnosticSuffix(browserStderr());
    }
    throw error;
  } finally {
    try { client?.close(); } catch {}
    await stopChrome(child);
    fs.rmSync(userDataDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
}

export function assertBrowserCapability(capability) {
  if (!capability?.context) {
    throw new BrowserInfrastructureError('WebGL context is unavailable', 'WEBGL_CONTEXT_UNAVAILABLE');
  }
  if (!capability.complete) {
    throw new BrowserInfrastructureError(
      `Framebuffer ${capability.statusName || capability.status || 'Incomplete'}, glError=${capability.error}`,
      'WEBGL_FRAMEBUFFER_INCOMPLETE');
  }
  if (Number(capability.error || 0) !== 0) {
    throw new BrowserInfrastructureError(
      `WebGL capability probe returned glError=${capability.error}`,
      'WEBGL_ERROR');
  }
  return capability;
}

export async function runBrowserCapabilityProbe({chromePath, cdpTimeoutMs = DEFAULT_CDP_TIMEOUT_MS}) {
  const capability = await useChromeTarget({
    chromePath,
    startupTimeoutMs: cdpTimeoutMs,
    cdpTimeoutMs
  }, client => evaluate(client, `(() => {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(1280 * dpr));
    canvas.height = Math.max(1, Math.round(720 * dpr));
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { context: false, viewport: [innerWidth, innerHeight], devicePixelRatio: dpr };
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      context: true,
      version: gl.getParameter(gl.VERSION),
      renderer: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: [innerWidth, innerHeight],
      devicePixelRatio: dpr,
      texture: [canvas.width, canvas.height],
      status,
      statusName: status === gl.FRAMEBUFFER_COMPLETE ? 'Complete' : String(status),
      complete: status === gl.FRAMEBUFFER_COMPLETE,
      error: gl.getError()
    };
  })()`));
  return assertBrowserCapability(capability);
}

export async function runChromeProbe({
  chromePath,
  gateway,
  host,
  mappedHosts,
  route,
  token,
  probeKey,
  timeoutMs,
  cdpTimeoutMs = DEFAULT_CDP_TIMEOUT_MS
}) {
  const hostRules = [
    ...new Set([...mappedHosts, 'hero-hospital.icu'])
  ].map(mappedHost => `MAP ${mappedHost} ${gateway.ip}`).concat([
    'EXCLUDE localhost'
  ]).join(',');
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
        try {
          await client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' });
        } catch (failError) {
          failures.push({
            requestId: params.requestId,
            url: params.request?.url || '',
            errorText: `Fetch.failRequest failed: ${failError.message}`,
            canceled: false
          });
        }
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
      if (runtimeErrors.some(entry => !isIgnoredTelemetryEntry(entry)
        && BROWSER_INFRASTRUCTURE_ERROR_PATTERN.test(String(entry?.message || entry)))) break;
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
  });
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

function infrastructureErrorMessage(error) {
  return String(error?.message || error || 'browser infrastructure failure').replace(/\s+/g, ' ').slice(0, 500);
}

export function isBrowserInfrastructureFailure({result, error} = {}) {
  if (error instanceof BrowserInfrastructureError || String(error?.code || '').startsWith('CDP_')) return true;
  if (error && BROWSER_INFRASTRUCTURE_ERROR_PATTERN.test(String(error.message || error))) return true;
  if (!result) return false;

  const summary = summarizeProbe(result);
  if (summary.launched || summary.badResponseCount > 0 || summary.networkFailureCount > 0) return false;
  const runtimeErrors = result.runtimeErrors.filter(entry => !isIgnoredTelemetryEntry(entry));
  return runtimeErrors.length > 0
    && runtimeErrors.every(entry => BROWSER_INFRASTRUCTURE_ERROR_PATTERN.test(String(entry?.message || entry)));
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  runStaticDelivery(args).catch(error => {
    if (error.probeResult) {
      console.error(`game_static_delivery_evidence=${JSON.stringify(probeFailureEvidence(error.probeResult))}`);
    }
    const label = process.argv.includes('--check-prerequisites')
      ? 'game_static_delivery_prerequisites'
      : 'game_static_delivery_validation';
    console.error(`${label}=FAIL ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
