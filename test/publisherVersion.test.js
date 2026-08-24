const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {spawn, spawnSync} = require('node:child_process');

const {
  capturePublisherRuntimeVersion,
  getPublisherVersionStatus,
  publisherContentHash,
  assertPublisherActionVersion,
  shouldAutoRestartPublisher
} = require('../src/publisherVersion');

test('reports an exact clean runtime and repository match', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root, {
    now: new Date('2026-07-17T04:00:00.000Z'),
    processId: 1234
  });
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(runtime.version, `0.2.0+${runtime.shortCommit}`);
  assert.equal(result.status, 'UP_TO_DATE');
  assert.equal(result.statusLabel, '执行环境与仓库一致');
  assert.equal(result.runtime.processId, 1234);
  assert.equal(result.runtime.capturedAt, '2026-07-17T04:00:00.000Z');
  assert.equal(result.runtime.contentHash, result.repository.contentHash);
});

test('reports uncommitted repository changes after the runtime snapshot', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);

  fs.appendFileSync(path.join(root, 'public', 'app.js'), 'console.log("changed");\n', 'utf8');
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(result.status, 'UNCOMMITTED_CHANGES');
  assert.equal(result.repository.dirty, true);
  assert.notEqual(result.runtime.contentHash, result.repository.contentHash);
});

test('reports a restart requirement after a newer clean commit', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);

  fs.appendFileSync(path.join(root, 'server.js'), 'module.exports = {};\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'update runtime']);
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(result.status, 'RESTART_REQUIRED');
  assert.equal(result.repository.dirty, false);
  assert.notEqual(result.runtime.commit, result.repository.commit);
  assert.throws(() => assertPublisherActionVersion(result), error => {
    assert.equal(error.code, 'PUBLISHER_RUNTIME_NOT_CURRENT');
    assert.equal(error.statusCode, 409);
    assert.equal(error.versionStatus, 'RESTART_REQUIRED');
    assert.match(error.message, /服务将自动重启/);
    return true;
  });
  assert.equal(shouldAutoRestartPublisher(result, false), true);
  assert.equal(shouldAutoRestartPublisher(result, true), false);
});

test('blocks publisher actions for uncommitted runtime changes without auto restart', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);
  fs.appendFileSync(path.join(root, 'public', 'app.js'), 'console.log("changed");\n', 'utf8');
  const result = getPublisherVersionStatus(root, runtime);

  assert.throws(() => assertPublisherActionVersion(result), error => {
    assert.equal(error.code, 'PUBLISHER_RUNTIME_NOT_CURRENT');
    assert.equal(error.statusCode, 409);
    assert.equal(error.versionStatus, 'UNCOMMITTED_CHANGES');
    assert.match(error.message, /发布计划和执行已锁定/);
    return true;
  });
  assert.equal(shouldAutoRestartPublisher(result, false), false);
});

test('accepts publisher actions only when runtime and repository match', () => {
  const root = tempPublisherRepository();
  const runtime = capturePublisherRuntimeVersion(root);
  const result = getPublisherVersionStatus(root, runtime);

  assert.equal(assertPublisherActionVersion(result), result);
  assert.equal(shouldAutoRestartPublisher(result, false), false);
});

test('server gates release planning and execution while monitoring idle restarts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  for (const route of ['/api/changes', '/api/plan', '/api/save-tag', '/api/execute']) {
    const routeIndex = source.indexOf(`pathname === '${route}'`);
    assert.ok(routeIndex >= 0, `${route} route must exist`);
    const routeSource = source.slice(routeIndex, routeIndex + 240);
    assert.match(routeSource, /assertPublisherActionReady\(\)/);
    assert.ok(
      routeSource.indexOf('await readBody(req)') < routeSource.indexOf('assertPublisherActionReady()'),
      `${route} must recheck the publisher version after receiving the request body`
    );
  }
  assert.match(source, /setInterval\(\s*checkPublisherRepositoryVersion/);
  assert.match(source, /shouldAutoRestartPublisher\(versionStatus, hasActivePublisherJobs\(\)\)/);
  assert.match(source, /shouldAutoRestartPublisher\(latestVersionStatus, hasActivePublisherJobs\(\)\)/);
  assert.match(source, /if \(publisherRestartPending\)/);
  assert.match(source, /server\.close\(\(\) => process\.exit\(75\)\)/);
});

test('idle publisher process exits after a clean runtime commit', {timeout: 20000}, async () => {
  const root = tempPublisherServerRepository();
  let child;
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...process.env,
        RELEASE_PUBLISHER_HOST: '127.0.0.1',
        RELEASE_PUBLISHER_PORT: '0',
        RELEASE_PUBLISHER_VERSION_CHECK_INTERVAL_MS: '100',
        RELEASE_PUBLISHER_JOBS_FILE: path.join(root, '.release-jobs.json')
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    await waitForChildOutput(child, /RHospital Release Console is running/, 5000);
    const exitPromise = waitForChildExit(child, 10000);
    fs.appendFileSync(path.join(root, 'public', 'app.js'), 'console.log("new runtime");\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'new runtime']);

    const exit = await exitPromise;
    assert.equal(exit.code, 75);
    assert.match(exit.output, /restarting idle process/);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
    }
    removeTempTree(root);
  }
});

test('restart drain rejects a release request that finishes after the repository changes', {timeout: 20000}, async () => {
  const root = tempPublisherServerRepository();
  let child;
  let slowRequest;
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...process.env,
        RELEASE_PUBLISHER_HOST: '127.0.0.1',
        RELEASE_PUBLISHER_PORT: '0',
        RELEASE_PUBLISHER_VERSION_CHECK_INTERVAL_MS: '100',
        RELEASE_PUBLISHER_JOBS_FILE: path.join(root, '.release-jobs.json')
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const startupOutput = await waitForChildOutput(
      child,
      /RHospital Release Console is running at http:\/\/127\.0\.0\.1:\d+/,
      5000
    );
    const portMatch = startupOutput.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    assert.ok(portMatch, startupOutput);

    slowRequest = openSlowJsonPost(Number(portMatch[1]), '/api/execute');
    await slowRequest.connected;
    await delay(50);
    const exitPromise = waitForChildExit(child, 10000);
    fs.appendFileSync(path.join(root, 'public', 'app.js'), 'console.log("new runtime");\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'new runtime']);
    await delay(750);

    slowRequest.finish();
    const response = await slowRequest.response;
    assert.equal(response.statusCode, 409);
    assert.equal(JSON.parse(response.body).code, 'PUBLISHER_RESTART_PENDING');

    const exit = await exitPromise;
    assert.equal(exit.code, 75);
    assert.match(exit.output, /restarting idle process/);
    const jobsPath = path.join(root, '.release-jobs.json');
    assert.ok(!fs.existsSync(jobsPath) || fs.readFileSync(jobsPath, 'utf8').trim() === '[]');
  } finally {
    if (slowRequest) slowRequest.abort();
    if (child && child.exitCode === null) {
      child.kill();
    }
    removeTempTree(root);
  }
});

test('runtime content hash changes when a displayed asset changes', () => {
  const root = tempPublisherRepository();
  const before = publisherContentHash(root);

  fs.appendFileSync(path.join(root, 'public', 'styles.css'), '.version { color: blue; }\n', 'utf8');

  assert.notEqual(publisherContentHash(root), before);
});

function tempPublisherRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-version-'));
  fs.mkdirSync(path.join(root, 'src'), {recursive: true});
  fs.mkdirSync(path.join(root, 'public'), {recursive: true});
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"publisher","version":"0.2.0"}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'server.js'), 'console.log("server");\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'core.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'app.js'), 'console.log("ui");\n', 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'styles.css'), 'body { color: black; }\n', 'utf8');
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
  return root;
}

function tempPublisherServerRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-auto-restart-'));
  const repositoryRoot = path.join(__dirname, '..');
  for (const relativePath of ['server.js', 'package.json', 'src', 'public']) {
    fs.cpSync(path.join(repositoryRoot, relativePath), path.join(root, relativePath), {recursive: true});
  }
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
  return root;
}

function waitForChildOutput(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error(`child output timeout: ${output}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (pattern.test(output)) {
        finish();
      }
    };
    const onExit = code => finish(new Error(`child exited early with ${code}: ${output}`));
    const finish = error => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      error ? reject(error) : resolve(output);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = chunk => {
      output += chunk.toString();
    };
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`child exit timeout: ${output}`));
    }, timeoutMs);
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({code, signal, output});
    });
  });
}

function openSlowJsonPost(port, pathname) {
  let request;
  let resolveConnected;
  const connected = new Promise(resolve => {
    resolveConnected = resolve;
  });
  const response = new Promise((resolve, reject) => {
    request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '2'
      }
    }, result => {
      let body = '';
      result.setEncoding('utf8');
      result.on('data', chunk => {
        body += chunk;
      });
      result.on('end', () => resolve({statusCode: result.statusCode, body}));
    });
    request.on('error', reject);
    request.on('socket', socket => {
      if (socket.connecting) {
        socket.once('connect', resolveConnected);
      } else {
        resolveConnected();
      }
    });
    request.write('{');
  });
  return {
    connected,
    response,
    finish() {
      request.end('}');
    },
    abort() {
      if (!request.destroyed && !request.writableEnded) request.destroy();
    }
  };
}

function removeTempTree(root) {
  for (let attempt = 0; attempt <= 100; attempt += 1) {
    try {
      fs.rmSync(root, {recursive: true, force: true});
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 100) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function runGit(cwd, args) {
  for (let attempt = 0; attempt <= 40; attempt += 1) {
    const result = spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});
    if (result.status === 0) {
      return result.stdout;
    }
    const message = result.stderr || result.stdout || `git ${args.join(' ')} failed`;
    if (!message.includes('index.lock') || attempt === 40) {
      throw new Error(message);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`git ${args.join(' ')} failed`);
}
