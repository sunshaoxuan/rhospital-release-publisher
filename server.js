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
  readReleaseHistory,
  readReleaseHistoryPage,
  deleteReleaseHistoryEntry,
  clearReleaseHistory,
  listGitBranches,
  listGitCommits,
  proposeNextTag,
  resolveSshTargetDetails,
  resolveDockerContextDetails,
  resolveIdeaDockerServerDetails,
  resolveDockerCommandTarget
} = require('./src/releasePublisherCore');

const projectRoot = defaultProjectRoot();
const publicRoot = path.join(__dirname, 'public');
const port = Number(process.env.RELEASE_PUBLISHER_PORT || 8787);
const jobs = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = requestUrl.pathname;
    if (pathname === '/' && req.method === 'GET') {
      return sendFile(res, path.join(publicRoot, 'index.html'));
    }
    if (pathname.startsWith('/static/') && req.method === 'GET') {
      const filePath = path.resolve(publicRoot, pathname.replace('/static/', ''));
      if (!filePath.startsWith(publicRoot + path.sep)) {
        return sendJson(res, 403, {message: '路径越界'});
      }
      return sendFile(res, filePath);
    }
    if (pathname === '/api/config' && req.method === 'GET') {
      const config = readConfig(projectRoot, DEFAULT_RUN_CONFIG);
      const remoteSshTarget = process.env.RELEASE_PUBLISHER_SSH_TARGET
        || process.env.RELEASE_PUBLISHER_DOCKER_CONTEXT
        || config.serverName;
      const dockerServerName = process.env.RELEASE_PUBLISHER_DOCKER_CONTEXT || config.serverName;
      const dockerContextResolution = resolveDockerContextDetails(dockerServerName, process.env);
      const ideaDockerServerResolution = resolveIdeaDockerServerDetails(dockerServerName, process.env);
      return sendJson(res, 200, {
        ...config,
        suggestedTag: proposeNextTag(config.appTag),
        remoteSshTarget,
        remoteComposeDir: process.env.RELEASE_PUBLISHER_REMOTE_COMPOSE_DIR || DEFAULT_REMOTE_COMPOSE_DIR,
        sshResolution: resolveSshTargetDetails(remoteSshTarget, process.env),
        dockerContextResolution,
        ideaDockerServerResolution,
        dockerCommandTarget: resolveDockerCommandTarget(dockerServerName, dockerContextResolution, ideaDockerServerResolution),
        executionEnabled: process.env.RELEASE_PUBLISHER_ALLOW_EXECUTE === 'true'
      });
    }
    if (pathname === '/api/history' && req.method === 'GET') {
      return sendJson(res, 200, readReleaseHistoryPage(projectRoot, {
        page: requestUrl.searchParams.get('page') || 1,
        limit: requestUrl.searchParams.get('limit') || 10
      }));
    }
    if (pathname === '/api/history' && req.method === 'DELETE') {
      return sendJson(res, 200, clearReleaseHistory(projectRoot));
    }
    if (pathname.startsWith('/api/history/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/history/'.length));
      return sendJson(res, 200, deleteReleaseHistoryEntry(projectRoot, id));
    }
    if (pathname === '/api/git/branches' && req.method === 'GET') {
      return sendJson(res, 200, listGitBranches(projectRoot, process.env));
    }
    if (pathname === '/api/git/commits' && req.method === 'GET') {
      return sendJson(res, 200, listGitCommits(
        projectRoot,
        requestUrl.searchParams.get('branch') || 'origin/master',
        requestUrl.searchParams.get('limit') || 60
      ));
    }
    if (pathname === '/api/plan' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, createPlan(projectRoot, body));
    }
    if (pathname === '/api/save-tag' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, saveTag(projectRoot, body));
    }
    if (pathname === '/api/execute' && req.method === 'POST') {
      const body = await readBody(req);
      const job = createExecutionJob(body);
      return sendJson(res, 202, job);
    }
    if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
      const job = jobs.get(id);
      if (!job) {
        return sendJson(res, 404, {message: '执行任务不存在或已过期'});
      }
      return sendJson(res, 200, job);
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

function createExecutionJob(body) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createdAt = new Date().toISOString();
  const job = {
    id,
    createdAt,
    updatedAt: createdAt,
    status: 'RUNNING',
    plan: null,
    logs: ['任务已创建，等待执行输出'],
    completedStepKeys: []
  };
  jobs.set(id, job);
  executePlan(projectRoot, body, process.env, {
    onProgress(progress) {
      Object.assign(job, {
        ...progress,
        id,
        createdAt,
        updatedAt: new Date().toISOString()
      });
    }
  }).then(result => {
    Object.assign(job, {
      ...result,
      id,
      createdAt,
      updatedAt: new Date().toISOString()
    });
  }).catch(error => {
    Object.assign(job, {
      id,
      createdAt,
      updatedAt: new Date().toISOString(),
      status: 'ERROR',
      logs: (job.logs || []).concat(`ERROR: ${error.message}`)
    });
  });
  pruneJobs();
  return job;
}

function pruneJobs() {
  const entries = Array.from(jobs.entries());
  if (entries.length <= 20) {
    return;
  }
  for (const [id] of entries.slice(0, entries.length - 20)) {
    jobs.delete(id);
  }
}
