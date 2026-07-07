const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_RUN_CONFIG,
  DEFAULT_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  readConfig,
  createPlan,
  saveTag,
  executePlan,
  proposeNextTag
} = require('./src/releasePublisherCore');

const projectRoot = defaultProjectRoot();
const publicRoot = path.join(__dirname, 'public');
const port = Number(process.env.RELEASE_PUBLISHER_PORT || 8787);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' && req.method === 'GET') {
      return sendFile(res, path.join(publicRoot, 'index.html'));
    }
    if (req.url.startsWith('/static/') && req.method === 'GET') {
      const filePath = path.resolve(publicRoot, req.url.replace('/static/', ''));
      if (!filePath.startsWith(publicRoot + path.sep)) {
        return sendJson(res, 403, {message: '路径越界'});
      }
      return sendFile(res, filePath);
    }
    if (req.url === '/api/config' && req.method === 'GET') {
      const config = readConfig(projectRoot, DEFAULT_RUN_CONFIG);
      return sendJson(res, 200, {
        ...config,
        suggestedTag: proposeNextTag(config.appTag),
        remoteSshTarget: process.env.RELEASE_PUBLISHER_SSH_TARGET
          || process.env.RELEASE_PUBLISHER_DOCKER_CONTEXT
          || config.serverName,
        remoteComposeDir: process.env.RELEASE_PUBLISHER_REMOTE_COMPOSE_DIR || DEFAULT_REMOTE_COMPOSE_DIR,
        executionEnabled: process.env.RELEASE_PUBLISHER_ALLOW_EXECUTE === 'true'
      });
    }
    if (req.url === '/api/plan' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, createPlan(projectRoot, body));
    }
    if (req.url === '/api/save-tag' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, saveTag(projectRoot, body));
    }
    if (req.url === '/api/execute' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, await executePlan(projectRoot, body));
    }
    return sendJson(res, 404, {message: 'Not found'});
  } catch (error) {
    return sendJson(res, 400, {message: error.message});
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Release publisher is running at http://127.0.0.1:${port}`);
  console.log(`Hospital project root: ${projectRoot}`);
  console.log('Dry run default: true');
});

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, {message: 'File not found'});
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {'Content-Type': contentTypes[ext] || 'application/octet-stream'});
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}
