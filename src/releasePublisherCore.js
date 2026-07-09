const fs = require('fs');
const path = require('path');
const os = require('os');
const {spawn, spawnSync} = require('child_process');

const DEFAULT_RUN_CONFIG = '.run/148.135.9.123.run.xml';
const DEFAULT_IMAGE_NAME = 'hospital-backend';
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml';
const DEFAULT_STACK_NAME = 'hospital_stack';
const DEFAULT_REMOTE_COMPOSE_DIR = '/opt/1panel/docker/compose/hospital-stack';
const DEFAULT_JETBRAINS_PRODUCT_DIR = 'IntelliJIdea2026.1';
const DEFAULT_HISTORY_FILE = '.release-history.json';
const DEFAULT_PUBLISHER_CONFIG = 'release-publisher.config.json';
const TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const GIT_REF_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._/@:-]{0,127}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-fA-F]{7,40}$/;

function defaultProjectRoot() {
  return process.env.RHOSPITAL_PROJECT_ROOT
    ? path.resolve(process.env.RHOSPITAL_PROJECT_ROOT)
    : path.resolve(__dirname, '..', '..', 'hospital-backend');
}

function readConfig(projectRoot, runConfigPath = DEFAULT_RUN_CONFIG) {
  const absolutePath = resolveInside(projectRoot, runConfigPath);
  const xml = fs.readFileSync(absolutePath, 'utf8');
  return {
    runConfigPath,
    absolutePath,
    projectRoot: path.resolve(projectRoot),
    ...parseIdeaRunConfig(xml)
  };
}

function parseIdeaRunConfig(xml) {
  const configurations = [...xml.matchAll(/<configuration\b[\s\S]*?<\/configuration>/g)].map(match => match[0]);
  const selected = configurations.find(config => /<option\s+name="buildArgs"/.test(config))
    || configurations[configurations.length - 1];
  if (!selected) {
    throw new Error('发布配置中没有 configuration 节点');
  }

  const serverName = attr(selected, 'server-name') || '';
  const imageTag = optionValue(selected, 'imageTag') || `${DEFAULT_IMAGE_NAME}:latest`;
  const appTag = dockerEnvValue(optionBlock(selected, 'buildArgs'), 'APP_TAG') || tagFromImage(imageTag);
  const envVars = parseDockerEnvVars(optionBlock(selected, 'envVars'));
  const volumeHostPath = dockerVolumeHostPath(optionBlock(selected, 'volumeBindings'));

  return {
    serverName,
    imageTag,
    imageName: imageNameFromTag(imageTag),
    appTag,
    dockerfile: optionValue(selected, 'sourceFilePath') || 'Dockerfile',
    containerName: optionValue(selected, 'containerName') || DEFAULT_IMAGE_NAME,
    buildOnly: optionValue(selected, 'buildOnly') === 'true',
    hostIp: envVars.HOST_IP || '',
    executorPort: envVars.EXECUTOR_PORT || '',
    volumeHostPath,
    composeFile: DEFAULT_COMPOSE_FILE,
    stackName: DEFAULT_STACK_NAME
  };
}

function createPlan(projectRoot, request, env = process.env) {
  const config = readConfig(projectRoot, request.runConfigPath || DEFAULT_RUN_CONFIG);
  const appTag = validateTag(request.appTag || config.appTag);
  const imageName = config.imageName || DEFAULT_IMAGE_NAME;
  const imageTag = `${imageName}:${appTag}`;
  const dockerContext = request.dockerContext || env.RELEASE_PUBLISHER_DOCKER_CONTEXT || config.serverName;
  const remoteSshTarget = request.remoteSshTarget || env.RELEASE_PUBLISHER_SSH_TARGET || dockerContext;
  const remoteComposeDir = request.remoteComposeDir || env.RELEASE_PUBLISHER_REMOTE_COMPOSE_DIR || DEFAULT_REMOTE_COMPOSE_DIR;
  const sshResolution = resolveSshTargetDetails(remoteSshTarget, env);
  const dockerContextResolution = resolveDockerContextDetails(dockerContext, env);
  const ideaDockerServerResolution = resolveReleaseDockerServerDetails(dockerContext, env);
  const dockerTarget = resolveDockerCommandTarget(dockerContext, dockerContextResolution);
  const remoteImageTarget = resolveRemoteImageTarget(remoteSshTarget, ideaDockerServerResolution);
  const includeStackDeploy = Boolean(request.includeStackDeploy);
  const gitBranch = validateGitBranch(request.gitBranch || env.RELEASE_PUBLISHER_GIT_BRANCH || 'origin/master');
  const gitCommit = validateGitCommit(request.gitCommit || 'latest');
  const gitUpdate = gitUpdateStep(gitBranch, gitCommit);

  const steps = [
    releaseStep({
      key: 'git-status-before-update',
      title: '检查本地代码状态',
      summary: '读取当前分支、当前提交和工作区状态，确认发布前代码来源',
      command: chainPowerShellCommands([
        'git status --short --branch',
        'git rev-parse --short HEAD'
      ]),
      validation: '确认工作区状态可接受，避免拉取代码时覆盖未处理改动',
      actionType: 'local-check',
      executable: true
    }),
    releaseStep({
      key: 'git-fetch',
      title: '获取远端代码',
      summary: '从 origin 拉取远端引用，供最新发布或指定 ref 发布使用',
      command: 'git fetch --prune origin',
      validation: 'git fetch 必须成功，远端引用必须可解析',
      actionType: 'local-code',
      executable: true
    }),
    releaseStep({
      key: 'git-update',
      title: gitUpdate.title,
      summary: gitUpdate.summary,
      command: gitUpdate.command,
      validation: gitUpdate.validation,
      actionType: 'local-code',
      executable: true
    }),
    releaseStep({
      key: 'capture-release-commit',
      title: '记录发布提交',
      summary: '记录本次实际发布使用的 Git HEAD，作为历史审计证据',
      command: chainPowerShellCommands([
        'git rev-parse HEAD',
        'git log -1 --format="%h%x09%ci%x09%s"'
      ]),
      validation: '历史记录必须包含实际提交 hash、提交时间和提交说明',
      actionType: 'local-check',
      executable: true
    }),
    releaseStep({
      key: 'validate-release-input',
      title: '读取配置并校验 TAG',
      summary: '确认本地发布配置、镜像 TAG 和 APP_TAG 使用同一个版本号',
      command: `读取 ${config.runConfigPath}`,
      validation: `APP_TAG=${appTag}, image=${imageTag}`,
      actionType: 'local-check'
    }),
    releaseStep({
      key: 'save-run-config',
      title: '更新本地发布配置',
      summary: '把 imageTag 和 APP_TAG 同步替换为本次发版 TAG',
      command: `${config.runConfigPath}: imageTag=${imageTag}, APP_TAG=${appTag}`,
      validation: `确认 ${config.runConfigPath} 中同时包含 ${imageTag} 和 APP_TAG=${appTag}`,
      actionType: 'local-config'
    }),
    releaseStep({
      key: 'compile-artifact',
      title: '编译应用产物',
      summary: '在本机 Docker 执行 Maven 构建阶段，确认 Java 产物可以完成编译',
      command: dockerCommand(dockerTarget, [
        'build',
        '--target', 'build',
        '-f', config.dockerfile,
        '--build-arg', `APP_TAG=${appTag}`,
        '-t', `${imageTag}-buildcheck`,
        '.'
      ]),
      validation: dockerCommand(dockerTarget, [
        'image', 'inspect', `${imageTag}-buildcheck`,
        '--format', '{{.Id}} {{.RepoTags}}'
      ]),
      validationCommand: dockerCommand(dockerTarget, [
        'image', 'inspect', `${imageTag}-buildcheck`,
        '--format', '{{.Id}} {{.RepoTags}}'
      ]),
      actionType: 'build',
      executable: true
    }),
    releaseStep({
      key: 'build-image',
      title: '制作 Docker 镜像',
      summary: '在本机 Docker 执行完整 Dockerfile，把已编译产物组装成可运行镜像',
      command: dockerCommand(dockerTarget, [
        'build',
        '-f', config.dockerfile,
        '--build-arg', `APP_TAG=${appTag}`,
        '-t', imageTag,
        '.'
      ]),
      validation: dockerCommand(dockerTarget, [
        'image', 'inspect', imageTag,
        '--format', '{{.Id}} {{.RepoTags}}'
      ]),
      validationCommand: dockerCommand(dockerTarget, [
        'image', 'inspect', imageTag,
        '--format', '{{.Id}} {{.RepoTags}}'
      ]),
      actionType: 'build',
      executable: true
    }),
    releaseStep({
      key: 'publish-image',
      title: '发布到目标镜像池',
      summary: '把本机已经构建好的镜像保存为 tar，经 SSH 上传到生产 Docker 主机并执行 docker load',
      command: publishImageCommand(imageTag, remoteImageTarget),
      validation: remoteSshCommand(remoteImageTarget,
        `docker image inspect ${shellToken(imageTag)} --format '{{.Id}} {{.RepoTags}}'`),
      validationCommand: remoteSshCommand(remoteImageTarget,
        `docker image inspect ${shellToken(imageTag)} --format '{{.Id}} {{.RepoTags}}'`),
      actionType: 'production',
      productionAction: true,
      executable: true
    })
  ];

  if (includeStackDeploy) {
    steps.push(releaseStep({
      key: 'resolve-ssh-target',
      title: '确认 SSH 连接配置',
      summary: '展开本机 SSH 配置，确认实际 HostName、User、Port 和密钥来源',
      command: `ssh -G ${shellToken(sshTargetValue(remoteImageTarget))}`,
      validation: remoteImageTarget.host
        ? `HostName=${remoteImageTarget.host}, User=${remoteImageTarget.user || '未解析'}, Port=${remoteImageTarget.port || '未解析'}, Key=${remoteImageTarget.keyPath || '默认 SSH key'}`
        : sshResolution.resolved
        ? `HostName=${sshResolution.hostName || '未解析'}, User=${sshResolution.user || '未解析'}, Port=${sshResolution.port || '未解析'}`
        : sshResolution.note || 'SSH 目标未解析',
      actionType: 'local-check'
    }));
    steps.push(releaseStep({
      key: 'read-remote-compose',
      title: '读取生产编排当前镜像',
      summary: '进入 hospital-stack 编排目录，确认当前 compose 中的 hospital-backend 镜像行',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*hospital-backend:' docker-compose.yml`
      ])),
      validation: `必须能读到 image: hospital-backend:<TAG>`,
      actionType: 'remote-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'update-remote-compose',
      title: '备份并替换生产编排 TAG',
      summary: '备份 docker-compose.yml，然后把 image: hospital-backend:<TAG> 替换成本次 TAG',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)`,
        `sed -i -E 's#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\\1${escapeSedReplacement(imageTag)}#' docker-compose.yml`
      ])),
      validation: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`
      ])),
      validationCommand: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`
      ])),
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    steps.push(releaseStep({
      key: 'deploy-stack',
      title: '执行 Docker Stack 热发布',
      summary: '在生产编排目录执行 stack deploy，触发 Swarm 按 compose 新镜像滚动更新',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `docker stack deploy -c docker-compose.yml ${shellToken(config.stackName)}`
      ])),
      validation: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        `docker stack services ${shellToken(config.stackName)}`
      )),
      validationCommand: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        `docker stack services ${shellToken(config.stackName)}`
      )),
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    steps.push(releaseStep({
      key: 'final-runtime-check',
      title: '最终运行校验',
      summary: '确认 stack 服务、任务状态和服务镜像都已经指向本次 TAG',
      command: remoteSshCommand(remoteImageTarget,
        remoteBashScriptCommand(finalRuntimeCheckCommand(config.stackName, config.containerName, imageTag))),
      validation: `服务镜像必须包含 ${imageTag}，任务不能处于 Failed 或 Rejected`,
      actionType: 'remote-check',
      executable: true,
      finalCheck: true
    }));
  }

  return {
    config: {
      ...config,
      dockerContext,
      remoteSshTarget,
      remoteComposeDir,
      sshResolution,
      dockerContextResolution,
      ideaDockerServerResolution,
      dockerCommandTarget: dockerTarget,
      remoteImageTarget,
      executionEnabled: true
    },
    appTag,
    imageTag,
    gitBranch,
    gitCommit,
    includeStackDeploy,
    dryRun: request.dryRun !== false,
    steps,
    guardrails: [
      '勾选 dry run 时只生成命令和写入预览',
      '取消 dry run 后会执行本地编译、镜像上传和勾选范围内的远端发布步骤'
    ]
  };
}

function releaseStep({
  key,
  title,
  summary,
  command,
  validation,
  validationCommand = '',
  productionAction = false,
  actionType = 'local-check',
  executable = false,
  finalCheck = false
}) {
  return {
    key,
    title,
    summary,
    command,
    validation,
    validationCommand,
    productionAction,
    actionType,
    executable,
    finalCheck,
    status: 'pending'
  };
}

function saveTag(projectRoot, request) {
  const configPath = request.runConfigPath || DEFAULT_RUN_CONFIG;
  const absolutePath = resolveInside(projectRoot, configPath);
  const config = readConfig(projectRoot, configPath);
  const appTag = validateTag(request.appTag || config.appTag);
  const imageTag = `${config.imageName || DEFAULT_IMAGE_NAME}:${appTag}`;
  const xml = fs.readFileSync(absolutePath, 'utf8');
  const updated = updateIdeaRunConfigTag(xml, imageTag, appTag);
  if (request.dryRun !== false) {
    return {
      status: 'DRY_RUN',
      appTag,
      imageTag,
      changed: updated !== xml,
      preview: updated
    };
  }
  fs.writeFileSync(absolutePath, updated, 'utf8');
  return {
    status: 'SAVED',
    appTag,
    imageTag,
    changed: updated !== xml
  };
}

function updateIdeaRunConfigTag(xml, imageTag, appTag) {
  const configurations = [...xml.matchAll(/<configuration\b[\s\S]*?<\/configuration>/g)];
  const selected = configurations.find(match => /<option\s+name="buildArgs"/.test(match[0]));
  if (!selected) {
    throw new Error('没有找到包含 APP_TAG buildArgs 的发布配置');
  }
  let block = selected[0];
  block = block.replace(
    /(<option\s+name="imageTag"\s+value=")[^"]*("\s*\/>)/,
    `$1${imageTag}$2`
  );
  block = block.replace(
    /(<DockerEnvVarImpl>[\s\S]*?<option\s+name="name"\s+value="APP_TAG"\s*\/>[\s\S]*?<option\s+name="value"\s+value=")[^"]*("\s*\/>[\s\S]*?<\/DockerEnvVarImpl>)/,
    `$1${appTag}$2`
  );
  return xml.slice(0, selected.index) + block + xml.slice(selected.index + selected[0].length);
}

async function executePlan(projectRoot, request, env = process.env, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const signal = options.signal;
  const plan = createPlan(projectRoot, request, env);
  const logs = [];
  const completedStepKeys = [];
  let currentStepKey = '';
  const stepLogs = {};
  const stepTiming = {};
  const updateStep = (stepKey, status, output) => {
    onProgress({
      plan: markStepStatus(plan, completedStepKeys, stepKey, status, stepLogs, stepTiming),
      logs: output === undefined ? logs.slice() : logs.concat(output),
      completedStepKeys: completedStepKeys.slice(),
      currentStepKey: stepKey,
      status: 'RUNNING'
    });
  };
  if (plan.dryRun) {
    const saved = saveTag(projectRoot, {
      appTag: plan.appTag,
      runConfigPath: request.runConfigPath,
      dryRun: true
    });
    logs.push(`${saved.status}: ${plan.imageTag}`);
    completedStepKeys.push(...plan.steps.map(step => step.key));
    const stepLogs = {};
    for (const step of plan.steps) {
      stepLogs[step.key] = step.key === 'save-run-config' ? logs.slice() : [];
    }
    const markedPlan = markCompletedSteps(plan, completedStepKeys, 'dry-run-checked', stepLogs, {});
    appendReleaseHistory(projectRoot, buildHistoryEntry('DRY_RUN', markedPlan, logs, completedStepKeys), env);
    return {status: 'DRY_RUN', plan: markedPlan, logs, completedStepKeys};
  }
  const pushStepLog = (stepKey, line) => {
    stepLogs[stepKey] = stepLogs[stepKey] || [];
    stepLogs[stepKey].push(line);
    logs.push(line);
  };
  const assertNotCancelled = () => {
    if (signal && signal.aborted) {
      throw new CancellationError('执行已取消');
    }
  };
  try {
    for (const step of plan.steps) {
      assertNotCancelled();
      currentStepKey = step.key;
      startStepTimer(step.key, stepTiming);
      pushStepLog(step.key, `[START] ${step.title}`);
      updateStep(step.key, 'running');
      if (step.key === 'save-run-config') {
        const saved = saveTag(projectRoot, {
          appTag: plan.appTag,
          runConfigPath: request.runConfigPath,
          dryRun: false
        });
        pushStepLog(step.key, `${saved.status}: ${plan.imageTag}`);
        completedStepKeys.push(step.key);
        const durationMs = finishStepTimer(step.key, stepTiming);
        pushStepLog(step.key, `[DONE] ${step.title}，用时 ${formatDurationMs(durationMs)}`);
        updateStep(step.key, 'done');
        continue;
      }
      if (step.executable) {
        pushStepLog(step.key, `[RUN] ${step.command}`);
        updateStep(step.key, 'running');
        await runPowerShell(projectRoot, step.command, env, chunk => {
          const line = chunk.trim();
          if (line) {
            pushStepLog(step.key, line);
            updateStep(step.key, 'running');
          }
        }, elapsedSeconds => {
          refreshStepElapsed(step.key, stepTiming);
          if (elapsedSeconds % 10 === 0) {
            pushStepLog(step.key, `[RUNNING] ${step.title} 已运行 ${elapsedSeconds} 秒，等待命令输出`);
          }
          updateStep(step.key, 'running');
        }, signal);
        if (step.validationCommand) {
          pushStepLog(step.key, `[VALIDATE] ${step.validationCommand}`);
          updateStep(step.key, 'running');
          await runPowerShell(projectRoot, step.validationCommand, env, chunk => {
            const line = chunk.trim();
            if (line) {
              pushStepLog(step.key, line);
              updateStep(step.key, 'running');
            }
          }, elapsedSeconds => {
            refreshStepElapsed(step.key, stepTiming);
            if (elapsedSeconds % 10 === 0) {
              pushStepLog(step.key, `[RUNNING] ${step.title} 校验已运行 ${elapsedSeconds} 秒，等待命令输出`);
            }
            updateStep(step.key, 'running');
          }, signal);
        }
        assertNotCancelled();
        completedStepKeys.push(step.key);
        const durationMs = finishStepTimer(step.key, stepTiming);
        pushStepLog(step.key, `[DONE] ${step.title}，用时 ${formatDurationMs(durationMs)}`);
        updateStep(step.key, 'done');
        continue;
      }
      pushStepLog(step.key, `[CHECK] ${step.validation}`);
      completedStepKeys.push(step.key);
      const durationMs = finishStepTimer(step.key, stepTiming);
      pushStepLog(step.key, `[DONE] ${step.title}，用时 ${formatDurationMs(durationMs)}`);
      updateStep(step.key, 'done');
    }
  } catch (error) {
    if (error.name === 'CancellationError') {
      finishStepTimer(currentStepKey, stepTiming);
      pushStepLog(currentStepKey, `CANCELLED: ${error.message}`);
      const cancelledLogs = logs.slice();
      const cancelledPlan = markStepStatus(plan, completedStepKeys, currentStepKey, 'cancelled', stepLogs, stepTiming);
      appendReleaseHistory(projectRoot, buildHistoryEntry('CANCELLED', cancelledPlan, cancelledLogs, completedStepKeys), env);
      return {status: 'CANCELLED', plan: cancelledPlan, logs: cancelledLogs, completedStepKeys};
    }
    finishStepTimer(currentStepKey, stepTiming);
    pushStepLog(currentStepKey, `ERROR: ${error.message}`);
    const errorLogs = logs.slice();
    const failedPlan = markStepStatus(plan, completedStepKeys, currentStepKey, 'failed', stepLogs, stepTiming);
    appendReleaseHistory(projectRoot, buildHistoryEntry('ERROR', failedPlan, errorLogs, completedStepKeys), env);
    return {status: 'ERROR', plan: failedPlan, logs: errorLogs, completedStepKeys};
  }
  const markedPlan = markCompletedSteps(plan, completedStepKeys, 'done', stepLogs, stepTiming);
  appendReleaseHistory(projectRoot, buildHistoryEntry('EXECUTED', markedPlan, logs, completedStepKeys), env);
  return {status: 'EXECUTED', plan: markedPlan, logs, completedStepKeys};
}

function historyFile(env = process.env) {
  return env.RELEASE_PUBLISHER_HISTORY_FILE
    ? path.resolve(env.RELEASE_PUBLISHER_HISTORY_FILE)
    : path.resolve(__dirname, '..', DEFAULT_HISTORY_FILE);
}

function readReleaseHistory(projectRoot, limit = 20, env = process.env) {
  const entries = readReleaseHistoryAll(projectRoot, env);
  return entries.slice(0, Math.max(1, Number(limit) || 20));
}

function readReleaseHistoryAll(projectRoot, env = process.env) {
  const filePath = historyFile(env);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [{
      id: 'history-read-error',
      createdAt: new Date().toISOString(),
      status: 'ERROR',
      message: `构造历史读取失败: ${error.message}`
    }];
  }
}

function appendReleaseHistory(projectRoot, entry, env = process.env, limit = 100) {
  const filePath = historyFile(env);
  const entries = readReleaseHistory(projectRoot, limit, env).filter(item => item.id !== 'history-read-error');
  const nextEntries = [entry].concat(entries).slice(0, limit);
  fs.writeFileSync(filePath, `${JSON.stringify(nextEntries, null, 2)}\n`, 'utf8');
  return nextEntries;
}

function readReleaseHistoryPage(projectRoot, request = {}, env = process.env) {
  const entries = readReleaseHistoryAll(projectRoot, env);
  const limit = Math.max(1, Math.min(50, Number(request.limit) || 10));
  const page = Math.max(1, Number(request.page) || 1);
  const offset = (page - 1) * limit;
  return {
    items: entries.slice(offset, offset + limit),
    total: entries.length,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(entries.length / limit))
  };
}

function deleteReleaseHistoryEntry(projectRoot, id, env = process.env) {
  const filePath = historyFile(env);
  const entries = readReleaseHistoryAll(projectRoot, env).filter(item => item.id !== 'history-read-error');
  const nextEntries = entries.filter(item => item.id !== id);
  fs.writeFileSync(filePath, `${JSON.stringify(nextEntries, null, 2)}\n`, 'utf8');
  return {deleted: nextEntries.length !== entries.length, total: nextEntries.length};
}

function clearReleaseHistory(projectRoot, env = process.env) {
  const filePath = historyFile(env);
  fs.writeFileSync(filePath, '[]\n', 'utf8');
  return {deleted: true, total: 0};
}

function buildHistoryEntry(status, plan, logs, completedStepKeys) {
  const completedDurations = plan.steps
    .filter(step => Number.isFinite(step.durationMs))
    .map(step => ({key: step.key, title: step.title, durationMs: step.durationMs}));
  const totalDurationMs = completedDurations.reduce((sum, step) => sum + step.durationMs, 0);
  const slowestStep = completedDurations
    .slice()
    .sort((left, right) => right.durationMs - left.durationMs)[0] || null;
  const commitEvidence = extractCommitEvidence(plan);
  return {
    id: `${new Date().toISOString()}-${plan.appTag}`,
    createdAt: new Date().toISOString(),
    status,
    dryRun: plan.dryRun,
    appTag: plan.appTag,
    imageTag: plan.imageTag,
    gitBranch: plan.gitBranch,
    gitCommit: plan.gitCommit,
    releaseCommit: commitEvidence.commit,
    releaseCommitShort: commitEvidence.shortCommit,
    releaseCommitDate: commitEvidence.date,
    releaseCommitSubject: commitEvidence.subject,
    includeStackDeploy: plan.includeStackDeploy,
    projectRoot: plan.config.projectRoot,
    dockerTarget: plan.config.dockerCommandTarget
      ? plan.config.dockerCommandTarget.description
      : plan.config.dockerContext,
    imageUploadTarget: plan.config.remoteImageTarget
      ? plan.config.remoteImageTarget.description
      : plan.config.remoteSshTarget,
    sshTarget: plan.config.remoteSshTarget,
    remoteComposeDir: plan.config.remoteComposeDir,
    stepCount: plan.steps.length,
    completedStepCount: completedStepKeys.length,
    totalDurationMs,
    slowestStep,
    stepSummary: plan.steps.map(step => ({
      key: step.key,
      title: step.title,
      status: step.status || 'pending',
      durationMs: Number.isFinite(step.durationMs) ? step.durationMs : null,
      actionType: step.actionType,
      productionAction: Boolean(step.productionAction),
      command: step.command,
      validation: step.validation,
      validationCommand: step.validationCommand || '',
      logs: Array.isArray(step.logs) ? step.logs.slice(-8) : []
    })),
    logs: logs.slice(0, 12)
  };
}

function extractCommitEvidence(plan) {
  const step = plan.steps.find(item => item.key === 'capture-release-commit');
  const lines = (step && Array.isArray(step.logs) ? step.logs : [])
    .map(line => String(line || '').trim())
    .filter(line => line
      && !line.startsWith('[START]')
      && !line.startsWith('[RUN]')
      && !line.startsWith('[DONE]')
      && !line.startsWith('[RUNNING]'));
  const commit = lines.find(line => /^[0-9a-f]{40}$/i.test(line)) || '';
  const detail = lines.find(line => /^[0-9a-f]{7,40}\t/.test(line)) || '';
  const [shortCommit, date, ...subjectParts] = detail.split('\t');
  return {
    commit,
    shortCommit: shortCommit || (commit ? commit.slice(0, 12) : ''),
    date: date || '',
    subject: subjectParts.join('\t')
  };
}

function markCompletedSteps(plan, completedStepKeys, status, stepLogs = {}, stepTiming = {}) {
  const completed = new Set(completedStepKeys);
  return {
    ...plan,
    steps: plan.steps.map(step => completed.has(step.key)
      ? withStepRuntime({...step, status, logs: stepLogs[step.key] || step.logs || []}, stepTiming)
      : withStepRuntime({...step, logs: stepLogs[step.key] || step.logs || []}, stepTiming))
  };
}

function markStepStatus(plan, completedStepKeys, stepKey, status, stepLogs = {}, stepTiming = {}) {
  const completed = new Set(completedStepKeys);
  return {
    ...plan,
    steps: plan.steps.map(step => {
      if (step.key === stepKey) {
        return withStepRuntime({...step, status, logs: stepLogs[step.key] || step.logs || []}, stepTiming);
      }
      return completed.has(step.key)
        ? withStepRuntime({...step, status: 'done', logs: stepLogs[step.key] || step.logs || []}, stepTiming)
        : withStepRuntime({...step, logs: stepLogs[step.key] || step.logs || []}, stepTiming);
    })
  };
}

function withStepRuntime(step, stepTiming) {
  const timing = stepTiming[step.key];
  return timing ? {...step, ...timing} : step;
}

function startStepTimer(stepKey, stepTiming, now = Date.now()) {
  stepTiming[stepKey] = {
    startedAt: new Date(now).toISOString(),
    finishedAt: '',
    elapsedMs: 0,
    durationMs: null
  };
}

function refreshStepElapsed(stepKey, stepTiming, now = Date.now()) {
  const timing = stepTiming[stepKey];
  if (!timing || timing.durationMs !== null) {
    return null;
  }
  timing.elapsedMs = Math.max(0, now - Date.parse(timing.startedAt));
  return timing.elapsedMs;
}

function finishStepTimer(stepKey, stepTiming, now = Date.now()) {
  const timing = stepTiming[stepKey];
  if (!timing || timing.durationMs !== null) {
    return timing ? timing.durationMs : 0;
  }
  const durationMs = Math.max(0, now - Date.parse(timing.startedAt));
  timing.elapsedMs = durationMs;
  timing.durationMs = durationMs;
  timing.finishedAt = new Date(now).toISOString();
  return durationMs;
}

function formatDurationMs(value) {
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
  return `${minutes}m ${seconds}s`;
}

function proposeNextTag(currentTag, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const match = String(currentTag || '').match(/^(\d{8})(\d{2})$/);
  if (match && match[1] === date) {
    return `${date}${String(Number(match[2]) + 1).padStart(2, '0')}`;
  }
  return `${date}01`;
}

function validateTag(tag) {
  const value = String(tag || '').trim();
  if (!TAG_PATTERN.test(value)) {
    throw new Error('APP_TAG 只能包含字母、数字、点、下划线和连字符，长度不超过 64');
  }
  return value;
}

function validateGitBranch(ref) {
  const value = String(ref || '').trim();
  if (!GIT_REF_PATTERN.test(value) || value.includes('..') || value.endsWith('.lock')) {
    throw new Error('Git 分支只能包含字母、数字、点、下划线、斜杠、@、冒号和连字符，长度不超过 128');
  }
  return value;
}

function validateGitCommit(commit) {
  const value = String(commit || 'latest').trim();
  if (value === 'latest') {
    return value;
  }
  if (!GIT_COMMIT_PATTERN.test(value)) {
    throw new Error('Git 提交只能是 latest 或 7 到 40 位十六进制提交号');
  }
  return value;
}

function gitUpdateStep(branch, commit) {
  if (commit !== 'latest') {
    return {
      title: '切换到指定提交',
      summary: `在分支 ${branch} 下选择提交 ${commit}`,
      command: `git checkout ${shellToken(commit)}`,
      validation: `git merge-base --is-ancestor ${shellToken(commit)} ${shellToken(branch)} && git rev-parse --verify ${shellToken(commit)}`
    };
  }
  if (isRemoteBranch(branch)) {
    return {
      title: '切换到分支最新提交',
      summary: `使用远端分支 ${branch} 的最新提交`,
      command: `git checkout ${shellToken(branch)}`,
      validation: `git rev-parse --verify ${shellToken(branch)}`
    };
  }
  return {
    title: '更新到分支最新提交',
    summary: `切换到本地分支 ${branch} 并执行 fast-forward 更新`,
    command: chainPowerShellCommands([
      `git checkout ${shellToken(branch)}`,
      'git pull --ff-only'
    ]),
    validation: 'git status --short --branch; git rev-parse --short HEAD'
  };
}

function chainPowerShellCommands(commands) {
  return commands
    .map((command, index) => index === 0
      ? command
      : `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${command}`)
    .join('; ');
}

function isRemoteBranch(branch) {
  return String(branch || '').startsWith('origin/');
}

function listGitBranches(projectRoot, env = process.env, gitRunner = spawnSync) {
  if (env.RELEASE_PUBLISHER_DISABLE_GIT_LIST === 'true') {
    return {branches: [], defaultBranch: env.RELEASE_PUBLISHER_GIT_BRANCH || 'origin/master'};
  }
  const current = runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], gitRunner).trim();
  const output = runGit(projectRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes/origin'
  ], gitRunner);
  const seen = new Set();
  const branches = [];
  for (const raw of output.split(/\r?\n/)) {
    const name = raw.trim();
    if (!name || name === 'origin/HEAD' || seen.has(name)) {
      continue;
    }
    seen.add(name);
    branches.push({
      name,
      type: name.startsWith('origin/') ? 'remote' : 'local',
      current: name === current
    });
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    if (a.type !== b.type) {
      return a.type === 'local' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const defaultBranch = current && current !== 'HEAD' && seen.has(current)
    ? current
    : branches.find(branch => branch.name === 'origin/master')?.name || branches[0]?.name || 'origin/master';
  return {branches, defaultBranch};
}

function listGitCommits(projectRoot, branch, limit = 60, gitRunner = spawnSync) {
  const selectedBranch = validateGitBranch(branch || 'origin/master');
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 60));
  const output = runGit(projectRoot, [
    'log',
    `-${safeLimit}`,
    '--format=%H%x09%h%x09%ci%x09%s',
    selectedBranch
  ], gitRunner);
  const commits = output.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [hash, shortHash, date, ...subjectParts] = line.split('\t');
      return {
        hash,
        shortHash,
        date,
        subject: subjectParts.join('\t')
      };
    });
  return {branch: selectedBranch, commits};
}

function runGit(projectRoot, args, gitRunner = spawnSync) {
  const git = gitRunner('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (git.status !== 0) {
    throw new Error((git.stderr || git.stdout || `git ${args.join(' ')} 执行失败`).trim());
  }
  return git.stdout || '';
}

function dockerCommand(target, args) {
  const parts = ['docker'];
  if (target && target.mode === 'host' && target.host) {
    parts.push('-H', target.host);
  } else if (target && target.mode === 'context' && target.context) {
    parts.push('--context', target.context);
  } else if (typeof target === 'string' && target) {
    parts.push('--context', target);
  }
  return parts.concat(args).map(shellToken).join(' ');
}

function resolveDockerCommandTarget(contextName, dockerContextResolution) {
  if (dockerContextResolution && dockerContextResolution.resolved && contextName && dockerContextResolution.local === true) {
    return {
      mode: 'context',
      context: contextName,
      host: '',
      source: 'Local Docker CLI context',
      description: `本机 Docker context ${contextName}`
    };
  }
  return {
    mode: 'local',
    context: '',
    host: '',
    source: 'local-docker',
    description: '本机 Docker'
  };
}

function resolveRemoteImageTarget(target, ideaDockerServerResolution) {
  if (ideaDockerServerResolution && ideaDockerServerResolution.resolved) {
    return {
      mode: 'ssh',
      name: ideaDockerServerResolution.name || target || '',
      host: ideaDockerServerResolution.host,
      user: ideaDockerServerResolution.username,
      port: ideaDockerServerResolution.port || '22',
      keyPath: ideaDockerServerResolution.keyPath || '',
      target: `${ideaDockerServerResolution.username}@${ideaDockerServerResolution.host}`,
      description: `生产 Docker 主机 ${ideaDockerServerResolution.username}@${ideaDockerServerResolution.host}:${ideaDockerServerResolution.port || '22'}`
    };
  }
  return {
    mode: 'ssh',
    name: target || '',
    host: '',
    user: '',
    port: '',
    keyPath: '',
    target,
    description: target || '未设置 SSH 目标'
  };
}

function resolveReleaseDockerServerDetails(serverName, env = process.env) {
  const publisherConfigResolution = resolvePublisherDockerServerDetails(serverName, env);
  if (publisherConfigResolution.resolved || publisherConfigResolution.exists) {
    return publisherConfigResolution;
  }
  return resolveIdeaDockerServerDetails(serverName, env);
}

function resolvePublisherDockerServerDetails(serverName, env = process.env) {
  const configPath = publisherConfigPath(env);
  const result = {
    name: serverName || '',
    source: 'release-publisher.config.json',
    configPath,
    exists: fs.existsSync(configPath),
    resolved: false,
    sshConfigId: '',
    host: '',
    username: '',
    port: '',
    keyPath: '',
    dockerExePath: '',
    dockerComposeExePath: '',
    dockerHost: '',
    note: '',
    error: ''
  };
  if (!serverName) {
    result.note = '未设置 Docker Server 名称';
    return result;
  }
  if (!result.exists) {
    result.note = '未找到 release-publisher.config.json';
    return result;
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const servers = config.dockerServers || {};
    const server = servers[serverName];
    if (!server) {
      result.note = `release-publisher.config.json 未找到 Docker Server ${serverName}`;
      return result;
    }
    result.host = String(server.host || '');
    result.username = String(server.username || server.user || '');
    result.port = String(server.port || '22');
    result.keyPath = String(server.keyPath || '');
    result.dockerExePath = String(server.dockerExePath || '');
    result.dockerComposeExePath = String(server.dockerComposeExePath || '');
    result.dockerHost = result.username && result.host
      ? `ssh://${result.username}@${result.host}${result.port ? `:${result.port}` : ''}`
      : '';
    result.resolved = Boolean(result.dockerHost);
    result.note = result.resolved ? '已读取发布器仓库配置' : '发布器仓库配置不完整';
    return result;
  } catch (error) {
    result.error = error.message;
    result.note = 'release-publisher.config.json 不是有效 JSON';
    return result;
  }
}

function publisherConfigPath(env = process.env) {
  return env.RELEASE_PUBLISHER_CONFIG
    ? path.resolve(env.RELEASE_PUBLISHER_CONFIG)
    : path.resolve(__dirname, '..', DEFAULT_PUBLISHER_CONFIG);
}

function publishImageCommand(imageTag, target) {
  const safeName = imageTag.replace(/[^0-9A-Za-z_.-]/g, '-');
  const remoteTar = `/tmp/${safeName}.tar`;
  return [
    `$imageTar = Join-Path $env:TEMP ${shellToken(`${safeName}.tar`)}`,
    `if (Test-Path $imageTar) { Remove-Item -Force $imageTar }`,
    `${dockerCommand(null, ['save', '-o'])} $imageTar ${shellToken(imageTag)}`,
    `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
    scpUploadCommand('$imageTar', target, remoteTar),
    `if ($LASTEXITCODE -ne 0) { Remove-Item -Force $imageTar -ErrorAction SilentlyContinue; exit $LASTEXITCODE }`,
    remoteSshCommand(target, `docker load -i ${shellToken(remoteTar)} && rm -f ${shellToken(remoteTar)}`),
    `$remoteLoadExit = $LASTEXITCODE`,
    `Remove-Item -Force $imageTar -ErrorAction SilentlyContinue`,
    `exit $remoteLoadExit`
  ].join('; ');
}

function finalRuntimeCheckCommand(stackName, containerName, imageTag) {
  const serviceName = `${stackName}_${containerName}`;
  return [
    `docker stack services ${shellToken(stackName)}`,
    `docker stack ps ${shellToken(stackName)} --no-trunc`,
    `service_image=$(docker service inspect ${shellToken(serviceName)} --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')`,
    `echo service_image=$service_image`,
    `case "$service_image" in *${imageTag}*) ;; *) echo "ERROR: service image is not ${imageTag}"; exit 1;; esac`,
    `if docker stack ps ${shellToken(stackName)} --no-trunc --format '{{.CurrentState}} {{.Error}}' | grep -E 'Failed|Rejected'; then echo "ERROR: stack task has failed state"; exit 1; fi`
  ].join(' && ');
}

function remoteBashScriptCommand(script) {
  const text = Array.isArray(script) ? script.join('\n') : String(script);
  const encoded = Buffer.from(`set -e\n${text}\n`, 'utf8').toString('base64');
  return `printf %s "${encoded}" | base64 -d | bash`;
}

function remoteSshCommand(target, remoteCommand) {
  const ssh = sshCommandParts(target);
  if (!ssh.length) {
    throw new Error('缺少 SSH 目标');
  }
  return ssh.concat(remoteCommand).map(shellToken).join(' ');
}

function scpCommand(localPath, target, remotePath) {
  const scp = scpCommandParts(target);
  if (!scp.length) {
    throw new Error('缺少 SSH 目标');
  }
  return scp.concat(localPath, `${sshTargetValue(target)}:${remotePath}`).map(shellToken).join(' ');
}

function scpUploadCommand(localExpression, target, remotePath) {
  const scp = scpCommandParts(target);
  if (!scp.length) {
    throw new Error('缺少 SSH 目标');
  }
  return `${scp.map(shellToken).join(' ')} ${localExpression} ${shellToken(`${sshTargetValue(target)}:${remotePath}`)}`;
}

function sshCommandParts(target) {
  if (target && typeof target === 'object') {
    const parts = ['ssh'];
    if (target.keyPath) {
      parts.push('-i', target.keyPath);
    }
    if (target.port) {
      parts.push('-p', target.port);
    }
    return parts.concat(sshTargetValue(target));
  }
  return target ? ['ssh', target] : [];
}

function scpCommandParts(target) {
  if (target && typeof target === 'object') {
    const parts = ['scp'];
    if (target.keyPath) {
      parts.push('-i', target.keyPath);
    }
    if (target.port) {
      parts.push('-P', target.port);
    }
    return parts;
  }
  return target ? ['scp'] : [];
}

function sshTargetValue(target) {
  if (target && typeof target === 'object') {
    return target.target || (target.user && target.host ? `${target.user}@${target.host}` : target.name);
  }
  return target;
}

function resolveSshTargetDetails(target, env = process.env, sshRunner = spawnSync) {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  const result = {
    target: target || '',
    targetSource: env.RELEASE_PUBLISHER_SSH_TARGET ? 'RELEASE_PUBLISHER_SSH_TARGET'
      : env.RELEASE_PUBLISHER_DOCKER_CONTEXT ? 'RELEASE_PUBLISHER_DOCKER_CONTEXT'
        : 'IDEA server-name',
    sshConfigPath,
    sshConfigExists: fs.existsSync(sshConfigPath),
    resolved: false,
    hostName: '',
    user: '',
    port: '',
    identityFiles: [],
    identitiesOnly: '',
    note: ''
  };
  if (!target) {
    result.note = '未设置 SSH 目标';
    return result;
  }
  if (env.RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE === 'true') {
    result.note = '已跳过 SSH 配置解析';
    return result;
  }
  const ssh = sshRunner('ssh', ['-G', target], {
    encoding: 'utf8',
    windowsHide: true
  });
  const output = `${ssh.stdout || ''}\n${ssh.stderr || ''}`.trim();
  if (ssh.status !== 0) {
    result.note = output || 'ssh -G 解析失败';
    return result;
  }
  const parsed = parseSshGOutput(output);
  result.resolved = true;
  result.hostName = parsed.hostname || '';
  result.user = parsed.user || '';
  result.port = parsed.port || '';
  result.identityFiles = parsed.identityfile || [];
  result.identitiesOnly = parsed.identitiesonly || '';
  result.note = result.sshConfigExists
    ? '已根据本机 OpenSSH 配置展开'
    : '未找到 ~/.ssh/config，以下为 ssh -G 展开的默认值或系统配置';
  return result;
}

function parseSshGOutput(output) {
  const result = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf(' ');
    if (separator < 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).toLowerCase();
    const value = trimmed.slice(separator + 1).trim();
    if (key === 'identityfile') {
      result.identityfile = result.identityfile || [];
      result.identityfile.push(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveDockerContextDetails(contextName, env = process.env, dockerRunner = spawnSync) {
  const result = {
    name: contextName || 'default',
    source: env.RELEASE_PUBLISHER_DOCKER_CONTEXT ? 'RELEASE_PUBLISHER_DOCKER_CONTEXT' : 'IDEA server-name',
    resolved: false,
    description: '',
    dockerEndpoint: '',
    error: '',
    note: ''
  };
  if (!contextName) {
    result.note = '未设置 Docker context，Docker 将使用本机默认上下文';
    return result;
  }
  if (env.RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE === 'true') {
    result.note = '已跳过 Docker context 解析';
    return result;
  }
  const docker = dockerRunner('docker', ['context', 'inspect', contextName], {
    encoding: 'utf8',
    windowsHide: true
  });
  const output = (docker.stderr || docker.stdout || '').trim();
  if (docker.status !== 0) {
    result.error = output || 'docker context inspect 失败';
    result.note = `Docker 未找到 context ${contextName}`;
    return result;
  }
  try {
    const inspected = JSON.parse(docker.stdout || '[]');
    const context = Array.isArray(inspected) ? inspected[0] : inspected;
    const dockerEndpoint = context && context.Endpoints && context.Endpoints.docker
      ? context.Endpoints.docker.Host || ''
      : '';
    result.resolved = true;
    result.description = context && context.Metadata ? context.Metadata.Description || '' : '';
    result.dockerEndpoint = dockerEndpoint;
    result.note = dockerEndpoint ? '已读取 Docker context endpoint' : '已读取 Docker context，但没有 docker endpoint';
    return result;
  } catch (error) {
    result.error = error.message;
    result.note = 'Docker context 输出不是有效 JSON';
    return result;
  }
}

function resolveIdeaDockerServerDetails(serverName, env = process.env) {
  const productDir = env.RELEASE_PUBLISHER_JETBRAINS_PRODUCT_DIR || DEFAULT_JETBRAINS_PRODUCT_DIR;
  const optionsDir = env.RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR
    || path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JetBrains', productDir, 'options');
  const remoteServersPath = path.join(optionsDir, 'remote-servers.xml');
  const sshConfigsPath = path.join(optionsDir, 'sshConfigs.xml');
  const result = {
    name: serverName || '',
    source: 'JetBrains options',
    optionsDir,
    remoteServersPath,
    sshConfigsPath,
    resolved: false,
    sshConfigId: '',
    host: '',
    username: '',
    port: '',
    keyPath: '',
    dockerExePath: '',
    dockerComposeExePath: '',
    dockerHost: '',
    note: '',
    error: ''
  };
  if (!serverName) {
    result.note = '未设置 IDEA Docker Server 名称';
    return result;
  }
  if (env.RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE === 'true') {
    result.note = '已跳过 IDEA Docker Server 解析';
    return result;
  }
  if (!fs.existsSync(remoteServersPath)) {
    result.note = '未找到 JetBrains remote-servers.xml';
    return result;
  }
  const remoteServersXml = fs.readFileSync(remoteServersPath, 'utf8');
  const remoteServerBlock = findRemoteServerBlock(remoteServersXml, serverName);
  if (!remoteServerBlock) {
    result.note = `JetBrains 未找到 Docker Server ${serverName}`;
    return result;
  }
  result.sshConfigId = contributedValue(remoteServerBlock, 'DockerSshConnectionConfigurator.SshConfigId');
  result.dockerExePath = optionValue(remoteServerBlock, 'dockerExePath');
  result.dockerComposeExePath = optionValue(remoteServerBlock, 'dockerComposeExePath');
  if (!result.sshConfigId) {
    result.note = `Docker Server ${serverName} 未配置 SSH Config ID`;
    return result;
  }
  if (!fs.existsSync(sshConfigsPath)) {
    result.note = '未找到 JetBrains sshConfigs.xml';
    return result;
  }
  const sshConfigsXml = fs.readFileSync(sshConfigsPath, 'utf8');
  const sshConfig = findSshConfig(sshConfigsXml, result.sshConfigId);
  if (!sshConfig) {
    result.note = `未找到 SSH Config ID ${result.sshConfigId}`;
    return result;
  }
  result.host = sshConfig.host || '';
  result.username = sshConfig.username || '';
  result.port = sshConfig.port || '22';
  result.keyPath = sshConfig.keyPath || '';
  result.dockerHost = result.username && result.host
    ? `ssh://${result.username}@${result.host}${result.port ? `:${result.port}` : ''}`
    : '';
  result.resolved = Boolean(result.dockerHost);
  result.note = result.resolved ? '已读取 IDEA Docker Server SSH 配置' : 'IDEA Docker Server SSH 配置不完整';
  return result;
}

function findRemoteServerBlock(xml, name) {
  for (const match of String(xml || '').matchAll(/<remote-server\b[\s\S]*?<\/remote-server>/g)) {
    const block = match[0];
    if (attr(block, 'name') === name && attr(block, 'type') === 'docker') {
      return block;
    }
  }
  return '';
}

function contributedValue(xml, key) {
  const match = String(xml || '').match(new RegExp(`<entry\\s+contributedKey="${escapeRegExp(key)}"\\s+value="([^"]*)"\\s*\\/>`));
  return match ? decodeXml(match[1]) : '';
}

function findSshConfig(xml, id) {
  for (const match of String(xml || '').matchAll(/<sshConfig\b[^>]*\/>/g)) {
    const block = match[0];
    if (attr(block, 'id') === id) {
      return {
        id,
        host: attr(block, 'host'),
        username: attr(block, 'username'),
        port: attr(block, 'port'),
        keyPath: attr(block, 'keyPath')
      };
    }
  }
  return null;
}

function runPowerShell(cwd, command, env, onChunk, onHeartbeat, signal) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let heartbeat = null;
    let settled = false;
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd,
      env: {...process.env, ...env},
      windowsHide: true
    });
    const cleanup = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (signal) {
        signal.removeEventListener('abort', cancel);
      }
    };
    const cancel = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      killProcessTree(child);
      reject(new CancellationError('执行已取消'));
    };
    if (signal) {
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, {once: true});
    }
    let output = '';
    child.stdout.on('data', data => {
      if (settled) {
        return;
      }
      const text = data.toString();
      output += text;
      if (onChunk) {
        onChunk(text);
      }
    });
    child.stderr.on('data', data => {
      if (settled) {
        return;
      }
      const text = data.toString();
      output += text;
      if (onChunk) {
        onChunk(text);
      }
    });
    child.on('error', error => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(new Error(output || `command exited with ${code}`));
        return;
      }
      resolve(output.trim() || '[OK]');
    });
    if (onHeartbeat) {
      heartbeat = setInterval(() => {
        onHeartbeat(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
      }, 1000);
    }
  });
}

function killProcessTree(child) {
  if (!child || !child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  child.kill('SIGTERM');
}

class CancellationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancellationError';
  }
}

function resolveInside(projectRoot, relativePath) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('路径越界');
  }
  return target;
}

function optionBlock(xml, name) {
  const match = xml.match(new RegExp(`<option\\s+name="${escapeRegExp(name)}"[\\s\\S]*?<\\/option>`));
  return match ? match[0] : '';
}

function optionValue(xml, name) {
  const match = xml.match(new RegExp(`<option\\s+name="${escapeRegExp(name)}"\\s+value="([^"]*)"\\s*\\/>`));
  return match ? decodeXml(match[1]) : '';
}

function parseDockerEnvVars(block) {
  const result = {};
  for (const match of block.matchAll(/<DockerEnvVarImpl>[\s\S]*?<\/DockerEnvVarImpl>/g)) {
    const env = match[0];
    const name = optionValue(env, 'name');
    const value = optionValue(env, 'value');
    if (name) {
      result[name] = value;
    }
  }
  return result;
}

function dockerEnvValue(block, name) {
  return parseDockerEnvVars(block)[name] || '';
}

function dockerVolumeHostPath(block) {
  const firstVolume = block.match(/<DockerVolumeBindingImpl>[\s\S]*?<\/DockerVolumeBindingImpl>/);
  return firstVolume ? optionValue(firstVolume[0], 'hostPath') : '';
}

function imageNameFromTag(imageTag) {
  const index = String(imageTag || '').lastIndexOf(':');
  return index > 0 ? imageTag.slice(0, index) : DEFAULT_IMAGE_NAME;
}

function tagFromImage(imageTag) {
  const index = String(imageTag || '').lastIndexOf(':');
  return index >= 0 ? imageTag.slice(index + 1) : 'latest';
}

function attr(xml, name) {
  const match = xml.match(new RegExp(`${escapeRegExp(name)}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
}

function shellToken(value) {
  const text = String(value);
  if (/^[0-9A-Za-z._:/=-]+$/.test(text)) {
    return text;
  }
  return `'${escapePowerShell(text)}'`;
}

function escapeSedReplacement(value) {
  return String(value).replace(/[\\&#]/g, '\\$&');
}

function escapeEgrepPattern(value) {
  return String(value).replace(/[.[\]{}()*+?^$\\|#]/g, '\\$&');
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DEFAULT_RUN_CONFIG,
  DEFAULT_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  parseIdeaRunConfig,
  readConfig,
  createPlan,
  saveTag,
  updateIdeaRunConfigTag,
  executePlan,
  readReleaseHistory,
  readReleaseHistoryPage,
  deleteReleaseHistoryEntry,
  clearReleaseHistory,
  appendReleaseHistory,
  buildHistoryEntry,
  resolveSshTargetDetails,
  resolveDockerContextDetails,
  resolveReleaseDockerServerDetails,
  resolvePublisherDockerServerDetails,
  resolveIdeaDockerServerDetails,
  resolveDockerCommandTarget,
  listGitBranches,
  listGitCommits,
  parseSshGOutput,
  proposeNextTag,
  validateTag,
  validateGitBranch,
  validateGitCommit
};
