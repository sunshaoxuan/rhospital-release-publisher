const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  compactPersistedJob,
  isActiveJobStatus,
  needsMeelokRecovery,
  publisherActivity,
  selectPersistedJobs
} = require('../src/releaseJobStore');

test('candidate activity includes game/forum active states and terminal-job cleanup', () => {
  assert.deepEqual(publisherActivity([], 0), {job: null, busy: false});
  for (const status of ['RUNNING', 'CANCELLING', 'RECOVERING']) {
    for (const releaseTarget of ['game', 'forum']) {
      const job = {status, releaseTarget};
      assert.deepEqual(publisherActivity([job], 0), {job, busy: true});
    }
  }
  const terminal = {status: 'EXECUTED'};
  assert.deepEqual(publisherActivity([terminal], 1), {job: null, busy: true});
  assert.deepEqual(publisherActivity([terminal], 0), {job: null, busy: false});
});

test('active endpoint reports cleanup occupancy and preserves the existing job field', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /sendJson\(res, 200, publisherActivity\(jobs.values\(\), jobControllers.size\)\)/);
});

test('persists only running and cancelling jobs', () => {
  const jobs = [
    {id: 'dry-run', status: 'DRY_RUN'},
    {id: 'executed', status: 'EXECUTED'},
    {id: 'error', status: 'ERROR'},
    {id: 'interrupted', status: 'INTERRUPTED'},
    {id: 'running', status: 'RUNNING'},
    {id: 'cancelling', status: 'CANCELLING'},
    {id: 'recovering', status: 'RECOVERING'}
  ];

  assert.deepEqual(selectPersistedJobs(jobs).map(job => job.id), ['running', 'cancelling', 'recovering']);
});

test('limits persisted active jobs after filtering terminal jobs', () => {
  const jobs = [
    {id: 'old-running', status: 'RUNNING'},
    {id: 'terminal', status: 'EXECUTED'},
    {id: 'new-running', status: 'RUNNING'}
  ];

  assert.deepEqual(selectPersistedJobs(jobs, 1).map(job => job.id), ['new-running']);
  assert.equal(isActiveJobStatus('RUNNING'), true);
  assert.equal(isActiveJobStatus('CANCELLING'), true);
  assert.equal(isActiveJobStatus('RECOVERING'), true);
  assert.equal(isActiveJobStatus('INTERRUPTED'), false);
});

test('bounds persisted active job logs without changing the in-memory job', () => {
  const hugeLine = 'x'.repeat(12000);
  const job = {
    id: 'running',
    status: 'RUNNING',
    logs: Array.from({length: 260}, (_, index) => index === 259 ? hugeLine : `job-${index}`),
    plan: {
      steps: [{
        key: 'verify',
        logs: Array.from({length: 100}, (_, index) => index === 99 ? hugeLine : `step-${index}`)
      }]
    }
  };

  const compacted = compactPersistedJob(job);

  assert.equal(compacted.logs.length, 200);
  assert.equal(compacted.plan.steps[0].logs.length, 80);
  assert.match(compacted.logs.at(-1), /TRUNCATED persisted log line/);
  assert.match(compacted.plan.steps[0].logs.at(-1), /TRUNCATED persisted log line/);
  assert.equal(job.logs.length, 260);
  assert.equal(job.logs.at(-1).length, 12000);
});

test('server recovers only active stored jobs and records an interruption once', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /selectPersistedJobs\(jobs\.values\(\), 50\)/);
  assert.match(server, /schedulePersistJobs\(\)/);
  assert.match(server, /if \(!isActiveJobStatus\(item\.status\)\) \{\s*continue;\s*\}/);
  assert.match(server, /const job = markInterruptedJob\(item, '服务重启时发现任务未结束'\);/);
  assert.match(server, /appendInterruptedJobHistory\(job\);/);
});

test('interrupted game jobs restore Meelok only after the pause boundary was entered', () => {
  const job = {plan: {releaseTarget: 'game', steps: [
    {key: 'pause-meelok-services', status: 'pending'},
    {key: 'restore-meelok-services', status: 'pending'}
  ]}};
  assert.equal(needsMeelokRecovery(job), false);
  job.plan.steps[0].status = 'running';
  assert.equal(needsMeelokRecovery(job), true);
  job.plan.steps[0].status = 'done';
  assert.equal(needsMeelokRecovery(job), true);
  job.plan.steps[1].status = 'done';
  assert.equal(needsMeelokRecovery(job), false);
  job.plan.releaseTarget = 'forum';
  job.plan.steps[1].status = 'pending';
  assert.equal(needsMeelokRecovery(job), false);
});

test('publisher restart Meelok restoration never overwrites the game interruption outcome', async () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const source = server.slice(server.indexOf('async function recoverInterruptedMeelok('),
    server.indexOf('function interruptRunningJobs('));
  for (const failure of [false, true]) {
    for (const status of ['INTERRUPTED', 'RECOVERY_REQUIRED']) {
      const history = [];
      const context = vm.createContext({projectRoot: 'fixture', process: {env: {}},
        restoreMeelokAfterControlledExit: async (root, job, env, options) => {
          options.onProgress({status: 'RECOVERING'});
          if (failure) throw new Error('Meelok unavailable fixture');
        }, persistJobs() {}, appendInterruptedJobHistory(job) { history.push(job.status); }});
      vm.runInContext(source, context);
      const job = {status: 'RECOVERING', logs: []};
      await context.recoverInterruptedMeelok(job, status);
      assert.equal(job.status, status);
      assert.deepEqual(history, [status]);
      if (failure) assert.match(job.logs.join('\n'), /WARNING: Meelok/);
    }
  }
});
