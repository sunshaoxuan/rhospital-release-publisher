(function () {
  const bootStartedAt = performance.now();
  const status = document.getElementById('status');
  const appTag = document.getElementById('app-tag');
  const gitBranch = document.getElementById('git-branch');
  const gitCommit = document.getElementById('git-commit');
  const gitRefresh = document.getElementById('git-refresh');
  const dockerContext = document.getElementById('docker-context');
  const remoteSshTarget = document.getElementById('remote-ssh-target');
  const remoteComposeDir = document.getElementById('remote-compose-dir');
  const dryRun = document.getElementById('dry-run');
  const includeStack = document.getElementById('include-stack');
  const cancelBtn = document.getElementById('cancel-btn');
  const pipeline = document.getElementById('pipeline');
  const steps = document.getElementById('steps');
  const logs = document.getElementById('logs');
  const history = document.getElementById('history');
  const historyCount = document.getElementById('history-count');
  const historyPrev = document.getElementById('history-prev');
  const historyNext = document.getElementById('history-next');
  const historyClear = document.getElementById('history-clear');
  const executionState = document.getElementById('execution-state');

  const fields = {
    projectRoot: document.getElementById('project-root'),
    runConfig: document.getElementById('run-config'),
    currentImage: document.getElementById('current-image'),
    currentTag: document.getElementById('current-tag'),
    gitBranchCurrent: document.getElementById('git-branch-current'),
    gitCommitCurrent: document.getElementById('git-commit-current'),
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
  let gitBranches = [];
  let gitCommits = [];
  let historyPage = 1;
  let historyPageCount = 1;
  let activeJobTimer = null;
  let activeJobId = '';
  let appTagEdited = false;

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
      gitBranch: gitBranch.value,
      gitCommit: gitCommit.value,
      dockerContext: dockerContext.value.trim(),
      remoteSshTarget: remoteSshTarget.value.trim(),
      remoteComposeDir: remoteComposeDir.value.trim(),
      dryRun: dryRun.checked,
      includeStackDeploy: includeStack.checked
    };
  }

  function renderExecutionState(config) {
    if (dryRun.checked) {
      executionState.textContent = 'dry run 模式';
      executionState.className = 'state dry-run-state';
      return;
    }
    executionState.textContent = '正式执行模式';
    executionState.className = 'state execute-state';
  }

  function renderConfig(config) {
    latestConfig = config;
    fields.projectRoot.textContent = config.projectRoot || '';
    fields.runConfig.textContent = config.runConfigPath || '';
    fields.currentImage.textContent = config.imageTag || '';
    fields.currentTag.textContent = config.appTag || '';
    fields.gitBranchCurrent.textContent = gitBranch.value || '未选择';
    fields.gitCommitCurrent.textContent = commitLabel(gitCommit.value);
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
    const logScrollState = new Map();
    for (const existing of steps.querySelectorAll('.step[data-step-key]')) {
      const key = existing.dataset.stepKey;
      const list = existing.querySelector('.step-logs');
      if (key && list) {
        logScrollState.set(key, {
          top: list.scrollTop,
          nearBottom: list.scrollTop + list.clientHeight >= list.scrollHeight - 8
        });
      }
    }
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
      item.className = `step ${step.finalCheck ? 'final-step' : ''} ${step.status === 'running' ? 'running' : ''} ${step.status === 'failed' || step.status === 'cancelled' || step.status === 'interrupted' ? 'failed' : ''}`;
      item.dataset.stepKey = step.key;
      const badge = actionTypeLabel(step);
      const stepLogs = Array.isArray(step.logs) ? step.logs : [];
      item.innerHTML = `
        <div class="step-title">
          <div class="step-index">${String(index + 1).padStart(2, '0')}</div>
          <div>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.summary || '')}</p>
          </div>
          <div class="step-meta">
            <span class="step-timer">${escapeHtml(stepTimerLabel(step))}</span>
            <span class="badge ${badgeClass(step)}">${badge}</span>
          </div>
        </div>
        <div class="command-block">
          <span>动作</span>
          <pre class="command action-command"></pre>
        </div>
        <div class="command-block validation-block">
          <span>校验</span>
          <pre class="command validation-command"></pre>
        </div>
        <div class="command-block step-log-block ${stepLogs.length ? '' : 'empty'}">
          <span>本步日志</span>
          <ul class="step-logs"></ul>
        </div>
      `;
      item.querySelector('.action-command').textContent = step.command || '';
      item.querySelector('.validation-command').textContent = step.validation || '';
      const stepLogList = item.querySelector('.step-logs');
      if (stepLogs.length) {
        for (const line of stepLogs) {
          const logItem = document.createElement('li');
          logItem.textContent = line;
          stepLogList.appendChild(logItem);
        }
      } else {
        const logItem = document.createElement('li');
        logItem.textContent = '等待执行到此步骤';
        stepLogList.appendChild(logItem);
      }
      steps.appendChild(item);
      restoreLogScroll(stepLogList, logScrollState.get(step.key));
    }
  }

  function restoreLogScroll(list, previousScroll) {
    if (!list || !previousScroll) {
      return;
    }
    const targetTop = previousScroll.nearBottom ? list.scrollHeight : previousScroll.top;
    list.scrollTop = targetTop;
    window.requestAnimationFrame(() => {
      list.scrollTop = previousScroll.nearBottom ? list.scrollHeight : targetTop;
    });
  }

  function renderPipeline(planSteps) {
    if (!window.__releaseConsoleFirstFlowRenderedAt) {
      window.__releaseConsoleFirstFlowRenderedAt = performance.now() - bootStartedAt;
    }
    window.__releaseConsoleLastFlowRenderedAt = performance.now() - bootStartedAt;
    pipeline.innerHTML = '';
    for (const [index, step] of planSteps.entries()) {
      const status = step.status || 'pending';
      const done = status === 'done' || status === 'dry-run-checked';
      const node = document.createElement('article');
      node.className = `flow-node ${done ? 'checked' : ''} ${status === 'running' ? 'running' : ''} ${status === 'failed' || status === 'cancelled' || status === 'interrupted' ? 'failed' : ''} ${step.finalCheck ? 'final-node' : ''}`;
      node.innerHTML = `
        <div class="flow-mark">${done ? '✓' : String(index + 1).padStart(2, '0')}</div>
        <div class="flow-copy">
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.validation || '')}</p>
          <span>${escapeHtml(statusWithDuration(step, status))}</span>
        </div>
      `;
      pipeline.appendChild(node);
    }
  }

  function statusWithDuration(step, status) {
    const timer = stepTimerLabel(step);
    return `${statusLabel(status)} · ${timer}`;
  }

  function statusLabel(status) {
    if (status === 'done') {
      return '已完成';
    }
    if (status === 'dry-run-checked') {
      return 'dry run 已校验';
    }
    if (status === 'running') {
      return '执行中';
    }
    if (status === 'failed') {
      return '失败';
    }
    if (status === 'cancelled') {
      return '已取消';
    }
    if (status === 'interrupted') {
      return '已中断';
    }
    return '待执行';
  }

  function stepTimerLabel(step) {
    if (Number.isFinite(step.durationMs)) {
      return `用时 ${formatDuration(step.durationMs)}`;
    }
    if (Number.isFinite(step.elapsedMs) && step.elapsedMs > 0) {
      return `已运行 ${formatDuration(step.elapsedMs)}`;
    }
    if (step.startedAt && step.status === 'running') {
      const elapsed = Date.now() - Date.parse(step.startedAt);
      return `已运行 ${formatDuration(elapsed)}`;
    }
    return '计时待开始';
  }

  function formatDuration(value) {
    const ms = Math.max(0, Number(value) || 0);
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (!minutes) {
      return `${seconds}s`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (!hours) {
      return `${minutes}m ${seconds}s`;
    }
    return `${hours}h ${remainingMinutes}m ${seconds}s`;
  }

  function actionTypeLabel(step) {
    if (step.finalCheck) {
      return '最终校验';
    }
    const labels = {
      'local-check': '本地校验',
      'local-code': '本地代码',
      'local-config': '本地配置',
      build: '构建动作',
      production: '生产动作',
      'remote-check': '远端只读校验'
    };
    return labels[step.actionType] || '本地动作';
  }

  function badgeClass(step) {
    if (step.finalCheck || step.actionType === 'remote-check') {
      return 'readonly';
    }
    if (step.productionAction || step.actionType === 'production') {
      return 'warn';
    }
    if (step.actionType === 'build') {
      return 'build';
    }
    return '';
  }

  function renderLogs(result) {
    logs.innerHTML = '';
    const lines = Array.isArray(result) ? result : result.logs || [];
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line;
      logs.appendChild(item);
    }
    logs.scrollTop = logs.scrollHeight;
  }

  function renderHistory(pageResult) {
    const entries = Array.isArray(pageResult)
      ? pageResult
      : pageResult.items || [];
    const total = Array.isArray(pageResult) ? entries.length : pageResult.total || 0;
    historyPage = Array.isArray(pageResult) ? 1 : pageResult.page || 1;
    historyPageCount = Array.isArray(pageResult) ? 1 : pageResult.pageCount || 1;
    historyCount.textContent = `${total} 条 · ${historyPage}/${historyPageCount}`;
    historyPrev.disabled = historyPage <= 1;
    historyNext.disabled = historyPage >= historyPageCount;
    historyClear.disabled = total === 0;
    history.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '暂无构造历史。执行一次 dry run 后会在这里出现记录。';
      history.appendChild(empty);
      return;
    }
    for (const item of entries) {
      const card = document.createElement('article');
      card.className = `history-card ${String(item.status || '').toLowerCase()}`;
      const codeSource = item.gitCommit && item.gitCommit !== 'latest'
        ? `${item.gitBranch || '未选择'} @ ${item.gitCommit}`
        : `${item.gitBranch || '未选择'} 最新提交`;
      const actualCommit = item.releaseCommitShort
        ? `${item.releaseCommitShort}${item.releaseCommitSubject ? ` ${item.releaseCommitSubject}` : ''}`
        : '未记录';
      card.innerHTML = `
        <div class="history-top">
          <strong>${escapeHtml(item.imageTag || item.appTag || '未知镜像')}</strong>
          <div>
            <span>${escapeHtml(item.status || 'UNKNOWN')}</span>
            <button type="button" class="history-delete" data-id="${escapeHtml(item.id || '')}">删除</button>
          </div>
        </div>
        <div class="history-grid">
          <div><span>时间</span><b>${escapeHtml(formatDateTime(item.createdAt))}</b></div>
          <div><span>选择代码</span><b>${escapeHtml(codeSource)}</b></div>
          <div><span>实际提交</span><b>${escapeHtml(actualCommit)}</b></div>
          <div><span>提交时间</span><b>${escapeHtml(item.releaseCommitDate || '未记录')}</b></div>
          <div><span>Docker 目标</span><b>${escapeHtml(item.dockerTarget || '未解析')}</b></div>
          <div><span>上传目标</span><b>${escapeHtml(item.imageUploadTarget || item.sshTarget || '未设置')}</b></div>
          <div><span>SSH 目标</span><b>${escapeHtml(item.sshTarget || '未设置')}</b></div>
          <div><span>编排目录</span><b>${escapeHtml(item.remoteComposeDir || '未设置')}</b></div>
          <div><span>节点</span><b>${escapeHtml(`${item.completedStepCount || 0}/${item.stepCount || 0}`)}</b></div>
          <div><span>总耗时</span><b>${escapeHtml(formatDuration(item.totalDurationMs || 0))}</b></div>
          <div><span>最慢步骤</span><b>${escapeHtml(slowestStepLabel(item.slowestStep))}</b></div>
        </div>
      `;
      history.appendChild(card);
    }
    for (const button of history.querySelectorAll('.history-delete')) {
      button.addEventListener('click', () => deleteHistory(button.dataset.id));
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

  function slowestStepLabel(step) {
    if (!step || !step.title) {
      return '暂无';
    }
    return `${step.title} · ${formatDuration(step.durationMs || 0)}`;
  }

  async function loadConfig() {
    setStatus('读取配置中', '');
    const config = await requestJson('/api/config');
    renderConfig(config);
    await plan();
    setStatus('流程已生成，正在读取分支和历史', '');
    loadRemoteTag(config).catch(error => setStatus(`远程 TAG 读取失败: ${error.message}`, 'error'));
    const results = await Promise.allSettled([
      loadBranches().then(() => plan()),
      loadHistory()
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
    setStatus('配置已读取', 'success');
  }

  async function loadRemoteTag(config) {
    const params = new URLSearchParams({
      remoteSshTarget: remoteSshTarget.value.trim() || config.remoteSshTarget || config.serverName || '',
      remoteComposeDir: remoteComposeDir.value.trim() || config.remoteComposeDir || ''
    });
    const remote = await requestJson(`/api/remote-tag?${params.toString()}`);
    const canApplySuggestion = remote.suggestedTag
      && !appTagEdited
      && (!appTag.value
        || appTag.value === config.suggestedTag
        || appTag.value === config.appTag);
    if (canApplySuggestion) {
      appTag.value = remote.suggestedTag;
      latestConfig = {
        ...(latestConfig || config),
        suggestedTag: remote.suggestedTag,
        remoteOnlineTag: remote.appTag,
        remoteOnlineImage: remote.imageTag
      };
      await plan();
      setStatus(`已按远程上线 TAG 建议 ${remote.suggestedTag}`, 'success');
    }
  }

  async function loadBranches() {
    const result = await requestJson('/api/git/branches');
    gitBranches = result.branches || [];
    const currentValue = gitBranch.dataset.loaded === 'true' && gitBranch.value
      ? gitBranch.value
      : result.defaultBranch || 'origin/master';
    gitBranch.innerHTML = '';
    for (const branch of gitBranches) {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = `${branch.name}${branch.current ? ' 当前' : ''}`;
      gitBranch.appendChild(option);
    }
    if (!gitBranches.length) {
      const option = document.createElement('option');
      option.value = currentValue;
      option.textContent = currentValue;
      gitBranch.appendChild(option);
    }
    gitBranch.value = gitBranches.some(branch => branch.name === currentValue)
      ? currentValue
      : result.defaultBranch || gitBranch.options[0].value;
    gitBranch.dataset.loaded = 'true';
    await loadCommits(false);
  }

  async function loadCommits(shouldPlan = true) {
    const result = await requestJson(`/api/git/commits?branch=${encodeURIComponent(gitBranch.value)}&limit=80`);
    gitCommits = result.commits || [];
    const previousValue = gitCommit.value || 'latest';
    gitCommit.innerHTML = '';
    const latestOption = document.createElement('option');
    latestOption.value = 'latest';
    latestOption.textContent = '最新提交';
    gitCommit.appendChild(latestOption);
    for (const commit of gitCommits) {
      const option = document.createElement('option');
      option.value = commit.hash;
      option.textContent = `${commit.shortHash} ${commit.subject}`;
      gitCommit.appendChild(option);
    }
    gitCommit.value = gitCommits.some(commit => commit.hash === previousValue) ? previousValue : 'latest';
    renderConfig(latestConfig || {});
    if (shouldPlan) {
      await plan();
    }
  }

  async function refreshCommits() {
    gitRefresh.disabled = true;
    gitRefresh.classList.add('is-loading');
    gitRefresh.setAttribute('aria-busy', 'true');
    setStatus('正在刷新远端提交', '');
    try {
      await requestJson('/api/git/refresh', {method: 'POST'});
      await loadBranches();
      await plan();
      setStatus('提交列表已刷新', 'success');
    } finally {
      gitRefresh.disabled = false;
      gitRefresh.classList.remove('is-loading');
      gitRefresh.removeAttribute('aria-busy');
    }
  }

  async function loadHistory() {
    const result = await requestJson(`/api/history?page=${historyPage}&limit=10`);
    renderHistory(result);
  }

  async function plan() {
    const result = await requestJson('/api/plan', {
      method: 'POST',
      body: JSON.stringify(payload())
    });
    renderPlan(result);
    return result;
  }

  async function execute() {
    if (activeJobTimer) {
      clearTimeout(activeJobTimer);
      activeJobTimer = null;
    }
    setStatus('执行请求处理中', '');
    renderLogs(['任务提交中']);
    const job = await requestJson('/api/execute', {
      method: 'POST',
      body: JSON.stringify(payload())
    });
    activeJobId = job.id;
    setStatus(`执行任务已创建: ${job.id}`, '');
    renderJob(job);
    pollJob(job.id);
  }

  async function pollJob(jobId) {
    const job = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    renderJob(job);
    if (job.status === 'RUNNING') {
      activeJobTimer = setTimeout(() => {
        pollJob(jobId).catch(error => setStatus(error.message, 'error'));
      }, 1000);
      return;
    }
    activeJobTimer = null;
    activeJobId = '';
    cancelBtn.disabled = true;
    await loadHistory();
    setStatus(`执行状态: ${job.status}`, terminalStatusKind(job.status));
  }

  function renderJob(job) {
    const pageScroll = capturePageScroll();
    if (job.plan) {
      renderPlan(job.plan);
    }
    renderLogs(job.logs || []);
    cancelBtn.disabled = !(job.status === 'RUNNING' || job.status === 'CANCELLING');
    setStatus(`执行状态: ${job.status}`, terminalStatusKind(job.status));
    restorePageScroll(pageScroll);
  }

  function capturePageScroll() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    return {
      top: scrollingElement.scrollTop,
      left: scrollingElement.scrollLeft
    };
  }

  function restorePageScroll(position) {
    if (!position) {
      return;
    }
    window.scrollTo(position.left, position.top);
    window.requestAnimationFrame(() => {
      window.scrollTo(position.left, position.top);
    });
  }

  function terminalStatusKind(status) {
    if (status === 'DRY_RUN' || status === 'EXECUTED') {
      return 'success';
    }
    if (status === 'RUNNING' || status === 'CANCELLING') {
      return '';
    }
    if (status === 'CANCELLED' || status === 'INTERRUPTED') {
      return 'error';
    }
    return 'error';
  }

  async function cancelActiveJob() {
    if (!activeJobId) {
      return;
    }
    cancelBtn.disabled = true;
    const job = await requestJson(`/api/jobs/${encodeURIComponent(activeJobId)}`, {method: 'DELETE'});
    renderJob(job);
  }

  async function deleteHistory(id) {
    if (!id) {
      return;
    }
    await requestJson(`/api/history/${encodeURIComponent(id)}`, {method: 'DELETE'});
    await loadHistory();
  }

  async function clearHistory() {
    await requestJson('/api/history', {method: 'DELETE'});
    historyPage = 1;
    await loadHistory();
  }

  document.getElementById('reload-btn').addEventListener('click', () => {
    loadConfig().catch(error => setStatus(error.message, 'error'));
  });
  document.getElementById('execute-btn').addEventListener('click', () => {
    execute().catch(error => setStatus(error.message, 'error'));
  });
  cancelBtn.addEventListener('click', () => {
    cancelActiveJob().catch(error => setStatus(error.message, 'error'));
  });
  historyPrev.addEventListener('click', () => {
    if (historyPage > 1) {
      historyPage -= 1;
      loadHistory().catch(error => setStatus(error.message, 'error'));
    }
  });
  historyNext.addEventListener('click', () => {
    if (historyPage < historyPageCount) {
      historyPage += 1;
      loadHistory().catch(error => setStatus(error.message, 'error'));
    }
  });
  historyClear.addEventListener('click', () => {
    clearHistory().catch(error => setStatus(error.message, 'error'));
  });
  appTag.addEventListener('input', () => {
    appTagEdited = true;
  });
  appTag.addEventListener('change', () => {
    appTagEdited = true;
    plan().catch(error => setStatus(error.message, 'error'));
  });
  gitBranch.addEventListener('change', () => {
    loadCommits(true).catch(error => setStatus(error.message, 'error'));
  });
  gitRefresh.addEventListener('click', () => {
    refreshCommits().catch(error => setStatus(`提交刷新失败: ${error.message}`, 'error'));
  });
  gitCommit.addEventListener('change', () => {
    renderConfig(latestConfig || {});
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

  function formatDateTime(value) {
    if (!value) {
      return '未知';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString('zh-CN', {hour12: false});
  }

  function commitLabel(value) {
    if (!value || value === 'latest') {
      return '最新提交';
    }
    const commit = gitCommits.find(item => item.hash === value);
    return commit ? `${commit.shortHash} ${commit.subject}` : value;
  }
})();
