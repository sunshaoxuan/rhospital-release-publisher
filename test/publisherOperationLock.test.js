const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {acquireOperationLock, releaseOperationLock, assertNoPublisherUpdate} = require('../src/publisherOperationLock');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-operation-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, lock: path.join(root, '.service', 'publisher-operation.lock')};
}

test('job wins update race and keeps its lease through async completion', async t => {
  const {lock} = fixture(t);
  let finish;
  const work = new Promise(resolve => { finish = resolve; });
  const lease = acquireOperationLock(lock, 'job');
  const running = (async () => { try { await work; } finally { lease.release(); } })();
  assert.throws(() => acquireOperationLock(lock, 'update'), {code: 'PUBLISHER_OPERATION_LOCKED'});
  assertNoPublisherUpdate(lock);
  assert.ok(fs.existsSync(lock));
  finish(); await running;
  acquireOperationLock(lock, 'update').release();
});

test('update wins race; plan gate and job acquisition fail until release', t => {
  const {lock} = fixture(t);
  const update = acquireOperationLock(lock, 'update');
  assert.throws(() => assertNoPublisherUpdate(lock), {code: 'PUBLISHER_UPDATE_PENDING'});
  assert.throws(() => acquireOperationLock(lock, 'job'), {code: 'PUBLISHER_OPERATION_LOCKED'});
  update.release();
  assertNoPublisherUpdate(lock);
  acquireOperationLock(lock, 'job').release();
});

test('failed update releases only its own lock; unknown ownership is retained', t => {
  const {lock} = fixture(t);
  const lease = acquireOperationLock(lock, 'update');
  assert.throws(() => { try { throw new Error('prepare failed'); } finally { lease.release(); } }, /prepare failed/);
  const second = acquireOperationLock(lock, 'update');
  assert.throws(() => releaseOperationLock(lock, '00000000-0000-0000-0000-000000000000'), /ownership changed/);
  assert.ok(fs.existsSync(lock));
  second.release();
  fs.mkdirSync(lock);
  assert.throws(() => assertNoPublisherUpdate(lock), {code: 'PUBLISHER_UPDATE_PENDING'});
  assert.throws(() => acquireOperationLock(lock, 'update'), {code: 'PUBLISHER_OPERATION_LOCKED'});
});

test('actual server job registration holds lease; startup failure releases without dispatch', t => {
  const {lock} = fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const fn = source.slice(source.indexOf('function createExecutionJob('), source.indexOf('async function runExecutionJobInIsolatedWorktree('));
  let dispatched = 0;
  let lease;
  let persistFailure = false;
  const context = vm.createContext({
    acquireOperationLock, publisherOperationLock: lock, hasActivePublisherJobs: () => false,
    jobs: new Map(), jobControllers: new Map(), AbortController, Date, Math,
    persistJobs: () => { if (persistFailure) throw new Error('disk full'); }, pruneJobs: () => {},
    runExecutionJobInIsolatedWorktree: async (...args) => { dispatched++; lease = args[4]; }, console
  });
  vm.runInContext(fn, context);
  const update = acquireOperationLock(lock, 'update');
  assert.throws(() => context.createExecutionJob({}), {code: 'PUBLISHER_OPERATION_LOCKED'});
  assert.equal(dispatched, 0);
  update.release();
  persistFailure = true;
  assert.throws(() => context.createExecutionJob({}), /disk full/);
  assert.equal(context.jobs.size, 0);
  assert.equal(context.jobControllers.size, 0);
  acquireOperationLock(lock, 'update').release();
  persistFailure = false;
  context.createExecutionJob({});
  assert.equal(dispatched, 1);
  assert.throws(() => acquireOperationLock(lock, 'update'), {code: 'PUBLISHER_OPERATION_LOCKED'});
  lease.release();
});

test('terminal job still blocks automatic restart until its controller cleanup finishes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const fn = source.slice(source.indexOf('function hasActivePublisherJobs('), source.indexOf('function assertPublisherActionReady('));
  const context = vm.createContext({jobs: new Map([['old', {status: 'EXECUTED'}]]), jobControllers: new Map([['old', {}]]), isActiveJobStatus: status => status === 'RUNNING'});
  vm.runInContext(fn, context);
  assert.equal(context.hasActivePublisherJobs(), true);
  context.jobControllers.clear();
  assert.equal(context.hasActivePublisherJobs(), false);
});

test('failed execution and diagnostic finalization release lease and controller', async t => {
  const {lock} = fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const fn = source.slice(source.indexOf('async function runExecutionJobInIsolatedWorktree('), source.indexOf('function cancelExecutionJob('));
  const lease = acquireOperationLock(lock, 'job');
  const context = vm.createContext({
    createReleaseWorktree: () => '', projectRoot: 'isolated', publisherRepositoryRoot: 'isolated',
    persistJobs() {}, executePlan: async () => { throw new Error('execution failed'); },
    process: {env: {}}, buildReleaseDiagnostics: () => { throw new Error('diagnostic failed'); },
    jobControllers: new Map([['fixture', {}]]), Date
  });
  vm.runInContext(fn, context);
  await assert.rejects(context.runExecutionJobInIsolatedWorktree({id: 'fixture', logs: []}, {}, {}, 'fixture', lease), /diagnostic failed/);
  assert.equal(context.jobControllers.size, 0);
  acquireOperationLock(lock, 'update').release();
});
