const ACTIVE_JOB_STATUSES = new Set(['RUNNING', 'CANCELLING', 'RECOVERING']);
const MAX_JOB_LOG_LINES = 200;
const MAX_STEP_LOG_LINES = 80;
const MAX_LOG_LINE_LENGTH = 4000;

function isActiveJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(String(status || ''));
}

function selectPersistedJobs(items, limit = 50) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  return Array.from(items || [])
    .filter(job => job && isActiveJobStatus(job.status))
    .slice(-safeLimit)
    .map(compactPersistedJob);
}

function compactPersistedJob(job) {
  return {
    ...job,
    logs: compactLogs(job.logs, MAX_JOB_LOG_LINES),
    plan: job.plan ? {
      ...job.plan,
      steps: (job.plan.steps || []).map(step => ({
        ...step,
        logs: compactLogs(step.logs, MAX_STEP_LOG_LINES)
      }))
    } : job.plan
  };
}

function compactLogs(logs, limit) {
  return Array.from(logs || [])
    .slice(-limit)
    .map(line => {
      const value = String(line || '');
      return value.length <= MAX_LOG_LINE_LENGTH
        ? value
        : `${value.slice(0, MAX_LOG_LINE_LENGTH)}\n[TRUNCATED persisted log line]`;
    });
}

module.exports = {
  compactPersistedJob,
  isActiveJobStatus,
  selectPersistedJobs
};
