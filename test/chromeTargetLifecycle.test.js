const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');

const verifier = () => import(pathToFileURL(path.resolve(__dirname, '../scripts/verify-game-static-delivery.mjs')).href);

async function fixture(t, overrides = {}) {
  const {useChromeTarget} = await verifier();
  const events = [];
  const child = new EventEmitter();
  Object.assign(child, {pid: 34567, exitCode: null, signalCode: null, stderr: new EventEmitter()});
  child.unref = () => events.push('unref');
  child.stderr.destroy = () => events.push('destroy-stderr');
  child.kill = signal => { events.push(`kill:${signal}`); finish(null, signal); return true; };
  function finish(code = 0, signal = null) {
    child.exitCode = code;
    child.signalCode = signal;
    events.push('chrome-close');
    child.emit('close', code, signal);
  }
  let profile;
  const page = {open: async () => {}, close: () => events.push('page-close')};
  const browser = {
    open: async () => events.push('browser-open'),
    send: async (method, params, timeoutMs) => {
      assert.equal(method, 'Browser.close');
      assert.deepEqual(params, {});
      assert.equal(timeoutMs, 20);
      events.push('browser-close-request');
      finish();
    },
    close: () => events.push('browser-socket-close')
  };
  const dependencies = {
    shutdownTimeoutMs: 20,
    platform: 'win32',
    spawnProcess: (command, args, options) => {
      assert.equal(command, 'owned-chrome');
      assert.equal(options.windowsHide, true);
      profile = args.find(arg => arg.startsWith('--user-data-dir=')).split('=').slice(1).join('=');
      fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '12345\n/devtools/browser/owned-browser\n');
      return child;
    },
    createClient: url => {
      if (url === 'ws://127.0.0.1:12345/devtools/browser/owned-browser') return browser;
      assert.equal(url, 'ws://127.0.0.1:12345/devtools/page/owned-page');
      return page;
    },
    requestTarget: async (url, method) => {
      assert.equal(url, 'http://127.0.0.1:12345/json/new?about%3Ablank');
      assert.equal(method, 'PUT');
      return {webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/owned-page'};
    },
    runFile: (command, args, options, callback) => {
      assert.equal(command, 'taskkill');
      assert.deepEqual(args, ['/PID', '34567', '/T', '/F']);
      assert.deepEqual(options, {windowsHide: true, timeout: 20});
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      events.push('taskkill');
      finish();
      callback(null);
    },
    removeProfile: async (directory, options) => {
      assert.equal(directory, profile);
      assert.ok(events.includes('chrome-close') || !child.pid);
      assert.deepEqual(options, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
      events.push('remove-profile');
      await fs.promises.rm(directory, options);
    },
    ...overrides
  };
  t.after(async () => {
    if (profile) await fs.promises.rm(profile, {recursive: true, force: true});
  });
  return {
    child, page, browser, events, finish, dependencies,
    get profile() { return profile; },
    run: action => useChromeTarget({chromePath: 'owned-chrome', startupTimeoutMs: 20, cdpTimeoutMs: 20}, action, dependencies)
  };
}

test('normal probe closes the owned browser before asynchronous profile removal', async t => {
  const f = await fixture(t);
  const result = {healthy: true};
  assert.equal(await f.run(async client => { assert.equal(client, f.page); return result; }), result);
  assert.deepEqual(f.events, [
    'page-close', 'browser-open', 'browser-close-request', 'chrome-close', 'browser-socket-close', 'remove-profile'
  ]);
  assert.equal(fs.existsSync(f.profile), false);
});

test('action error identity, stack and attached evidence survive successful cleanup', async t => {
  const f = await fixture(t);
  const original = Object.assign(new Error('original probe failure'), {probeResult: {partial: true}});
  const stack = original.stack;
  await assert.rejects(f.run(async () => { throw original; }), error => {
    assert.equal(error, original);
    assert.equal(error.stack, stack);
    assert.equal(error.message, 'original probe failure');
    assert.deepEqual(error.probeResult, {partial: true});
    assert.equal(error.chromeCleanupErrors, undefined);
    return true;
  });
  assert.equal(fs.existsSync(f.profile), false);
});

test('Browser.close socket disconnection is accepted after observed Chrome close', async t => {
  const f = await fixture(t);
  f.browser.send = async () => {
    setTimeout(() => f.finish(), 5);
    throw new Error('CDP socket closed');
  };
  assert.equal(await f.run(async () => 'result'), 'result');
  assert.equal(f.events.includes('taskkill'), false);
  assert.equal(fs.existsSync(f.profile), false);
});

test('unresponsive browser uses the owned Windows tree and awaits close before removal', async t => {
  const f = await fixture(t);
  f.browser.send = async () => { throw new Error('CDP Browser.close timed out'); };
  f.dependencies.runFile = (command, args, options, callback) => {
    assert.equal(command, 'taskkill');
    assert.deepEqual(args, ['/PID', String(f.child.pid), '/T', '/F']);
    assert.deepEqual(options, {windowsHide: true, timeout: 20});
    assert.equal(f.child.exitCode, null);
    assert.equal(f.events.some(event => event.startsWith('kill:')), false);
    f.events.push('taskkill');
    callback(null);
    setTimeout(() => f.finish(), 5);
  };
  assert.equal(await f.run(async () => 'result'), 'result');
  assert.ok(f.events.indexOf('taskkill') < f.events.indexOf('chrome-close'));
  assert.ok(f.events.indexOf('chrome-close') < f.events.indexOf('remove-profile'));
});

test('non-Windows forced termination waits for close and uses only the owned child', async t => {
  const f = await fixture(t, {platform: 'linux'});
  f.browser.send = async () => {};
  await f.run(async () => true);
  assert.ok(f.events.includes('kill:SIGKILL'));
  assert.equal(f.events.includes('taskkill'), false);
  assert.equal(fs.existsSync(f.profile), false);
});

for (const [label, commandError] of [
  ['nonzero taskkill', Object.assign(new Error('taskkill failed'), {code: 1})],
  ['timed out taskkill', Object.assign(new Error('taskkill timed out'), {code: 'ETIMEDOUT'})]
]) {
  test(`${label} is blocking and preserves the completed probe evidence`, async t => {
    const f = await fixture(t);
    f.browser.send = async () => {};
    f.dependencies.runFile = (command, args, options, callback) => callback(commandError);
    const result = {partial: true};
    await assert.rejects(f.run(async () => result), error => {
      assert.equal(error.code, 'CHROME_CLEANUP_FAILURE');
      assert.equal(error.probeResult, result);
      assert.equal(error.chromeCleanupErrors[0].phase, 'shutdown');
      assert.equal(error.errors[0].cause, commandError);
      return true;
    });
    assert.equal(f.events.includes('remove-profile'), false);
    assert.ok(f.events.includes('unref'));
    assert.equal(fs.existsSync(f.profile), true);
  });
}

test('successful tree-stop command without Chrome close fails within the shutdown bound', async t => {
  const f = await fixture(t);
  f.browser.send = async () => {};
  f.dependencies.runFile = (command, args, options, callback) => callback(null);
  await assert.rejects(f.run(async () => true), /Chrome did not close within 20ms/);
  assert.equal(f.events.includes('remove-profile'), false);
});

test('already-closed Chrome is not terminated again', async t => {
  const f = await fixture(t);
  await f.run(async () => { f.finish(null, 'SIGTERM'); return true; });
  assert.deepEqual(f.events, ['chrome-close', 'page-close', 'remove-profile']);
});

test('signal exit still awaits the close event and never targets an exited PID', async t => {
  const f = await fixture(t);
  await f.run(async () => {
    f.child.signalCode = 'SIGTERM';
    setTimeout(() => f.finish(null, 'SIGTERM'), 5);
    return true;
  });
  assert.equal(f.events.includes('taskkill'), false);
  assert.ok(f.events.indexOf('chrome-close') < f.events.indexOf('remove-profile'));
});

test('exit without close fails bounded and retains the profile for recovery', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(async () => { f.child.exitCode = 0; }), /Chrome did not close within 20ms/);
  assert.equal(f.events.includes('taskkill'), false);
  assert.equal(f.events.includes('remove-profile'), false);
});

test('startup timeout terminates the owned tree and retains the startup error', async t => {
  const f = await fixture(t);
  const launch = f.dependencies.spawnProcess;
  f.dependencies.spawnProcess = (...args) => {
    const child = launch(...args);
    fs.unlinkSync(path.join(f.profile, 'DevToolsActivePort'));
    return child;
  };
  await assert.rejects(f.run(async () => assert.fail('action must not start')), {code: 'CHROME_STARTUP_TIMEOUT'});
  assert.ok(f.events.includes('taskkill'));
  assert.equal(fs.existsSync(f.profile), false);
});

test('asynchronous spawn failure cleans the allocated profile without killing a PID', async t => {
  const f = await fixture(t);
  const launch = f.dependencies.spawnProcess;
  f.dependencies.spawnProcess = (...args) => {
    const child = launch(...args);
    fs.unlinkSync(path.join(f.profile, 'DevToolsActivePort'));
    child.pid = undefined;
    process.nextTick(() => { child.emit('error', new Error('ENOENT')); f.finish(-4058); });
    return child;
  };
  await assert.rejects(f.run(async () => assert.fail('action must not start')), {code: 'CHROME_SPAWN_FAILURE'});
  assert.equal(f.events.includes('taskkill'), false);
  assert.equal(fs.existsSync(f.profile), false);
});

test('synchronous spawn failure retains its identity and still removes the profile', async t => {
  const f = await fixture(t);
  const original = new Error('invalid spawn arguments');
  f.dependencies.spawnProcess = () => { throw original; };
  let removed = false;
  f.dependencies.removeProfile = async directory => {
    removed = true;
    await fs.promises.rm(directory, {recursive: true, force: true});
  };
  await assert.rejects(f.run(async () => {}), error => error === original);
  assert.equal(removed, true);
});

for (const phase of ['target', 'connection']) {
  test(`${phase} failure still shuts down Chrome and retains the primary error`, async t => {
    const f = await fixture(t);
    const original = new Error(`${phase} failed`);
    if (phase === 'target') f.dependencies.requestTarget = async () => { throw original; };
    else f.page.open = async () => { throw original; };
    await assert.rejects(f.run(async () => assert.fail('action must not start')), error => error === original);
    assert.ok(f.events.includes('browser-close-request'));
    assert.equal(fs.existsSync(f.profile), false);
  });
}

test('cleanup EPERM preserves the original error, stack and business evidence and blocks retry', async t => {
  const {BrowserInfrastructureError, runValidatedChromeProbe, chromeCleanupEvidence} = await verifier();
  const denied = Object.assign(new Error('profile is locked'), {code: 'EPERM'});
  const f = await fixture(t, {removeProfile: async () => { throw denied; }});
  const original = Object.assign(new BrowserInfrastructureError('CDP Runtime.evaluate timed out', 'CDP_REQUEST_TIMEOUT'), {
    probeResult: {partial: true}
  });
  const stack = original.stack;
  let attempts = 0;
  await assert.rejects(runValidatedChromeProbe({
    probeOptions: {probeKey: 'cleanup-failure'}, validationOptions: {}, infrastructureRetries: 1,
    probeRunner: async () => { attempts += 1; return f.run(async () => { throw original; }); }
  }), error => {
    assert.equal(error, original);
    assert.equal(error.stack, stack);
    assert.equal(error.message, 'CDP Runtime.evaluate timed out');
    assert.deepEqual(error.probeResult, {partial: true});
    assert.deepEqual(chromeCleanupEvidence(error), [{phase: 'profile', code: 'EPERM', message: 'profile is locked'}]);
    return true;
  });
  assert.equal(attempts, 1);
});

test('cleanup-only failure cannot return PASS or retry and retains the action result', async t => {
  const {isBrowserInfrastructureFailure, runValidatedChromeProbe} = await verifier();
  const f = await fixture(t, {removeProfile: async () => { throw new Error('DevTools profile remains locked'); }});
  const result = {partial: true};
  let attempts = 0;
  await assert.rejects(runValidatedChromeProbe({
    probeOptions: {probeKey: 'cleanup-only'}, validationOptions: {}, infrastructureRetries: 1,
    probeRunner: async () => { attempts += 1; return f.run(async () => result); }
  }), error => {
    assert.equal(error.code, 'CHROME_CLEANUP_FAILURE');
    assert.equal(error.probeResult, result);
    assert.equal(isBrowserInfrastructureFailure({error}), false);
    return true;
  });
  assert.equal(attempts, 1);
});

test('shutdown failure cannot replace the primary action error or delete a live profile', async t => {
  const f = await fixture(t);
  f.browser.send = async () => {};
  f.dependencies.runFile = (command, args, options, callback) => callback(new Error('termination denied'));
  const original = new Error('application assertion failed');
  const stack = original.stack;
  await assert.rejects(f.run(async () => { throw original; }), error => {
    assert.equal(error, original);
    assert.equal(error.stack, stack);
    assert.equal(error.chromeCleanupErrors[0].phase, 'shutdown');
    return true;
  });
  assert.equal(f.events.includes('remove-profile'), false);
});

test('browser stderr is retained separately without mutating the original infrastructure error', async t => {
  const {BrowserInfrastructureError} = await verifier();
  const f = await fixture(t);
  const original = new BrowserInfrastructureError('CDP failed');
  const stack = original.stack;
  await assert.rejects(f.run(async () => {
    f.child.stderr.emit('data', Buffer.from('local browser diagnostic'));
    throw original;
  }), error => {
    assert.equal(error, original);
    assert.equal(error.message, 'CDP failed');
    assert.equal(error.stack, stack);
    assert.match(error.chromeDiagnostic, /local browser diagnostic/);
    return true;
  });
});

test('cleanup is awaited without blocking timers before exposing the action result', async t => {
  const f = await fixture(t);
  let released = false;
  f.dependencies.removeProfile = async (directory, options) => {
    assert.deepEqual(options, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    await new Promise(resolve => setTimeout(() => { released = true; resolve(); }, 10));
    await fs.promises.rm(directory, options);
  };
  await f.run(async () => true);
  assert.equal(released, true);
  assert.equal(fs.existsSync(f.profile), false);
});

test('Windows profile cleanup retries a real file lock until its asynchronous release', {
  skip: process.platform !== 'win32', timeout: 20000
}, async t => {
  const f = await fixture(t);
  delete f.dependencies.removeProfile;
  let locker;
  let lockerClosed;
  t.after(async () => {
    if (locker?.exitCode === null) locker.kill();
    if (lockerClosed) await lockerClosed;
  });
  await f.run(async () => {
    const lockedFile = path.join(f.profile, 'locked-file');
    fs.writeFileSync(lockedFile, 'local regression fixture');
    locker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$lock = [System.IO.File]::Open($env:RHOSPITAL_LOCK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); [Console]::WriteLine("LOCKED"); [Console]::Out.Flush(); [Threading.Thread]::Sleep(700); $lock.Dispose()'], {
      windowsHide: true, env: {...process.env, RHOSPITAL_LOCK_FILE: lockedFile}, stdio: ['pipe', 'pipe', 'pipe']
    });
    lockerClosed = new Promise(resolve => locker.once('close', resolve));
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('lock fixture startup timed out')), 5000);
      locker.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('LOCKED')) { clearTimeout(timer); resolve(); }
      });
      locker.once('error', reject);
      locker.once('exit', code => {
        clearTimeout(timer);
        if (!output.includes('LOCKED')) reject(new Error(`lock fixture exited: ${code}`));
      });
    });
    assert.throws(() => fs.unlinkSync(lockedFile), error => ['EBUSY', 'EPERM'].includes(error.code));
    return true;
  });
  await lockerClosed;
  assert.equal(fs.existsSync(f.profile), false);
});
