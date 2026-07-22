const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawn, spawnSync} = require('child_process');

const DEFAULT_RUN_CONFIG = '.run/148.135.9.123.run.xml';
const DEFAULT_IMAGE_NAME = 'hospital-backend';
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml';
const DEFAULT_STACK_NAME = 'hospital_stack';
const DEFAULT_REMOTE_COMPOSE_DIR = '/opt/1panel/docker/compose/hospital-stack';
const DEFAULT_FORUM_IMAGE_NAME = 'rhospital/flarum-sso';
const DEFAULT_FORUM_DOCKERFILE = 'integrations/flarum/Dockerfile';
const DEFAULT_FORUM_BUILD_CONTEXT = 'integrations/flarum';
const DEFAULT_FORUM_INIT_SCRIPTS = [
  'integrations/flarum/04-rhospital-secret.sh',
  'integrations/flarum/05-rhospital-env.sh'
];
const GAME_SSO_BASELINE_COMMIT = 'e54c5fba27b79b7d13ea9993e02eedf830875733';
const GAME_SSO_SOURCE_PATHS = [
  'src/main/java/com/zly/hospital/controller/api/ForumSsoController.java',
  'src/main/java/com/zly/hospital/service/ForumSsoDatabaseUpgradeService.java',
  'src/main/java/com/zly/hospital/service/ForumProvisioningService.java'
];
const GAME_RUNTIME_PATHS = ['Dockerfile', 'docker-compose.yml', 'entrypoint.sh', 'pom.xml'];
const GAME_MIGRATION_PREFIX = 'scripts/migration/';
const GAME_RUNTIME_PREFIXES = ['newrelic/', 'src/main/', GAME_MIGRATION_PREFIX];
const RELEASE_IMPACT_ASSESSMENT_PATH = 'release/release-impact.json';
const RELEASE_IMPACT_SCHEMA_VERSION = 1;
const RELEASE_CHECKLIST_DECISIONS = new Set(['existing-checks-sufficient', 'checklist-updated']);
const RELEASE_DATABASE_IMPACTS = new Set(['none', 'query-change', 'schema-change', 'data-change', 'configuration-change']);
const REQUIRED_RELEASE_CHECKS = {
  game: ['test-game-backend', 'pre-deploy-checklist', 'final-runtime-check'],
  forum: ['validate-forum-source', 'forum-preflight', 'final-runtime-check']
};
const KNOWN_RELEASE_CHECKS = {
  game: new Set([
    'validate-game-sso-source',
    'test-game-backend',
    'compile-artifact',
    'validate-game-image',
    'game-database-preflight',
    'apply-database-migrations',
    'pre-deploy-checklist',
    'final-runtime-check',
    'verify-tradepool-release'
  ]),
  forum: new Set([
    'validate-forum-source',
    'validate-forum-image',
    'forum-preflight',
    'final-runtime-check'
  ])
};
const GAME_DATABASE_CONTAINER_NAME = 'postgresql';
const GAME_DATABASE_NAME = 'hospital';
const RELEASE_MIGRATION_PATTERN = /^scripts\/migration\/[0-9A-Za-z][0-9A-Za-z._/-]*\.sql$/;
const CATALOG_UPGRADE_SOURCE_PATH = 'src/main/java/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.java';
const TRADE_POOL_REQUIRED_COLUMNS = ['listing_source', 'admin_source_email', 'admin_batch_id'];
const TRADE_POOL_REQUIRED_INDEXES = [
  'idx_toilet_listing_admin_batch',
  'idx_toilet_tx_type_id',
  'idx_toilet_tx_actor_id',
  'idx_toilet_tx_target_id'
];
const GAME_TRADE_POOL_IMAGE_PATHS = [
  'BOOT-INF/classes/com/zly/hospital/controller/page/AdminTradePoolPageController.class',
  'BOOT-INF/classes/com/zly/hospital/controller/api/AdminToiletMarketController.class',
  'BOOT-INF/classes/com/zly/hospital/service/AdminTradePoolService.class',
  'BOOT-INF/classes/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.class',
  'BOOT-INF/classes/templates/admin_tradepool.html'
];
const FORUM_RUNTIME_PREFIX = 'integrations/flarum/';
const DEFAULT_FORUM_REMOTE_COMPOSE_DIR = '/opt/1panel/apps/flarum/flarum';
const DEFAULT_FORUM_CONTAINER_NAME = 'flarum';
const DEFAULT_JETBRAINS_PRODUCT_DIR = 'IntelliJIdea2026.1';
const DEFAULT_HISTORY_FILE = '.release-history.json';
const DEFAULT_PUBLISHER_CONFIG = 'release-publisher.config.json';
const TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const GIT_REF_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._/@:-]{0,127}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-fA-F]{7,40}$/;
const releaseChangeAnalysisCache = new Map();

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

function readReleaseConfig(projectRoot, releaseTarget = 'game', runConfigPath = DEFAULT_RUN_CONFIG) {
  const target = validateReleaseTarget(releaseTarget);
  const gameConfig = readConfig(projectRoot, runConfigPath);
  if (target === 'game') {
    return {
      ...gameConfig,
      releaseTarget: 'game',
      releaseTargetLabel: '游戏',
      deploymentMode: 'swarm',
      buildContext: '.',
      defaultRemoteComposeDir: DEFAULT_REMOTE_COMPOSE_DIR
    };
  }
  return {
    ...gameConfig,
    releaseTarget: 'forum',
    releaseTargetLabel: '论坛',
    forumImageMode: 'build',
    forumImageModeLabel: '构建并上传新镜像',
    deploymentMode: 'compose',
    runConfigPath: '',
    absolutePath: '',
    imageTag: `${DEFAULT_FORUM_IMAGE_NAME}:latest`,
    imageName: DEFAULT_FORUM_IMAGE_NAME,
    appTag: '',
    dockerfile: DEFAULT_FORUM_DOCKERFILE,
    buildContext: DEFAULT_FORUM_BUILD_CONTEXT,
    containerName: DEFAULT_FORUM_CONTAINER_NAME,
    volumeHostPath: '/opt/1panel/apps/flarum/flarum/data',
    composeFile: DEFAULT_COMPOSE_FILE,
    stackName: '',
    defaultRemoteComposeDir: DEFAULT_FORUM_REMOTE_COMPOSE_DIR
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
  if (validateReleaseTarget(request.releaseTarget || 'game') === 'forum') {
    return createForumPlan(projectRoot, request, env);
  }
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
  const catalogSchemaVersion = resolveCatalogSchemaVersion(projectRoot, gitCommit);
  const releaseMigrations = resolveReleaseMigrations(projectRoot, gitCommit, request.changeAnalysis);
  assertJpaSchemaMigrationCoverage(projectRoot, gitCommit, request.changeAnalysis, releaseMigrations);
  const releaseImpactAssessment = resolveReleaseImpactAssessment(
    projectRoot,
    gitCommit,
    request.changeAnalysis,
    'game',
    releaseMigrations
  );
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
    ...(releaseImpactAssessment ? [releaseImpactValidationStep(releaseImpactAssessment)] : []),
    releaseStep({
      key: 'validate-game-sso-source',
      title: '校验游戏 SSO 发布基线',
      summary: '确认目标提交包含已上线的游戏论坛 SSO 和自动升级能力',
      command: chainPowerShellCommands([
        sourceCleanPowerShellCommand('gameReleaseChanges', [
          ...GAME_RUNTIME_PATHS,
          ...GAME_RUNTIME_PREFIXES.map(prefix => prefix.replace(/\/$/, ''))
        ]),
        `git merge-base --is-ancestor ${GAME_SSO_BASELINE_COMMIT} HEAD`,
        ...GAME_SSO_SOURCE_PATHS.map(sourcePath => `git cat-file -e HEAD:${sourcePath}`),
        `git grep -n -E ${shellToken(`MARKER_VERSION[[:space:]]*=[[:space:]]*${catalogSchemaVersion};`)} HEAD -- ${shellToken(CATALOG_UPGRADE_SOURCE_PATH)}`
      ]),
      validation: `目标提交必须包含 ${GAME_SSO_BASELINE_COMMIT.slice(0, 8)}、三个游戏 SSO 核心文件和 Catalog v${catalogSchemaVersion} 升级声明`,
      actionType: 'local-check',
      executable: true
    }),
    releaseStep({
      key: 'test-game-backend',
      title: '执行游戏后端测试',
      summary: '在制作镜像前运行完整 Maven 测试套件，阻止带失败测试的提交进入镜像',
      command: '.\\mvnw.cmd -q test',
      validation: '完整 Maven 测试套件必须通过',
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
      key: 'validate-game-image',
      title: '验证游戏镜像版本、迁移包与交易池能力',
      summary: `确认运行镜像内的 TAG、迁移清单、SSO、Catalog v${catalogSchemaVersion} 和管理员交易池代码完整`,
      command: gameImageValidationCommand(dockerTarget, imageTag, appTag, catalogSchemaVersion),
      validation: `镜像内 IMAGE_TAG=${appTag}，/app/migrations 清单必须完整，Catalog 版本必须等于目标提交的 v${catalogSchemaVersion}，并包含 SSO 和管理员交易池代码`,
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
      title: '读取生产编排当前版本',
      summary: '进入 hospital-stack 编排目录，确认当前镜像和前端运行版本使用同一个 TAG',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*hospital-backend:|^[[:space:]]*(-[[:space:]]*)?(IMAGE_TAG|FORUM_SSO_ENABLED|FORUM_SSO_SECRET_FILE)([[:space:]]*[:=])' docker-compose.yml`,
        ...gameComposeSsoContractCommands()
      ])),
      validation: `必须同时读到游戏镜像、IMAGE_TAG、FORUM_SSO_ENABLED=true 和论坛 SSO Secret`,
      actionType: 'remote-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'game-database-preflight',
      title: '盘点交易池数据库升级前状态',
      summary: '使用当前健康容器的 JDBC 驱动执行只读检查，记录 Catalog 标记、目标字段和索引现状',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        gameDatabasePreflightCommand(config.stackName, config.containerName, catalogSchemaVersion)
      )),
      validation: `当前运行容器必须只读输出数据库结构状态，数据库版本不得高于目标 v${catalogSchemaVersion}`,
      actionType: 'remote-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'backup-game-release',
      title: '备份游戏编排与交易池数据',
      summary: '在替换编排前保存 Compose、服务和镜像证据，并只读导出升级涉及的交易池表',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        gameReleaseBackupCommand(
          remoteComposeDir,
          config.stackName,
          config.containerName,
          catalogSchemaVersion,
          releaseMigrations
        )
      )),
      validation: releaseMigrations.length > 0
        ? '备份目录、交易池数据、完整 hospital 数据库快照和 SHA256SUMS 必须完整'
        : '备份目录、交易池数据导出和 SHA256SUMS 必须完整，并记录本次发布起始时间',
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    if (releaseMigrations.length > 0) {
      steps.push(releaseStep({
        key: 'apply-database-migrations',
        title: '执行目标提交数据库迁移',
        summary: `从目标镜像提取并核验迁移包，在切换镜像前按路径顺序执行 ${releaseMigrations.length} 个脚本`,
        command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
          applyGameDatabaseMigrationsCommand(remoteComposeDir, imageTag, releaseMigrations)
        )),
        validation: `迁移必须来自目标镜像 /app/migrations，镜像清单、目标提交 SHA256 和脚本实际 SHA256 必须一致：${releaseMigrations.map(item => item.filePath).join(', ')}`,
        actionType: 'production',
        productionAction: true,
        executable: true
      }));
    }
    steps.push(releaseStep({
      key: 'pre-deploy-checklist',
      title: '发布前 CheckList 总验收',
      summary: '在切换生产编排前统一验证目标镜像、当前服务、备份校验和、数据库迁移回执和回滚入口',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        gamePreDeployChecklistCommand(remoteComposeDir, config.stackName, config.containerName, imageTag, releaseMigrations)
      )),
      validation: 'CheckList 所有项目必须输出 PASS，任一项目失败时禁止更新 Compose 和执行热滚',
      actionType: 'remote-check',
      executable: true,
      timeoutSeconds: 120
    }));
    steps.push(releaseStep({
      key: 'update-remote-compose',
      title: '备份并替换生产编排 TAG',
      summary: '备份 docker-compose.yml，同时替换服务镜像和前端运行版本，并校验编排文件',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `image_line_count=$(grep -Ec '^[[:space:]]*image:[[:space:]]*hospital-backend:' docker-compose.yml)`,
        `version_line_count=$(grep -Ec '^[[:space:]]*(-[[:space:]]*)?IMAGE_TAG([[:space:]]*[:=])' docker-compose.yml)`,
        `[ "$image_line_count" -eq 1 ] || { echo "ERROR: expected exactly one hospital-backend image line, found $image_line_count"; exit 1; }`,
        `[ "$version_line_count" -eq 1 ] || { echo "ERROR: expected exactly one IMAGE_TAG line, found $version_line_count"; exit 1; }`,
        ...gameComposeSsoContractCommands(),
        `cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)`,
        `sed -i -E 's#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\\1${escapeSedReplacement(imageTag)}#' docker-compose.yml`,
        `sed -i -E 's#^([[:space:]]*-[[:space:]]*IMAGE_TAG=).*$#\\1${escapeSedReplacement(appTag)}#' docker-compose.yml`,
        `sed -i -E 's#^([[:space:]]*IMAGE_TAG:[[:space:]]*).*$#\\1"${escapeSedReplacement(appTag)}"#' docker-compose.yml`,
        `docker stack config -c docker-compose.yml >/dev/null`
      ])),
      validation: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`,
        `grep -nE '^[[:space:]]*-[[:space:]]*IMAGE_TAG=${escapeEgrepPattern(appTag)}[[:space:]]*$|^[[:space:]]*IMAGE_TAG:[[:space:]]*"?${escapeEgrepPattern(appTag)}"?[[:space:]]*$' docker-compose.yml`,
        ...gameComposeSsoContractCommands(),
        `docker stack config -c docker-compose.yml >/dev/null`
      ])),
      validationCommand: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`,
        `grep -nE '^[[:space:]]*-[[:space:]]*IMAGE_TAG=${escapeEgrepPattern(appTag)}[[:space:]]*$|^[[:space:]]*IMAGE_TAG:[[:space:]]*"?${escapeEgrepPattern(appTag)}"?[[:space:]]*$' docker-compose.yml`,
        ...gameComposeSsoContractCommands(),
        `docker stack config -c docker-compose.yml >/dev/null`
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
      summary: '等待 Swarm 滚动完成，确认镜像、运行版本、健康副本和旧任务全部收敛',
      command: remoteSshCommand(remoteImageTarget,
        remoteBashScriptCommand(finalRuntimeCheckCommand(config.stackName, config.containerName, imageTag, appTag))),
      validation: `服务镜像和 IMAGE_TAG 必须为 ${imageTag}，Swarm 更新完成且只有目标版本健康副本运行`,
      actionType: 'remote-check',
      executable: true,
      finalCheck: true,
      timeoutSeconds: 960
    }));
    steps.push(releaseStep({
      key: 'verify-tradepool-release',
      title: '验证管理员交易池发布结果',
      summary: `核对 Catalog v${catalogSchemaVersion} 标记、字段、索引、迁移日志、匿名页面跳转和管理员 API 拒绝未登录请求`,
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        tradePoolPostDeployCheckCommand(remoteComposeDir, config.stackName, config.containerName, catalogSchemaVersion)
      )),
      validation: `Catalog 标记必须等于 ${catalogSchemaVersion} 且状态为 COMPLETED，交易池字段和索引完整，匿名访问保持受限`,
      actionType: 'remote-check',
      executable: true,
      finalCheck: true,
      timeoutSeconds: 120
    }));
    steps.push(releaseStep({
      key: 'game-rollback-command',
      title: '记录游戏回滚命令',
      summary: '业务验收失败或切换后取消时自动暂停在售 ADMIN 挂单、恢复发布前 Compose，并等待旧版本重新健康',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        gameAutomaticRollbackCommand(remoteComposeDir, config.stackName, config.containerName)
      )),
      validation: '自动恢复必须输出 automatic_rollback_validation=PASS；失败时任务进入 RECOVERY_REQUIRED 并保留现场',
      actionType: 'local-check'
    }));
  }

  assertReleaseImpactPlanCoverage(releaseImpactAssessment, steps, includeStackDeploy);

  return {
    config: {
      ...config,
      releaseTarget: 'game',
      releaseTargetLabel: '游戏',
      deploymentMode: 'swarm',
      buildContext: '.',
      dockerContext,
      remoteSshTarget,
      remoteComposeDir,
      sshResolution,
      dockerContextResolution,
      ideaDockerServerResolution,
      dockerCommandTarget: dockerTarget,
      remoteImageTarget,
      catalogSchemaVersion,
      releaseImpactAssessment,
      databaseMigrations: releaseMigrations.map(item => ({
        filePath: item.filePath,
        sha256: item.sha256
      })),
      executionEnabled: true
    },
    releaseTarget: 'game',
    releaseTargetLabel: '游戏',
    appTag,
    imageTag,
    gitBranch,
    gitCommit,
    changeAnalysis: request.changeAnalysis || null,
    includeStackDeploy,
    dryRun: request.dryRun !== false,
    steps,
    guardrails: [
      '勾选 dry run 时只生成命令和写入预览',
      '取消 dry run 后会执行本地测试、镜像上传和勾选范围内的远端发布步骤',
      '目标提交新增或修改的 scripts/migration/*.sql 必须存在于目标镜像，并在镜像切换前完成备份、提取、校验和执行',
      '旧代码回滚前必须暂停所有 ACTIVE 的 ADMIN 挂单，避免旧版交易逻辑继续处理系统库存'
    ]
  };
}

function createForumPlan(projectRoot, request, env = process.env) {
  const config = readReleaseConfig(projectRoot, 'forum', request.runConfigPath || DEFAULT_RUN_CONFIG);
  const forumImageMode = validateForumImageMode(request.forumImageMode || config.forumImageMode);
  const forumImageModeLabel = forumImageMode === 'reuse' ? '复用生产已有镜像' : '构建并上传新镜像';
  const appTag = validateTag(request.appTag || proposeNextTag(''));
  const imageTag = `${config.imageName}:${appTag}`;
  const dockerContext = request.dockerContext || env.RELEASE_PUBLISHER_DOCKER_CONTEXT || config.serverName;
  const remoteSshTarget = request.remoteSshTarget || env.RELEASE_PUBLISHER_SSH_TARGET || dockerContext;
  const remoteComposeDir = request.remoteComposeDir
    || env.RELEASE_PUBLISHER_FORUM_REMOTE_COMPOSE_DIR
    || DEFAULT_FORUM_REMOTE_COMPOSE_DIR;
  const sshResolution = resolveSshTargetDetails(remoteSshTarget, env);
  const dockerContextResolution = resolveDockerContextDetails(dockerContext, env);
  const ideaDockerServerResolution = resolveReleaseDockerServerDetails(dockerContext, env);
  const dockerTarget = resolveDockerCommandTarget(dockerContext, dockerContextResolution);
  const remoteImageTarget = resolveRemoteImageTarget(remoteSshTarget, ideaDockerServerResolution);
  const includeStackDeploy = Boolean(request.includeStackDeploy);
  const gitBranch = forumImageMode === 'build'
    ? validateGitBranch(request.gitBranch || env.RELEASE_PUBLISHER_GIT_BRANCH || 'origin/master')
    : 'not-used';
  const gitCommit = forumImageMode === 'build'
    ? validateGitCommit(request.gitCommit || 'latest')
    : 'not-used';
  const releaseImpactAssessment = forumImageMode === 'build'
    ? resolveReleaseImpactAssessment(projectRoot, gitCommit, request.changeAnalysis, 'forum', [])
    : null;
  const steps = [];

  if (forumImageMode === 'build') {
    const gitUpdate = gitUpdateStep(gitBranch, gitCommit);
    steps.push(releaseStep({
      key: 'git-status-before-update',
      title: '检查本地代码状态',
      summary: '读取当前分支、当前提交和工作区状态，确认论坛发布代码来源',
      command: chainPowerShellCommands(['git status --short --branch', 'git rev-parse --short HEAD']),
      validation: '确认工作区状态可接受，避免拉取代码时覆盖未处理改动',
      actionType: 'local-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'git-fetch',
      title: '获取远端代码',
      summary: '从 origin 拉取远端引用，供最新发布或指定提交发布使用',
      command: 'git fetch --prune origin',
      validation: 'git fetch 必须成功，远端引用必须可解析',
      actionType: 'local-code',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'git-update',
      title: gitUpdate.title,
      summary: gitUpdate.summary,
      command: gitUpdate.command,
      validation: gitUpdate.validation,
      actionType: 'local-code',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'capture-release-commit',
      title: '记录发布提交',
      summary: '记录本次实际发布使用的 Git HEAD，作为论坛镜像审计证据',
      command: chainPowerShellCommands(['git rev-parse HEAD', 'git log -1 --format="%h%x09%ci%x09%s"']),
      validation: '历史记录必须包含实际提交 hash、提交时间和提交说明',
      actionType: 'local-check',
      executable: true
    }));
  }

  if (releaseImpactAssessment) {
    steps.push(releaseImpactValidationStep(releaseImpactAssessment));
  }

  steps.push(releaseStep({
      key: 'validate-release-input',
      title: '校验论坛发布 TAG',
      summary: forumImageMode === 'build'
        ? '确认论坛 Dockerfile、构建目录和不可变镜像 TAG'
        : '确认要复用的生产镜像 TAG，不执行本地构建和上传',
      command: forumImageMode === 'build' ? `读取 ${config.dockerfile}` : `复用 ${imageTag}`,
      validation: `target=forum, imageMode=${forumImageMode}, tag=${appTag}, image=${imageTag}`,
      actionType: 'local-check'
  }));

  if (forumImageMode === 'build') {
    steps.push(releaseStep({
      key: 'validate-forum-source',
      title: '校验论坛发布源码',
      summary: '执行论坛镜像契约测试和初始化脚本语法检查',
      command: chainPowerShellCommands([
        '.\\mvnw.cmd -q "-Dtest=ForumFlarumImageAssetTest,ForumDeploymentConfigTest" test',
        ...forumSourceScriptValidationCommands()
      ]),
      validation: '论坛镜像契约测试必须通过，两个初始化脚本必须与发布提交一致且语法有效',
      actionType: 'local-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'build-image',
      title: '制作论坛 Docker 镜像',
      summary: '在本机 Docker 构建带扩展和初始化逻辑的论坛不可变镜像',
      command: dockerCommand(dockerTarget, [
        'build', '--pull=false', '-f', config.dockerfile, '-t', imageTag, config.buildContext
      ]),
      validation: dockerCommand(dockerTarget, ['image', 'inspect', imageTag, '--format', '{{.Id}} {{.RepoTags}}']),
      validationCommand: dockerCommand(dockerTarget, ['image', 'inspect', imageTag, '--format', '{{.Id}} {{.RepoTags}}']),
      actionType: 'build',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'validate-forum-image',
      title: '验证论坛镜像运行边界',
      summary: '验证 root-only Secret 转存、Flarum 用户读取、PHP 语法和 Composer 安全公告',
      command: forumImageValidationCommand(dockerTarget, imageTag),
      validation: 'Secret 权限、重复初始化、PHP 语法和 Composer 审计必须全部通过',
      actionType: 'local-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'publish-image',
      title: '发布论坛镜像到生产镜像池',
      summary: '把本机论坛镜像保存为 tar，经 SSH 上传到生产 Docker 主机并执行 docker load',
      command: publishImageCommand(imageTag, remoteImageTarget),
      validation: remoteSshCommand(remoteImageTarget, `docker image inspect ${shellToken(imageTag)} --format '{{.Id}} {{.RepoTags}}'`),
      validationCommand: remoteSshCommand(remoteImageTarget, `docker image inspect ${shellToken(imageTag)} --format '{{.Id}} {{.RepoTags}}'`),
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
  } else {
    steps.push(releaseStep({
      key: 'validate-existing-forum-image',
      title: '校验生产已有论坛镜像',
      summary: '只读确认生产 Docker 镜像池中已经存在指定不可变 TAG',
      command: remoteSshCommand(remoteImageTarget,
        `docker image inspect ${shellToken(imageTag)} --format '{{.Id}} {{.RepoTags}}'`),
      validation: `生产镜像池必须存在 ${imageTag}，不存在时流程立即停止`,
      actionType: 'remote-check',
      executable: true
    }));
  }

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
      title: '读取论坛生产编排当前镜像',
      summary: '进入 Flarum 编排目录，确认当前论坛镜像行',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(config.imageName)}:' docker-compose.yml`
      ])),
      validation: `必须能读到 image: ${config.imageName}:<TAG>`,
      actionType: 'remote-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'forum-preflight',
      title: '检查论坛生产发布前状态',
      summary: '只读确认 Compose、论坛容器、MySQL、Secret 元数据和磁盘空间',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(forumPreflightCommand(remoteComposeDir))),
      validation: 'Compose 必须可渲染，论坛和 MySQL 容器必须运行，Secret 只能读取元数据且磁盘空间充足',
      actionType: 'remote-check',
      executable: true
    }));
    steps.push(releaseStep({
      key: 'backup-forum-release',
      title: '生成论坛发布备份点',
      summary: '备份 MySQL、data、Compose、环境文件和当前镜像证据，生成校验和',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(forumBackupCommand(remoteComposeDir))),
      validation: '备份目录中的数据库、data、Compose、镜像证据和 SHA256SUMS 必须非空',
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    steps.push(releaseStep({
      key: 'update-remote-compose',
      title: '替换论坛生产编排 TAG',
      summary: '保留修改前 Compose 副本，然后把论坛镜像替换成本次不可变 TAG',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        'cp docker-compose.yml docker-compose.yml.pre-release.$(date -u +%Y%m%dT%H%M%SZ)',
        `sed -i -E 's#^([[:space:]]*image:[[:space:]]*)${escapeEgrepPattern(config.imageName)}:[^[:space:]]+#\\1${escapeSedReplacement(imageTag)}#' docker-compose.yml`,
        'docker compose config >/dev/null'
      ])),
      validation: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`,
        'docker compose config >/dev/null'
      ])),
      validationCommand: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `grep -nE '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageTag)}$' docker-compose.yml`,
        'docker compose config >/dev/null'
      ])),
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    steps.push(releaseStep({
      key: 'deploy-forum-compose',
      title: '替换论坛容器',
      summary: '使用 Docker Compose 只重建 Flarum 服务，保留 MySQL、网络和持久数据',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand([
        `cd ${shellToken(remoteComposeDir)}`,
        `docker compose up -d --no-deps --force-recreate ${shellToken(config.containerName)}`
      ])),
      validation: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        forumContainerRunningCheck(config.containerName)
      )),
      validationCommand: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        forumContainerRunningCheck(config.containerName)
      )),
      actionType: 'production',
      productionAction: true,
      executable: true
    }));
    steps.push(releaseStep({
      key: 'final-runtime-check',
      title: '论坛最终运行校验',
      summary: '确认论坛镜像、Flarum 版本、扩展、Secret 读取、公网 HTTP 和错误日志',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(
        finalForumRuntimeCheckCommand(config.containerName, imageTag)
      )),
      validation: `容器必须运行 ${imageTag}，Flarum 和 rhospital-sso 正常，Secret 可由 flarum 读取，公网返回成功`,
      actionType: 'remote-check',
      executable: true,
      finalCheck: true
    }));
    steps.push(releaseStep({
      key: 'forum-rollback-command',
      title: '记录论坛回滚命令',
      summary: '保留上一个 Compose 和备份目录的回滚入口，发布流程不会自动执行回滚',
      command: remoteSshCommand(remoteImageTarget, remoteBashScriptCommand(forumRollbackCommand(remoteComposeDir))),
      validation: '仅在验收失败且人工确认后执行；数据库和 data 完整恢复另行确认',
      actionType: 'local-check'
    }));
  }

  assertReleaseImpactPlanCoverage(releaseImpactAssessment, steps, includeStackDeploy);

  return {
    config: {
      ...config,
      forumImageMode,
      forumImageModeLabel,
      dockerContext,
      remoteSshTarget,
      remoteComposeDir,
      sshResolution,
      dockerContextResolution,
      ideaDockerServerResolution,
      dockerCommandTarget: dockerTarget,
      remoteImageTarget,
      releaseImpactAssessment,
      executionEnabled: true
    },
    releaseTarget: 'forum',
    releaseTargetLabel: '论坛',
    forumImageMode,
    forumImageModeLabel,
    appTag,
    imageTag,
    gitBranch,
    gitCommit,
    changeAnalysis: request.changeAnalysis || null,
    includeStackDeploy,
    dryRun: request.dryRun !== false,
    steps,
    guardrails: [
      '论坛镜像 TAG 必须保持不可变；构建模式使用新 TAG，复用模式只使用生产镜像池中已经存在的 TAG',
      forumImageMode === 'reuse'
        ? '复用模式只校验生产已有镜像，不执行源码更新、Maven、Docker build、docker save、SCP 或 docker load'
        : '构建模式执行源码校验、镜像构建、运行验证和镜像上传',
      '正式执行先生成 MySQL、data、Compose 和镜像证据备份，再替换论坛容器',
      '回滚命令只记录不自动执行，完整数据恢复需要人工确认'
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
  finalCheck = false,
  timeoutSeconds = 0
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
    timeoutSeconds,
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
  const runCommand = typeof options.runCommand === 'function' ? options.runCommand : runPowerShell;
  const plan = createPlan(projectRoot, request, env);
  let runtimePlan = plan;
  const logs = [];
  const completedStepKeys = [];
  let currentStepKey = '';
  const stepLogs = {};
  const stepTiming = {};
  let executionStatus = 'RUNNING';
  let cutoverStarted = false;
  const updateStep = (stepKey, status, output) => {
    const activeStep = runtimePlan.steps.find(step => step.key === stepKey);
    const elapsedMs = stepTiming[stepKey] ? stepTiming[stepKey].elapsedMs : 0;
    const timeoutSeconds = activeStep ? Number(activeStep.timeoutSeconds || 0) : 0;
    onProgress({
      plan: markStepStatus(runtimePlan, completedStepKeys, stepKey, status, stepLogs, stepTiming),
      logs: output === undefined ? logs.slice() : logs.concat(output),
      completedStepKeys: completedStepKeys.slice(),
      currentStepKey: stepKey,
      currentStepTitle: activeStep ? activeStep.title : stepKey,
      stepElapsedSeconds: Math.floor((Number(elapsedMs) || 0) / 1000),
      stepTimeoutSeconds: timeoutSeconds,
      stepRemainingSeconds: timeoutSeconds > 0 ? Math.max(0, timeoutSeconds - Math.floor((Number(elapsedMs) || 0) / 1000)) : null,
      heartbeatAt: new Date().toISOString(),
      status: executionStatus
    });
  };
  if (plan.dryRun) {
    const saved = plan.releaseTarget === 'game'
      ? saveTag(projectRoot, {
          appTag: plan.appTag,
          runConfigPath: request.runConfigPath,
          dryRun: true
        })
      : {status: 'DRY_RUN', appTag: plan.appTag, imageTag: plan.imageTag, changed: false};
    logs.push(`${saved.status}: ${plan.imageTag}`);
    completedStepKeys.push(...plan.steps.map(step => step.key));
    const stepLogs = {};
    for (const step of plan.steps) {
      stepLogs[step.key] = step.key === (plan.releaseTarget === 'game' ? 'save-run-config' : 'validate-release-input')
        ? logs.slice()
        : [];
    }
    const markedPlan = markCompletedSteps(plan, completedStepKeys, 'dry-run-checked', stepLogs, {});
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
        if (step.key === 'deploy-stack') {
          cutoverStarted = true;
        }
        pushStepLog(step.key, `[RUN] ${step.command}`);
        updateStep(step.key, 'running');
        await runCommand(projectRoot, step.command, env, chunk => {
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
        }, signal, step.timeoutSeconds);
        if (step.validationCommand) {
          pushStepLog(step.key, `[VALIDATE] ${step.validationCommand}`);
          updateStep(step.key, 'running');
          await runCommand(projectRoot, step.validationCommand, env, chunk => {
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
          }, signal, step.timeoutSeconds);
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
    const failedStepKey = currentStepKey;
    finishStepTimer(failedStepKey, stepTiming);
    pushStepLog(failedStepKey, `${error.name === 'CancellationError' ? 'CANCELLED' : 'ERROR'}: ${error.message}`);
    runtimePlan = markStepStatus(runtimePlan, completedStepKeys, failedStepKey,
      error.name === 'CancellationError' ? 'cancelled' : 'failed', stepLogs, stepTiming);
    const shouldRecover = plan.releaseTarget === 'game'
      && cutoverStarted
      && !completedStepKeys.includes('verify-tradepool-release');
    if (shouldRecover) {
      const rollbackStep = plan.steps.find(step => step.key === 'game-rollback-command');
      currentStepKey = rollbackStep.key;
      executionStatus = 'RECOVERING';
      startStepTimer(rollbackStep.key, stepTiming);
      pushStepLog(rollbackStep.key, `[RECOVER] ${rollbackStep.title}`);
      pushStepLog(rollbackStep.key, `[RUN] ${rollbackStep.command}`);
      updateStep(rollbackStep.key, 'running');
      try {
        await runCommand(projectRoot, rollbackStep.command, env, chunk => {
          const line = chunk.trim();
          if (line) {
            pushStepLog(rollbackStep.key, line);
          }
          refreshStepElapsed(rollbackStep.key, stepTiming);
          updateStep(rollbackStep.key, 'running');
        }, elapsedSeconds => {
          refreshStepElapsed(rollbackStep.key, stepTiming);
          if (elapsedSeconds % 10 === 0) {
            pushStepLog(rollbackStep.key, `[RECOVERING] 自动恢复已运行 ${elapsedSeconds} 秒`);
          }
          updateStep(rollbackStep.key, 'running');
        }, null, 960);
        completedStepKeys.push(rollbackStep.key);
        const durationMs = finishStepTimer(rollbackStep.key, stepTiming);
        pushStepLog(rollbackStep.key, `[DONE] 自动恢复完成，用时 ${formatDurationMs(durationMs)}`);
        runtimePlan = markStepStatus(runtimePlan, completedStepKeys, rollbackStep.key, 'done', stepLogs, stepTiming);
        const recoveredLogs = logs.slice();
        appendReleaseHistory(projectRoot, buildHistoryEntry('ROLLED_BACK', runtimePlan, recoveredLogs, completedStepKeys), env);
        return {status: 'ROLLED_BACK', plan: runtimePlan, logs: recoveredLogs, completedStepKeys};
      } catch (recoveryError) {
        finishStepTimer(rollbackStep.key, stepTiming);
        pushStepLog(rollbackStep.key, `RECOVERY_REQUIRED: ${recoveryError.message}`);
        runtimePlan = markStepStatus(runtimePlan, completedStepKeys, rollbackStep.key, 'failed', stepLogs, stepTiming);
        const recoveryLogs = logs.slice();
        appendReleaseHistory(projectRoot, buildHistoryEntry('RECOVERY_REQUIRED', runtimePlan, recoveryLogs, completedStepKeys), env);
        return {status: 'RECOVERY_REQUIRED', plan: runtimePlan, logs: recoveryLogs, completedStepKeys};
      }
    }
    if (error.name === 'CancellationError') {
      const cancelledLogs = logs.slice();
      const cancelledPlan = runtimePlan;
      appendReleaseHistory(projectRoot, buildHistoryEntry('CANCELLED', cancelledPlan, cancelledLogs, completedStepKeys), env);
      return {status: 'CANCELLED', plan: cancelledPlan, logs: cancelledLogs, completedStepKeys};
    }
    const errorLogs = logs.slice();
    const failedPlan = runtimePlan;
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
  clearReleaseChangeAnalysisCache();
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
  clearReleaseChangeAnalysisCache();
  return {deleted: nextEntries.length !== entries.length, total: nextEntries.length};
}

function clearReleaseHistory(projectRoot, env = process.env) {
  const filePath = historyFile(env);
  fs.writeFileSync(filePath, '[]\n', 'utf8');
  clearReleaseChangeAnalysisCache();
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
  const releaseImpactAssessment = plan.config && plan.config.releaseImpactAssessment;
  return {
    id: `${new Date().toISOString()}-${plan.appTag}`,
    createdAt: new Date().toISOString(),
    status,
    dryRun: plan.dryRun,
    releaseTarget: plan.releaseTarget || 'game',
    releaseTargetLabel: plan.releaseTargetLabel || '游戏',
    forumImageMode: plan.forumImageMode || '',
    forumImageModeLabel: plan.forumImageModeLabel || '',
    appTag: plan.appTag,
    imageTag: plan.imageTag,
    gitBranch: plan.gitBranch,
    gitCommit: plan.gitCommit,
    releaseCommit: commitEvidence.commit,
    releaseCommitShort: commitEvidence.shortCommit,
    releaseCommitDate: commitEvidence.date,
    releaseCommitSubject: commitEvidence.subject,
    releaseImpactAssessmentId: releaseImpactAssessment ? releaseImpactAssessment.assessmentId : '',
    releaseImpactRiskLevel: releaseImpactAssessment ? releaseImpactAssessment.riskLevel : '',
    releaseImpactDatabaseImpact: releaseImpactAssessment ? releaseImpactAssessment.databaseImpact : '',
    releaseImpactChecklistDecision: releaseImpactAssessment ? releaseImpactAssessment.checklistDecision : '',
    releaseImpactRuntimePaths: releaseImpactAssessment ? releaseImpactAssessment.coveredRuntimePaths.slice() : [],
    releaseImpactRequiredChecks: releaseImpactAssessment
      ? releaseImpactAssessment.requiredChecks.map(item => item.stepKey)
      : [],
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
    catalogSchemaVersion: plan.config.catalogSchemaVersion || null,
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
  const tags = Array.isArray(currentTag) ? currentTag : [currentTag];
  let needsSequence = false;
  let maxSequence = 0;
  for (const item of tags) {
    const tag = releaseTagValue(item);
    if (!tag) {
      continue;
    }
    if (tag === date) {
      needsSequence = true;
      continue;
    }
    const sameDaySequence = tag.match(new RegExp(`^${date}(\\d{2})$`));
    if (sameDaySequence) {
      needsSequence = true;
      maxSequence = Math.max(maxSequence, Number(sameDaySequence[1]));
      continue;
    }
    if (/^\d{8}(\d{2})?$/.test(tag) && tag >= date) {
      needsSequence = true;
    }
  }
  if (!needsSequence) {
    return date;
  }
  return `${date}${String(maxSequence + 1).padStart(2, '0')}`;
}

function releaseTagValue(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const imageMatch = text.match(/^[^:\s]+:([0-9A-Za-z._-]+)$/);
  return imageMatch ? imageMatch[1] : text;
}

function readRemoteComposeImageTag(target, remoteComposeDir, imageName = DEFAULT_IMAGE_NAME, env = process.env, sshRunner = spawnSync) {
  if (env.RELEASE_PUBLISHER_DISABLE_REMOTE_TAG_READ === 'true') {
    return {resolved: false, imageTag: '', appTag: '', note: '已跳过远程 TAG 读取'};
  }
  const ssh = sshCommandParts(target);
  if (!ssh.length) {
    return {resolved: false, imageTag: '', appTag: '', note: '缺少 SSH 目标'};
  }
  const remoteCommand = remoteBashScriptCommand([
    `cd ${shellToken(remoteComposeDir || DEFAULT_REMOTE_COMPOSE_DIR)}`,
    `grep -m 1 -E '^[[:space:]]*image:[[:space:]]*${escapeEgrepPattern(imageName)}:' docker-compose.yml`
  ]);
  const result = sshRunner(ssh[0], ssh.slice(1).concat(remoteCommand), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(env.RELEASE_PUBLISHER_REMOTE_TAG_TIMEOUT_MS || 8000)
  });
  if (result.error) {
    return {resolved: false, imageTag: '', appTag: '', note: '远程 TAG 读取失败', error: result.error.message};
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status !== 0) {
    return {resolved: false, imageTag: '', appTag: '', note: '远程 TAG 读取失败', error: output || `ssh exited with ${result.status}`};
  }
  const match = output.match(new RegExp(`\\b(${escapeRegExp(imageName)}:([^\\s]+))\\b`));
  if (!match) {
    return {resolved: false, imageTag: '', appTag: '', note: '远程 compose 未找到镜像 TAG', output};
  }
  return {
    resolved: true,
    imageTag: match[1],
    appTag: match[2],
    note: '已读取远程 compose 当前镜像 TAG',
    output
  };
}

function validateTag(tag) {
  const value = String(tag || '').trim();
  if (!TAG_PATTERN.test(value)) {
    throw new Error('APP_TAG 只能包含字母、数字、点、下划线和连字符，长度不超过 64');
  }
  return value;
}

function validateReleaseTarget(releaseTarget) {
  const value = String(releaseTarget || 'game').trim().toLowerCase();
  if (value !== 'game' && value !== 'forum') {
    throw new Error('发布目标只能是 game 或 forum');
  }
  return value;
}

function validateForumImageMode(mode) {
  const value = String(mode || 'build').trim().toLowerCase();
  if (value !== 'build' && value !== 'reuse') {
    throw new Error('论坛镜像处理只能是 build 或 reuse');
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

function resolveCatalogSchemaVersion(projectRoot, gitCommit = 'latest', gitRunner = spawnSync) {
  const commit = validateGitCommit(gitCommit);
  const source = commit === 'latest'
    ? fs.readFileSync(resolveInside(projectRoot, CATALOG_UPGRADE_SOURCE_PATH), 'utf8')
    : runGit(projectRoot, ['show', `${commit}:${CATALOG_UPGRADE_SOURCE_PATH}`], gitRunner);
  const matches = [...source.matchAll(/\bMARKER_VERSION\s*=\s*(\d+)\s*;/g)];
  if (matches.length !== 1) {
    throw new Error(`目标提交的 ${CATALOG_UPGRADE_SOURCE_PATH} 必须且只能声明一个 MARKER_VERSION`);
  }
  const version = Number(matches[0][1]);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error('Catalog MARKER_VERSION 必须是正整数');
  }
  return version;
}

function analyzeReleaseChanges(projectRoot, request = {}, env = process.env, gitRunner = spawnSync) {
  const gitBranch = validateGitBranch(request.gitBranch || env.RELEASE_PUBLISHER_GIT_BRANCH || 'origin/master');
  const gitCommit = validateGitCommit(request.gitCommit || 'latest');
  const branchCommit = runGit(projectRoot, ['rev-parse', '--verify', `${gitBranch}^{commit}`], gitRunner).trim();
  const targetCommit = gitCommit === 'latest'
    ? branchCommit
    : runGit(projectRoot, ['rev-parse', '--verify', `${gitCommit}^{commit}`], gitRunner).trim();
  const analysisHistoryFile = historyFile(env);
  const historyStat = fs.existsSync(analysisHistoryFile) ? fs.statSync(analysisHistoryFile) : null;
  const cacheKey = `${path.resolve(projectRoot)}|${gitBranch}|${targetCommit}|${analysisHistoryFile}|${historyStat ? `${historyStat.mtimeMs}:${historyStat.size}` : 'missing'}`;
  const cached = releaseChangeAnalysisCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 10000) {
    return cached.analysis;
  }
  if (gitCommit !== 'latest'
      && !gitCommandSucceeds(projectRoot, ['merge-base', '--is-ancestor', targetCommit, branchCommit], gitRunner)) {
    throw new Error(`目标提交 ${targetCommit.slice(0, 8)} 不属于发布分支 ${gitBranch}`);
  }

  const history = readReleaseHistoryAll(projectRoot, env);
  const targets = {};
  for (const target of ['game', 'forum']) {
    const baseline = history.find(entry => isSuccessfulTargetRelease(entry, target));
    const baselineCommit = baseline && GIT_COMMIT_PATTERN.test(String(baseline.releaseCommit || ''))
      ? String(baseline.releaseCommit)
      : '';
    if (!baselineCommit) {
      targets[target] = {
        target,
        baselineCommit: '',
        baselineTag: '',
        direction: 'unknown',
        changed: null,
        changedPaths: [],
        ignoredPaths: [],
        note: '没有可验证的成功生产发布基线'
      };
      continue;
    }
    const direction = releaseDirection(projectRoot, baselineCommit, targetCommit, gitRunner);
    const allPaths = runGit(projectRoot, [
      'diff', '--name-only', '--diff-filter=ACDMRTUXB', `${baselineCommit}..${targetCommit}`
    ], gitRunner).split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const changedPaths = allPaths.filter(target === 'forum' ? isForumRuntimePath : isGameRuntimePath);
    targets[target] = {
      target,
      baselineCommit,
      baselineTag: String(baseline.appTag || tagFromImage(baseline.imageTag || '')),
      direction,
      changed: direction === 'forward' && changedPaths.length > 0,
      changedPaths,
      ignoredPaths: allPaths.filter(filePath => !changedPaths.includes(filePath)),
      note: direction === 'same'
        ? '目标提交与当前生产发布提交一致'
        : direction === 'rollback'
          ? '目标提交早于当前生产发布提交'
          : direction === 'diverged'
            ? '目标提交与当前生产发布提交分叉'
            : changedPaths.length > 0
              ? `检测到 ${changedPaths.length} 个运行文件变化`
              : '只有文档、测试或其他非运行文件变化'
    };
  }

  const changedTargets = ['game', 'forum'].filter(target => targets[target].changed === true);
  const analysis = {
    gitBranch,
    requestedCommit: gitCommit,
    targetCommit,
    targetCommitShort: targetCommit.slice(0, 8),
    changedTargets,
    recommendedTarget: changedTargets.length === 1
      ? changedTargets[0]
      : changedTargets.length > 1 ? 'multiple' : 'none',
    targets
  };
  releaseChangeAnalysisCache.set(cacheKey, {createdAt: Date.now(), analysis});
  if (releaseChangeAnalysisCache.size > 20) {
    releaseChangeAnalysisCache.delete(releaseChangeAnalysisCache.keys().next().value);
  }
  return analysis;
}

function clearReleaseChangeAnalysisCache() {
  releaseChangeAnalysisCache.clear();
}

function resolveReleaseMigrations(projectRoot, gitCommit, changeAnalysis) {
  const changedPaths = changeAnalysis
    && changeAnalysis.targets
    && changeAnalysis.targets.game
    && Array.isArray(changeAnalysis.targets.game.changedPaths)
    ? changeAnalysis.targets.game.changedPaths
    : [];
  const migrationPaths = [...new Set(changedPaths
    .map(value => String(value || '').replace(/\\/g, '/'))
    .filter(filePath => RELEASE_MIGRATION_PATTERN.test(filePath)))]
    .sort();

  return migrationPaths.map(filePath => {
    if (filePath.split('/').includes('..')) {
      throw new Error(`数据库迁移路径越界: ${filePath}`);
    }
    const sql = gitCommit === 'latest'
      ? fs.readFileSync(resolveInside(projectRoot, filePath), 'utf8')
      : runGit(projectRoot, ['show', `${gitCommit}:${filePath}`]);
    validateReleaseMigration(filePath, sql);
    return {
      filePath,
      sql,
      sha256: crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
    };
  });
}

function validateReleaseMigration(filePath, sql) {
  const source = String(sql || '');
  const requirements = [
    [/^\\set\s+ON_ERROR_STOP\s+on\s*$/mi, '\\set ON_ERROR_STOP on'],
    [/\bbegin\s*;/i, 'begin;'],
    [/set\s+local\s+lock_timeout\s*=/i, 'set local lock_timeout'],
    [/set\s+local\s+statement_timeout\s*=/i, 'set local statement_timeout'],
    [/\bcommit\s*;/i, 'commit;'],
    [/\bcommit\s*;[\s\S]*\bselect\b/i, 'commit 后的只读验收 SELECT']
  ];
  const missing = requirements.filter(([pattern]) => !pattern.test(source)).map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(`数据库迁移 ${filePath} 缺少发布安全约束: ${missing.join(', ')}`);
  }
  const incompatible = source.match(/\b(drop\s+(?:table|column|index|constraint)|truncate\b|rename\s+(?:column|to)\b|alter\s+column\b|delete\s+from\b)/i);
  if (incompatible) {
    throw new Error(`数据库迁移 ${filePath} 包含不兼容旧版本自动恢复的操作: ${incompatible[0]}`);
  }
}

function assertJpaSchemaMigrationCoverage(projectRoot, targetCommit, changeAnalysis, releaseMigrations) {
  const gameChanges = changeAnalysis && changeAnalysis.targets && changeAnalysis.targets.game;
  const baselineCommit = gameChanges && gameChanges.baselineCommit;
  const changedPaths = gameChanges && Array.isArray(gameChanges.changedPaths) ? gameChanges.changedPaths : [];
  if (!baselineCommit || !targetCommit || targetCommit === 'latest' || releaseMigrations.length > 0) {
    return;
  }
  const modelPaths = changedPaths.filter(filePath => /^src\/main\/java\/.*\/model\/.*\.java$/.test(filePath));
  for (const filePath of modelPaths) {
    const targetSource = gitFileOrEmpty(projectRoot, targetCommit, filePath);
    const baselineSource = gitFileOrEmpty(projectRoot, baselineCommit, filePath);
    if (!/@Entity\b/.test(targetSource) && !/@Entity\b/.test(baselineSource)) {
      continue;
    }
    const diff = runGit(projectRoot, ['diff', '--unified=0', baselineCommit, targetCommit, '--', filePath]);
    const schemaLines = diff.split(/\r?\n/).filter(line => /^[+-](?![+-])/.test(line));
    const schemaAnnotationChanged = schemaLines.some(line => /@(Column|JoinColumn|JoinTable|Table|Index|CollectionTable|ElementCollection|OneToOne|OneToMany|ManyToOne|ManyToMany|Enumerated|Lob|Version)\b/.test(line));
    const persistentFieldChanged = schemaLines.some(line => /^[+-]\s*(?:private|protected|public)\s+(?!static\b|transient\b)[\w<>?,.\[\]]+\s+\w+\s*(?:=[^;]*)?;\s*$/.test(line));
    if (schemaAnnotationChanged || persistentFieldChanged) {
      throw new Error(`JPA 持久化结构发生变化但没有发布迁移脚本: ${filePath}`);
    }
  }
}

function resolveReleaseImpactAssessment(projectRoot, targetCommit, changeAnalysis, releaseTarget, releaseMigrations = []) {
  const target = validateReleaseTarget(releaseTarget);
  const targetChanges = changeAnalysis && changeAnalysis.targets && changeAnalysis.targets[target];
  if (!targetChanges || targetChanges.changed !== true) {
    return null;
  }
  const changedPaths = uniqueSortedReleasePaths(targetChanges.changedPaths || []);
  if (changedPaths.length === 0) {
    throw new Error(`发布影响评估异常：${target} 标记为有运行变更但没有变更路径`);
  }
  const allChangedPaths = uniqueSortedReleasePaths([
    ...(targetChanges.changedPaths || []),
    ...(targetChanges.ignoredPaths || [])
  ]);
  if (!allChangedPaths.includes(RELEASE_IMPACT_ASSESSMENT_PATH)) {
    throw new Error(`检测到 ${target} 运行代码或数据库变更，但本次提交范围没有更新 ${RELEASE_IMPACT_ASSESSMENT_PATH}`);
  }

  const document = readReleaseImpactDocument(projectRoot, targetCommit, true);
  validateReleaseImpactDocument(document);
  const assessment = document.targets && document.targets[target];
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
    throw new Error(`${RELEASE_IMPACT_ASSESSMENT_PATH} 缺少 targets.${target} 发版影响评估`);
  }

  const normalized = normalizeReleaseImpactTarget(document.assessmentId, target, assessment);
  assertExactRuntimePathCoverage(target, changedPaths, normalized.coveredRuntimePaths);
  assertReleaseImpactRequiredChecks(normalized, target, releaseMigrations);

  const baselineCommit = String(targetChanges.baselineCommit || '').trim();
  if (baselineCommit) {
    const baselineDocument = readReleaseImpactDocument(projectRoot, baselineCommit, false);
    if (baselineDocument && String(baselineDocument.assessmentId || '') === normalized.assessmentId) {
      throw new Error(`发版影响评估 assessmentId 仍为 ${normalized.assessmentId}，必须针对本次变更更新`);
    }
    if (normalized.checklistDecision === 'checklist-updated' && baselineDocument) {
      const baselineTarget = baselineDocument.targets && baselineDocument.targets[target];
      const baselineChecks = normalizedRequiredChecksSignature(baselineTarget && baselineTarget.requiredChecks);
      const targetChecks = normalizedRequiredChecksSignature(normalized.requiredChecks);
      if (JSON.stringify(baselineChecks) === JSON.stringify(targetChecks)) {
        throw new Error('发版影响评估声明 checklist-updated，但 requiredChecks 的步骤或覆盖理由没有变化');
      }
    }
  }

  return normalized;
}

function readReleaseImpactDocument(projectRoot, commit, required) {
  try {
    const source = commit === 'latest'
      ? fs.readFileSync(resolveInside(projectRoot, RELEASE_IMPACT_ASSESSMENT_PATH), 'utf8')
      : runGit(projectRoot, ['show', `${commit}:${RELEASE_IMPACT_ASSESSMENT_PATH}`]);
    return JSON.parse(source);
  } catch (error) {
    if (!required) {
      return null;
    }
    throw new Error(`无法从目标提交读取 ${RELEASE_IMPACT_ASSESSMENT_PATH}: ${error.message}`);
  }
}

function validateReleaseImpactDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${RELEASE_IMPACT_ASSESSMENT_PATH} 必须是 JSON 对象`);
  }
  if (document.schemaVersion !== RELEASE_IMPACT_SCHEMA_VERSION) {
    throw new Error(`${RELEASE_IMPACT_ASSESSMENT_PATH} schemaVersion 必须为 ${RELEASE_IMPACT_SCHEMA_VERSION}`);
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{7,127}$/.test(String(document.assessmentId || ''))) {
    throw new Error('发版影响评估 assessmentId 必须是 8 到 128 位可审计标识');
  }
  if (String(document.summary || '').trim().length < 10) {
    throw new Error('发版影响评估 summary 必须说明本次发布范围');
  }
}

function normalizeReleaseImpactTarget(assessmentId, target, assessment) {
  const checklistDecision = String(assessment.checklistDecision || '').trim();
  if (!RELEASE_CHECKLIST_DECISIONS.has(checklistDecision)) {
    throw new Error(`targets.${target}.checklistDecision 必须为 existing-checks-sufficient 或 checklist-updated`);
  }
  const riskLevel = String(assessment.riskLevel || '').trim();
  if (!['low', 'medium', 'high'].includes(riskLevel)) {
    throw new Error(`targets.${target}.riskLevel 必须为 low、medium 或 high`);
  }
  const codeImpact = String(assessment.codeImpact || '').trim();
  if (codeImpact.length < 10) {
    throw new Error(`targets.${target}.codeImpact 必须说明代码变化的发版影响`);
  }
  const databaseImpact = String(assessment.databaseImpact || '').trim();
  if (!RELEASE_DATABASE_IMPACTS.has(databaseImpact)) {
    throw new Error(`targets.${target}.databaseImpact 必须为 ${[...RELEASE_DATABASE_IMPACTS].join('、')}`);
  }
  const coveredRuntimePaths = uniqueSortedReleasePaths(assessment.coveredRuntimePaths || []);
  const requiredChecks = normalizeRequiredChecks(target, assessment.requiredChecks);
  return {
    assessmentId: String(assessmentId),
    target,
    checklistDecision,
    riskLevel,
    codeImpact,
    databaseImpact,
    coveredRuntimePaths,
    requiredChecks
  };
}

function normalizeRequiredChecks(target, requiredChecks) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) {
    throw new Error(`targets.${target}.requiredChecks 必须至少声明一项自动检查`);
  }
  const result = requiredChecks.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`targets.${target}.requiredChecks[${index}] 必须是对象`);
    }
    const stepKey = String(item.stepKey || '').trim();
    const reason = String(item.reason || '').trim();
    if (!KNOWN_RELEASE_CHECKS[target].has(stepKey)) {
      throw new Error(`targets.${target}.requiredChecks 引用了发布器未注册的检查步骤: ${stepKey || '(empty)'}`);
    }
    if (reason.length < 10) {
      throw new Error(`检查步骤 ${stepKey} 必须说明为何覆盖本次变更`);
    }
    return {stepKey, reason};
  });
  const stepKeys = result.map(item => item.stepKey);
  if (new Set(stepKeys).size !== stepKeys.length) {
    throw new Error(`targets.${target}.requiredChecks 不允许重复 stepKey`);
  }
  return result;
}

function normalizedRequiredChecksSignature(requiredChecks) {
  if (!Array.isArray(requiredChecks)) {
    return [];
  }
  return requiredChecks
    .map(item => ({
      stepKey: String(item && item.stepKey || '').trim(),
      reason: String(item && item.reason || '').trim()
    }))
    .filter(item => item.stepKey)
    .sort((left, right) => left.stepKey.localeCompare(right.stepKey));
}

function uniqueSortedReleasePaths(paths) {
  if (!Array.isArray(paths)) {
    throw new Error('发版影响评估路径必须是数组');
  }
  const normalized = paths.map(value => {
    const filePath = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!filePath || filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath) || filePath.split('/').includes('..')) {
      throw new Error(`发版影响评估包含非法路径: ${value}`);
    }
    return filePath;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('发版影响评估 coveredRuntimePaths 不允许重复路径');
  }
  return normalized.sort();
}

function assertExactRuntimePathCoverage(target, changedPaths, coveredRuntimePaths) {
  const missing = changedPaths.filter(filePath => !coveredRuntimePaths.includes(filePath));
  const extra = coveredRuntimePaths.filter(filePath => !changedPaths.includes(filePath));
  if (missing.length > 0 || extra.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`未评估: ${missing.join(', ')}`);
    if (extra.length > 0) details.push(`非本次运行变更: ${extra.join(', ')}`);
    throw new Error(`${target} 发版影响评估必须精确覆盖生产基线到目标提交的运行变更；${details.join('；')}`);
  }
}

function assertReleaseImpactRequiredChecks(assessment, target, releaseMigrations) {
  const selected = new Set(assessment.requiredChecks.map(item => item.stepKey));
  const missingBaseChecks = REQUIRED_RELEASE_CHECKS[target].filter(stepKey => !selected.has(stepKey));
  if (missingBaseChecks.length > 0) {
    throw new Error(`${target} 发版影响评估缺少基础检查: ${missingBaseChecks.join(', ')}`);
  }
  const databaseRelated = target === 'game'
    && assessment.coveredRuntimePaths.some(isDatabaseRelatedRuntimePath);
  if (databaseRelated && assessment.databaseImpact === 'none') {
    throw new Error('检测到数据库相关代码或迁移变化，databaseImpact 不得为 none');
  }
  if (target === 'game' && releaseMigrations.length > 0 && !selected.has('apply-database-migrations')) {
    throw new Error('检测到数据库迁移脚本，发版影响评估必须包含 apply-database-migrations');
  }
}

function isDatabaseRelatedRuntimePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.startsWith(GAME_MIGRATION_PREFIX)
    || /\/model\//.test(normalized)
    || /\/repository\//.test(normalized)
    || /(?:Dao|DAO|Repository)\.java$/.test(normalized);
}

function releaseImpactValidationStep(assessment) {
  const checks = assessment.requiredChecks.map(item => item.stepKey).join(', ');
  return releaseStep({
    key: 'validate-release-impact-checklist',
    title: '校验本次发版影响与 CheckList',
    summary: `评估 ${assessment.assessmentId} 已精确覆盖 ${assessment.coveredRuntimePaths.length} 个运行变更路径`,
    command: `读取目标提交 ${RELEASE_IMPACT_ASSESSMENT_PATH}`,
    validation: `risk=${assessment.riskLevel}, database=${assessment.databaseImpact}, decision=${assessment.checklistDecision}, checks=${checks}`,
    actionType: 'local-check'
  });
}

function assertReleaseImpactPlanCoverage(assessment, steps, includeStackDeploy) {
  if (!assessment) {
    return;
  }
  const stepMap = new Map(steps.map(step => [step.key, step]));
  for (const check of assessment.requiredChecks) {
    const step = stepMap.get(check.stepKey);
    if (!step) {
      if (!includeStackDeploy) {
        continue;
      }
      throw new Error(`发版影响评估要求的检查步骤未进入本次发布计划: ${check.stepKey}`);
    }
    if (!step.executable) {
      throw new Error(`发版影响评估引用的检查步骤不可执行: ${check.stepKey}`);
    }
  }
}

function gitFileOrEmpty(projectRoot, commit, filePath) {
  try {
    return runGit(projectRoot, ['show', `${commit}:${filePath}`]);
  } catch (error) {
    return '';
  }
}

function assertReleaseTargetChanged(analysis, releaseTarget, forumImageMode = 'build') {
  const target = validateReleaseTarget(releaseTarget);
  if (target === 'forum' && validateForumImageMode(forumImageMode) === 'reuse') {
    return true;
  }
  const detail = analysis && analysis.targets && analysis.targets[target];
  if (!detail || !detail.baselineCommit) {
    return true;
  }
  if (detail.direction === 'rollback' || detail.direction === 'diverged') {
    throw new Error(`${target === 'game' ? '游戏' : '论坛'}目标提交不是当前生产基线的后续提交，已阻止降级发布`);
  }
  if (!detail.changed) {
    throw new Error(`目标提交没有${target === 'game' ? '游戏' : '论坛'}运行文件变化，无需发布该镜像`);
  }
  return true;
}

function isSuccessfulTargetRelease(entry, target) {
  if (!entry || entry.status !== 'EXECUTED' || !entry.releaseCommit || entry.includeStackDeploy === false) {
    return false;
  }
  const inferredTarget = entry.releaseTarget === 'forum'
    || String(entry.imageTag || '').startsWith(`${DEFAULT_FORUM_IMAGE_NAME}:`)
    ? 'forum'
    : 'game';
  if (inferredTarget !== target) {
    return false;
  }
  return !Array.isArray(entry.completedStepKeys)
    || entry.completedStepKeys.includes('final-runtime-check');
}

function releaseDirection(projectRoot, baselineCommit, targetCommit, gitRunner) {
  if (baselineCommit === targetCommit) {
    return 'same';
  }
  if (gitCommandSucceeds(projectRoot, ['merge-base', '--is-ancestor', baselineCommit, targetCommit], gitRunner)) {
    return 'forward';
  }
  if (gitCommandSucceeds(projectRoot, ['merge-base', '--is-ancestor', targetCommit, baselineCommit], gitRunner)) {
    return 'rollback';
  }
  return 'diverged';
}

function gitCommandSucceeds(projectRoot, args, gitRunner = spawnSync) {
  const result = gitRunner('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0;
}

function isGameRuntimePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return GAME_RUNTIME_PATHS.includes(normalized)
    || GAME_RUNTIME_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function isForumRuntimePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').startsWith(FORUM_RUNTIME_PREFIX);
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

function forumSourceScriptValidationCommands() {
  return [
    sourceCleanPowerShellCommand('forumReleaseChanges', ['integrations/flarum']),
    ...DEFAULT_FORUM_INIT_SCRIPTS.map(scriptPath =>
      `bash -o pipefail -c ${shellToken(`git show HEAD:${scriptPath} | bash -n`)}`)
  ];
}

function sourceCleanPowerShellCommand(variableName, paths) {
  const safeVariable = String(variableName || 'releaseChanges').replace(/[^0-9A-Za-z_]/g, '');
  const pathList = paths.map(shellToken).join(' ');
  return `$${safeVariable} = git status --porcelain --untracked-files=all -- ${pathList}; if ($${safeVariable}) { $${safeVariable}; exit 1 }`;
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

function refreshGitRefs(projectRoot, env = process.env, gitRunner = spawnSync) {
  if (env.RELEASE_PUBLISHER_DISABLE_GIT_REFRESH === 'true') {
    return {refreshed: false, skipped: true, remote: 'origin'};
  }
  runGit(projectRoot, ['fetch', '--prune', 'origin'], gitRunner);
  clearReleaseChangeAnalysisCache();
  return {refreshed: true, skipped: false, remote: 'origin'};
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

function gameDatabaseAuditJavaSource() {
  return String.raw`import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.List;
import java.util.Properties;
import java.util.zip.GZIPOutputStream;

public final class ReleaseTradePoolDatabaseAudit {
    private static final int EXPECTED_VERSION = requiredPositiveInt("RELEASE_EXPECTED_CATALOG_VERSION");
    private static final List<String> REQUIRED_COLUMNS = List.of(
            "listing_source", "admin_source_email", "admin_batch_id");
    private static final List<String> REQUIRED_INDEXES = List.of(
            "idx_toilet_listing_admin_batch", "idx_toilet_tx_type_id",
            "idx_toilet_tx_actor_id", "idx_toilet_tx_target_id");
    private static final List<String> BACKUP_TABLES = List.of(
            "t_backend_upgrade_markers", "t_toilet_market_listing", "t_toilet_market_transaction");

    private ReleaseTradePoolDatabaseAudit() {
    }

    public static void main(String[] args) throws Exception {
        String mode = required("RELEASE_DB_AUDIT_MODE");
        Class.forName("org.postgresql.Driver");
        Properties properties = new Properties();
        properties.setProperty("user", required("DB_USER"));
        properties.setProperty("password", required("DB_PASSWORD"));
        properties.setProperty("connectTimeout", "10");
        properties.setProperty("socketTimeout", "120");
        try (Connection connection = DriverManager.getConnection(required("DB_URL"), properties)) {
            boolean mutating = "suspend-admin".equals(mode);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setReadOnly(!mutating);
            connection.setAutoCommit(false);
            switch (mode) {
                case "inspect" -> inspect(connection);
                case "backup" -> backup(connection, Path.of(required("RELEASE_DB_BACKUP_DIR")));
                case "verify" -> verify(connection);
                case "suspend-admin" -> suspendAdmin(connection);
                default -> throw new IllegalArgumentException("Unsupported audit mode: " + mode);
            }
            if (mutating) {
                connection.commit();
            } else {
                connection.rollback();
            }
        }
    }

    private static void inspect(Connection connection) throws Exception {
        SchemaStatus status = schemaStatus(connection);
        System.out.println(status.asLine("tradepool_schema_preflight"));
        System.out.println("tradepool_schema_expected=" + EXPECTED_VERSION);
        if (status.markerVersion() > EXPECTED_VERSION) {
            throw new IllegalStateException("Catalog downgrade is blocked: database version "
                    + status.markerVersion() + " is newer than target version " + EXPECTED_VERSION);
        }
        if (status.markerVersion() == EXPECTED_VERSION && !"COMPLETED".equals(status.markerStatus())) {
            throw new IllegalStateException("Catalog marker at target version is not COMPLETED: "
                    + status.markerStatus());
        }
        System.out.println("tradepool_schema_transition=" + status.markerVersion() + "->" + EXPECTED_VERSION);
    }

    private static void verify(Connection connection) throws Exception {
        SchemaStatus status = schemaStatus(connection);
        System.out.println(status.asLine("tradepool_schema_postdeploy"));
        if (status.markerVersion() != EXPECTED_VERSION || !"COMPLETED".equals(status.markerStatus())) {
            throw new IllegalStateException("Catalog marker must equal target version " + EXPECTED_VERSION
                    + " with COMPLETED status");
        }
        if (status.columnCount() != REQUIRED_COLUMNS.size()) {
            throw new IllegalStateException("Required trade-pool columns are missing");
        }
        if (status.indexCount() != REQUIRED_INDEXES.size()) {
            throw new IllegalStateException("Required trade-pool indexes are missing");
        }
        System.out.println("tradepool_database_validation=PASS");
    }

    private static void backup(Connection connection, Path directory) throws Exception {
        Files.createDirectories(directory);
        SchemaStatus status = schemaStatus(connection);
        Files.writeString(directory.resolve("schema-status.txt"),
                status.asLine("tradepool_schema_backup") + System.lineSeparator(), StandardCharsets.UTF_8);
        for (String table : BACKUP_TABLES) {
            if (!tableExists(connection, table)) {
                Files.writeString(directory.resolve(table + ".missing"), "missing\n", StandardCharsets.UTF_8);
                continue;
            }
            writeQuery(connection, "select * from " + table, directory.resolve(table + ".tsv.gz"));
        }
        System.out.println("tradepool_database_backup=" + directory);
    }

    private static void suspendAdmin(Connection connection) throws Exception {
        if (!columnExists(connection, "t_toilet_market_listing", "listing_source")) {
            throw new IllegalStateException("listing_source column is missing; refusing old-code rollback");
        }
        try (PreparedStatement statement = connection.prepareStatement("""
                update t_toilet_market_listing
                set status = 'SUSPENDED', update_time = now()
                where listing_source = 'ADMIN' and status = 'ACTIVE'
                """)) {
            int updated = statement.executeUpdate();
            System.out.println("suspended_admin_listings=" + updated);
        }
    }

    private static SchemaStatus schemaStatus(Connection connection) throws Exception {
        int markerVersion = -1;
        String markerStatus = "MISSING";
        if (tableExists(connection, "t_backend_upgrade_markers")) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    select marker_version, status
                    from t_backend_upgrade_markers
                    where marker_key = 'catalog_item_store_v1'
                    """)) {
                try (ResultSet result = statement.executeQuery()) {
                    if (result.next()) {
                        markerVersion = result.getInt(1);
                        markerStatus = result.getString(2);
                    }
                }
            }
        }
        int columnCount = 0;
        for (String column : REQUIRED_COLUMNS) {
            if (columnExists(connection, "t_toilet_market_listing", column)) {
                columnCount++;
            }
        }
        int indexCount = 0;
        for (String index : REQUIRED_INDEXES) {
            if (indexExists(connection, index)) {
                indexCount++;
            }
        }
        return new SchemaStatus(markerVersion, markerStatus, columnCount, indexCount);
    }

    private static boolean tableExists(Connection connection, String table) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("select to_regclass(?) is not null")) {
            statement.setString(1, "public." + table);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getBoolean(1);
            }
        }
    }

    private static boolean columnExists(Connection connection, String table, String column) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select count(*)
                from information_schema.columns
                where table_schema = 'public' and table_name = ? and column_name = ?
                """)) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getInt(1) == 1;
            }
        }
    }

    private static boolean indexExists(Connection connection, String index) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select count(*) from pg_indexes where schemaname = 'public' and indexname = ?
                """)) {
            statement.setString(1, index);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getInt(1) == 1;
            }
        }
    }

    private static void writeQuery(Connection connection, String sql, Path target) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(120);
            try (ResultSet result = statement.executeQuery(sql);
                 GZIPOutputStream gzip = new GZIPOutputStream(Files.newOutputStream(target));
                 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(gzip, StandardCharsets.UTF_8))) {
                ResultSetMetaData metadata = result.getMetaData();
                for (int column = 1; column <= metadata.getColumnCount(); column++) {
                    if (column > 1) writer.write('\t');
                    writer.write(escape(metadata.getColumnLabel(column)));
                }
                writer.newLine();
                while (result.next()) {
                    for (int column = 1; column <= metadata.getColumnCount(); column++) {
                        if (column > 1) writer.write('\t');
                        writer.write(escape(result.getString(column)));
                    }
                    writer.newLine();
                }
            }
        }
    }

    private static String escape(String value) {
        if (value == null) return "\\N";
        return value.replace("\\", "\\\\")
                .replace("\t", "\\t")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    private static int requiredPositiveInt(String name) {
        String value = required(name);
        try {
            int parsed = Integer.parseInt(value);
            if (parsed <= 0) throw new NumberFormatException("not positive");
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalStateException(name + " must be a positive integer", error);
        }
    }

    private record SchemaStatus(int markerVersion, String markerStatus, int columnCount, int indexCount) {
        String asLine(String prefix) {
            return prefix + " marker=" + markerVersion + "|" + markerStatus
                    + " columns=" + columnCount + "/" + REQUIRED_COLUMNS.size()
                    + " indexes=" + indexCount + "/" + REQUIRED_INDEXES.size();
        }
    }
}
`;
}

function gameDatabaseAuditContainerScript() {
  const source = Buffer.from(gameDatabaseAuditJavaSource(), 'utf8').toString('base64');
  return [
    'set -eu',
    'work_dir=$(mktemp -d)',
    'trap \'rm -rf "$work_dir"\' EXIT',
    'profile="${SPRING_PROFILE:-prod}"',
    'case "$profile" in *[!0-9A-Za-z_.-]*) echo "ERROR: invalid SPRING_PROFILE"; exit 1;; esac',
    'cd "$work_dir"',
    'properties_entry=$(jar tf /app/app.jar | grep -E "^BOOT-INF/classes/application-${profile}\\.properties$" | head -n 1)',
    '[ -n "$properties_entry" ] || { echo "ERROR: application profile properties are missing"; exit 1; }',
    'jar xf /app/app.jar "$properties_entry"',
    'properties_file="$work_dir/$properties_entry"',
    'read_property() { grep -F "$1=" "$properties_file" | head -n 1 | cut -d= -f2- | tr -d "\\r"; }',
    'db_url="${SPRING_DATASOURCE_URL:-$(read_property spring.datasource.url)}"',
    'db_user="${SPRING_DATASOURCE_USERNAME:-$(read_property spring.datasource.username)}"',
    'db_password="${SPRING_DATASOURCE_PASSWORD:-$(read_property spring.datasource.password)}"',
    '[ -n "$db_url" ] && [ -n "$db_user" ] && [ -n "$db_password" ] || { echo "ERROR: database connection settings are incomplete"; exit 1; }',
    'driver_entry=$(jar tf /app/app.jar | grep -E "^BOOT-INF/lib/postgresql-[^/]+\\.jar$" | head -n 1)',
    '[ -n "$driver_entry" ] || { echo "ERROR: PostgreSQL JDBC driver is missing"; exit 1; }',
    'jar xf /app/app.jar "$driver_entry"',
    'driver_jar="$work_dir/$driver_entry"',
    `printf %s ${shellToken(source)} | base64 -d > ReleaseTradePoolDatabaseAudit.java`,
    'javac -encoding UTF-8 -cp "$driver_jar" ReleaseTradePoolDatabaseAudit.java',
    'export DB_URL="$db_url" DB_USER="$db_user" DB_PASSWORD="$db_password"',
    'java -cp "$driver_jar:$work_dir" ReleaseTradePoolDatabaseAudit'
  ].join('\n');
}

function gameDatabaseAuditExecCommand(containerReference, mode, expectedVersion, backupDirectoryReference = '') {
  const encoded = Buffer.from(`${gameDatabaseAuditContainerScript()}\n`, 'utf8').toString('base64');
  const backup = backupDirectoryReference
    ? ` RELEASE_DB_BACKUP_DIR=${backupDirectoryReference}`
    : '';
  const runner = `printf %s "${encoded}" | base64 -d | sh`;
  return `docker exec ${containerReference} env RELEASE_DB_AUDIT_MODE=${shellToken(mode)} RELEASE_EXPECTED_CATALOG_VERSION=${shellToken(expectedVersion)}${backup} sh -lc ${shellToken(runner)}`;
}

function gameServiceName(stackName, containerName) {
  return `${stackName}_${containerName}`;
}

function gameDatabasePreflightCommand(stackName, containerName, expectedVersion) {
  const serviceName = gameServiceName(stackName, containerName);
  return [
    `service_name=${shellToken(serviceName)}`,
    'docker service inspect "$service_name" >/dev/null',
    'container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)',
    '[ -n "$container_id" ] || { echo "ERROR: no healthy game container is available for database preflight"; exit 1; }',
    gameDatabaseAuditExecCommand('"$container_id"', 'inspect', expectedVersion),
    "echo 'game_database_preflight=PASS'"
  ];
}

function gameReleaseBackupCommand(remoteComposeDir, stackName, containerName, expectedVersion, releaseMigrations = []) {
  const serviceName = gameServiceName(stackName, containerName);
  const commands = [
    `cd ${shellToken(remoteComposeDir)}`,
    `service_name=${shellToken(serviceName)}`,
    'release_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'backup_dir=/opt/1panel/backup/game-release-$(date -u +%Y%m%dT%H%M%SZ)',
    'container_backup_dir=/tmp/tradepool-release-backup-$$',
    'umask 077',
    'mkdir -p "$backup_dir/database"',
    'cp docker-compose.yml "$backup_dir/docker-compose.yml"',
    '[ ! -f .env ] || cp .env "$backup_dir/.env"',
    'docker service inspect "$service_name" > "$backup_dir/service.inspect.json"',
    'current_image=$(docker service inspect "$service_name" --format \'{{.Spec.TaskTemplate.ContainerSpec.Image}}\')',
    'docker image inspect "$current_image" > "$backup_dir/image.inspect.json"',
    'container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)',
    '[ -n "$container_id" ] || { echo "ERROR: no healthy game container is available for backup"; exit 1; }',
    gameDatabaseAuditExecCommand('"$container_id"', 'backup', expectedVersion, '"$container_backup_dir"'),
    'docker cp "$container_id:$container_backup_dir/." "$backup_dir/database/"',
    'docker exec "$container_id" rm -rf "$container_backup_dir"'
  ];
  if (releaseMigrations.length > 0) {
    commands.push(
      ...gameDatabaseContainerResolutionCommands(),
      `database_name=${shellToken(GAME_DATABASE_NAME)}`,
      'docker exec "$database_container_id" sh -lc \'pg_dump -Fc -U "$POSTGRES_USER" -d "$1"\' sh "$database_name" > "$backup_dir/database/hospital.pre-migration.dump"',
      'test -s "$backup_dir/database/hospital.pre-migration.dump"',
      'echo "database_migration_backup=$backup_dir/database/hospital.pre-migration.dump"'
    );
  }
  commands.push(
    '(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)',
    'test -s "$backup_dir/docker-compose.yml"',
    'test -s "$backup_dir/database/schema-status.txt"',
    'test -s "$backup_dir/SHA256SUMS"',
    'chmod 700 "$backup_dir" "$backup_dir/database"',
    'find "$backup_dir" -type f -exec chmod 600 {} +',
    'printf "%s\\n" "$backup_dir" > .last-game-release-backup',
    'printf "%s\\n" "$release_started_at" > .last-game-release-start',
    'chmod 600 .last-game-release-backup .last-game-release-start',
    'echo "game_backup_dir=$backup_dir"'
  );
  return commands;
}

function gameDatabaseContainerResolutionCommands() {
  return [
    `database_container_name=${shellToken(GAME_DATABASE_CONTAINER_NAME)}`,
    'database_container_ids=$(docker ps -q --filter "name=^/${database_container_name}$")',
    'database_container_count=$(printf "%s\n" "$database_container_ids" | sed \'/^$/d\' | wc -l)',
    '[ "$database_container_count" -eq 1 ] || { echo "ERROR: expected one running database container named $database_container_name, found $database_container_count"; exit 1; }',
    'database_container_id=$(printf "%s\n" "$database_container_ids" | head -n 1)'
  ];
}

function gamePreDeployChecklistCommand(remoteComposeDir, stackName, containerName, imageTag, releaseMigrations) {
  const serviceName = gameServiceName(stackName, containerName);
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    `service_name=${shellToken(serviceName)}`,
    `target_image=${shellToken(imageTag)}`,
    'backup_dir=$(cat .last-game-release-backup)',
    'test -d "$backup_dir"',
    '(cd "$backup_dir" && sha256sum -c SHA256SUMS)',
    'test -s "$backup_dir/docker-compose.yml"',
    'test -s "$backup_dir/database/schema-status.txt"',
    'docker image inspect "$target_image" >/dev/null',
    'current_healthy=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | wc -l)',
    '[ "$current_healthy" -ge 1 ] || { echo "ERROR: current production service has no healthy container"; exit 1; }',
    `expected_migrations=${releaseMigrations.length}`,
    'actual_migrations=0',
    'if [ -d "$backup_dir/database/migrations" ]; then actual_migrations=$(find "$backup_dir/database/migrations" -type f -name "*.applied" | wc -l); fi',
    '[ "$actual_migrations" -eq "$expected_migrations" ] || { echo "ERROR: database migration receipts expected $expected_migrations, actual $actual_migrations"; exit 1; }',
    'if [ "$expected_migrations" -gt 0 ]; then',
    '  test -s "$backup_dir/database/migrations/migration-image-source.txt"',
    '  recorded_migration_image=$(cut -d"|" -f1 "$backup_dir/database/migrations/migration-image-source.txt")',
    '  recorded_migration_image_id=$(cut -d"|" -f2 "$backup_dir/database/migrations/migration-image-source.txt")',
    '  actual_migration_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    '  [ "$recorded_migration_image" = "$target_image" ] || { echo "ERROR: migration source image tag mismatch"; exit 1; }',
    '  [ "$recorded_migration_image_id" = "$actual_migration_image_id" ] || { echo "ERROR: migration source image ID mismatch"; exit 1; }',
    'fi',
    'echo "checklist_target_image=PASS image=$target_image"',
    'echo "checklist_current_service=PASS healthy=$current_healthy"',
    'echo "checklist_backup=PASS path=$backup_dir"',
    'echo "checklist_database_migrations=PASS count=$actual_migrations"',
    'echo "checklist_migration_image_source=PASS image=$target_image"',
    'echo "checklist_rollback_source=PASS compose=$backup_dir/docker-compose.yml"',
    'echo "pre_deploy_checklist=PASS"'
  ];
}

function applyGameDatabaseMigrationsCommand(remoteComposeDir, imageTag, releaseMigrations) {
  const commands = [
    `cd ${shellToken(remoteComposeDir)}`,
    `target_image=${shellToken(imageTag)}`,
    'backup_dir=$(cat .last-game-release-backup)',
    'test -s "$backup_dir/database/hospital.pre-migration.dump"',
    'mkdir -p "$backup_dir/database/migrations"',
    'image_migration_dir="$backup_dir/database/migrations/image-bundle"',
    'test ! -e "$image_migration_dir" || { echo "ERROR: migration image bundle already exists in release backup"; exit 1; }',
    'mkdir -p "$image_migration_dir"',
    'migration_source_container="rhospital-migration-source-$$"',
    'cleanup_migration_source() { if [ -n "${migration_source_container:-}" ]; then docker rm -f "$migration_source_container" >/dev/null 2>&1 || true; fi; }',
    'trap cleanup_migration_source EXIT',
    'docker create --name "$migration_source_container" "$target_image" >/dev/null',
    'docker cp "$migration_source_container:/app/migrations/." "$image_migration_dir/"',
    'docker rm "$migration_source_container" >/dev/null',
    'migration_source_container=',
    'trap - EXIT',
    'test -s "$image_migration_dir/SHA256SUMS"',
    '(cd "$image_migration_dir" && sha256sum -c SHA256SUMS)',
    'actual_image_manifest="$backup_dir/database/migrations/image-bundle.actual.SHA256SUMS"',
    '(cd "$image_migration_dir" && find . -type f -name "*.sql" -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > "$actual_image_manifest")',
    'cmp -s "$image_migration_dir/SHA256SUMS" "$actual_image_manifest" || { echo "ERROR: target image migration manifest does not exactly cover all SQL files"; exit 1; }',
    'rm -f "$actual_image_manifest"',
    'target_image_id=$(docker image inspect "$target_image" --format \'{{.Id}}\')',
    'printf "%s|%s\n" "$target_image" "$target_image_id" > "$backup_dir/database/migrations/migration-image-source.txt"',
    ...gameDatabaseContainerResolutionCommands(),
    `database_name=${shellToken(GAME_DATABASE_NAME)}`
  ];

  for (const migration of releaseMigrations) {
    const safeName = migration.filePath
      .slice(GAME_MIGRATION_PREFIX.length)
      .replace(/[^0-9A-Za-z._-]/g, '_');
    const imageRelativePath = migration.filePath.slice(GAME_MIGRATION_PREFIX.length);
    commands.push(
      `migration_path=${shellToken(migration.filePath)}`,
      `migration_sha256=${shellToken(migration.sha256)}`,
      `migration_relative_path=${shellToken(imageRelativePath)}`,
      'migration_file="$image_migration_dir/$migration_relative_path"',
      'test -f "$migration_file" || { echo "ERROR: target image migration is missing: $migration_path"; exit 1; }',
      'actual_sha256=$(sha256sum "$migration_file" | cut -d" " -f1)',
      '[ "$actual_sha256" = "$migration_sha256" ] || { echo "ERROR: migration checksum mismatch for $migration_path"; exit 1; }',
      'docker exec -i "$database_container_id" sh -lc \'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -f -\' sh "$database_name" < "$migration_file"',
      `migration_receipt="$backup_dir/database/migrations/${safeName}.applied"`,
      'printf "%s|%s|%s|%s\n" "$migration_path" "$migration_sha256" "$target_image_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$migration_receipt"',
      'echo "database_migration_applied=$migration_path sha256=$migration_sha256"'
    );
  }
  commands.push(
    '(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)',
    'find "$backup_dir/database/migrations" -type f -exec chmod 600 {} +',
    `test "$(find "$backup_dir/database/migrations" -type f -name '*.applied' | wc -l)" -eq ${releaseMigrations.length}`,
    `echo "database_migrations_applied=${releaseMigrations.length}"`
  );
  return commands;
}

function tradePoolPostDeployCheckCommand(remoteComposeDir, stackName, containerName, expectedVersion) {
  const serviceName = gameServiceName(stackName, containerName);
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    `service_name=${shellToken(serviceName)}`,
    'container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)',
    '[ -n "$container_id" ] || { echo "ERROR: no healthy target container is available for trade-pool verification"; exit 1; }',
    gameDatabaseAuditExecCommand('"$container_id"', 'verify', expectedVersion),
    'release_started_at=$(cat .last-game-release-start)',
    'migration_logs=$(timeout 20 docker service logs --since "$release_started_at" --tail 2000 "$service_name" 2>&1)',
    'printf "%s\\n" "$migration_logs" | grep -Ei "catalog database upgrade (finished|failed)" | tail -n 20',
    'printf "%s\\n" "$migration_logs" | grep -q "catalog database upgrade finished outcome=" || { echo "ERROR: catalog upgrade completion log is missing"; exit 1; }',
    'if printf "%s\\n" "$migration_logs" | grep -qi "catalog database upgrade failed"; then echo "ERROR: catalog database upgrade failure detected"; exit 1; fi',
    'page_result=$(docker exec "$container_id" curl -sS -o /dev/null -w \'%{http_code}|%{redirect_url}\' http://127.0.0.1:8090/admin/tradepool)',
    'page_status=${page_result%%|*}',
    '[ "$page_status" = 302 ] || { echo "ERROR: anonymous trade-pool page did not redirect"; exit 1; }',
    'printf "%s\\n" "$page_result" | grep -Eq \'/login\\?redirect=(%2F|/)admin(%2F|/)tradepool\' || { echo "ERROR: trade-pool login redirect target is wrong"; exit 1; }',
    'admin_api_result=$(docker exec "$container_id" curl -sS -o /dev/null -w \'%{http_code}|%{redirect_url}\' http://127.0.0.1:8090/api/admin/toilet-market/pool)',
    'admin_api_status=${admin_api_result%%|*}',
    'case "$admin_api_status" in 302|401|403) ;; *) echo "ERROR: anonymous admin API request was not denied"; exit 1;; esac',
    'if [ "$admin_api_status" = 302 ]; then printf "%s\\n" "$admin_api_result" | grep -q \'/login\' || { echo "ERROR: admin API redirect is not a login redirect"; exit 1; }; fi',
    'echo "tradepool_page=$page_result admin_api=$admin_api_result"',
    "echo 'tradepool_release_validation=PASS'"
  ];
}

function gameAutomaticRollbackCommand(remoteComposeDir, stackName, containerName) {
  const serviceName = gameServiceName(stackName, containerName);
  const suspendSql = "do $$ begin if to_regclass('public.t_toilet_market_listing') is not null and exists (select 1 from information_schema.columns where table_schema='public' and table_name='t_toilet_market_listing' and column_name='listing_source') then update t_toilet_market_listing set status='SUSPENDED', update_time=now() where listing_source='ADMIN' and status='ACTIVE'; end if; end $$;";
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    `service_name=${shellToken(serviceName)}`,
    'backup_dir=$(cat .last-game-release-backup)',
    'test -s "$backup_dir/docker-compose.yml"',
    'echo "WARNING: suspending all ACTIVE ADMIN listings before old-code rollback"',
    ...gameDatabaseContainerResolutionCommands(),
    `database_name=${shellToken(GAME_DATABASE_NAME)}`,
    `docker exec "$database_container_id" sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$database_name" ${shellToken(suspendSql)}`,
    `rollback_image=$(grep -E '^[[:space:]]*image:[[:space:]]*' "$backup_dir/docker-compose.yml" | grep 'hospital-backend:' | head -n 1 | awk '{print $2}' | tr -d '"')`,
    `rollback_version=$(grep -E 'IMAGE_TAG(=|:)' "$backup_dir/docker-compose.yml" | head -n 1 | sed -E 's/.*IMAGE_TAG(=|:)[[:space:]]*//' | tr -d ' "')`,
    '[ -n "$rollback_image" ] && [ -n "$rollback_version" ] || { echo "ERROR: rollback image or IMAGE_TAG is missing from backup Compose"; exit 1; }',
    'cp "$backup_dir/docker-compose.yml" docker-compose.yml',
    'docker stack config -c docker-compose.yml >/dev/null',
    `docker stack deploy -c docker-compose.yml ${shellToken(stackName)}`,
    'rollback_deadline=$(( $(date +%s) + 900 ))',
    'while true; do',
    '  service_image=$(docker service inspect "$service_name" --format \'{{.Spec.TaskTemplate.ContainerSpec.Image}}\')',
    '  service_env=$(docker service inspect "$service_name" --format \'{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}\')',
    '  service_version=$(printf "%s\\n" "$service_env" | sed -n \'s/^IMAGE_TAG=//p\' | head -n 1)',
    '  update_state=$(docker service inspect "$service_name" --format \'{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}completed{{end}}\')',
    '  expected_replicas=$(docker service inspect "$service_name" --format \'{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}1{{end}}\')',
    '  healthy_count=0',
    '  for container_id in $(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name"); do',
    '    container_image=$(docker inspect "$container_id" --format \'{{.Config.Image}}\')',
    '    container_health=$(docker inspect "$container_id" --format \'{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\')',
    '    case "$container_image" in "$rollback_image"|"$rollback_image"@*) [ "$container_health" = healthy ] && healthy_count=$((healthy_count + 1)) ;; esac',
    '  done',
    '  image_matches=false',
    '  case "$service_image" in "$rollback_image"|"$rollback_image"@*) image_matches=true ;; esac',
    '  echo "automatic_rollback_state=$update_state image=$service_image version=$service_version healthy=$healthy_count/$expected_replicas"',
    '  if [ "$image_matches" = true ] && [ "$service_version" = "$rollback_version" ] && [ "$update_state" = completed ] && [ "$healthy_count" -eq "$expected_replicas" ]; then break; fi',
    '  case "$update_state" in paused|rollback_paused) echo "ERROR: automatic rollback ended in $update_state"; exit 1 ;; esac',
    '  [ "$(date +%s)" -lt "$rollback_deadline" ] || { echo "ERROR: automatic rollback did not converge within 900 seconds"; exit 1; }',
    '  sleep 5',
    'done',
    'echo "game_rollback_completed_from=$backup_dir"',
    'echo "automatic_rollback_validation=PASS"'
  ];
}

function gameComposeSsoContractCommands() {
  return [
    `test "$(grep -Ec '^[[:space:]]*-[[:space:]]*FORUM_SSO_ENABLED=true[[:space:]]*$|^[[:space:]]*FORUM_SSO_ENABLED:[[:space:]]*"?true"?[[:space:]]*$' docker-compose.yml)" -eq 1 || { echo 'ERROR: FORUM_SSO_ENABLED=true is missing or duplicated'; exit 1; }`,
    `test "$(grep -Ec '^[[:space:]]*-[[:space:]]*FORUM_SSO_SECRET_FILE=/run/secrets/forum_sso_secret[[:space:]]*$|^[[:space:]]*FORUM_SSO_SECRET_FILE:[[:space:]]*"?/run/secrets/forum_sso_secret"?[[:space:]]*$' docker-compose.yml)" -eq 1 || { echo 'ERROR: FORUM_SSO_SECRET_FILE is missing or duplicated'; exit 1; }`,
    `test "$(grep -Ec '^[[:space:]]*forum_sso_secret:[[:space:]]*$' docker-compose.yml)" -eq 1 || { echo 'ERROR: forum_sso_secret declaration is missing or duplicated'; exit 1; }`
  ];
}

function gameImageValidationCommand(dockerTarget, imageTag, appTag, expectedCatalogVersion) {
  const script = [
    'set -eu',
    `expected_catalog_version=${shellToken(expectedCatalogVersion)}`,
    `test "$IMAGE_TAG" = ${shellToken(appTag)} || { echo "ERROR: IMAGE_TAG expected ${appTag}, actual $IMAGE_TAG"; exit 1; }`,
    'test -d /app/migrations',
    'test -s /app/migrations/SHA256SUMS',
    '(cd /app/migrations && sha256sum -c SHA256SUMS)',
    'migration_sql_count=$(find /app/migrations -type f -name "*.sql" | wc -l)',
    '[ "$migration_sql_count" -gt 0 ] || { echo "ERROR: image migration bundle is empty"; exit 1; }',
    'actual_migration_manifest=$(mktemp)',
    'trap \'rm -f "$actual_migration_manifest"\' EXIT',
    '(cd /app/migrations && find . -type f -name "*.sql" -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > "$actual_migration_manifest")',
    'cmp -s /app/migrations/SHA256SUMS "$actual_migration_manifest" || { echo "ERROR: image migration manifest does not exactly cover all SQL files"; exit 1; }',
    'rm -f "$actual_migration_manifest"',
    'trap - EXIT',
    "jar tf /app/app.jar | grep -q 'BOOT-INF/classes/com/zly/hospital/controller/api/ForumSsoController.class'",
    "jar tf /app/app.jar | grep -q 'BOOT-INF/classes/com/zly/hospital/service/ForumSsoDatabaseUpgradeService.class'",
    "jar tf /app/app.jar | grep -q 'BOOT-INF/classes/com/zly/hospital/service/ForumProvisioningService.class'",
    ...GAME_TRADE_POOL_IMAGE_PATHS.map(imagePath => `jar tf /app/app.jar | grep -qx ${shellToken(imagePath)}`),
    'work_dir=$(mktemp -d)',
    'trap \'rm -rf "$work_dir"\' EXIT',
    'cd "$work_dir"',
    "jar xf /app/app.jar BOOT-INF/classes/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.class",
    'catalog_class=com.zly.hospital.service.catalog.CatalogDatabaseUpgradeService',
    'catalog_bytecode="$work_dir/catalog-upgrade.javap"',
    'javap -p -constants -c -classpath "$work_dir/BOOT-INF/classes" "$catalog_class" > "$catalog_bytecode"',
    `actual_catalog_version=$(sed -n 's/.*MARKER_VERSION = \\([0-9][0-9]*\\).*/\\1/p' "$catalog_bytecode" | head -n 1)`,
    '[ -n "$actual_catalog_version" ] || { echo "ERROR: image Catalog MARKER_VERSION is missing"; exit 1; }',
    '[ "$actual_catalog_version" = "$expected_catalog_version" ] || { echo "ERROR: image Catalog version expected $expected_catalog_version, actual $actual_catalog_version"; exit 1; }',
    ...TRADE_POOL_REQUIRED_COLUMNS.map(column => `grep -q ${shellToken(column)} "$catalog_bytecode"`),
    ...TRADE_POOL_REQUIRED_INDEXES.map(index => `grep -q ${shellToken(index)} "$catalog_bytecode"`),
    'echo "game_image_catalog_version=$actual_catalog_version"',
    'echo "game_image_migration_bundle=PASS count=$migration_sql_count"',
    "echo 'game_image_tradepool_validation=PASS'"
  ].join('\n');
  const encoded = Buffer.from(`${script}\n`, 'utf8').toString('base64');
  return dockerCommand(dockerTarget, [
    'run', '--rm', '--entrypoint', 'sh', imageTag, '-lc',
    `printf %s "${encoded}" | base64 -d | sh`
  ]);
}

function finalRuntimeCheckCommand(stackName, containerName, imageTag, appTag) {
  const serviceName = `${stackName}_${containerName}`;
  return [
    `service_name=${shellToken(serviceName)}`,
    `expected_image=${shellToken(imageTag)}`,
    `expected_version=${shellToken(appTag)}`,
    `rollout_timeout_seconds="${'${RELEASE_PUBLISHER_ROLLOUT_TIMEOUT_SECONDS:-900}'}"`,
    `rollout_deadline=$(( $(date +%s) + rollout_timeout_seconds ))`,
    `while true; do`,
    `  service_image=$(docker service inspect "$service_name" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')`,
    `  service_env=$(docker service inspect "$service_name" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}')`,
    `  service_version=$(printf '%s\n' "$service_env" | sed -n 's/^IMAGE_TAG=//p' | head -n 1)`,
    `  service_sso_enabled=$(printf '%s\n' "$service_env" | sed -n 's/^FORUM_SSO_ENABLED=//p' | head -n 1)`,
    `  service_sso_secret_file=$(printf '%s\n' "$service_env" | sed -n 's/^FORUM_SSO_SECRET_FILE=//p' | head -n 1)`,
    `  service_sso_secret=$(docker service inspect "$service_name" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{println .SecretName}}{{end}}' | grep -x 'forum_sso_secret' || true)`,
    `  update_state=$(docker service inspect "$service_name" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}completed{{end}}')`,
    `  expected_replicas=$(docker service inspect "$service_name" --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}1{{end}}')`,
    `  active_target_count=0`,
    `  active_other_count=0`,
    `  while IFS='|' read -r task_image task_state; do`,
    `    [ -n "$task_image" ] || continue`,
    `    case "$task_image" in`,
    `      "$expected_image"|"$expected_image"@*) case "$task_state" in Running*) active_target_count=$((active_target_count + 1));; esac ;;`,
    `      *) active_other_count=$((active_other_count + 1)) ;;`,
    `    esac`,
    `  done <<EOF`,
    `$(docker service ps "$service_name" --filter desired-state=running --format '{{.Image}}|{{.CurrentState}}')`,
    `EOF`,
    `  healthy_target_count=0`,
    `  for container_id in $(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name"); do`,
    `    container_image=$(docker inspect "$container_id" --format '{{.Config.Image}}')`,
    `    container_health=$(docker inspect "$container_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')`,
    `    container_env=$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}')`,
    `    container_version=$(printf '%s\n' "$container_env" | sed -n 's/^IMAGE_TAG=//p' | head -n 1)`,
    `    container_sso_enabled=$(printf '%s\n' "$container_env" | sed -n 's/^FORUM_SSO_ENABLED=//p' | head -n 1)`,
    `    container_sso_secret_file=$(printf '%s\n' "$container_env" | sed -n 's/^FORUM_SSO_SECRET_FILE=//p' | head -n 1)`,
    `    container_secret_ready=false`,
    `    container_migrations_ready=false`,
    `    if docker exec "$container_id" test -r /run/secrets/forum_sso_secret 2>/dev/null; then container_secret_ready=true; fi`,
    `    if docker exec "$container_id" sh -lc 'test -s /app/migrations/SHA256SUMS && cd /app/migrations && sha256sum -c SHA256SUMS >/dev/null' 2>/dev/null; then container_migrations_ready=true; fi`,
    `    case "$container_image" in`,
    `      "$expected_image"|"$expected_image"@*) if [ "$container_health" = healthy ] && [ "$container_version" = "$expected_version" ] && [ "$container_sso_enabled" = true ] && [ "$container_sso_secret_file" = /run/secrets/forum_sso_secret ] && [ "$container_secret_ready" = true ] && [ "$container_migrations_ready" = true ]; then healthy_target_count=$((healthy_target_count + 1)); fi ;;`,
    `    esac`,
    `  done`,
    `  image_matches=false`,
    `  case "$service_image" in "$expected_image"|"$expected_image"@*) image_matches=true ;; esac`,
    `  echo "rollout_state=$update_state image=$service_image version=$service_version sso=$service_sso_enabled sso_secret_file=$service_sso_secret_file sso_secret=$service_sso_secret expected_replicas=$expected_replicas active_target=$active_target_count active_other=$active_other_count healthy_target=$healthy_target_count"`,
    `  if [ "$image_matches" = true ] && [ "$service_version" = "$expected_version" ] && [ "$service_sso_enabled" = true ] && [ "$service_sso_secret_file" = /run/secrets/forum_sso_secret ] && [ "$service_sso_secret" = forum_sso_secret ] && [ "$update_state" = completed ] && [ "$active_target_count" -eq "$expected_replicas" ] && [ "$healthy_target_count" -eq "$expected_replicas" ] && [ "$active_other_count" -eq 0 ]; then`,
    `    break`,
    `  fi`,
    `  case "$update_state" in paused|rollback_started|rollback_paused|rollback_completed) echo "ERROR: Swarm rollout ended in $update_state"; exit 1 ;; esac`,
    `  if [ "$(date +%s)" -ge "$rollout_deadline" ]; then echo "ERROR: Swarm rollout did not converge within ${'${rollout_timeout_seconds}'} seconds"; exit 1; fi`,
    `  sleep 5`,
    `done`,
    `docker stack services ${shellToken(stackName)}`,
    `docker service ps "$service_name" --no-trunc`,
    `echo rollout_validation=PASS`
  ];
}

function forumImageValidationCommand(dockerTarget, imageTag) {
  const script = [
    'set -eu',
    'mkdir -p /run/secrets',
    "printf 'release-validator-secret' > /run/secrets/forum_sso_secret",
    'chmod 0600 /run/secrets/forum_sso_secret',
    'sh /etc/cont-init.d/04-rhospital-secret.sh',
    "test \"$(stat -c '%a|%u|%g' /run/secrets/forum_sso_secret)\" = '600|0|0'",
    "test \"$(stat -c '%a|%u|%g' /run/rhospital-secrets)\" = '700|1000|1000'",
    "test \"$(stat -c '%a|%u|%g' /run/rhospital-secrets/forum_sso_secret)\" = '400|1000|1000'",
    "yasu flarum:flarum php -r '$v=file_get_contents(\"/run/rhospital-secrets/forum_sso_secret\"); exit(strlen($v)>0 ? 0 : 1);'",
    "printf 'release-validator-secret-2' > /run/secrets/forum_sso_secret",
    'sh /etc/cont-init.d/04-rhospital-secret.sh',
    "yasu flarum:flarum php -r '$v=file_get_contents(\"/run/rhospital-secrets/forum_sso_secret\"); exit(str_ends_with($v, \"-2\") ? 0 : 1);'",
    "find /opt/rhospital-sso -name '*.php' -type f -exec php -l {} \\; | grep -q 'No syntax errors detected'",
    "test -f /opt/flarum/vendor/flarum-lang/chinese-simplified/extend.php",
    'cd /opt/flarum',
    "composer show flarum-lang/chinese-simplified --locked --no-interaction | grep -q 'versions.*1.6.0'",
    "composer audit --abandoned=report --format=json | php -r '$d=json_decode(stream_get_contents(STDIN),true); exit(count($d[\"advisories\"] ?? [])===0 ? 0 : 1);'",
    "echo 'forum_image_validation=PASS'"
  ].join('\n');
  const encoded = Buffer.from(`${script}\n`, 'utf8').toString('base64');
  return dockerCommand(dockerTarget, [
    'run', '--rm', '--entrypoint', 'sh', imageTag, '-lc',
    `printf %s "${encoded}" | base64 -d | sh`
  ]);
}

function forumPreflightCommand(remoteComposeDir) {
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    'docker compose config >/dev/null',
    "test \"$(docker inspect -f '{{.State.Running}}' flarum)\" = 'true'",
    "test \"$(docker inspect -f '{{.State.Running}}' mysql)\" = 'true'",
    'test -s ./secrets/forum_sso_secret',
    "stat -c 'secret_meta=%a|%u|%g' ./secrets/forum_sso_secret",
    "test \"$(stat -c '%a|%u|%g' ./secrets/forum_sso_secret)\" = '600|0|0'",
    "df -Pk . | awk 'NR==2 {if ($4 < 1048576) exit 1; print \"free_kb=\" $4}'",
    "docker ps --filter name='^/flarum$' --filter name='^/mysql$' --format '{{.Names}}|{{.Image}}|{{.Status}}'"
  ];
}

function forumBackupCommand(remoteComposeDir) {
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    'backup_dir=/opt/1panel/backup/forum-release-$(date -u +%Y%m%dT%H%M%SZ)',
    'umask 077',
    'mkdir -p "$backup_dir"',
    'cp docker-compose.yml "$backup_dir/docker-compose.yml"',
    '[ ! -f .env ] || cp .env "$backup_dir/.env"',
    "db_name=$(docker inspect flarum --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DB_NAME=//p' | head -n 1)",
    'test -n "$db_name"',
    "docker exec mysql sh -lc 'exec mysqldump --single-transaction --quick --routines --triggers -uroot -p\"$MYSQL_ROOT_PASSWORD\" \"$1\"' sh \"$db_name\" > \"$backup_dir/flarum.sql\"",
    'tar -czf "$backup_dir/flarum-data.tar.gz" -C data .',
    'docker inspect flarum > "$backup_dir/flarum.inspect.json"',
    "current_image=$(docker inspect flarum --format '{{.Config.Image}}')",
    'docker image inspect "$current_image" > "$backup_dir/flarum-image.inspect.json"',
    '(cd "$backup_dir" && sha256sum docker-compose.yml flarum.sql flarum-data.tar.gz flarum.inspect.json flarum-image.inspect.json > SHA256SUMS)',
    'test -s "$backup_dir/flarum.sql"',
    'test -s "$backup_dir/flarum-data.tar.gz"',
    'test -s "$backup_dir/SHA256SUMS"',
    'printf "%s\\n" "$backup_dir" > .last-forum-release-backup',
    'echo "backup_dir=$backup_dir"'
  ];
}

function forumContainerRunningCheck(containerName) {
  return [
    'ready=false',
    'for attempt in $(seq 1 60); do',
    `  if [ \"$(docker inspect -f '{{.State.Running}}' ${shellToken(containerName)} 2>/dev/null || true)\" = 'true' ]; then ready=true; break; fi`,
    '  sleep 2',
    'done',
    '[ "$ready" = true ]',
    `docker ps --filter name='^/${containerName}$' --format '{{.Names}}|{{.Image}}|{{.Status}}'`
  ].join('\n');
}

function finalForumRuntimeCheckCommand(containerName, imageTag) {
  const safeContainerName = shellToken(containerName);
  return [
    `container_image=$(docker inspect ${safeContainerName} --format '{{.Config.Image}}')`,
    'echo "container_image=$container_image"',
    `test \"$container_image\" = ${shellToken(imageTag)}`,
    'forum_ready_file=/run/rhospital-ready/forum-ready',
    'ready=false',
    'forum_info=',
    'for attempt in $(seq 1 90); do',
    `  container_running=$(docker inspect -f '{{.State.Running}}' ${safeContainerName} 2>/dev/null || true)`,
    '  secret_ready=false',
    '  forum_ready=false',
    `  if [ "$container_running" = 'true' ] && docker exec -u flarum ${safeContainerName} test -r /run/rhospital-secrets/forum_sso_secret 2>/dev/null; then secret_ready=true; fi`,
    `  if [ "$secret_ready" = 'true' ]; then forum_info=$(docker exec ${safeContainerName} cat "$forum_ready_file" 2>/dev/null || true); fi`,
    '  if printf "%s\\n" "$forum_info" | grep -q "^forum_core=1.8.17$" && printf "%s\\n" "$forum_info" | grep -q "^forum_extension_rhospital_sso=enabled$" && printf "%s\\n" "$forum_info" | grep -q "^forum_locale=zh-Hans$" && printf "%s\\n" "$forum_info" | grep -Eq "^forum_translation_count=[1-9][0-9]*$" && printf "%s\\n" "$forum_info" | grep -Eq "^forum_translation_probe=.+$" && ! printf "%s\\n" "$forum_info" | grep -q "^forum_translation_probe=Profile$"; then forum_ready=true; fi',
    '  echo "forum_readiness attempt=$attempt running=$container_running secret=$secret_ready application=$forum_ready"',
    '  if [ "$container_running" = true ] && [ "$secret_ready" = true ] && [ "$forum_ready" = true ]; then ready=true; break; fi',
    '  sleep 2',
    'done',
    `if [ "$ready" != true ]; then docker logs --tail 120 ${safeContainerName} 2>&1; echo 'ERROR: forum did not become ready within 180 seconds'; exit 1; fi`,
    `docker exec -u flarum ${safeContainerName} test -r /run/rhospital-secrets/forum_sso_secret`,
    'printf "%s\\n" "$forum_info"',
    'printf "%s\\n" "$forum_info" | grep -q "^forum_core=1.8.17$"',
    'printf "%s\\n" "$forum_info" | grep -q "^forum_extension_rhospital_sso=enabled$"',
    'printf "%s\\n" "$forum_info" | grep -q "^forum_locale=zh-Hans$"',
    'printf "%s\\n" "$forum_info" | grep -Eq "^forum_translation_count=[1-9][0-9]*$"',
    `cache_owner_error=$(docker exec ${safeContainerName} sh -lc 'find -L /opt/flarum/storage/cache /opt/flarum/storage/locale \\( ! -user flarum -o ! -group flarum \\) -print -quit 2>/dev/null')`,
    'if [ -n "$cache_owner_error" ]; then echo "ERROR: forum runtime cache ownership mismatch: $cache_owner_error"; exit 1; fi',
    'public_ready=false',
    'for attempt in $(seq 1 30); do if curl -fsS -o /dev/null https://bbs.rhospital.cc/; then public_ready=true; break; fi; sleep 2; done',
    '[ "$public_ready" = true ]',
    'forum_html=$(curl -fsS https://bbs.rhospital.cc/)',
    `locale_asset=$(printf '%s' "$forum_html" | sed -n 's#.*src="\\([^"]*forum-zh-Hans\\.js?v=[^"]*\\)".*#\\1#p' | head -n 1)`,
    '[ -n "$locale_asset" ]',
    'case "$locale_asset" in http*) ;; *) locale_asset="https://bbs.rhospital.cc$locale_asset" ;; esac',
    'locale_js=$(curl -fsS "$locale_asset")',
    `printf '%s' "$locale_js" | grep -q 'core.forum.header.profile_button'`,
    `printf '%s' "$locale_js" | grep -Fq 'core.forum.header.profile_button":"\\u4e2a\\u4eba\\u4e3b\\u9875'`,
    `if printf '%s' "$locale_js" | grep -q 'addTranslations(\\[\\])'; then echo 'ERROR: forum locale asset is empty'; exit 1; fi`,
    'echo "locale_asset=$locale_asset"',
    `if docker logs --since 5m ${safeContainerName} 2>&1 | grep -E 'forum_sso_secret.*Permission denied|Permission denied.*forum_sso_secret'; then echo 'ERROR: forum SSO secret permission failure'; exit 1; fi`,
    "echo 'forum_runtime_validation=PASS'"
  ];
}

function forumRollbackCommand(remoteComposeDir) {
  return [
    `cd ${shellToken(remoteComposeDir)}`,
    'backup_dir=$(cat .last-forum-release-backup)',
    'test -s "$backup_dir/docker-compose.yml"',
    'cp docker-compose.yml docker-compose.yml.failed.$(date -u +%Y%m%dT%H%M%SZ)',
    'cp "$backup_dir/docker-compose.yml" docker-compose.yml',
    'docker compose config >/dev/null',
    'docker compose up -d --no-deps --force-recreate flarum',
    forumContainerRunningCheck('flarum')
  ];
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

function runPowerShell(cwd, command, env, onChunk, onHeartbeat, signal, timeoutSeconds = 0) {
  const testMode = String((env && env.RELEASE_PUBLISHER_TEST_MODE)
    || process.env.RELEASE_PUBLISHER_TEST_MODE
    || '').toLowerCase();
  if (testMode === 'true' || testMode === '1') {
    return Promise.reject(new Error('测试模式禁止启动系统发布命令；执行测试必须注入 runCommand'));
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let heartbeat = null;
    let timeoutHandle = null;
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
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
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
    if (Number(timeoutSeconds) > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        killProcessTree(child);
        reject(new Error(`命令超过 ${timeoutSeconds} 秒未完成`));
      }, Number(timeoutSeconds) * 1000);
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
  DEFAULT_FORUM_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  parseIdeaRunConfig,
  readConfig,
  readReleaseConfig,
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
  readRemoteComposeImageTag,
  analyzeReleaseChanges,
  assertReleaseTargetChanged,
  listGitBranches,
  listGitCommits,
  refreshGitRefs,
  parseSshGOutput,
  proposeNextTag,
  validateReleaseTarget,
  validateForumImageMode,
  validateTag,
  validateGitBranch,
  validateGitCommit,
  resolveCatalogSchemaVersion
};
