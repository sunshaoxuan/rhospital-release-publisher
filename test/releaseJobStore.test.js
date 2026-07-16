const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
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
    {id: 'cancelling', status: 'CANCELLING'}
  ];

  assert.deepEqual(selectPersistedJobs(jobs).map(job => job.id), ['running', 'cancelling']);
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
  assert.equal(isActiveJobStatus('INTERRUPTED'), false);
});

test('server recovers only active stored jobs and records an interruption once', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /selectPersistedJobs\(jobs\.values\(\), 50\)/);
  assert.match(server, /if \(!isActiveJobStatus\(item\.status\)\) \{\s*continue;\s*\}/);
  assert.match(server, /const job = markInterruptedJob\(item, '服务重启时发现任务未结束'\);/);
  assert.match(server, /appendInterruptedJobHistory\(job\);/);
});
