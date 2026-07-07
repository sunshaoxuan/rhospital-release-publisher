(function () {
  const status = document.getElementById('status');
  const appTag = document.getElementById('app-tag');
  const dockerContext = document.getElementById('docker-context');
  const remoteSshTarget = document.getElementById('remote-ssh-target');
  const remoteComposeDir = document.getElementById('remote-compose-dir');
  const dryRun = document.getElementById('dry-run');
  const includeStack = document.getElementById('include-stack');
  const pipeline = document.getElementById('pipeline');
  const steps = document.getElementById('steps');
  const logs = document.getElementById('logs');
  const executionState = document.getElementById('execution-state');

  const fields = {
    projectRoot: document.getElementById('project-root'),
    runConfig: document.getElementById('run-config'),
    currentImage: document.getElementById('current-image'),
    currentTag: document.getElementById('current-tag'),
    serverName: document.getElementById('server-name'),
    dockerContextSource: document.getElementById('docker-context-source'),
    dockerEndpoint: document.getElementById('docker-endpoint'),
    dockerContextNote: document.getElementById('docker-context-note'),
    ideaDockerServer: document.getElementById('idea-docker-server'),
    ideaDockerSsh: document.getElementById('idea-docker-ssh'),
    ideaDockerKey: document.getElementById('idea-docker-key'),
    dockerCommandTarget: document.getElementById('docker-command-target'),
    sshTarget: document.getElementById('ssh-target'),
    sshTargetSource: document.getElementById('ssh-target-source'),
    sshHostName: document.getElementById('ssh-hostname'),
    sshUser: document.getElementById('ssh-user'),
    sshPort: document.getElementById('ssh-port'),
    sshIdentity: document.getElementById('ssh-identity'),
    sshConfigPath: document.getElementById('ssh-config-path'),
    sshNote: document.getElementById('ssh-note'),
    dockerfile: document.getElementById('dockerfile'),
    volumePath: document.getElementById('volume-path'),
    remoteComposePath: document.getElementById('remote-compose-path'),
    targetImage: document.getElementById('target-image'),
    targetImageFlow: document.getElementById('target-image-flow')
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

  function renderExecutionState(config) {
    const executionEnabled = Boolean(config && config.executionEnabled);
    if (dryRun.checked) {
      executionState.textContent = 'dry run 模式';
      executionState.className = 'state dry-run-state';
      return;
    }
    executionState.textContent = executionEnabled ? '正式执行模式' : '正式执行未授权';
    executionState.className = `state ${executionEnabled ? 'execute-state' : 'blocked-state'}`;
  }

  function renderConfig(config) {
    latestConfig = config;
    fields.projectRoot.textContent = config.projectRoot || '';
    fields.runConfig.textContent = config.runConfigPath || '';
    fields.currentImage.textContent = config.imageTag || '';
    fields.currentTag.textContent = config.appTag || '';
    fields.serverName.textContent = config.serverName || '';
    fields.sshTarget.textContent = config.remoteSshTarget || config.serverName || '';
    renderDockerContextResolution(config.dockerContextResolution);
    renderIdeaDockerServer(config.ideaDockerServerResolution, config.dockerCommandTarget);
    renderSshResolution(config.sshResolution);
    fields.dockerfile.textContent = config.dockerfile || '';
    fields.volumePath.textContent = config.volumeHostPath || '';
    fields.remoteComposePath.textContent = config.remoteComposeDir || '';
    dockerContext.value = dockerContext.value || config.serverName || '';
    remoteSshTarget.value = remoteSshTarget.value || config.remoteSshTarget || config.serverName || '';
    remoteComposeDir.value = remoteComposeDir.value || config.remoteComposeDir || '';
    appTag.value = appTag.value || config.suggestedTag || config.appTag || '';
    renderExecutionState(config);
  }

  function renderSshResolution(sshResolution) {
    const info = sshResolution || {};
    fields.sshTargetSource.textContent = info.targetSource || '未解析';
    fields.sshHostName.textContent = info.hostName || '未解析';
    fields.sshUser.textContent = info.user || '未解析';
    fields.sshPort.textContent = info.port || '未解析';
    fields.sshIdentity.textContent = Array.isArray(info.identityFiles) && info.identityFiles.length
      ? info.identityFiles.join('\n')
      : '未指定';
    fields.sshConfigPath.textContent = info.sshConfigPath
      ? `${info.sshConfigPath}${info.sshConfigExists ? '' : ' 不存在'}`
      : '未解析';
    fields.sshNote.textContent = info.note || (info.resolved ? '已解析' : '未解析');
  }

  function renderDockerContextResolution(contextResolution) {
    const info = contextResolution || {};
    fields.dockerContextSource.textContent = info.source || '未解析';
    fields.dockerEndpoint.textContent = info.dockerEndpoint || '未解析';
    fields.dockerContextNote.textContent = info.error
      ? `${info.note || '解析失败'}: ${info.error}`
      : info.note || (info.resolved ? '已解析' : '未解析');
  }

  function renderIdeaDockerServer(serverResolution, commandTarget) {
    const info = serverResolution || {};
    fields.ideaDockerServer.textContent = info.resolved ? `${info.name} (${info.note})` : info.note || '未解析';
    fields.ideaDockerSsh.textContent = info.host
      ? `${info.username || '未指定'}@${info.host}:${info.port || '22'}`
      : '未解析';
    fields.ideaDockerKey.textContent = info.keyPath || '未指定';
    fields.dockerCommandTarget.textContent = commandTarget && commandTarget.mode === 'host'
      ? `${commandTarget.source}: ${commandTarget.host}`
      : commandTarget && commandTarget.mode === 'context'
        ? `${commandTarget.source}: ${commandTarget.context || 'default'}`
        : '未解析';
  }

  function renderPlan(plan) {
    renderConfig({
      ...plan.config,
      suggestedTag: latestConfig ? latestConfig.suggestedTag : plan.appTag
    });
    fields.targetImage.textContent = plan.imageTag;
    fields.targetImageFlow.textContent = plan.imageTag;
    renderPipeline(plan.steps);
    steps.innerHTML = '';
    for (const [index, step] of plan.steps.entries()) {
      const item = document.createElement('article');
      item.className = `step ${step.finalCheck ? 'final-step' : ''}`;
      const badge = step.productionAction ? '生产动作' : '本地动作';
      item.innerHTML = `
        <div class="step-title">
          <div class="step-index">${String(index + 1).padStart(2, '0')}</div>
          <div>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.summary || '')}</p>
          </div>
          <span class="badge ${step.productionAction ? 'warn' : ''}">${badge}</span>
        </div>
        <div class="command-block">
          <span>动作</span>
          <pre class="command action-command"></pre>
        </div>
        <div class="command-block validation-block">
          <span>校验</span>
          <pre class="command validation-command"></pre>
        </div>
      `;
      item.querySelector('.action-command').textContent = step.command || '';
      item.querySelector('.validation-command').textContent = step.validation || '';
      steps.appendChild(item);
    }
  }

  function renderPipeline(planSteps) {
    pipeline.innerHTML = '';
    for (const [index, step] of planSteps.entries()) {
      const status = step.status || 'pending';
      const done = status === 'done' || status === 'dry-run-checked';
      const node = document.createElement('article');
      node.className = `flow-node ${done ? 'checked' : ''} ${step.finalCheck ? 'final-node' : ''}`;
      node.innerHTML = `
        <div class="flow-mark">${done ? '✓' : String(index + 1).padStart(2, '0')}</div>
        <div class="flow-copy">
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.validation || '')}</p>
          <span>${statusLabel(status)}</span>
        </div>
      `;
      pipeline.appendChild(node);
    }
  }

  function statusLabel(status) {
    if (status === 'done') {
      return '已完成';
    }
    if (status === 'dry-run-checked') {
      return 'dry run 已校验';
    }
    return '待执行';
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
  dryRun.addEventListener('change', () => {
    renderExecutionState(latestConfig || {});
    plan().catch(error => setStatus(error.message, 'error'));
  });
  includeStack.addEventListener('change', () => {
    plan().catch(error => setStatus(error.message, 'error'));
  });

  loadConfig().catch(error => setStatus(error.message, 'error'));
})();
