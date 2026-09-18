// Loopback-only browser fixture. No release engine or production configuration is loaded.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../public');
const {buildReleaseDiagnostics} = require('../../src/releaseDiagnostics');
const diagnosticsMode = process.env.DIAGNOSTICS_FIXTURE === '1';
const diagnosticCases = [
  ['warning', 'EXECUTED', [{key: 'cleanup-game-release-containers', title: '清理历史容器', status: 'done', logs: ['WARNING: cleanup failed']}]],
  ['held', 'RECOVERY_REQUIRED', [{key: 'commit-game-cutover', title: '新版本健康接管', status: 'done'},
    {key: 'verify-game-static-delivery', title: '静态资源交付校验', status: 'failed', logs: ['ERROR: MIME mismatch']},
    {key: 'game-fatal-rollback-decision', title: '致命故障复核', status: 'done', logs: ['fatal_rollback_decision=HOLD_TARGET']}]],
  ['rollback-failed', 'RECOVERY_REQUIRED', [{key: 'deploy-stack', title: '部署目标版本', status: 'failed'},
    {key: 'game-rollback-command', title: '回滚旧版本', status: 'failed'}]],
  ['rolled-back', 'ROLLED_BACK', [{key: 'deploy-stack', title: '部署目标版本', status: 'failed'},
    {key: 'game-rollback-command', title: '回滚旧版本', status: 'done'}]],
  ['before-deploy', 'ERROR', [{key: 'apply-database-migrations', title: '数据库迁移', status: 'failed'}]]
].map(([id, status, steps]) => ({id, status, imageTag: `UI fixture: ${id}`, stepSummary: steps,
  diagnostics: buildReleaseDiagnostics({status, stepSummary: steps, releaseTarget: 'game'}, 'retained_history')}));
let executions = 0;
let polls = 0;
let finished = false;
const config = {releaseTarget: 'game', appTag: 'ui-test', suggestedTag: 'ui-test',
  projectRoot: 'Browser regression fixture', imageTag: 'hospital-backend:ui-test'};
function plan(status = 'pending') {
  return {config, imageTag: config.imageTag, steps: [
    {key: 'git-fetch', title: '准备发布源', status: status === 'pending' ? status : 'done'},
    {key: 'publish-image', title: '交付镜像', status}
  ]};
}
function job() {
  return {id: 'browser-test', status: finished ? 'EXECUTED' : 'RUNNING',
    currentStepTitle: '交付镜像', plan: plan(finished ? 'done' : 'running'), logs: ['Browser fixture only'],
    diagnostics: diagnosticsMode && finished ? diagnosticCases[0].diagnostics : null};
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (value, status = 200) => {
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/__test/status') return json({executions, polls, finished});
  if (url.pathname === '/__test/finish' && req.method === 'POST') {
    finished = true; return json({finished});
  }
  if (url.pathname === '/api/execute') {
    executions++; finished = false;
    return setTimeout(() => json(job(), 202), 500);
  }
  if (url.pathname === '/api/jobs/browser-test') { polls++; return json(job()); }
  if (url.pathname === '/api/config') return json(config);
  if (url.pathname === '/api/plan') return json(plan());
  if (url.pathname === '/api/changes') return json({});
  if (url.pathname === '/api/history') return json({items: diagnosticsMode ? diagnosticCases : [], total: diagnosticsMode ? diagnosticCases.length : 0, page: 1, pageCount: 1});
  if (url.pathname.startsWith('/api/history/') && url.pathname.endsWith('/diagnose') && req.method === 'POST') {
    const entry = diagnosticCases.find(item => url.pathname === `/api/history/${item.id}/diagnose`);
    if (!entry) return json({message: 'Missing fixture'}, 404);
    entry.diagnostics.semantic = {status: 'UNAVAILABLE', code: 'TIMEOUT', reason: '诊断请求超时。'};
    return json(entry.diagnostics);
  }
  if (url.pathname === '/api/git/branches') return json({branches: [{name: 'master'}]});
  if (url.pathname === '/api/git/commits') return json({commits: []});
  if (url.pathname === '/api/remote-tag') return json({resolved: true, imageTag: config.imageTag, appTag: 'ui-test'});
  if (url.pathname === '/api/version') return json({status: 'UP_TO_DATE', runtimeVersion: 'UI regression fixture', statusLabel: '隔离测试环境'});
  const files = {'/': ['index.html', 'text/html'], '/static/app.js': ['app.js', 'application/javascript'],
    '/static/styles.css': ['styles.css', 'text/css']};
  const file = files[url.pathname];
  if (!file) return json({message: 'Not found'}, 404);
  res.writeHead(200, {'Content-Type': file[1]});
  res.end(fs.readFileSync(path.join(root, file[0])));
});
const port = Number(process.env.UI_FIXTURE_PORT || 18787);
server.listen(port, '127.0.0.1', () => console.log(`UI fixture http://127.0.0.1:${port}`));
