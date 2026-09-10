const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {isActiveJobStatus} = require('../src/releaseJobStore');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function ui(requestJson) {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const button = {disabled: false};
  const rendered = [];
  const timers = [];
  const context = vm.createContext({
    requestJson, document: {getElementById: () => button},
    activeJobId: '', activeJobTimer: null, activeJobCutoverRefreshed: false,
    executionSubmitting: false, cancelBtn: {},
    setStatus() {}, renderLogs() {}, payload: () => ({}),
    renderJob: job => rendered.push(job.id), isActiveJobStatus,
    refreshProductionImageOnly: async () => {}, loadHistory: async () => {},
    terminalStatusKind: () => '', setTimeout: fn => { timers.push(fn); return timers.length; }
  });
  vm.runInContext(source.slice(source.indexOf('  async function execute()'),
    source.indexOf('  function renderJob(job)')), context);
  return {context, button, rendered, timers};
}

test('double submission sends one POST and keeps execution locked while polling', async () => {
  const response = deferred();
  const poll = deferred();
  const requests = [];
  const h = ui((url) => { requests.push(url); return url === '/api/execute' ? response.promise : poll.promise; });
  const first = h.context.execute();
  await h.context.execute();
  assert.deepEqual(requests, ['/api/execute']);
  assert.equal(h.button.disabled, true);
  response.resolve({id: 'one', status: 'RUNNING'});
  await first;
  await h.context.execute();
  assert.deepEqual(requests, ['/api/execute', '/api/jobs/one']);
  assert.equal(h.button.disabled, true);
  poll.resolve({id: 'one', status: 'RUNNING'});
});

test('submission failure unlocks the button and permits retry', async () => {
  const h = ui(async () => { throw new Error('HTTP 409'); });
  await assert.rejects(h.context.execute(), /409/);
  assert.equal(h.button.disabled, false);
  assert.equal(h.context.executionSubmitting, false);
  assert.equal(h.context.activeJobId, '');
});

for (const staleStatus of ['RUNNING', 'EXECUTED']) {
  test(`late ${staleStatus} response cannot repaint or reschedule an old task`, async () => {
    const response = deferred();
    const h = ui(() => response.promise);
    h.context.activeJobId = 'old';
    const request = h.context.pollJob('old');
    h.context.activeJobId = 'new';
    response.resolve({id: 'old', status: staleStatus});
    await request;
    assert.deepEqual(h.rendered, []);
    assert.deepEqual(h.timers, []);
    assert.equal(h.context.activeJobId, 'new');
    await h.context.pollJob('old');
    assert.deepEqual(h.rendered, []);
  });
}

test('transient poll failure retains the task and retries successfully', async () => {
  let calls = 0;
  const h = ui(async () => {
    if (++calls === 1) throw new Error('offline');
    return {id: 'one', status: 'EXECUTED'};
  });
  h.context.activeJobId = 'one';
  await h.context.pollJob('one');
  assert.equal(h.context.activeJobId, 'one');
  assert.equal(h.timers.length, 1);
  await h.timers[0]();
  assert.deepEqual(h.rendered, ['one']);
  assert.equal(h.context.activeJobId, '');
  assert.equal(h.button.disabled, false);
});

test('terminal history failure still releases the execution lock', async () => {
  const h = ui(async () => ({id: 'one', status: 'EXECUTED'}));
  h.context.activeJobId = 'one';
  h.context.loadHistory = async () => { throw new Error('history unavailable'); };
  await assert.rejects(h.context.pollJob('one'), /history unavailable/);
  assert.equal(h.context.activeJobId, '');
  assert.equal(h.button.disabled, false);
});

function serverHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  let executions = 0;
  const jobs = new Map();
  const jobControllers = new Map();
  const context = vm.createContext({
    jobs, jobControllers, AbortController,
    hasActivePublisherJobs: () => [...jobs.values()].some(job => isActiveJobStatus(job.status)),
    persistJobs() {}, pruneJobs() {}, runExecutionJobInIsolatedWorktree() { executions++; }
  });
  vm.runInContext(source.slice(source.indexOf('function createExecutionJob(body)'),
    source.indexOf('async function runExecutionJobInIsolatedWorktree')), context);
  return {context, jobs, jobControllers, executions: () => executions};
}

for (const status of ['RUNNING', 'CANCELLING', 'RECOVERING']) {
  for (const releaseTarget of ['game', 'forum']) {
    test(`${status} blocks another ${releaseTarget} execution before any work starts`, () => {
      const h = serverHarness();
      h.jobs.set('existing', {status});
      assert.throws(() => h.context.createExecutionJob({releaseTarget}),
        error => error.statusCode === 409 && error.code === 'PUBLISHER_JOB_ACTIVE');
      assert.equal(h.jobs.size, 1);
      assert.equal(h.executions(), 0);
    });
  }
}

test('finished execution stays locked through cleanup, then accepts exactly one new job', () => {
  const h = serverHarness();
  h.jobs.set('finished', {status: 'EXECUTED'});
  h.jobControllers.set('finished', {});
  assert.throws(() => h.context.createExecutionJob({}), error => error.statusCode === 409);
  h.jobControllers.clear();
  const job = h.context.createExecutionJob({});
  assert.equal(job.status, 'RUNNING');
  assert.equal(h.executions(), 1);
  assert.throws(() => h.context.createExecutionJob({}), error => error.statusCode === 409);
  assert.equal(h.executions(), 1);
});
