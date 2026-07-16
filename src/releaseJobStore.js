const ACTIVE_JOB_STATUSES = new Set(['RUNNING', 'CANCELLING']);

function isActiveJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(String(status || ''));
}

function selectPersistedJobs(items, limit = 50) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  return Array.from(items || [])
    .filter(job => job && isActiveJobStatus(job.status))
    .slice(-safeLimit);
}

module.exports = {
  isActiveJobStatus,
  selectPersistedJobs
};
