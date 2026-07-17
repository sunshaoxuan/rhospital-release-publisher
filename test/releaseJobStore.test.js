const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  compactPersistedJob,
  isActiveJobStatus,
  selectPersistedJobs
} = require('../src/releaseJobStore');

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
