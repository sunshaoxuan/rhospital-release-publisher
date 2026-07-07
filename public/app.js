(function () {
  const status = document.getElementById('status');
  const appTag = document.getElementById('app-tag');
  const dockerContext = document.getElementById('docker-context');
  const remoteSshTarget = document.getElementById('remote-ssh-target');
  const remoteComposeDir = document.getElementById('remote-compose-dir');
  const dryRun = document.getElementById('dry-run');
  const includeStack = document.getElementById('include-stack');
  const steps = document.getElementById('steps');
  const logs = document.getElementById('logs');
  const executionState = document.getElementById('execution-state');

  const fields = {
    projectRoot: document.getElementById('project-root'),
    runConfig: document.getElementById('run-config'),
    currentImage: document.getElementById('current-image'),
    currentTag: document.getElementById('current-tag'),
    serverName: document.getElementById('server-name'),
    sshTarget: document.getElementById('ssh-target'),
    dockerfile: document.getElementById('dockerfile'),
    volumePath: document.getElementById('volume-path'),
    remoteComposePath: document.getElementById('remote-compose-path'),
    targetImage: document.getElementById('target-image')
  };

  let latestConfig = null;

  async function requestJson(url, options) {
    const response = await fetch(url, {
      headers: {'Content-Type': 'application/json'},
      ...options
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `HTTP ${response.status}`);
    }
    return payload;
  }

  function setStatus(message, kind) {
    status.textContent = message || '';
    status.className = `status ${kind || ''}`.trim();
  }

  function payload() {
    return {
      appTag: appTag.value.trim(),
      dockerContext: dockerContext.value.trim(),
      remoteSshTarget: remoteSshTarget.value.trim(),
      remoteComposeDir: remoteComposeDir.value.trim(),
      dryRun: dryRun.checked,
      includeStackDeploy: includeStack.checked
    };
  }

  function renderConfig(config) {
    latestConfig = config;
    fields.projectRoot.textContent = config.projectRoot || '';
    fields.runConfig.textContent = config.runConfigPath || '';
    fields.currentImage.textContent = config.imageTag || '';
    fields.currentTag.textContent = config.appTag || '';
    fields.serverName.textContent = config.serverName || '';
    fields.sshTarget.textContent = config.remoteSshTarget || config.serverName || '';
    fields.dockerfile.textContent = config.dockerfile || '';
    fields.volumePath.textContent = config.volumeHostPath || '';
    fields.remoteComposePath.textContent = config.remoteComposeDir || '';
    dockerContext.value = dockerContext.value || config.serverName || '';
    remoteSshTarget.value = remoteSshTarget.value || config.remoteSshTarget || config.serverName || '';
    remoteComposeDir.value = remoteComposeDir.value || config.remoteComposeDir || '';
    appTag.value = appTag.value || config.suggestedTag || config.appTag || '';
    executionState.textContent = config.executionEnabled ? 'execute enabled' : 'dry run only';
  }

  function renderPlan(plan) {
    renderConfig({
      ...plan.config,
      suggestedTag: latestConfig ? latestConfig.suggestedTag : plan.appTag
    });
    fields.targetImage.textContent = plan.imageTag;
    steps.innerHTML = '';
    for (const step of plan.steps) {
      const item = document.createElement('article');
      item.className = 'step';
      const badge = step.productionAction ? '生产命令' : '本地动作';
      item.innerHTML = `<h3><span>${escapeHtml(step.title)}</span><span class="badge ${step.productionAction ? 'warn' : ''}">${badge}</span></h3><pre class="command"></pre>`;
      item.querySelector('pre').textContent = step.command;
      steps.appendChild(item);
    }
  }

  function renderLogs(result) {
    logs.innerHTML = '';
    for (const line of result.logs || []) {
      const item = document.createElement('li');
      item.textContent = line;
      logs.appendChild(item);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadConfig() {
    setStatus('读取配置中', '');
    const config = await requestJson('/api/config');
    renderConfig(config);
    await plan();
    setStatus('配置已读取', 'success');
  }

  async function plan() {
    const result = await requestJson('/api/plan', {
      method: 'POST',
      body: JSON.stringify(payload())
    });
    renderPlan(result);
    return result;
  }

  async function saveTag() {
    setStatus('保存 TAG 预处理中', '');
    const result = await requestJson('/api/save-tag', {
      method: 'POST',
      body: JSON.stringify(payload())
    });
    setStatus(`${result.status}: ${result.imageTag}`, result.status === 'DRY_RUN' ? 'success' : '');
    await plan();
  }

  async function execute() {
    setStatus('执行请求处理中', '');
    const result = await requestJson('/api/execute', {
      method: 'POST',
      body: JSON.stringify(payload())
    });
    renderPlan(result.plan);
    renderLogs(result);
    setStatus(`执行状态: ${result.status}`, result.status === 'DRY_RUN' ? 'success' : '');
  }

  document.getElementById('reload-btn').addEventListener('click', () => {
    loadConfig().catch(error => setStatus(error.message, 'error'));
  });
  document.getElementById('suggest-btn').addEventListener('click', () => {
    if (latestConfig && latestConfig.suggestedTag) {
      appTag.value = latestConfig.suggestedTag;
      plan().catch(error => setStatus(error.message, 'error'));
    }
  });
  document.getElementById('save-btn').addEventListener('click', () => {
    saveTag().catch(error => setStatus(error.message, 'error'));
  });
  document.getElementById('execute-btn').addEventListener('click', () => {
    execute().catch(error => setStatus(error.message, 'error'));
  });
  appTag.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });
  dockerContext.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });
  remoteSshTarget.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });
  remoteComposeDir.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });
  includeStack.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });

  loadConfig().catch(error => setStatus(error.message, 'error'));
})();
