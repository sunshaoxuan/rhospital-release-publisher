// Loopback-only browser fixture. No release engine or production configuration is loaded.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../public');
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
    currentStepTitle: '交付镜像', plan: plan(finished ? 'done' : 'running'), logs: ['Browser fixture only']};
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
  if (url.pathname === '/api/history') return json({items: [], total: 0, page: 1, pageCount: 1});
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
server.listen(18787, '127.0.0.1', () => console.log('UI fixture http://127.0.0.1:18787'));
