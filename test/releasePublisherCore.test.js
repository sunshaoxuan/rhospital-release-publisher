const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test, temporaryDirectory} = require('./helpers/ownedFixtures').fixtureLifecycle(require('node:test'));
const vm = require('node:vm');

process.env.RELEASE_PUBLISHER_TEST_MODE = 'true';

const {
  createPlan,
  DEFAULT_REMOTE_COMPOSE_DIR,
  DEFAULT_FORUM_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  executePlan: executePlanCore,
  diagnoseHistoryEntry,
  resolveDockerContextDetails,
  resolvePublisherDockerServerDetails,
  resolveReleaseTargetDockerServerName,
  resolveIdeaDockerServerDetails,
  listGitBranches,
  listGitCommits,
  refreshGitRefs,
  parseSshGOutput,
  readReleaseConfig,
  proposeNextTag,
  readReleaseHistory,
  readReleaseHistoryPage,
  deleteReleaseHistoryEntry,
  clearReleaseHistory,
  appendReleaseHistory,
  buildHistoryEntry,
  validateTag,
  validateGitBranch,
  validateGitCommit,
  resolveCatalogSchemaVersion,
  residentMigrationPreflight,
  analyzeReleaseChanges,
  assertReleaseTargetChanged,
  readRemoteComposeImageTag,
  tradePoolCatalogLogCheckCommands,
  runPowerShell,
  remoteSshCommand
} = require('../src/releasePublisherCore');
const {
  ACCEPTANCE_FLAG,
  createAcceptanceIsolation,
  executeReleasePlanAcceptance
} = require('../src/releaseFlowAcceptance');


async function executePlan(root,request,environment,options={}) {
  if(typeof options.runCommand!=='function')return executePlanCore(root,request,environment,options);
  return executePlanCore(root,request,environment,{...options,runCommand:async(...args)=>{
    const output=await options.runCommand(...args);
    const prefix=mockedPluginPrefix(args[0],args[1]);
    if(!prefix)return output;
    const report=JSON.parse(prefix);report.migrationDeclarations=(request.changeAnalysis?.targets?.game?.changedPaths||[]).filter(file=>/^scripts\/migration\/.+\.sql$/.test(file));
    return JSON.stringify(report)+'\n';
  }});
}

const sampleXml = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="192.0.2.10" type="docker-deploy" factoryName="dockerfile" server-name="GAME_PRD2">
    <deployment type="dockerfile">
      <settings>
        <option name="imageTag" value="hospital-backend:2026070701" />
        <option name="buildArgs">
          <list>
            <DockerEnvVarImpl>
              <option name="name" value="APP_TAG" />
              <option name="value" value="2026070701" />
            </DockerEnvVarImpl>
          </list>
        </option>
        <option name="buildOnly" value="true" />
        <option name="containerName" value="hospital-backend" />
        <option name="envVars">
          <list>
            <DockerEnvVarImpl>
              <option name="name" value="EXECUTOR_PORT" />
              <option name="value" value="9996" />
            </DockerEnvVarImpl>
            <DockerEnvVarImpl>
              <option name="name" value="HOST_IP" />
              <option name="value" value="192.0.2.10" />
            </DockerEnvVarImpl>
          </list>
        </option>
        <option name="sourceFilePath" value="Dockerfile" />
        <option name="volumeBindings">
          <list>
            <DockerVolumeBindingImpl>
              <option name="containerPath" value="/data" />
              <option name="hostPath" value="/usr/local/software/rhospital" />
            </DockerVolumeBindingImpl>
          </list>
        </option>
      </settings>
    </deployment>
    <method v="2" />
  </configuration>
</component>`;

function decodedRemoteScript(command) {
  if (String(command).includes('game-standby-candidate.cjs')) {
    const encoded = String(command).match(/\$candidateRequest = '([0-9A-Za-z+/=]+)'/);
    assert.ok(encoded, 'candidate cutover payload is required');
    return JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8')).cutoverScript;
  }
  const match = String(command).match(/(?:printf %s ["']|\$remoteScript = ["'])([0-9A-Za-z+/=]+)["']/);
  assert.ok(match, `command does not contain an encoded remote script: ${command}`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

function decodedScriptTree(command) {
  const decoded = [];
  const pending = [String(command)];
  const pattern = /(?:printf %s ["']|\$remoteScript = ["'])([0-9A-Za-z+/=]+)["']/g;
  while (pending.length > 0) {
    const value = pending.shift();
    decoded.push(value);
    if (value.includes('game-standby-candidate.cjs') && / cutover(?:;|\s)/.test(value)) {
      pending.push(decodedRemoteScript(value));
    }
    for (const match of value.matchAll(pattern)) {
      const child = Buffer.from(match[1], 'base64').toString('utf8');
      if (!decoded.includes(child) && !pending.includes(child)) pending.push(child);
    }
  }
  return decoded.join('\n');
}

function runTradePoolCatalogLogGate(exitCode, logs) {
  const encodedLogs = Buffer.from(logs, 'utf8').toString('base64');
  const script = [
    'set -e',
    `timeout() { printf %s '${encodedLogs}' | base64 -d; return ${Number(exitCode)}; }`,
    'service_name=hospital_stack_hospital-backend',
    'container_id=target-container',
    'release_started_at=2026-07-30T04:10:16Z',
    ...tradePoolCatalogLogCheckCommands()
  ].join('\n');
  return spawnSync(testBashExecutable(), ['-c', script], {
    encoding: 'utf8'
  });
}

function testBashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    process.env.GIT_BASH_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || 'bash';
}

test('trade-pool log gate accepts captured completion after container log timeout', () => {
  const result = runTradePoolCatalogLogGate(124,
    'catalog database upgrade finished outcome=ALREADY_COMPLETED');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /catalog_log_collection_exit=124/);
  assert.match(result.stdout, /validating captured output/);
});

test('trade-pool log gate rejects a timed out capture without completion evidence', () => {
  const result = runTradePoolCatalogLogGate(124, 'application startup complete');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /catalog upgrade completion log is missing/);
});

test('trade-pool log gate rejects an explicit catalog upgrade failure', () => {
  const result = runTradePoolCatalogLogGate(0, [
    'catalog database upgrade finished outcome=APPLIED',
    'catalog database upgrade failed reason=validation'
  ].join('\n'));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /catalog database upgrade failure detected/);
});

test('trade-pool log gate rejects unexpected container log command failures', () => {
  const result = runTradePoolCatalogLogGate(125,
    'catalog database upgrade finished outcome=ALREADY_COMPLETED');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /container log collection failed with exit 125/);
});

test('suggests next tag from current date and sequence', () => {
  const now = new Date(2026, 6, 9);

  assert.equal(proposeNextTag('2026070809', now), '20260709');
  assert.equal(proposeNextTag('20260709', now), '2026070901');
  assert.equal(proposeNextTag('hospital-backend:20260709', now), '2026070901');
  assert.equal(proposeNextTag(['20260708', '2026070901'], now), '2026070902');
  assert.equal(proposeNextTag(['20260710'], now), '2026070901');
});

test('reads Catalog schema version from the selected release source', () => {
  const root = tempProject(sampleXml);

  assert.equal(resolveCatalogSchemaVersion(root, 'latest'), 20);
  const sourcePath = path.join(root, 'src', 'main', 'java', 'com', 'zly', 'hospital', 'service', 'catalog',
    'CatalogDatabaseUpgradeService.java');
  fs.writeFileSync(sourcePath, 'public final class CatalogDatabaseUpgradeService {}\n', 'utf8');
  assert.throws(() => resolveCatalogSchemaVersion(root, 'latest'), /MARKER_VERSION/);
});

test('creates dry run command plan without production execution enabled', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    ...selectGameChecks(root, 'verify-relations-release', 'verify-tradepool-release'),
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.imageTag, 'hospital-backend:2026070702');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.gitBranch, 'origin/master');
  assert.equal(plan.gitCommit, 'latest');
  assert.equal(plan.config.catalogSchemaVersion, 20);
  assert.equal(plan.config.executionEnabled, true);
  assert.equal(plan.config.dockerContextResolution.note, '已跳过 Docker context 解析');
  assert.ok(plan.steps.some(step => step.key === 'git-status-before-update'
    && step.command.includes('git status --short --branch')
    && !step.command.includes(' && ')));
  assert.ok(plan.steps.some(step => step.key === 'git-fetch'
    && step.command === 'git fetch --prune origin'));
  assert.ok(plan.steps.some(step => step.key === 'git-update'
    && step.title === '切换到分支最新提交'
    && step.command === 'git checkout origin/master'));
  assert.ok(plan.steps.some(step => step.key === 'validate-game-sso-source'
    && !step.command.includes('merge-base --is-ancestor')
    && !step.command.includes('git cat-file -e')
    && step.command.includes('CatalogDatabaseUpgradeService.java')));
  assert.ok(plan.steps.some(step => step.key === 'test-game-backend'
    && step.command.includes('docker build --target build')
    && !/(?:^|\s)-H(?:\s|=|$)/.test(step.command)
    && !step.command.includes('--context')
    && step.command.includes('hospital-backend:2026070702-buildcheck')));
  assert.ok(!plan.steps.some(step => step.key === 'compile-artifact'));
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('docker build')
    && !/(?:^|\s)-H(?:\s|=|$)/.test(step.command)
    && !step.command.includes('--context')
    && step.command.includes('-t hospital-backend:2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'validate-game-image'
    && decodedRemoteScript(step.command).includes('game_image_tradepool_validation=PASS')
    && decodedRemoteScript(step.command).includes('game_image_migration_bundle=PASS')
    && decodedRemoteScript(step.command).includes('/app/migrations/SHA256SUMS')
    && decodedRemoteScript(step.command).includes('sha256sum -c SHA256SUMS')
    && decodedRemoteScript(step.command).includes('ForumSsoController.class')
    && decodedRemoteScript(step.command).includes('ForumSsoDatabaseUpgradeService.class')
    && decodedRemoteScript(step.command).includes('AdminTradePoolPageController.class')
    && decodedRemoteScript(step.command).includes('AdminToiletMarketController.class')
    && decodedRemoteScript(step.command).includes('AdminTradePoolService.class')
    && decodedRemoteScript(step.command).includes('admin_tradepool.html')
    && decodedRemoteScript(step.command).includes('expected_catalog_version=20')
    && decodedRemoteScript(step.command).includes('game_image_catalog_version=$actual_catalog_version')
    && decodedRemoteScript(step.command).includes('listing_source')
    && decodedRemoteScript(step.command).includes('idx_toilet_listing_admin_batch')
    && decodedRemoteScript(step.command).includes('idx_toilet_tx_type_id')
    && decodedRemoteScript(step.command).includes('idx_toilet_tx_actor_id')
    && decodedRemoteScript(step.command).includes('idx_toilet_tx_target_id')
    && decodedRemoteScript(step.command).includes('test "$IMAGE_TAG" = 2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes('docker save -o')
    && step.command.includes('scp')
    && !step.command.includes('game-standby-candidate.cjs')));
  const publishImageIndex = plan.steps.findIndex(step => step.key === 'publish-image');
  assert.ok(plan.steps.findIndex(step => step.key === 'resolve-ssh-target') < publishImageIndex);
  assert.ok(plan.steps.findIndex(step => step.key === 'game-prd2-migration-readiness') < publishImageIndex);
  assert.ok(plan.steps.findIndex(step => step.key === 'read-remote-compose') < publishImageIndex);
  assert.ok(plan.steps.findIndex(step => step.key === 'game-database-preflight') < publishImageIndex);
  assert.ok(plan.steps.some(step => step.key === 'read-remote-compose'
    && decodedRemoteScript(step.command).includes(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`)
    && decodedRemoteScript(step.command).includes('IMAGE_TAG')
    && decodedRemoteScript(step.command).includes('deploy replicas must equal 1')
    && decodedRemoteScript(step.command).includes('update_config must use start-first')
    && decodedRemoteScript(step.command).includes('rollback_config must use start-first')
    && decodedRemoteScript(step.command).includes('graceful stop or healthcheck contract is invalid')
    && decodedRemoteScript(step.command).includes('environment, port, volume, network or restart contract is invalid')
    && decodedRemoteScript(step.command).includes('forum SSO environment contract is incomplete')
    && decodedRemoteScript(step.command).includes('production profile or secret file environment contract is invalid')
    && decodedRemoteScript(step.command).includes('Secret mapping count is invalid')
    && decodedRemoteScript(step.command).includes('game_failback_spring_datasource_password:spring.datasource.password')
    && decodedRemoteScript(step.command).includes('game_new_relic_license_key:newrelic.license.key')
    && decodedRemoteScript(step.command).includes('game_compose_runtime_contract=PASS')));
  assert.ok(plan.steps.some(step => step.key === 'game-database-preflight'
    && decodedScriptTree(step.command).includes('RELEASE_DB_AUDIT_MODE=inspect')
    && decodedScriptTree(step.command).includes('RELEASE_EXPECTED_CATALOG_VERSION=20')
    && decodedScriptTree(step.command).includes('read_secret()')
    && decodedScriptTree(step.command).includes('secret_file="/run/secrets/$1"')
    && decodedScriptTree(step.command).includes('tr -d "\\r\\n"')
    && decodedScriptTree(step.command).includes('read_secret spring.datasource.url')
    && decodedScriptTree(step.command).includes('read_secret spring.datasource.username')
    && decodedScriptTree(step.command).includes('read_secret spring.datasource.password')
    && decodedScriptTree(step.command).includes('Catalog downgrade is blocked')
    && decodedScriptTree(step.command).includes('tradepool_schema_transition=')
    && decodedScriptTree(step.command).includes('tradepool_schema_preflight')));
  assert.ok(plan.steps.some(step => step.key === 'backup-game-release'
    && decodedScriptTree(step.command).includes('/opt/1panel/backup/game-release-')
    && decodedScriptTree(step.command).includes('RELEASE_DB_AUDIT_MODE=backup')
    && decodedScriptTree(step.command).includes('TRANSACTION_REPEATABLE_READ')
    && decodedScriptTree(step.command).includes('t_toilet_market_listing')
    && decodedScriptTree(step.command).includes('.last-game-release-backup')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && step.command.includes('base64 -d | bash')
    && decodedRemoteScript(step.command).includes("export APP_TAG='2026070702'")
    && decodedRemoteScript(step.command).includes("--arg image 'hospital-backend:2026070702' --arg version '2026070702'")
    && decodedRemoteScript(step.command).includes('python3 - prepare --root')
    && decodedRemoteScript(step.command).includes('game_compose_runtime_contract=PASS')
    && decodedRemoteScript(step.command).includes('docker stack config -c docker-compose.yml')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-stack'
    && decodedRemoteScript(step.command).includes('hospital-backend deploy replicas must equal 1')
    && decodedRemoteScript(step.command).includes('healthy_before_deploy')
    && decodedRemoteScript(step.command).indexOf('game_compose_runtime_contract=PASS')
      < decodedRemoteScript(step.command).indexOf('docker stack deploy -c docker-compose.yml hospital_stack')
    && decodedRemoteScript(step.command).includes('replicas_after_submit')
    && decodedRemoteScript(step.command).includes('healthy_after_submit')
    && decodedRemoteScript(step.command).includes('game_stack_deploy_guard=PASS')));
  assert.ok(plan.steps.every(step => step.summary && step.validation && step.status === 'pending'));
  assert.ok(plan.steps.some(step => step.key === 'test-game-backend'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702-buildcheck')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && decodedRemoteScript(step.validationCommand).includes('grep -nE')
    && decodedRemoteScript(step.validationCommand).includes('hospital-backend:2026070702')
    && decodedRemoteScript(step.validationCommand).includes('IMAGE_TAG=2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-stack'
    && decodedRemoteScript(step.validationCommand).includes('Replicated.Replicas')
    && decodedRemoteScript(step.validationCommand).includes('health=healthy')
    && decodedRemoteScript(step.validationCommand).includes('docker stack services hospital_stack')));
  assert.ok(plan.steps.some(step => step.key === 'commit-game-cutover'
    && step.cutoverCommit === true
    && step.timeoutSeconds === 1860
    && step.validation.includes('全链路致命故障触发回退')
    && decodedRemoteScript(step.command).includes('game_cutover_observation=PASS')
    && decodedRemoteScript(step.command).includes('active_other_count')
    && decodedRemoteScript(step.command).includes('[ "$update_state" = updating ] || [ "$update_state" = completed ]')));
  assert.ok(plan.steps.some(step => step.key === 'final-runtime-check'
    && step.finalCheck
    && step.timeoutSeconds === 1860
    && step.validation.includes('hospital-backend:2026070702')
    && decodedRemoteScript(step.command).includes('expected_image=hospital-backend:2026070702')
    && decodedRemoteScript(step.command).includes('expected_version=2026070702')
    && decodedRemoteScript(step.command).includes('RELEASE_PUBLISHER_ROLLOUT_TIMEOUT_SECONDS:-1800')
    && decodedRemoteScript(step.command).includes("update_state=$(docker service inspect \"$service_name\" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}completed{{end}}')")
    && decodedRemoteScript(step.command).includes('--filter desired-state=running')
    && decodedRemoteScript(step.command).includes('container_health=$(docker inspect')
    && decodedRemoteScript(step.command).includes('container_version=$(printf')
    && decodedRemoteScript(step.command).includes('container_sso_enabled=$(printf')
    && decodedRemoteScript(step.command).includes('container_secret_ready=false')
    && decodedRemoteScript(step.command).includes('service_sso_enabled')
    && decodedRemoteScript(step.command).includes('service_sso_secret=')
    && decodedRemoteScript(step.command).includes('active_other_count')
    && decodedRemoteScript(step.command).includes('rollout_validation=PASS')));
  assert.ok(plan.steps.some(step => step.key === 'game-prd2-runtime-contract'
    && decodedRemoteScript(step.command).includes('timeout 20 docker logs --tail 500 "$runtime_container"')
    && !decodedRemoteScript(step.command).includes('docker service logs')
    && decodedRemoteScript(step.command).includes('--filter health=healthy')
    && decodedRemoteScript(step.command).includes('SPRING_PROFILE=//p')
    && decodedRemoteScript(step.command).includes('NEW_RELIC_LICENSE_KEY_FILE=//p')
    && decodedScriptTree(step.command).includes('secret_mapping_count_mismatch')
    && decodedRemoteScript(step.command).includes('Spec.RollbackConfig.Order')
    && decodedRemoteScript(step.command).includes('Spec.TaskTemplate.ContainerSpec.StopGracePeriod')
    && decodedScriptTree(step.command).includes('secret_identity_mismatch')
    && decodedScriptTree(step.command).includes('game_failback_spring_datasource_password')
    && decodedScriptTree(step.command).includes('game_new_relic_license_key')
    && decodedRemoteScript(step.command).includes('NEW_RELIC_LICENSE_KEY=')));
  const deployIndex = plan.steps.findIndex(step => step.key === 'deploy-stack');
  const cutoverCommitIndex = plan.steps.findIndex(step => step.key === 'commit-game-cutover');
  const finalRuntimeIndex = plan.steps.findIndex(step => step.key === 'final-runtime-check');
  assert.ok(deployIndex < cutoverCommitIndex && cutoverCommitIndex < finalRuntimeIndex,
    'cutover commit must be recorded after deploy and before extended runtime observation');
  assert.ok(plan.steps.some(step => step.key === 'verify-game-static-delivery'
    && step.finalCheck
    && step.timeoutSeconds === 2100
    && step.command.includes('verify-game-static-delivery.mjs')
    && step.command.includes('--app-tag 2026070702')
    && step.command.includes("--auth-token-file 'C:\\ProgramData\\RHospital\\secrets\\game-smoke-token.txt'")
    && step.validation.includes('X-Cache')
    && step.validation.includes('Steam ES 模块')
    && step.summary.includes('隔离复测一次')));
  assert.ok(plan.steps.some(step => step.key === 'verify-relations-release'
    && step.finalCheck
    && step.timeoutSeconds === 900
    && step.command.includes('verify-relations-release.mjs')
    && step.command.includes('--app-tag 2026070702')
    && step.command.includes("--auth-token-file 'C:\\ProgramData\\RHospital\\secrets\\game-smoke-token.txt'")
    && step.validation.includes('/relations')
    && step.validation.includes('关系图接口不含邮箱')
    && step.validation.includes('邮箱、医院名和院长名')
    && step.validation.includes('查询提交不得自动选择')
    && step.validation.includes('加载和刷新期间禁用')
    && step.validation.includes('页面首次关系 API 响应')
    && step.validation.includes('至少有一条明确关系')
    && step.validation.includes('快照必须发生在成功响应之后')
    && step.validation.includes('实际场景关系对象均清零')
    && step.summary.includes('医院 ID 唯一')
    && step.summary.includes('真实场景对象全量一致')
    && step.summary.includes('发布环境清单')));
  assert.ok(plan.steps.some(step => step.key === 'validate-game-static-delivery-prerequisites'
    && step.command.includes('verify-game-static-delivery.mjs')
    && step.command.includes('--app-tag 2026070702')
    && step.command.includes("--auth-token-file 'C:\\ProgramData\\RHospital\\secrets\\game-smoke-token.txt'")
    && step.command.includes('--check-prerequisites')
    && step.command.includes('--mode route-check')
    && step.command.includes('game-static-assets.mjs')
    && step.validation.includes('game_static_delivery_browser=PASS')
    && step.validation.includes('game_static_delivery_prerequisites=PASS')
    && step.validation.includes('gateway_static_route_preflight=PASS')));
  const prerequisiteIndex = plan.steps.findIndex(step => step.key === 'validate-game-static-delivery-prerequisites');
  const backendTestIndex = plan.steps.findIndex(step => step.key === 'test-game-backend');
  const gitUpdateIndex = plan.steps.findIndex(step => step.key === 'git-update');
  const firstProductionIndex = plan.steps.findIndex(step => step.productionAction === true);
  assert.ok(prerequisiteIndex >= 0 && prerequisiteIndex < firstProductionIndex,
    'static delivery prerequisites must run before every production action');
  assert.ok(prerequisiteIndex < backendTestIndex,
    'static delivery prerequisites must run before the full backend test suite');
  assert.ok(prerequisiteIndex < gitUpdateIndex,
    'static delivery prerequisites must run before changing the working tree revision');
  assert.ok(plan.steps.some(step => step.key === 'build-game-static-assets'
    && step.command.includes('--target frontend-assets')
    && step.validationCommand.includes('--mode validate')
    && step.validationCommand.includes('game-static-assets.mjs')));
  assert.ok(plan.steps.some(step => step.key === 'stage-game-static-assets'
    && step.productionAction
    && step.command.includes('game-static-assets.mjs')
    && step.command.includes('--mode stage')
    && step.command.includes(path.join('rhospital', 'release', 'game-static-gateways.json'))));
  assert.ok(plan.steps.some(step => step.key === 'verify-game-static-assets-predeploy'
    && step.command.includes('--mode verify')
    && step.validation.includes('X-Cache=LOCAL')));
  assert.ok(plan.steps.some(step => step.key === 'verify-tradepool-release'
    && decodedScriptTree(step.command).includes('RELEASE_DB_AUDIT_MODE=verify')
    && decodedScriptTree(step.command).includes('RELEASE_EXPECTED_CATALOG_VERSION=20')
    && decodedScriptTree(step.command).includes('status.markerVersion() != EXPECTED_VERSION')
    && decodedScriptTree(step.command).includes('idx_toilet_tx_actor_id')
    && decodedScriptTree(step.command).includes('idx_toilet_tx_target_id')
    && decodedScriptTree(step.command).includes('Catalog marker must equal target version')
    && decodedScriptTree(step.command).includes('catalog database upgrade failed')
    && decodedScriptTree(step.command).includes('migration_logs_status=$?')
    && decodedScriptTree(step.command).includes('catalog_log_collection_exit=')
    && decodedScriptTree(step.command).includes('validating captured output')
    && decodedScriptTree(step.command).includes('timeout 20 docker logs --since')
    && decodedScriptTree(step.command).includes('"$container_id" >"$migration_logs_file"')
    && decodedScriptTree(step.command).includes('trap \'rm -f "$migration_logs_file"\' EXIT')
    && decodedScriptTree(step.command).includes('/admin/tradepool')
    && decodedScriptTree(step.command).includes('/api/admin/toilet-market/pool')
    && decodedScriptTree(step.command).includes('tradepool_release_validation=PASS')));
  const staticDeliveryIndex = plan.steps.findIndex(step => step.key === 'verify-game-static-delivery');
  const relationsReleaseIndex = plan.steps.findIndex(step => step.key === 'verify-relations-release');
  const tradePoolIndex = plan.steps.findIndex(step => step.key === 'verify-tradepool-release');
  assert.ok(finalRuntimeIndex < staticDeliveryIndex
    && staticDeliveryIndex < relationsReleaseIndex
    && relationsReleaseIndex < tradePoolIndex,
    'final game verification order must be runtime, static delivery, relations, then trade pool');
  const gameRollback = plan.steps.find(step => step.key === 'game-rollback-command');
  const gameRollbackDecision = plan.steps.find(step => step.key === 'game-rollback-decision');
  assert.ok(gameRollbackDecision);
  assert.equal(gameRollbackDecision.executable, true);
  assert.equal(gameRollbackDecision.recoveryOnly, true);
  const rollbackDecisionScript = decodedRemoteScript(gameRollbackDecision.command);
  assert.ok(rollbackDecisionScript.includes('automatic_rollback_evidence'));
  assert.ok(rollbackDecisionScript.includes('automatic_rollback_decision=HOLD_TARGET'));
  assert.ok(rollbackDecisionScript.includes('automatic_rollback_decision=ROLLBACK_CONFIRMED'));
  assert.ok(rollbackDecisionScript.includes('active_other'));
  assert.ok(rollbackDecisionScript.includes('healthy_target'));
  assert.ok(gameRollback);
  assert.equal(gameRollback.executable, true);
  assert.equal(gameRollback.recoveryOnly, true);
  const rollbackScript = decodedRemoteScript(gameRollback.command);
  const rollbackScriptTree = decodedScriptTree(gameRollback.command);
  assert.ok(rollbackScript.includes('base64 -d | docker exec -i'));
  assert.ok(rollbackScript.includes('psql -X -v ON_ERROR_STOP=1'));
  assert.ok(rollbackScriptTree.includes("to_regclass('public.t_toilet_market_listing')"));
  assert.ok(rollbackScriptTree.includes("table_schema='public'"));
  assert.ok(rollbackScriptTree.includes("column_name='listing_source'"));
  assert.ok(rollbackScriptTree.includes("listing_source='ADMIN'"));
  assert.ok(rollbackScriptTree.includes('update t_toilet_market_listing set status='));
  assert.ok(rollbackScriptTree.includes('automatic_rollback_validation=PASS'));
  assert.ok(rollbackScript.includes('RELEASE_PUBLISHER_ROLLBACK_TIMEOUT_SECONDS:-1800'));
  assert.ok(rollbackScriptTree.includes('.last-game-release-backup'));
  assertStepType(plan, 'git-status-before-update', 'local-check', false);
  assertStepType(plan, 'git-fetch', 'local-code', false);
  assertStepType(plan, 'git-update', 'local-code', false);
  assertStepType(plan, 'validate-game-sso-source', 'local-check', false);
  assertStepType(plan, 'pre-deploy-checklist', 'remote-check', false);
  assertStepType(plan, 'test-game-backend', 'build', false);
  assertStepType(plan, 'validate-release-input', 'local-check', false);
  assertStepType(plan, 'validate-game-static-delivery-prerequisites', 'local-check', false);
  assertStepType(plan, 'build-image', 'build', false);
  assertStepType(plan, 'build-game-static-assets', 'build', false);
  assertStepType(plan, 'validate-game-image', 'build', false);
  assertStepType(plan, 'publish-image', 'production', true);
  assertStepType(plan, 'resolve-ssh-target', 'local-check', false);
  assertStepType(plan, 'read-remote-compose', 'remote-check', false);
  assertStepType(plan, 'stage-game-static-assets', 'production', true);
  assertStepType(plan, 'verify-game-static-assets-predeploy', 'remote-check', false);
  assertStepType(plan, 'game-database-preflight', 'remote-check', false);
  assertStepType(plan, 'backup-game-release', 'production', true);
  assertStepType(plan, 'update-remote-compose', 'production', true);
  assertStepType(plan, 'deploy-stack', 'production', true);
  assertStepType(plan, 'commit-game-cutover', 'remote-check', false);
  assertStepType(plan, 'final-runtime-check', 'remote-check', false);
  assertStepType(plan, 'verify-game-static-delivery', 'remote-check', false);
  assertStepType(plan, 'verify-relations-release', 'remote-check', false);
  assertStepType(plan, 'verify-tradepool-release', 'remote-check', false);
  assertStepType(plan, 'game-rollback-decision', 'remote-check', false);
  assertStepType(plan, 'game-fatal-rollback-decision', 'remote-check', false);
  assert.ok(plan.steps.find(step => step.key === 'game-fatal-rollback-decision').recoveryOnly);
  assert.ok(plan.steps.find(step => step.key === 'game-fatal-rollback-decision').command
    .includes('evaluate-game-fatal-rollback.mjs'));
});

test('deploy guard blocks stack deploy when rendered compose requests zero replicas', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const deployScript = decodedRemoteScript(plan.steps.find(step => step.key === 'deploy-stack').command)
    .replace(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`, 'cd .');
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-zero-replica-guard-'));
  try {
    const harness = [
      'flock() { return 0; }',
      'docker() {',
      '  if [ "$1" = compose ]; then printf \'%s\\n\' \'{"services":{"hospital-backend":{"deploy":{"replicas":0}}}}\'; return 0; fi',
      '  if [ "$1" = stack ] && [ "$2" = deploy ]; then touch deploy-called; return 0; fi',
      '  return 0',
      '}',
      'jq() { if [ "$1" = -r ]; then printf \'0\\n\'; else return 0; fi; }',
      deployScript
    ].join('\n');
    const harnessPath = path.join(isolatedRoot, 'guard.sh');
    fs.writeFileSync(harnessPath, harness);
    const result = spawnSync(testBashExecutable(), [harnessPath.replace(/\\/g, '/')], {
      cwd: isolatedRoot,
      encoding: 'utf8'
    });
    assert.equal(result.error, undefined, 'fixture must reach the generated guard, not a Windows argv limit');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /deploy replicas must equal 1/);
    assert.equal(fs.existsSync(path.join(isolatedRoot, 'deploy-called')), false);
  } finally {
    fs.rmSync(isolatedRoot, {recursive: true, force: true});
  }
});

test('resident candidate precondition runs readonly before image upload and excludes migration DDL', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/20261108_add_resident_reward_ledger.sql';
  const block = `do $resident_precondition$
declare application_owner name;
begin
 if current_setting('server_version_num')::integer >= 190000 or current_schema() <> 'public' then
  raise exception 'unsupported target';
 end if;
 select pg_get_userbyid(core_table.relowner) into application_owner from pg_class core_table where core_table.relname='t_hospitals';
end $resident_precondition$;`;
  const source = `\\set ON_ERROR_STOP on\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\n${block}\ncreate table if not exists resident_fixture(id bigint);\ndo $owner$ declare application_owner name; begin select pg_get_userbyid(core_table.relowner) into application_owner from pg_class core_table where core_table.relname='t_hospitals'; execute format('alter table resident_fixture owner to %I',application_owner); end $owner$;\ncommit;\nselect 1;\n`;
  const file = path.join(root, migrationPath);
  fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, source);
  const plan = createPlan(root, {appTag:'2026111201', dryRun:true, includeStackDeploy:true, gitCommit:'latest',
    changeAnalysis:{targets:{game:{changedPaths:[migrationPath]}}}}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'});
  const guard = plan.steps.find(s=>s.key==='validate-game-database-migration-compatibility');
  const script = decodedScriptTree(guard.command);
  assert.match(script,/BEGIN READ ONLY/); assert(script.includes(block));
  assert.doesNotMatch(script,/create table if not exists resident_fixture/);
  assert.match(script,/statement_timeout = '30s'/);
  assert(plan.steps.indexOf(guard)<plan.steps.findIndex(s=>s.key==='publish-image'));
  assert.equal(plan.config.databaseMigrations[0].sha256,crypto.createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(residentMigrationPreflight('scripts/migration/other.sql',source),{});
  for(const invalid of [source.replace(block,''),source+block,source.replace('begin\n if','begin\n execute \'select 1\';\n if'),source.replace('current_schema()','public_schema()'),source.replace(block,'/*\n'+block+'\n*/'),source.replace(block,"select '\n"+block+"\n';")]) {
    assert.throws(()=>residentMigrationPreflight(migrationPath,invalid),/Migration precondition|Migration requires/);
  }
});

test('validates and applies changed database migrations before switching the production image', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/20260716_add_google_uid.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  const migrationLines = [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '10s';",
    "set local statement_timeout = '120s';",
    'alter table t_directors add column if not exists google_uid varchar(128);',
    'commit;',
    "select count(*) from information_schema.columns where column_name = 'google_uid';",
    ''
  ];
  fs.writeFileSync(absoluteMigration, migrationLines.join('\r\n'), 'utf8');

  const plan = createPlan(root, {
    appTag: '2026071701',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {
      targets: {
        game: {changedPaths: [migrationPath]}
      }
    }
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.config.databaseMigrations.length, 1);
  assert.equal(plan.config.databaseMigrations[0].filePath, migrationPath);
  assert.equal(
    plan.config.databaseMigrations[0].sha256,
    crypto.createHash('sha256').update(migrationLines.join('\n'), 'utf8').digest('hex')
  );
  const backupStep = plan.steps.find(step => step.key === 'backup-game-release');
  const compatibilityStep = plan.steps.find(step => step.key === 'validate-game-database-migration-compatibility');
  const migrationStep = plan.steps.find(step => step.key === 'apply-database-migrations');
  const composeStep = plan.steps.find(step => step.key === 'update-remote-compose');
  const checklistStep = plan.steps.find(step => step.key === 'pre-deploy-checklist');
  assert.ok(backupStep);
  assert.ok(compatibilityStep);
  assert.ok(migrationStep);
  assert.ok(composeStep);
  assert.ok(checklistStep);
  assert.ok(plan.steps.indexOf(compatibilityStep) < plan.steps.findIndex(step => step.key === 'publish-image'));
  assert.ok(plan.steps.indexOf(backupStep) < plan.steps.indexOf(migrationStep));
  assert.ok(plan.steps.indexOf(migrationStep) < plan.steps.indexOf(composeStep));
  assert.ok(plan.steps.indexOf(migrationStep) < plan.steps.indexOf(checklistStep));
  assert.ok(plan.steps.indexOf(checklistStep) < plan.steps.indexOf(composeStep));
  assert.doesNotMatch(decodedScriptTree(backupStep.command), /pg_dump -Fc|hospital\.pre-migration\.dump/);
  assert.match(decodedScriptTree(compatibilityStep.command), /BEGIN READ ONLY/);
  assert.match(decodedScriptTree(compatibilityStep.command), /ROLLBACK/);
  assert.match(decodedScriptTree(compatibilityStep.command), /psql -X -v ON_ERROR_STOP=1/);
  assert.match(decodedScriptTree(compatibilityStep.command), /game_database_migration_compatibility=PASS migrations=1 hashes=0/);
  assert.doesNotMatch(decodedScriptTree(compatibilityStep.command), /createdb|pg_restore|pg_dump|ALTER TABLE/);
  assert.match(decodedScriptTree(migrationStep.command), /psql -X -v ON_ERROR_STOP=1/);
  assert.match(decodedScriptTree(migrationStep.command), /20260716_add_google_uid\.sql/);
  assert.match(decodedScriptTree(migrationStep.command), /docker create --name/);
  assert.match(decodedScriptTree(migrationStep.command), /docker cp .*\/app\/migrations/);
  assert.match(decodedScriptTree(migrationStep.command), /image_migration_dir=.*image-bundle/);
  assert.match(decodedScriptTree(migrationStep.command), /migration_relative_path=20260716_add_google_uid\.sql/);
  assert.match(decodedScriptTree(migrationStep.command), /migration_file="\$image_migration_dir\/\$migration_relative_path"/);
  assert.match(decodedScriptTree(migrationStep.command), /sha256sum -c SHA256SUMS/);
  assert.match(decodedScriptTree(migrationStep.command), /image migration manifest does not exactly cover all SQL files/);
  assert.match(decodedScriptTree(migrationStep.command), /cmp -s/);
  assert.match(decodedScriptTree(migrationStep.command), /migration-image-source\.txt/);
  assert.match(decodedScriptTree(migrationStep.command), /http:\/\/127\.0\.0\.1:8190\//);
  assert.match(decodedScriptTree(migrationStep.command), /production availability probe failed during database migration/);
  assert.match(decodedScriptTree(migrationStep.command), /game_migration_availability=PASS/);
  assert.match(decodedScriptTree(migrationStep.command), /spring\.datasource\.username/);
  assert.match(decodedScriptTree(migrationStep.command), /to_regrole\(:'application_role'\)/);
  assert.match(decodedScriptTree(migrationStep.command), /runtime_object\.relkind IN \('r', 'p', 'S'\)/);
  assert.match(decodedScriptTree(migrationStep.command), /application_ownership_check.*true\|true\|0/);
  assert.match(decodedScriptTree(migrationStep.command), /game_database_application_ownership=PASS mismatches=0/);
  assert.doesNotMatch(decodedScriptTree(migrationStep.command), /echo .*application_database_role/);
  assert.doesNotMatch(decodedScriptTree(migrationStep.command), /alter table t_directors add column/);
  assert.match(decodedScriptTree(migrationStep.command), /database_migrations_applied=1/);
  assert.match(decodedScriptTree(checklistStep.command), /pre_deploy_checklist=PASS/);
  assert.match(decodedScriptTree(checklistStep.command), /migration source image ID mismatch/);
  assertStepType(plan, 'validate-game-database-migration-compatibility', 'remote-check', false);
  assertStepType(plan, 'apply-database-migrations', 'production', true);
});

test('opportunity conversion has a verified backpack backup before its SQL executes', () => {
  const root = tempProject(sampleXml);
  const migrationPath = require('../src/bacteriaInventoryBackup').MIGRATION;
  fs.mkdirSync(path.dirname(path.join(root, migrationPath)), {recursive: true});
  fs.writeFileSync(path.join(root, migrationPath), [
    '\\set ON_ERROR_STOP on', 'BEGIN;', "SET LOCAL lock_timeout='5s';",
    "SET LOCAL statement_timeout='120s';", 'SELECT 1;', 'COMMIT;', 'SELECT 1;'
  ].join('\n'));
  const plan = createPlan(root, {appTag: '2026102002', dryRun: true,
    includeStackDeploy: true, gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const backup = decodedScriptTree(plan.steps.find(step => step.key === 'backup-game-release').command);
  const apply = decodedScriptTree(plan.steps.find(step => step.key === 'apply-database-migrations').command);
  assert.match(backup, /pg_dump --format=custom --table=public.t_backpack/);
  assert.ok(backup.indexOf('game_database_identity=PASS') < backup.indexOf('pg_dump'));
  assert.ok(backup.indexOf('pg_dump') < backup.indexOf('bacteria_inventory_backup=PASS'));
  assert.ok(apply.indexOf('bacteria_inventory_backup=PASS') > 0);
  assert.ok(apply.indexOf('bacteria_inventory_backup=PASS') < apply.indexOf('< "$migration_file"'));
});

function technologyPlanFixture(extraSql = '', paths = ['scripts/migration/20261016_bound_supervision_income.sql', 'scripts/migration/20261016_technology_catalog.sql']) {
  const root = tempProject(sampleXml);
  for (const [index, filePath] of paths.entries()) {
    const target = path.join(root, filePath);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, ['\\set ON_ERROR_STOP on', 'BEGIN;', "SET LOCAL lock_timeout = '10s';",
      "SET LOCAL statement_timeout = '120s';", `ALTER TABLE t_hospitals ADD COLUMN IF NOT EXISTS tech_fixture_${index} bigint;`,
      index === 1 ? extraSql : '', 'COMMIT;', 'SELECT 1;'].join('\n'));
  }
  const request = {appTag: '2026101901', dryRun: true, includeStackDeploy: true, gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: paths}}}};
  const env = {RELEASE_PUBLISHER_TEST_MODE: 'true', RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json')};
  return {root, paths, request, env};
}

test('technology format plan places verified offline backup before DDL and guards every downstream phase', () => {
  const {root, request, env} = technologyPlanFixture();
  const plan = createPlan(root, request, env);
  const step = key => plan.steps.find(row => row.key === key);
  assert.ok(plan.steps.indexOf(step('backup-game-release')) < plan.steps.indexOf(step('technology-offline-cutover')));
  assert.ok(plan.steps.indexOf(step('technology-offline-cutover')) < plan.steps.indexOf(step('apply-database-migrations')));
  assert.equal(step('technology-offline-cutover').recoveryBoundary, true);
  for (const key of ['apply-database-migrations', 'pre-deploy-checklist', 'deploy-stack']) {
    const script = decodedScriptTree(step(key).command);
    assert.match(script, /technology-offline-backup\.verified/);
    assert.match(script, /technology target image changed/);
    assert.match(script, /assert_game_stopped/);
  }
  assert.doesNotMatch(decodedScriptTree(step('apply-database-migrations').command), /availability_monitor_pid|no healthy application container/);
  assert.match(decodedScriptTree(step('apply-database-migrations').command), /assert_no_database_writers/);
  assert.match(decodedScriptTree(step('update-remote-compose').command), /technology-quiesced\.inspect\.json/);
  assert.doesNotMatch(decodedScriptTree(step('deploy-stack').command), /no healthy old container|old healthy container disappeared/);
  const rollback = decodedScriptTree(step('game-rollback-command').command);
  assert.ok(rollback.indexOf('technology_rollback_compatibility=PASS') < rollback.indexOf('suspending all ACTIVE ADMIN'));
  assert.throws(() => createPlan(root, {...request, requireStandbyCandidate: true}, env), /single active writer/);
});

test('room-only format plan retains stopped-writer guards before migration and rollout', () => {
  const {root, request, env} = technologyPlanFixture('', ['scripts/migration/20261021_room_catalog.sql']);
  const plan = createPlan(root, request, env);
  const index = key => plan.steps.findIndex(row => row.key === key);
  const script = key => decodedScriptTree(plan.steps.find(row => row.key === key).command);
  assert.ok(index('backup-game-release') < index('technology-offline-cutover'));
  assert.ok(index('technology-offline-cutover') < index('apply-database-migrations'));
  assert.match(script('technology-offline-cutover'), /RoomCatalogService\.class/);
  for (const key of ['apply-database-migrations', 'pre-deploy-checklist', 'deploy-stack']) {
    assert.match(script(key), /\.room-format-floor-v1/);
    assert.match(script(key), /assert_game_stopped/);
  }
  assert.match(script('apply-database-migrations'), /assert_no_database_writers/);
  assert.doesNotMatch(script('apply-database-migrations'), /availability_monitor_pid/);
  assert.throws(() => createPlan(root, {...request, requireStandbyCandidate: true}, env), /single active writer/);
});

test('technology stop, migration and post-cutover failures require recovery without old-image rollback', async () => {
  for (const failure of ['technology_offline_cutover=PASS', 'database_migrations_applied=2', 'game_cutover_observation=PASS']) {
    const {root, request, env} = technologyPlanFixture();
    const runner = testCommandRunner({failOnIncludes: failure});
    const result = await executePlan(root, {...request, dryRun: false}, env, {runCommand: runner});
    assert.equal(result.status, 'RECOVERY_REQUIRED', failure + '\n' + result.logs.join('\n'));
    assert.equal(runner.commands.some(command => decodedScriptTree(command).includes('automatic_rollback_validation=PASS')), false);
  }
});

test('protective truncate trigger is accepted while actual truncation stays blocked', () => {
  const protective = 'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON t_technology_catalog_publication FOR EACH STATEMENT EXECUTE FUNCTION immutable_publication();';
  const good = technologyPlanFixture(protective);
  assert.doesNotThrow(() => createPlan(good.root, good.request, good.env));
  for (const destructive of ['TRUNCATE t_hospitals;', protective + '\nTRUNCATE TABLE t_hospitals;']) {
    const bad = technologyPlanFixture(destructive);
    assert.throws(() => createPlan(bad.root, bad.request, bad.env), /TRUNCATE/i);
  }
});

test('orders catalog migrations by declared release hash dependencies', () => {
  const root = tempProject(sampleXml);
  const migrationDir = path.join(root, 'scripts', 'migration');
  fs.mkdirSync(migrationDir, {recursive: true});
  const migration = (name, expected, target) => {
    const filePath = `scripts/migration/${name}.sql`;
    fs.writeFileSync(path.join(root, ...filePath.split('/')), [
      '\\set ON_ERROR_STOP on',
      'BEGIN;',
      "SET LOCAL lock_timeout = '10s';",
      "SET LOCAL statement_timeout = '120s';",
      `DO $migration$ DECLARE expected_release_hash constant text := '${expected}'; target_release_hash constant text := '${target}'; BEGIN NULL; END $migration$;`,
      'COMMIT;',
      'SELECT 1;'
    ].join('\n'));
    return filePath;
  };
  const firstHash = '1'.repeat(64);
  const secondHash = '2'.repeat(64);
  const thirdHash = '3'.repeat(64);
  const second = migration('20260915_a_second', firstHash, secondHash);
  const third = migration('20260915_b_third', secondHash, thirdHash);
  const first = migration('20260915_z_first', '0'.repeat(64), firstHash);
  const plan = createPlan(root, {
    appTag: '2026091701', dryRun: true, includeStackDeploy: true, gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [second, third, first]}}}
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  assert.deepEqual(plan.config.databaseMigrations.map(item => item.filePath), [first, second, third]);
});

test('blocks a JPA schema change when no release migration is present', () => {
  const root = tempProject(sampleXml);
  runGit(root, ['init']);
  const entityPath = path.join(root, 'src', 'main', 'java', 'com', 'zly', 'hospital', 'model', 'DemoEntity.java');
  fs.mkdirSync(path.dirname(entityPath), {recursive: true});
  fs.writeFileSync(entityPath, 'import jakarta.persistence.Entity;\n@Entity\nclass DemoEntity { private Long id; }\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline']);
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(entityPath, 'import jakarta.persistence.Entity;\n@Entity\nclass DemoEntity {\n private Long id;\n private String googleUid;\n}\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'schema change']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, {
    appTag: '2026071703',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: target,
    changeAnalysis: {
      targets: {
        game: {
          baselineCommit: baseline,
          changedPaths: ['src/main/java/com/zly/hospital/model/DemoEntity.java']
        }
      }
    }
  }), /JPA 持久化结构发生变化但没有发布迁移脚本/);
});

test('rejects changed database migrations without transaction and timeout guards', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/unsafe.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, 'alter table t_directors add column unsafe text;\n', 'utf8');

  assert.throws(() => createPlan(root, {
    appTag: '2026071702',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }), /缺少发布安全约束/);
});

test('rejects destructive database migrations that make automatic application rollback unsafe', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/destructive.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '10s';",
    "set local statement_timeout = '120s';",
    'alter table t_directors drop column firebase_uid;',
    'commit;',
    'select 1;',
    ''
  ].join('\n'), 'utf8');

  assert.throws(() => createPlan(root, {
    appTag: '2026071704',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }), /包含不兼容旧版本自动恢复的操作/);
});

test('allows default and not-null finalization only for columns added by the same migration', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/additive-column.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '2min';",
    'alter table t_guild add column if not exists auto_approval_enabled boolean;',
    'alter table t_guild alter column auto_approval_enabled set default false, alter column auto_approval_enabled set not null;',
    'commit;',
    'select 1;',
    ''
  ].join('\n'), 'utf8');

  assert.doesNotThrow(() => createPlan(root, {
    appTag: '2026080601',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }));
});

test('rejects default or not-null changes for columns not added by the same migration', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/existing-column.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '2min';",
    'alter table t_guild alter column name set not null;',
    'commit;',
    'select 1;',
    ''
  ].join('\n'), 'utf8');

  assert.throws(() => createPlan(root, {
    appTag: '2026080602',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }), /包含不兼容旧版本自动恢复的操作/);
});

test('accepts locked unique-id deletion of original player logs from a temporary snapshot', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/controlled-log-delete.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '2min';",
    'create temporary table tmp_admin_gift_reclaim_right_bottom_log on commit drop as',
    'select candidate.record_id, player_log.id as log_id from candidate join t_log_right_bottom player_log on player_log.hospital_id = candidate.hospital_id;',
    'select record_id from tmp_admin_gift_reclaim_right_bottom_log group by record_id having count(*) > 1;',
    'select player_log.id from t_log_right_bottom player_log join tmp_admin_gift_reclaim_right_bottom_log matched on matched.log_id = player_log.id for update of player_log;',
    'delete from t_log_right_bottom player_log using tmp_admin_gift_reclaim_right_bottom_log matched where player_log.id = matched.log_id;',
    'commit;',
    'select 1;',
    ''
  ].join('\n'), 'utf8');

  assert.doesNotThrow(() => createPlan(root, {
    appTag: '2026073101',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }));
});

test('rejects player log deletion without locked unique-id snapshot contract', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/uncontrolled-log-delete.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '2min';",
    "delete from t_log_right_bottom where content like 'gift%';",
    'commit;',
    'select 1;',
    ''
  ].join('\n'), 'utf8');

  assert.throws(() => createPlan(root, {
    appTag: '2026073101',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }), /包含未受控的 DELETE FROM 操作/);
});

test('blocks runtime changes when the release impact assessment was not updated', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'runtime change']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(target, baseline, [runtimePath], [])),
    /没有更新 release\/release-impact\.json/);
});

test('accepts an updated release impact assessment with exact runtime path and required check coverage', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-runtime-impact',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'existing-checks-sufficient'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'assess runtime change']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  const plan = createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  ));

  assert.equal(plan.config.releaseImpactAssessment.assessmentId, '20260717-runtime-impact');
  assert.deepEqual(plan.config.releaseImpactAssessment.coveredRuntimePaths, [runtimePath]);
  assert.ok(plan.steps.some(step => step.key === 'validate-release-impact-checklist'));
  const historyEntry = buildHistoryEntry('DRY_RUN', plan, [], []);
  assert.equal(historyEntry.releaseImpactAssessmentId, '20260717-runtime-impact');
  assert.deepEqual(historyEntry.releaseImpactRuntimePaths, [runtimePath]);
  assert.deepEqual(historyEntry.releaseImpactRequiredChecks, [
    'test-game-backend',
    'verify-game-static-assets-predeploy',
    'pre-deploy-checklist',
    'final-runtime-check',
    'verify-game-static-delivery'
  ]);
});

test('AI settings migration backs up the old file and retires it after final runtime checks', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const migrationPath = 'scripts/migration/20260926_databaseize_design_image_settings.sql';
  const absolute = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, [
    '\\set ON_ERROR_STOP on', 'BEGIN;', "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '60s';",
    'CREATE TABLE IF NOT EXISTS t_design_image_settings (id bigint PRIMARY KEY);',
    "SELECT core_table.relowner INTO application_owner FROM pg_class core_table WHERE core_table.relname = 't_hospitals';",
    "EXECUTE format('ALTER TABLE t_design_image_settings OWNER TO %I', application_owner);",
    'COMMIT;', 'SELECT 1;'
  ].join('\n'));
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy',
    'apply-database-migrations', 'pre-deploy-checklist', 'final-runtime-check',
    'verify-game-static-delivery', 'retire-design-image-settings-file'];
  writeReleaseImpact(root, {assessmentId:'20260926-ai-database', coveredRuntimePaths:[migrationPath],
    checklistDecision:'checklist-updated', databaseImpact:'schema-change', requiredChecks});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'AI settings migration']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();
  const request = releaseImpactPlanRequest(target, baseline, [migrationPath], ['release/release-impact.json']);
  const plan = createPlan(root, request);
  const index = key => plan.steps.findIndex(step => step.key === key);
  assert.ok(index('backup-game-release') < index('apply-database-migrations'));
  assert.ok(index('retire-design-image-settings-file') > index('final-runtime-check'));
  assert.match(decodedScriptTree(plan.steps[index('backup-game-release')].command), /cp "\$legacy_image_settings" "\$backup_dir\/design-image\.json"/);
  assert.match(decodedScriptTree(plan.steps[index('retire-design-image-settings-file')].command), /cmp -s "\$backup_dir\/design-image\.json" "\$legacy_image_settings"/);
  assert.match(decodedScriptTree(plan.steps[index('game-rollback-command')].command), /cp "\$backup_dir\/design-image\.json" data\/private\/design-image\.json/);
  writeReleaseImpact(root, {assessmentId:'20260926-ai-missing-check', coveredRuntimePaths:[migrationPath],
    checklistDecision:'checklist-updated', databaseImpact:'schema-change',
    requiredChecks:requiredChecks.filter(key=>key!=='retire-design-image-settings-file')});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'missing retirement check']);
  const missing = runGit(root, ['rev-parse', 'HEAD']).trim();
  assert.throws(()=>createPlan(root, releaseImpactPlanRequest(missing, baseline, [migrationPath], ['release/release-impact.json'])),
    /生图配置数据库迁移必须选择/);
});

test('release plan blocks an administrator-owned table until a later version aligns the application owner', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const initial = 'scripts/migration/20260926_databaseize_design_image_settings.sql';
  const repair = 'scripts/migration/20260928_align_design_image_settings_owner.sql';
  const location = file => path.join(root, ...file.split('/'));
  fs.mkdirSync(path.dirname(location(initial)), {recursive: true});
  const envelope = body => [
    '\\set ON_ERROR_STOP on', 'BEGIN;', "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '60s';", body, 'COMMIT;', 'SELECT 1;'
  ].join('\n');
  fs.writeFileSync(location(initial), envelope('CREATE TABLE IF NOT EXISTS public.t_design_image_settings (id bigint PRIMARY KEY);'));
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy',
    'apply-database-migrations', 'pre-deploy-checklist', 'final-runtime-check',
    'verify-game-static-delivery', 'retire-design-image-settings-file'];
  writeReleaseImpact(root, {assessmentId: '20260928-owner-missing', coveredRuntimePaths: [initial],
    checklistDecision: 'checklist-updated', databaseImpact: 'schema-change', requiredChecks});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'owner missing']);
  const bad = runGit(root, ['rev-parse', 'HEAD']).trim();
  assert.throws(() => createPlan(root, releaseImpactPlanRequest(bad, baseline, [initial], ['release/release-impact.json'])),
    /t_design_image_settings.*owner/);

  fs.writeFileSync(location(repair), envelope([
    "SELECT core_table.relowner INTO application_owner FROM pg_class core_table WHERE core_table.relname = 't_hospitals';",
    "EXECUTE format('ALTER TABLE public.t_design_image_settings OWNER TO %I', application_owner);"
  ].join('\n')));
  writeReleaseImpact(root, {assessmentId: '20260928-owner-repaired', coveredRuntimePaths: [initial, repair],
    checklistDecision: 'checklist-updated', databaseImpact: 'schema-change', requiredChecks});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'owner repaired']);
  const fixed = runGit(root, ['rev-parse', 'HEAD']).trim();
  const plan = createPlan(root, releaseImpactPlanRequest(fixed, baseline, [initial, repair], ['release/release-impact.json']));
  assert.deepEqual(plan.config.databaseMigrations.map(item => item.filePath), [initial, repair]);
});

test('Tomcat security checks use committed POM and surround production cutover', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><properties><tomcat.version>10.1.59</tomcat.version></properties></project>');
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy', 'pre-deploy-checklist',
    'final-runtime-check', 'verify-game-static-delivery', 'verify-game-tomcat-image', 'verify-game-tomcat-runtime'];
  writeReleaseImpact(root, {assessmentId: '20260908-tomcat', coveredRuntimePaths: ['pom.xml'],
    checklistDecision: 'checklist-updated', requiredChecks});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'tomcat security']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  const request = releaseImpactPlanRequest(target, baseline, ['pom.xml'], ['release/release-impact.json']);
  const plan = createPlan(root, request);
  const index = key => plan.steps.findIndex(s => s.key === key);
  assert.ok(index('verify-game-tomcat-image') > index('validate-game-image'));
  assert.ok(index('verify-game-tomcat-image') < index('publish-image'));
  assert.ok(index('verify-game-tomcat-runtime') > index('final-runtime-check'));
  assert.equal(plan.steps[index('verify-game-tomcat-runtime')].finalCheck, true);
  assert.ok(plan.steps[index('verify-game-tomcat-image')].command.includes('--network'));
  writeReleaseImpact(root, {assessmentId: '20260908-tomcat-unpaired', coveredRuntimePaths: ['pom.xml'],
    checklistDecision: 'checklist-updated', requiredChecks: requiredChecks.filter(k => k !== 'verify-game-tomcat-runtime')});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'unpaired']);
  assert.throws(() => createPlan(root, releaseImpactPlanRequest(runGit(root, ['rev-parse', 'HEAD']).trim(),
    baseline, ['pom.xml'], ['release/release-impact.json'])), /同时选择/);
});






test('emergency guard checks are paired, executable and ordered around deployment', () => {
  const root=releaseImpactGitProject();
  const baseline=runGit(root,['rev-parse','HEAD']).trim();
  const runtimePath='src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root,...runtimePath.split('/')),'emergency change\n');
  const requiredChecks=['test-game-backend','verify-game-static-assets-predeploy','pre-deploy-checklist',
    'final-runtime-check','verify-game-static-delivery','fixture-source','verify-game-emergency-guard-runtime'];
  writeReleaseImpact(root,{assessmentId:'20260907-emergency',coveredRuntimePaths:[runtimePath],checklistDecision:'checklist-updated',requiredChecks});
  runGit(root,['add','.']);runGit(root,['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','guard checks']);
  const target=runGit(root,['rev-parse','HEAD']).trim();
  const plan=createPlan(root,releaseImpactPlanRequest(target,baseline,[runtimePath],['release/release-impact.json']));
  const index=k=>plan.steps.findIndex(s=>s.key===k);
  assert.ok(index('validate-game-source-impact')<index('test-game-backend'));
  assert.ok(index('verify-game-emergency-guard-runtime')>index('final-runtime-check'));
  assert.equal(plan.config.pluginProtocol.unitIds.includes('fixture-source'),true);
  assert.equal(plan.steps[index('verify-game-emergency-guard-runtime')].finalCheck,true);
});

test('accepts verify-relations-release as a registered executable game impact check', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'relations changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260810-relations-impact',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'checklist-updated',
    requiredChecks: [
      'test-game-backend',
      'verify-game-static-assets-predeploy',
      'pre-deploy-checklist',
      'final-runtime-check',
      'verify-game-static-delivery',
      'verify-relations-release'
    ]
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'relations impact check']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  const plan = createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  ));
  const relationsStep = plan.steps.find(step => step.key === 'verify-relations-release');

  assert.ok(relationsStep);
  assert.equal(relationsStep.executable, true);
  assert.equal(relationsStep.finalCheck, true);
  assert.ok(relationsStep.command.includes('verify-relations-release.mjs'));
  assert.deepEqual(plan.config.releaseImpactAssessment.requiredChecks.map(item => item.stepKey), [
    'test-game-backend',
    'verify-game-static-assets-predeploy',
    'pre-deploy-checklist',
    'final-runtime-check',
    'verify-game-static-delivery',
    'verify-relations-release'
  ]);
});

test('adds a secret-safe SMTP sender probe when the game impact assessment requires it', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/application.properties';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), [
    'spring.mail.host=mail.briconbric.com',
    'spring.mail.port=587',
    'spring.mail.username=support@rhospital.cc',
    'mail.verify.from=support@rhospital.cc',
    ''
  ].join('\n'), 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260828-smtp-sender-impact',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'checklist-updated',
    requiredChecks: [
      'test-game-backend',
      'verify-game-static-assets-predeploy',
      'pre-deploy-checklist',
      'final-runtime-check',
      'verify-game-static-delivery',
      'verify-game-smtp-sender'
    ]
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'smtp sender gate']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  const plan = createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  ));
  const step = plan.steps.find(item => item.key === 'verify-game-smtp-sender');
  const script = decodedRemoteScript(step.command);

  assert.ok(step);
  assert.equal(step.executable, true);
  assert.equal(step.finalCheck, true);
  assert.ok(plan.steps.findIndex(item => item.key === 'verify-game-smtp-sender')
    > plan.steps.findIndex(item => item.key === 'final-runtime-check'));
  assert.match(script, /spring\.mail\.password/);
  assert.match(script, /python3 - <<'PY'/);
  assert.match(script, /smtplib\.SMTP\(host, port, timeout=10\)/);
  assert.match(script, /smtp\.starttls\(context=ssl\.create_default_context\(\)\)/);
  assert.match(script, /smtp\.auth\('PLAIN', smtp\.auth_plain\)/);
  assert.doesNotMatch(script, /smtp\.login\(/);
  assert.match(script, /smtp\.mail\(sender\)/);
  assert.match(script, /smtp\.rset\(\)/);
  assert.match(script, /stage=\{stage\} code=\{error\.smtp_code\}/);
  assert.match(script, /support@rhospital\.cc/);
  assert.doesNotMatch(script, /smtp\.data\(|smtp\.sendmail\(|sleep 1|openssl s_client/);
  assert.doesNotMatch(step.command, /password =/);
});

test('blocks the SMTP sender probe when the authenticated user and From address differ', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/application.properties';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), [
    'spring.mail.host=mail.briconbric.com',
    'spring.mail.port=587',
    'spring.mail.username=support@rhospital.cc',
    'mail.verify.from=postmaster@rhospital.cc',
    ''
  ].join('\n'), 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260828-smtp-sender-mismatch',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'checklist-updated',
    requiredChecks: [
      'test-game-backend',
      'verify-game-static-assets-predeploy',
      'pre-deploy-checklist',
      'final-runtime-check',
      'verify-game-static-delivery',
      'verify-game-smtp-sender'
    ]
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'smtp sender mismatch']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /SMTP 认证账号与发件地址不一致/);
});

test('uses the successful release baseline to enforce the committed impact assessment', () => {
  const root = releaseImpactGitProject();
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const historyPath = path.join(root, 'impact-history.json');
  fs.writeFileSync(historyPath, `${JSON.stringify([{
    status: 'EXECUTED',
    releaseTarget: 'game',
    releaseCommit: baseline,
    appTag: '20260717',
    imageTag: 'hospital-backend:20260717',
    includeStackDeploy: true
  }], null, 2)}\n`, 'utf8');
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed from production baseline\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-analyzed-impact',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'existing-checks-sufficient'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'runtime assessment']);

  const analysis = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  const plan = createPlan(root, {
    appTag: '2026071706',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: analysis.targetCommit,
    changeAnalysis: analysis
  });

  assert.deepEqual(analysis.targets.game.changedPaths, [runtimePath]);
  assert.ok(analysis.targets.game.ignoredPaths.includes('release/release-impact.json'));
  assert.equal(plan.config.releaseImpactAssessment.assessmentId, '20260717-analyzed-impact');
});

test('rejects release impact assessments that do not exactly cover the runtime diff', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-wrong-impact',
    coveredRuntimePaths: ['src/main/resources/other.txt'],
    checklistDecision: 'existing-checks-sufficient'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'wrong assessment']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /必须精确覆盖生产基线到目标提交的运行变更/);
});

test('rejects a stale release impact assessment identifier', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-impact-baseline',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'existing-checks-sufficient'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'stale assessment id']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /assessmentId 仍为 20260717-impact-baseline/);
});

test('rejects a checklist-updated decision when the selected checks did not change', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-unchanged-checks',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'checklist-updated'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'unchanged checklist']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /声明 checklist-updated，但 requiredChecks 的步骤或覆盖理由没有变化/);
});

test('rejects a release impact assessment that omits a mandatory base check', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-missing-base-check',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'existing-checks-sufficient',
    requiredChecks: ['test-game-backend', 'verify-game-static-assets-predeploy', 'pre-deploy-checklist']
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'missing base check']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /缺少基础检查: final-runtime-check/);
});

test('requires database impact and migration checklist coverage for changed migration scripts', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const migrationPath = 'scripts/migration/20260717_release_impact.sql';
  const migrationFile = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(migrationFile), {recursive: true});
  fs.writeFileSync(migrationFile, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '10s';",
    "set local statement_timeout = '120s';",
    'create table if not exists release_impact_demo(id bigint);',
    "select core_table.relowner into application_owner from pg_class core_table where core_table.relname = 't_hospitals';",
    "execute format('alter table release_impact_demo owner to %I', application_owner);",
    'commit;',
    'select count(*) from release_impact_demo;',
    ''
  ].join('\n'), 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-migration-impact',
    coveredRuntimePaths: [migrationPath],
    checklistDecision: 'existing-checks-sufficient',
    databaseImpact: 'schema-change'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'migration assessment']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [migrationPath],
    ['release/release-impact.json']
  )), /必须包含 apply-database-migrations/);
});

test('enforces the same release impact assessment gate for forum runtime changes', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const forumPath = 'integrations/flarum/Dockerfile';
  const forumFile = path.join(root, ...forumPath.split('/'));
  fs.mkdirSync(path.dirname(forumFile), {recursive: true});
  fs.writeFileSync(forumFile, 'FROM demo\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-forum-impact',
    coveredRuntimePaths: [],
    checklistDecision: 'existing-checks-sufficient',
    forumCoveredRuntimePaths: [forumPath],
    forumChecklistDecision: 'existing-checks-sufficient',
    forumDatabaseImpact: 'schema-change: replaces the two existing fulltext indexes with the MySQL ngram parser'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'forum assessment']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  const plan = createPlan(root, {
    releaseTarget: 'forum',
    forumImageMode: 'build',
    appTag: '2026071707',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: target,
    changeAnalysis: {
      targets: {
        forum: {
          changed: true,
          baselineCommit: baseline,
          changedPaths: [forumPath],
          ignoredPaths: ['release/release-impact.json']
        }
      }
    }
  });

  assert.equal(plan.config.releaseImpactAssessment.assessmentId, '20260717-forum-impact');
  assert.equal(plan.config.releaseImpactAssessment.target, 'forum');
  assert.equal(plan.config.releaseImpactAssessment.databaseImpact, 'schema-change');
  assert.equal(plan.config.releaseImpactAssessment.databaseImpactDetail,
    'replaces the two existing fulltext indexes with the MySQL ngram parser');
  const history = buildHistoryEntry('DRY_RUN', plan, [], []);
  assert.equal(history.releaseImpactDatabaseImpact, 'schema-change');
  assert.equal(history.releaseImpactDatabaseImpactDetail,
    'replaces the two existing fulltext indexes with the MySQL ngram parser');
  assert.ok(plan.steps.some(step => step.key === 'validate-release-impact-checklist'));
});

test('keeps invalid database impact classifications fail closed for game releases', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'changed\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-invalid-game-database-impact',
    coveredRuntimePaths: [runtimePath],
    checklistDecision: 'existing-checks-sufficient',
    databaseImpact: 'schema-update: unsupported classification remains blocked'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'invalid database impact']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => createPlan(root, releaseImpactPlanRequest(
    target,
    baseline,
    [runtimePath],
    ['release/release-impact.json']
  )), /databaseImpact 必须为/);
});

test('creates reusable forum compose release plan with backup validation and rollback evidence', () => {
  const root = tempProject(sampleXml);
  const config = readReleaseConfig(root, 'forum');
  const plan = createPlan(root, {
    releaseTarget: 'forum',
    appTag: '2026071501',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(config.releaseTarget, 'forum');
  assert.equal(config.deploymentMode, 'compose');
  assert.equal(config.imageName, 'rhospital/flarum-sso');
  assert.equal(config.dockerfile, 'integrations/flarum/Dockerfile');
  assert.equal(config.buildContext, 'integrations/flarum');
  assert.equal(config.defaultRemoteComposeDir, DEFAULT_FORUM_REMOTE_COMPOSE_DIR);
  assert.equal(plan.releaseTarget, 'forum');
  assert.equal(plan.releaseTargetLabel, '论坛');
  assert.equal(plan.forumImageMode, 'build');
  assert.equal(plan.forumImageModeLabel, '构建并上传新镜像');
  assert.equal(plan.imageTag, 'rhospital/flarum-sso:2026071501');
  assert.equal(plan.config.remoteComposeDir, DEFAULT_FORUM_REMOTE_COMPOSE_DIR);
  assert.equal(plan.steps.some(step => step.key === 'compile-artifact'), false);
  assert.ok(plan.steps.some(step => step.key === 'validate-forum-source'
    && step.command.includes('ForumFlarumImageAssetTest,ForumSearchMigrationContractTest,ForumDeploymentConfigTest')
    && step.command.includes('git status --porcelain --untracked-files=all -- integrations/flarum')
    && step.command.includes('Select-Object -First 1')
    && step.command.includes('$gitBash = $env:GIT_BASH_PATH')
    && step.command.includes("$gitBash = Join-Path $gitRoot 'bin\\bash.exe'")
    && step.command.includes("& $gitBash -o pipefail -c 'git show HEAD:integrations/flarum/04-rhospital-secret.sh | bash -n'")
    && step.command.includes("& $gitBash -o pipefail -c 'git show HEAD:integrations/flarum/05-rhospital-env.sh | bash -n'")
    && !step.command.includes('; bash -o pipefail')
    && !step.command.includes('bash -n integrations/flarum/')));
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('-f integrations/flarum/Dockerfile')
    && step.command.includes('-t rhospital/flarum-sso:2026071501 integrations/flarum')));
  assert.ok(plan.steps.some(step => step.key === 'validate-forum-image'
    && decodedRemoteScript(step.command).includes('forum_image_validation=PASS')
    && decodedRemoteScript(step.command).includes('/run/rhospital-secrets/forum_sso_secret')
    && decodedRemoteScript(step.command).includes('/opt/flarum/vendor/flarum-lang/chinese-simplified/extend.php')
    && decodedRemoteScript(step.command).includes('composer show flarum-lang/chinese-simplified')));
  assert.ok(plan.steps.some(step => step.key === 'read-remote-compose'
    && decodedRemoteScript(step.command).includes(DEFAULT_FORUM_REMOTE_COMPOSE_DIR)
    && decodedRemoteScript(step.command).includes('rhospital/flarum-sso:')));
  assert.ok(plan.steps.some(step => step.key === 'forum-preflight'
    && decodedRemoteScript(step.command).includes('docker compose config')
    && decodedRemoteScript(step.command).includes('secret_meta=')));
  const forumPublishIndex = plan.steps.findIndex(step => step.key === 'publish-image');
  assert.ok(plan.steps.findIndex(step => step.key === 'resolve-ssh-target') < forumPublishIndex);
  assert.ok(plan.steps.findIndex(step => step.key === 'read-remote-compose') < forumPublishIndex);
  assert.ok(plan.steps.findIndex(step => step.key === 'forum-preflight') < forumPublishIndex);
  assert.ok(plan.steps.some(step => step.key === 'backup-forum-release'
    && decodedRemoteScript(step.command).includes('mysqldump --single-transaction')
    && decodedRemoteScript(step.command).includes('flarum-data.tar.gz')
    && decodedRemoteScript(step.command).includes('.last-forum-release-backup')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && step.recoveryBoundary === true
    && decodedRemoteScript(step.command).includes('rhospital/flarum-sso:2026071501')
    && decodedRemoteScript(step.command).includes('docker compose config')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-forum-compose'
    && decodedRemoteScript(step.command).includes('docker compose up -d --no-deps --force-recreate flarum')));
  assert.ok(plan.steps.some(step => step.key === 'final-runtime-check'
    && step.finalCheck
    && decodedRemoteScript(step.command).includes('docker exec -u flarum flarum test -r /run/rhospital-secrets/forum_sso_secret')
    && decodedRemoteScript(step.command).includes('/run/rhospital-ready/forum-ready')
    && decodedRemoteScript(step.command).includes('forum_translation_count=[1-9][0-9]*')
    && decodedRemoteScript(step.command).includes('forum_translation_probe=Profile')
    && decodedRemoteScript(step.command).includes('forum-zh-Hans\\.js')
    && decodedRemoteScript(step.command).includes('core.forum.header.profile_button":"\\u4e2a\\u4eba\\u4e3b\\u9875')
    && decodedRemoteScript(step.command).includes('forum locale asset is empty')
    && !decodedRemoteScript(step.command).includes('php flarum info')
    && decodedRemoteScript(step.command).includes('for attempt in $(seq 1 90)')
    && decodedRemoteScript(step.command).includes('forum_readiness attempt=')
    && decodedRemoteScript(step.command).includes('forum did not become ready within 180 seconds')
    && decodedRemoteScript(step.command).includes('forum_runtime_validation=PASS')));
  const rollback = plan.steps.find(step => step.key === 'forum-rollback-command');
  assert.ok(rollback);
  assert.equal(rollback.executable, true);
  assert.equal(rollback.recoveryOnly, true);
  assert.ok(decodedRemoteScript(rollback.command).includes('.last-forum-release-backup'));
  assertStepType(plan, 'backup-forum-release', 'production', true);
  assertStepType(plan, 'deploy-forum-compose', 'production', true);
  assertStepType(plan, 'final-runtime-check', 'remote-check', false);
});

test('reuses an existing production forum image without rebuilding or uploading it', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    releaseTarget: 'forum',
    forumImageMode: 'reuse',
    appTag: '20260715',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.forumImageMode, 'reuse');
  assert.equal(plan.forumImageModeLabel, '复用生产已有镜像');
  assert.equal(plan.gitBranch, 'not-used');
  assert.equal(plan.gitCommit, 'not-used');
  assert.equal(plan.steps.some(step => step.key === 'git-fetch'), false);
  assert.equal(plan.steps.some(step => step.key === 'git-update'), false);
  assert.equal(plan.steps.some(step => step.key === 'validate-forum-source'), false);
  assert.equal(plan.steps.some(step => step.key === 'build-image'), false);
  assert.equal(plan.steps.some(step => step.key === 'validate-forum-image'), false);
  assert.equal(plan.steps.some(step => step.key === 'publish-image'), false);
  const existingImageCheck = plan.steps.find(step => step.key === 'validate-existing-forum-image');
  assert.ok(existingImageCheck);
  assert.ok(existingImageCheck.command.includes('docker image inspect'));
  assert.ok(existingImageCheck.command.includes('rhospital/flarum-sso:20260715'));
  assertStepType(plan, 'validate-existing-forum-image', 'remote-check', false);
  assert.ok(plan.steps.some(step => step.key === 'backup-forum-release'));
  assert.ok(plan.steps.some(step => step.key === 'deploy-forum-compose'));
  assert.ok(plan.steps.some(step => step.key === 'final-runtime-check'));
  assert.ok(plan.guardrails.some(rule => rule.includes('不执行源码更新')));
});

test('creates specified branch latest update plan', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    gitBranch: 'origin/release/20260707',
    gitCommit: 'latest',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.gitBranch, 'origin/release/20260707');
  assert.equal(plan.gitCommit, 'latest');
  assert.ok(plan.steps.some(step => step.key === 'git-update'
    && step.title === '切换到分支最新提交'
    && step.command === 'git checkout origin/release/20260707'));
});

test('creates specified branch commit update plan', () => {
  const root = tempProject(sampleXml);
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'release source']);
  const commit = runGit(root, ['rev-parse', 'HEAD']).trim();
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    gitBranch: 'origin/release/20260707',
    gitCommit: commit,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.gitBranch, 'origin/release/20260707');
  assert.equal(plan.gitCommit, commit);
  assert.ok(plan.steps.some(step => step.key === 'git-update'
    && step.title === '切换到指定提交'
    && step.command === `git checkout ${commit}`
    && step.validation.includes(`git merge-base --is-ancestor ${commit} origin/release/20260707`)));
});

test('local branch latest update command is compatible with Windows PowerShell', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    gitBranch: 'master',
    gitCommit: 'latest',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const statusStep = plan.steps.find(step => step.key === 'git-status-before-update');
  const updateStep = plan.steps.find(step => step.key === 'git-update');

  assert.ok(statusStep.command.includes('$LASTEXITCODE'));
  assert.ok(updateStep.command.includes('$LASTEXITCODE'));
  assert.equal(statusStep.command.includes(' && '), false);
  assert.equal(updateStep.command.includes(' && '), false);
});

test('uses authoritative production target and compose directory in hot deploy plan', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.config.dockerContext, 'GAME_PRD2');
  assert.equal(plan.config.remoteSshTarget, 'GAME_PRD2');
  assert.equal(plan.config.remoteComposeDir, DEFAULT_REMOTE_COMPOSE_DIR);
  assert.ok(plan.steps.some(step => step.command.includes("root@92.113.124.185")));
  assert.ok(plan.steps.some(step => step.command.includes('base64 -d | bash')
    && decodedRemoteScript(step.command).includes(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`)));
});

test('reads remote compose image tag through SSH output', () => {
  const calls = [];
  const result = readRemoteComposeImageTag({
    host: '92.113.124.185',
    user: 'root',
    port: '22',
    keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem'
  }, '/opt/1panel/docker/compose/hospital-stack', 'hospital-backend', {}, (command, args, options) => {
    calls.push({command, args, options});
    return {
      status: 0,
      stdout: '12:    image: hospital-backend:2026070902\n',
      stderr: ''
    };
  });

  assert.equal(result.resolved, true);
  assert.equal(result.imageTag, 'hospital-backend:2026070902');
  assert.equal(result.appTag, '2026070902');
  assert.equal(calls[0].command, 'ssh');
  assert.ok(calls[0].args.includes('-i'));
  assert.ok(calls[0].args.some(arg => String(arg).includes('base64 -d | bash')));
});

test('reads namespaced forum image tag from the forum compose', () => {
  const result = readRemoteComposeImageTag('root@92.113.124.185', DEFAULT_FORUM_REMOTE_COMPOSE_DIR,
    'rhospital/flarum-sso', {}, () => ({
      status: 0,
      stdout: '34:        image: rhospital/flarum-sso:20260715\n',
      stderr: ''
    }));

  assert.equal(result.resolved, true);
  assert.equal(result.imageTag, 'rhospital/flarum-sso:20260715');
  assert.equal(result.appTag, '20260715');
});

test('parses ssh -G output for display', () => {
  const parsed = parseSshGOutput(`host GAME_PRD2
user root
hostname 192.0.2.10
port 22
identityfile C:/Users/user/.ssh/id_ed25519
identityfile C:/Users/user/.ssh/id_rsa
identitiesonly yes`);

  assert.equal(parsed.user, 'root');
  assert.equal(parsed.hostname, '192.0.2.10');
  assert.equal(parsed.port, '22');
  assert.deepEqual(parsed.identityfile, [
    'C:/Users/user/.ssh/id_ed25519',
    'C:/Users/user/.ssh/id_rsa'
  ]);
  assert.equal(parsed.identitiesonly, 'yes');
});

test('resolves docker context inspect output for display', () => {
  const result = resolveDockerContextDetails('GAME_PRD2', {}, () => ({
    status: 0,
    stdout: JSON.stringify([{
      Name: 'GAME_PRD2',
      Metadata: {Description: 'prod docker'},
      Endpoints: {docker: {Host: 'ssh://root@192.0.2.10'}}
    }]),
    stderr: ''
  }));

  assert.equal(result.resolved, true);
  assert.equal(result.description, 'prod docker');
  assert.equal(result.dockerEndpoint, 'ssh://root@192.0.2.10');
});

test('reports missing docker context for display', () => {
  const result = resolveDockerContextDetails('GAME_PRD2', {}, () => ({
    status: 1,
    stdout: '',
    stderr: 'context "GAME_PRD2": context not found'
  }));

  assert.equal(result.resolved, false);
  assert.match(result.note, /未找到/);
  assert.match(result.error, /context not found/);
});

test('resolves IDEA Docker Server for SSH image upload while building locally', () => {
  const root = tempProject(sampleXml);
  const optionsDir = tempJetBrainsOptions();
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: optionsDir
  });

  assert.equal(plan.config.ideaDockerServerResolution.resolved, true);
  assert.equal(plan.config.ideaDockerServerResolution.host, '92.113.124.185');
  assert.equal(plan.config.ideaDockerServerResolution.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.equal(plan.config.dockerCommandTarget.mode, 'local');
  assert.equal(plan.config.dockerCommandTarget.description, '本机 Docker');
  assert.equal(plan.config.remoteImageTarget.host, '92.113.124.185');
  assert.equal(plan.config.remoteImageTarget.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('docker build')
    && !step.command.includes('92.113.124.185')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes("-i 'C:\\workspace\\Secure\\sunsxaws.pem' -P 22")
    && step.command.includes("-i 'C:\\workspace\\Secure\\sunsxaws.pem' -p 22 'root@92.113.124.185'")
    && step.command.includes('docker load -i')));
});

test('resolves release Docker Server from repository config without JetBrains options', () => {
  const root = tempProject(sampleXml);
  const configPath = tempPublisherConfig();
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_CONFIG: configPath,
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: path.join(os.tmpdir(), 'missing-jetbrains-options')
  });

  assert.equal(plan.config.ideaDockerServerResolution.source, 'release-publisher.config.json');
  assert.equal(plan.config.ideaDockerServerResolution.resolved, true);
  assert.equal(plan.config.remoteImageTarget.host, '92.113.124.185');
  assert.equal(plan.config.remoteImageTarget.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes("-i 'C:\\workspace\\Secure\\sunsxaws.pem' -P 22")
    && step.command.includes("-i 'C:\\workspace\\Secure\\sunsxaws.pem' -p 22 'root@92.113.124.185'")));
});

test('resolves repository Docker Server details directly', () => {
  const configPath = tempPublisherConfig();
  const result = resolvePublisherDockerServerDetails('GAME_PRD2', {
    RELEASE_PUBLISHER_CONFIG: configPath
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'release-publisher.config.json');
  assert.equal(result.dockerHost, 'ssh://root@92.113.124.185:22');
});

test('resolves authoritative Docker servers for game and forum releases', () => {
  const configPath = tempPublisherConfig();
  const env = {
    RELEASE_PUBLISHER_CONFIG: configPath
  };

  assert.equal(resolveReleaseTargetDockerServerName('game', 'GAME_PRD2', env), 'GAME_PRD2');
  assert.equal(resolveReleaseTargetDockerServerName('forum', 'GAME_PRD2', env), 'FORUM_PRD2');

  const root = tempProject(sampleXml);
  const forumPlan = createPlan(root, {
    releaseTarget: 'forum',
    forumImageMode: 'reuse',
    appTag: '20260817-prd2',
    dryRun: true,
    includeStackDeploy: false
  }, {
    ...env,
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true'
  });

  assert.equal(forumPlan.config.dockerContext, 'FORUM_PRD2');
  assert.equal(forumPlan.config.remoteSshTarget, 'FORUM_PRD2');
  assert.equal(forumPlan.config.remoteImageTarget.host, '92.113.124.185');
  assert.equal(forumPlan.config.remoteImageTarget.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
});

test('rejects request-level production target and compose path overrides', () => {
  const root = tempProject(sampleXml);
  const configPath = tempPublisherConfig();
  const env = {
    RELEASE_PUBLISHER_CONFIG: configPath,
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true'
  };
  const baseRequest = {
    releaseTarget: 'forum',
    forumImageMode: 'reuse',
    appTag: '20260817-prd2',
    dryRun: true,
    includeStackDeploy: false
  };

  for (const [field, value] of Object.entries({
    dockerContext: 'UNREGISTERED_TARGET',
    remoteSshTarget: 'root@unregistered.invalid',
    remoteComposeDir: '/unregistered/compose/path'
  })) {
    assert.throws(() => createPlan(root, {...baseRequest, [field]: value}, env),
      /生产目标和编排路径由发布器配置固定管理/);
  }
});

test('fails closed when a production target is missing or references an unregistered server', () => {
  const root = temporaryDirectory('release-publisher-invalid-target-');
  const missingTargetConfig = path.join(root, 'missing-target.json');
  const unregisteredTargetConfig = path.join(root, 'unregistered-target.json');
  const wrongHostConfig = path.join(root, 'wrong-host.json');
  fs.writeFileSync(missingTargetConfig, JSON.stringify({dockerServers: {}, releaseTargets: {}}), 'utf8');
  fs.writeFileSync(unregisteredTargetConfig, JSON.stringify({
    dockerServers: {},
    releaseTargets: {game: {dockerServer: 'UNREGISTERED_TARGET'}}
  }), 'utf8');
  fs.writeFileSync(wrongHostConfig, JSON.stringify({
    dockerServers: {
      GAME_PRD2: {
        host: '192.0.2.20',
        username: 'root',
        port: '22',
        keyPath: 'C:\\workspace\\Secure\\test.pem'
      }
    },
    releaseTargets: {game: {dockerServer: 'GAME_PRD2'}}
  }), 'utf8');

  assert.throws(() => resolveReleaseTargetDockerServerName('game', '', {
    RELEASE_PUBLISHER_CONFIG: missingTargetConfig
  }), /缺少 game 的生产 Docker Server/);
  assert.throws(() => resolveReleaseTargetDockerServerName('game', '', {
    RELEASE_PUBLISHER_CONFIG: unregisteredTargetConfig
  }), /生产 Docker Server 未完整注册/);
  assert.throws(() => resolveReleaseTargetDockerServerName('game', '', {
    RELEASE_PUBLISHER_CONFIG: wrongHostConfig
  }), /生产主机不是当前受控主机/);
});

test('resolves IDEA Docker Server details directly', () => {
  const optionsDir = tempJetBrainsOptions();
  const result = resolveIdeaDockerServerDetails('GAME_PRD2', {
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: optionsDir
  });

  assert.equal(result.resolved, true);
  assert.equal(result.sshConfigId, 'e4ab0b3b-0051-4923-9eeb-03c207819bed');
  assert.equal(result.dockerExePath, '/usr/bin/docker');
  assert.equal(result.dockerHost, 'ssh://root@92.113.124.185:22');
});

test('execute dry run marks every pipeline step checked without mutating files or history', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'DRY_RUN');
  assert.ok(result.completedStepKeys.length >= 1);
  assert.ok(result.plan.steps.every(step => step.recoveryOnly
    ? step.status === 'pending'
    : step.status === 'dry-run-checked'));
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 0);
});

test('remote rehearsal dry run runs only the isolated rehearsal command', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const rehearsalConfigPath = path.join(root, 'rehearsal-gateways.json');
  const productionConfigPath = path.join(root, 'production-gateways.json');
  const gateway = (id, host, remoteAssetRoot) => ({
    id,
    host,
    username: 'tester',
    port: '22',
    domain: 'stage.rhospital.test',
    remoteAssetRoot
  });
  fs.writeFileSync(rehearsalConfigPath, JSON.stringify({
    environment: 'rehearsal',
    gateways: [
      gateway('stage-a', 'stage-a.example', '/tmp/rhospital-release-rehearsal'),
      gateway('stage-b', 'stage-b.example', '/tmp/rhospital-release-rehearsal')
    ]
  }), 'utf8');
  fs.writeFileSync(productionConfigPath, JSON.stringify({
    gateways: [gateway('prod-a', 'prod-a.example', '/var/lib/assets'), gateway('prod-b', 'prod-b.example', '/var/lib/assets')]
  }), 'utf8');
  const runCommand = testCommandRunner();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: true,
    remoteRehearsal: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_GATEWAY_STATIC_CONFIG: productionConfigPath,
    RELEASE_PUBLISHER_REHEARSAL_GATEWAY_STATIC_CONFIG: rehearsalConfigPath,
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'DRY_RUN');
  assert.equal(result.plan.remoteRehearsal, true);
  const rehearsalStep = result.plan.steps.find(step => step.key === 'rehearse-game-static-assets');
  assert.equal(rehearsalStep.status, 'done');
  assert.equal(rehearsalStep.actionType, 'rehearsal');
  assert.match(runCommand.commands[0], /--mode rehearse/);
  assert.match(runCommand.commands[0], /--production-config/);
  assert.ok(result.plan.steps.filter(step => step.key !== 'rehearse-game-static-assets' && !step.recoveryOnly)
    .every(step => step.status === 'dry-run-checked'));
  assert.equal(readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}).length, 0);

  assert.throws(() => createPlan(root, {
    appTag: '2026070702',
    dryRun: false,
    remoteRehearsal: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_GATEWAY_STATIC_CONFIG: productionConfigPath,
    RELEASE_PUBLISHER_REHEARSAL_GATEWAY_STATIC_CONFIG: rehearsalConfigPath,
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  }), /只能在 dry run 模式下执行/);
});

test('forum dry run returns its target without changing config or history', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'forum-history.json');
  const result = await executePlan(root, {
    releaseTarget: 'forum',
    appTag: '2026071501',
    dryRun: true,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'DRY_RUN');
  assert.equal(result.plan.releaseTarget, 'forum');
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 0);
});

test('execute runs validation commands after executable steps', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = testCommandRunner();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    gitBranch: 'master',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {
    runCommand
  });

  assert.equal(result.status, 'EXECUTED');
  assert.ok(result.logs.some(line => line.includes('[VALIDATE] docker image inspect hospital-backend:2026070702-buildcheck')));
  assert.ok(result.logs.some(line => line.includes('[VALIDATE] docker image inspect hospital-backend:2026070702')));
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history[0].status, 'EXECUTED');
  assert.ok(history[0].stepSummary.some(step => step.key === 'build-image'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702')));
  assert.ok(runCommand.commands.some(command => command.includes('docker save')));
});

test('history entry records release commit evidence and step summary', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const commitStep = plan.steps.find(step => step.key === 'capture-release-commit');
  commitStep.status = 'done';
  commitStep.durationMs = 123;
  commitStep.logs = [
    '[START] 记录发布提交',
    '[RUN] git rev-parse HEAD',
    '0123456789abcdef0123456789abcdef01234567',
    '0123456\t2026-07-07 20:30:40 +0900\tRelease hospital backend',
    '[DONE] 记录发布提交，用时 123ms'
  ];

  const entry = buildHistoryEntry('EXECUTED', plan, commitStep.logs, ['capture-release-commit']);

  assert.equal(entry.releaseCommit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(entry.releaseCommitShort, '0123456');
  assert.equal(entry.releaseCommitDate, '2026-07-07 20:30:40 +0900');
  assert.equal(entry.releaseCommitSubject, 'Release hospital backend');
  assert.equal(entry.catalogSchemaVersion, 20);
  assert.ok(entry.stepSummary.some(step => step.key === 'capture-release-commit'
    && step.status === 'done'
    && step.durationMs === 123
    && step.command.includes('git rev-parse HEAD')
    && step.logs.includes('0123456789abcdef0123456789abcdef01234567')));
});

test('release history extracts multiline stdout chunks and excludes command or unrelated evidence', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {appTag: '2026101601', dryRun: true}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const capture = plan.steps.find(step => step.key === 'capture-release-commit');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  capture.status = 'done';
  capture.logs = [`[START] capture`, `${sha}\r\n0123456\t2026-10-16 01:02:47 +0900\tRelease candidate\r\n`, '[DONE] capture'];
  for (const status of ['EXECUTED', 'RECOVERY_REQUIRED', 'ERROR']) {
    const entry = buildHistoryEntry(status, plan, [], [capture.key]);
    assert.equal(entry.releaseCommit, sha);
    assert.equal(entry.releaseCommitShort, '0123456');
    assert.equal(entry.releaseCommitDate, '2026-10-16 01:02:47 +0900');
    assert.equal(entry.releaseCommitSubject, 'Release candidate');
  }
  capture.logs = [`[RUN] command\n${sha}\n0123456\tdate\tfake`, sha.slice(0, -1)];
  plan.steps[0].logs = [sha];
  const missing = buildHistoryEntry('ERROR', plan, [sha], []);
  assert.equal(missing.releaseCommit, '');
  assert.equal(missing.releaseCommitSubject, '');
});

test('execution buffers Git evidence split inside SHA, CRLF and commit details', async () => {
  const root = tempProject(sampleXml);
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const output = `${sha}\r\n0123456\t2026-10-16 01:02:47 +0900\tRelease candidate\r\n`;
  const fallback = testCommandRunner();
  const runCommand = async (cwd, command, env, onChunk, ...rest) => {
    if (!command.includes('git rev-parse HEAD')) return fallback(cwd, command, env, onChunk, ...rest);
    for (const character of output) onChunk(character);
    return output;
  };
  const historyFile = path.join(root, 'chunked-commit-history.json');
  const result = await executePlan(root, {appTag: '2026101601', dryRun: false, includeStackDeploy: false}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true', RELEASE_PUBLISHER_HISTORY_FILE: historyFile
  }, {runCommand});
  assert.equal(result.status, 'EXECUTED');
  const entry = JSON.parse(fs.readFileSync(historyFile, 'utf8'))[0];
  assert.equal(entry.releaseCommit, sha);
  assert.equal(entry.releaseCommitSubject, 'Release candidate');
});

test('failed Git capture preserves received chunked output for investigation', async () => {
  const root = tempProject(sampleXml);
  const fallback = testCommandRunner();
  const runCommand = async (cwd, command, env, onChunk, ...rest) => {
    if (!command.includes('git rev-parse HEAD')) return fallback(cwd, command, env, onChunk, ...rest);
    for (const character of 'fatal: capture interrupted\r\n') onChunk(character);
    throw new Error('capture failed');
  };
  const result = await executePlan(root, {appTag: '2026101601', dryRun: false, includeStackDeploy: false}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true', RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'failed-capture.json')
  }, {runCommand});
  assert.equal(result.status, 'ERROR');
  const capture = result.plan.steps.find(step => step.key === 'capture-release-commit');
  assert.equal(capture.status, 'failed');
  assert.ok(capture.logs.includes('fatal: capture interrupted'));
});

test('execute without dry run runs without a separate environment authorization flag', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = testCommandRunner();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {
    runCommand
  });

  assert.equal(result.status, 'EXECUTED');
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'EXECUTED');
  assert.ok(history[0].completedStepCount > 0);
});

test('execute errors are written to history with partial progress', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const progress = [];
  const runCommand = testCommandRunner({failOnCommand: true});
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {
    runCommand,
    onProgress(update) {
      progress.push(update);
    }
  });

  assert.equal(result.status, 'ERROR');
  assert.match(result.logs.join('\n'), /git status/);
  assert.ok(progress.some(update => update.currentStepKey === 'git-status-before-update'));
  const failedStep = result.plan.steps.find(step => step.key === 'git-status-before-update');
  assert.equal(failedStep.status, 'failed');
  assert.ok(Number.isFinite(failedStep.durationMs));
  assert.ok(failedStep.startedAt);
  assert.ok(failedStep.finishedAt);
  assert.ok(failedStep.logs.some(line => line.includes('[START] 检查本地代码状态')));
  assert.ok(failedStep.logs.some(line => line.includes('[RUN] git status')));
  assert.ok(failedStep.logs.some(line => line.includes('ERROR:')));
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'ERROR');
  assert.equal(history[0].completedStepCount, 0);
  assert.ok(Number.isFinite(history[0].totalDurationMs));
  assert.equal(history[0].slowestStep.key, 'git-status-before-update');
  assert.equal(runCommand.commands.length, 1);
});

test('database preflight failure stops before image upload', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'preflight-history.json');
  const runCommand = testCommandRunner({failOnIncludes: 'RELEASE_DB_AUDIT_MODE=inspect'});
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'ERROR');
  assert.equal(result.plan.steps.find(step => step.key === 'game-database-preflight').status, 'failed');
  assert.equal(runCommand.commands.some(command => command.includes('docker save -o')), false);
  assert.equal(runCommand.commands.some(command => command.includes('docker load -i')), false);
});

test('migration compatibility failure stops before image upload and production migration', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'migration-rehearsal-history.json');
  const migrationPath = 'scripts/migration/20260716_add_google_uid.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '120s';",
    'ALTER TABLE t_directors ADD COLUMN IF NOT EXISTS google_uid varchar(128);',
    'COMMIT;',
    'SELECT 1;'
  ].join('\n'), 'utf8');
  const runCommand = testCommandRunner({failOnIncludes: 'game_database_migration_compatibility=PASS'});
  const result = await executePlan(root, {
    appTag: '2026071701',
    dryRun: false,
    includeStackDeploy: true,
    gitCommit: 'latest',
    changeAnalysis: {targets: {game: {changedPaths: [migrationPath]}}}
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'ERROR');
  assert.equal(result.plan.steps.find(step => step.key === 'validate-game-database-migration-compatibility').status, 'failed');
  assert.equal(result.plan.steps.find(step => step.key === 'publish-image').status, 'pending');
  assert.equal(result.plan.steps.find(step => step.key === 'stage-game-static-assets').status, 'pending');
  assert.equal(result.plan.steps.find(step => step.key === 'apply-database-migrations').status, 'pending');
  assert.equal(runCommand.commands.some(command => command.includes('--mode stage')), false);
  assert.equal(runCommand.commands.some(command => command.includes('docker save -o')), false);
});

test('live configuration drift blocks game image upload and deployment', async () => {
  const root = tempProject(sampleXml);
  const runCommand = testCommandRunner({failOnIncludes: 'game_compose_live_config=PASS'});
  const result = await executePlan(root, {
    appTag: '2026100301', dryRun: false, includeStackDeploy: true, gitCommit: 'latest'
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'stripe-guard-history.json')
  }, {runCommand});
  assert.equal(result.status, 'ERROR');
  assert.equal(result.plan.steps.find(step => step.key === 'read-remote-compose').status, 'failed');
  for (const key of ['publish-image', 'update-remote-compose', 'deploy-stack']) {
    assert.equal(result.plan.steps.find(step => step.key === key).status, 'pending');
  }
  assert.equal(runCommand.commands.some(command => decodedScriptTree(command).includes('docker stack deploy')), false);
});

test('game guards are repeated at deployment and Stripe authentication is a final check', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {appTag: '2026100301', dryRun: true, includeStackDeploy: true}, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });
  const byKey = key => plan.steps.find(step => step.key === key);
  for (const key of ['read-remote-compose', 'update-remote-compose', 'deploy-stack']) {
    assert.match(decodedScriptTree(byKey(key).command), /game_compose_live_config=PASS/);
  }
  const deploy = decodedRemoteScript(byKey('deploy-stack').command);
  assert.ok(deploy.indexOf('python3 -') < deploy.indexOf('docker stack deploy'));
  assert.match(decodedScriptTree(byKey('validate-game-image').command), /production image contains a Stripe credential override/);
  assert.equal(byKey('game-prd2-runtime-contract').finalCheck, true);
  assert.match(decodedScriptTree(byKey('game-prd2-runtime-contract').command), /game_stripe_authentication=PASS/);
  const rollback = decodedRemoteScript(byKey('game-rollback-command').command);
  assert.match(decodedScriptTree(byKey('game-rollback-command').command), /game_service_snapshot=PASS/);
  assert.ok(rollback.indexOf('python3 -') < rollback.indexOf('WARNING: suspending'));
  assert.ok(rollback.indexOf('python3 -') < rollback.indexOf('python3 - "$backup_dir" "$service_name" apply'));
  assert.doesNotMatch(rollback, /docker service update --detach=true --rollback/);
  assert.doesNotMatch(rollback, /docker stack deploy/);
  assert.match(rollback, /rollback_completed/);
  for (const item of plan.steps.filter(item => item.command && item.command.includes('$remoteScript ='))) {
    const syntax = spawnSync(testBashExecutable(), ['-n'], {input: decodedRemoteScript(item.command), encoding: 'utf8'});
    assert.equal(syntax.status, 0, item.key + ': ' + syntax.stderr);
  }
});

test('cutover read-only transport retry preserves deployment and unknown-state holds without rollback', async () => {
  for (const scenario of ['recovers', 'persistent', 'authentication', 'fatal']) {
    const root = tempProject(sampleXml);
    const commands = [];
    let observations = 0;
    const runner = async (cwd, command, env, onChunk) => {
      commands.push(command);
      const script = decodedScriptTree(command);
      if (script.includes('game_cutover_observation=PASS')) {
        observations++;
        if (scenario === 'fatal') throw new Error('ERROR: Swarm rollout ended in paused\nclient_loop: send disconnect: Connection reset');
        if (scenario === 'authentication') throw new Error('Permission denied (publickey)');
        if (scenario === 'persistent' || observations === 1) throw new Error('client_loop: send disconnect: Connection reset');
      }
      if (script.includes('python3 - compensate --root')) return `game_deploy_transaction=ATTEMPTED id=${script.match(/--transaction '([a-f0-9-]{36})'/)[1]}\n`;
      if (script.includes('automatic_rollback_evidence')) return 'automatic_rollback_decision=HOLD_TARGET\n';
      onChunk?.('test_command=PASS\n');
      return 'test_command=PASS\n';
    };
    const result = await executePlan(root, {appTag: '2026111701', dryRun: false, includeStackDeploy: true}, {
      RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
      RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true', RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'transport.json')
    }, {runCommand: runner});
    assert.equal(observations, ['recovers', 'persistent'].includes(scenario) ? 2 : 1, scenario);
    assert.equal(result.status, scenario === 'recovers' ? 'EXECUTED' : 'RECOVERY_REQUIRED', scenario);
    const scripts = commands.map(decodedScriptTree);
    assert.equal(scripts.filter(script => script.includes('game_stack_deploy_guard=PASS')).length, 1, scenario);
    assert.equal(scripts.some(script => script.includes('automatic_rollback_validation=PASS')), false, scenario);
    assert.equal(scripts.some(script => script.includes('automatic_rollback_evidence')), scenario === 'fatal', scenario);
  }
});

test('game safety checks remain blocking with game-only materials', async () => {
  for (const failure of ['insufficient game cutover memory', 'memory headroom changed before game cutover', 'pre_deploy_checklist=PASS', 'rollout_validation=PASS']) {
    const root = tempProject(sampleXml);
    const base = testCommandRunner();
    const result = await executePlan(root, {appTag: '2026101601', dryRun: false, includeStackDeploy: true}, {
      RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
      RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true', RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'safety.json')
    }, {runCommand: async (...args) => {
      const script = decodedScriptTree(args[1]);
      assert.doesNotMatch(script, /meelok/i);
      if (script.includes(failure)) throw new Error(`game safety fixture: ${failure}`);
      return base(...args);
    }});
    assert.notEqual(result.status, 'EXECUTED', failure);
    assert.ok(result.plan.steps.some(step => step.status === 'failed' && !step.notificationOnly), failure);
    if (failure === 'insufficient game cutover memory') {
      assert.equal(result.plan.steps.find(step => step.key === 'publish-image').status, 'pending');
    }
  }
});

test('notification history retains all service observations and early warnings', () => {
  const logs = ['WARNING: Meelok marker retained', ...Array.from({length: 20}, (_, i) => `meelok_status observation=${i}`)];
  const entry = buildHistoryEntry('EXECUTED', {releaseTarget: 'game', config: {}, steps: [
    {key: 'game-meelok-readiness', notificationOnly: true, status: 'done', logs}
  ]}, [], ['game-meelok-readiness']);
  assert.deepEqual(entry.stepSummary[0].logs, logs);
  assert.equal(entry.stepSummary[0].notificationOnly, true);
});

test('forum preflight failure stops before image upload', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'forum-preflight-history.json');
  const runCommand = testCommandRunner({failOnIncludes: 'docker compose config'});
  const result = await executePlan(root, {
    releaseTarget: 'forum',
    forumImageMode: 'build',
    appTag: '2026071501',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'ERROR');
  assert.equal(result.plan.steps.find(step => step.key === 'forum-preflight').status, 'failed');
  assert.equal(runCommand.commands.some(command => command.includes('docker save -o')), false);
  assert.equal(runCommand.commands.some(command => command.includes('docker load -i')), false);
});

test('forum compose mutation failures require recovery without changing game recovery behavior', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'forum-recovery-history.json');
  const commands = [];
  const runCommand = async (cwd, command, env, onChunk) => {
    commands.push(command);
    const script = decodedScriptTree(command);
    if (script.includes("sed -i -E") && script.includes('rhospital/flarum-sso:2026071501')) {
      throw new Error('simulated forum compose mutation failure');
    }
    if (onChunk) onChunk('test_command=PASS\n');
    return 'test_command=PASS\n';
  };
  const result = await executePlan(root, {
    releaseTarget: 'forum',
    forumImageMode: 'reuse',
    appTag: '2026071501',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.recoveryBoundaryEntered, true);
  assert.match(result.logs.join('\n'), /论坛生产 Compose 修改已经进入执行边界/);
  assert.ok(commands.some(command => decodedScriptTree(command).includes("sed -i -E")));
  const history = readReleaseHistory(root, 1, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath})[0];
  assert.equal(history.status, 'RECOVERY_REQUIRED');
  assert.equal(history.stepSummary.find(step => step.key === 'update-remote-compose').status, 'failed');
});

test('terminal evidence is persisted before semantic diagnosis and model failure preserves success with warnings', async () => {
  const root = tempProject(sampleXml);
  const env = {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true', RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'diagnostics.json'),
    RELEASE_PUBLISHER_JEV_BASE_URL: 'http://127.0.0.1:1234/v1', RELEASE_PUBLISHER_JEV_MODEL: 'fixture',
    RELEASE_PUBLISHER_JEV_API_KEY: 'test-secret'
  };
  const runner = testCommandRunner();
  let requests = 0;
  const result = await executePlan(root, {appTag: '2026070702', dryRun: false, includeStackDeploy: true}, env, {
    runCommand: async (...args) => {
      const output = await runner(...args);
      if (decodedScriptTree(args[1]).includes('rollout_validation=PASS')) {
        args[3]('WARNING: fixture rollout observation needs review');
      }
      return output;
    },
    diagnosticFetch: async () => {
      requests++;
      const saved = readReleaseHistory(root, 1, env)[0];
      assert.equal(saved.status, 'EXECUTED');
      assert.equal(saved.diagnostics.outcome, 'SUCCESS_WITH_WARNINGS');
      throw new Error('test-secret');
    }
  });
  assert.equal(requests, 1);
  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.diagnostics.semantic.code, 'REQUEST_FAILED');
  assert.equal(JSON.stringify(result.diagnostics).includes('test-secret'), false);
  assert.equal(readReleaseHistory(root, 20, env).length, 1);
  assert.equal(readReleaseHistory(root, 1, env)[0].diagnostics.semantic.code, 'REQUEST_FAILED');
});

test('historical diagnosis labels retained evidence and never resurrects deleted history', async () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'diagnose-old.json'),
    RELEASE_PUBLISHER_JEV_BASE_URL: 'http://127.0.0.1:1234/v1', RELEASE_PUBLISHER_JEV_MODEL: 'fixture',
    RELEASE_PUBLISHER_JEV_API_KEY: 'test-secret'};
  appendReleaseHistory(root, {id: 'historical-failure', status: 'ERROR', stepSummary: [
    {key: 'test-game-backend', title: '后端测试', status: 'failed', logs: ['ERROR: tests failed']}
  ]}, env);
  const diagnostic = await diagnoseHistoryEntry(root, 'historical-failure', env, {fetch: async () => {
    clearReleaseHistory(root, env);
    return {ok: false};
  }});
  assert.equal(diagnostic.scope, 'retained_history');
  assert.equal(diagnostic.firstFailure.stepKey, 'test-game-backend');
  assert.equal(readReleaseHistory(root, 20, env).length, 0);
});

test('observing target holds when the fatal full-chain threshold is not met', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = recoveryDecisionTestRunner('HOLD_TARGET');
  const result = await executePlan(root, {
    ...selectGameChecks(root, 'verify-tradepool-release'),
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.cutoverCommitted, true);
  assert.match(result.logs.join('\n'), /全链路致命故障阈值未满足/);
  assert.equal(runCommand.rollbackRuns, 0);
  assert.equal(runCommand.decisionRuns, 0);
  assert.equal(runCommand.fatalDecisionRuns, 1);
  const history = readReleaseHistory(root, 1, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath})[0];
  assert.equal(history.status, 'RECOVERY_REQUIRED');
  assert.equal(history.stepSummary.find(step => step.key === 'commit-game-cutover').status, 'done');
  assert.equal(history.stepSummary.find(step => step.key === 'verify-tradepool-release').status, 'failed');
  assert.equal(history.stepSummary.find(step => step.key === 'game-rollback-decision').status, 'pending');
  assert.equal(history.stepSummary.find(step => step.key === 'game-fatal-rollback-decision').status, 'done');
  assert.equal(history.stepSummary.find(step => step.key === 'game-rollback-command').status, 'pending');
  assert.equal(runCommand.commands.some(command =>
    decodedScriptTree(command).includes('post_release_container_cleanup=PASS')), false);
});

test('three-round fatal full-chain evidence after cutover permits automatic rollback', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = recoveryDecisionTestRunner('ROLLBACK_CONFIRMED');
  const result = await executePlan(root, {
    ...selectGameChecks(root, 'verify-tradepool-release'),
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: true,
    requireStandbyCandidate: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(runCommand.fatalDecisionRuns, 1);
  assert.equal(runCommand.rollbackRuns, 1);
  assert.equal(result.plan.steps.find(step => step.key === 'accept-game-standby-candidate').status, 'pending');
});

test('confirmed unsafe target evidence before cutover commit permits automatic rollback', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = recoveryDecisionTestRunner('ROLLBACK_CONFIRMED', {failAt: 'cutover'});
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(result.cutoverCommitted, undefined);
  assert.equal(runCommand.rollbackRuns, 1);
  assert.equal(runCommand.decisionRuns, 1);
});

test('rollback decision check failure before cutover commit preserves the target', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const runCommand = recoveryDecisionTestRunner('CHECK_ERROR', {failAt: 'cutover'});
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {runCommand});

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.match(result.logs.join('\n'), /复核异常，禁止自动回滚/);
  assert.equal(runCommand.rollbackRuns, 0);
  assert.equal(runCommand.decisionRuns, 1);
});

test('default A-only formal release succeeds without any B helper and keeps core safety checks', async () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json')};
  const runner = testCommandRunner();
  const result = await executePlan(root, {...selectGameChecks(root),
    appTag: 'primary-only', dryRun: false, includeStackDeploy: true}, env, {
    runCommand: async (...args) => {
      assert.equal(args[1].includes('game-standby-candidate.cjs'), false);
      return runner(...args);
    }
  });
  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.plan.config.standbyCandidate, null);
  for (const key of ['test-game-backend', 'verify-game-static-assets-predeploy',
    'pre-deploy-checklist', 'publish-image', 'deploy-stack', 'final-runtime-check',
    'verify-game-static-delivery']) {
    assert.ok(result.completedStepKeys.includes(key), key);
  }
  for (const key of ['verify-tradepool-release', 'verify-relations-release', 'game-meelok-readiness',
    'pause-meelok-services', 'restore-meelok-services', 'cleanup-game-release-containers', 'sync-game-disaster-recovery-image']) {
    assert.equal(result.plan.steps.some(step => step.key === key), false, key);
  }
  assert.equal(result.plan.steps.some(step => /standby-candidate/.test(step.key)), false);
  assert.equal(result.plan.steps.find(step => step.key === 'build-image').command.includes('--iidfile'), false);
  assert.match(decodedRemoteScript(result.plan.steps.find(step => step.key === 'deploy-stack').command), /docker stack deploy/);
  assert.equal(readReleaseHistory(root, 1, env)[0].standbyCandidate, null);
  assert.equal(createPlan(root, {appTag: 'primary-only', includeStackDeploy: true,
    requireStandbyCandidate: false}, env).config.standbyCandidate, null);
  assert.throws(() => createPlan(root, {appTag: 'primary-only', includeStackDeploy: true,
    requireStandbyCandidate: 'false'}, env), /requireStandbyCandidate/);
});

test('fixture teardown retries transient permission errors without suppressing persistent failures', async () => {
  const {fixtureLifecycle} = require('./helpers/ownedFixtures');
  for (const persistent of [false, true]) {
    let register, teardown, root, attempts = 0;
    const fixture = fixtureLifecycle((_name, testBody) => { register = testBody; }, {
      remove(directory, options) {
        attempts++;
        if (attempts === 1 || persistent) throw Object.assign(new Error('fixture busy'), {code: 'EPERM'});
        fs.rmSync(directory, options);
      }
    });
    fixture.test('fixture', () => { root = fixture.temporaryDirectory('release-publisher-teardown-'); });
    await register({after: callback => { teardown = callback; }});
    try {
      if (persistent) {
        await assert.rejects(teardown(), {code: 'EPERM'});
        assert.equal(attempts, 4);
        assert.equal(fs.existsSync(root), true);
      } else {
        await teardown();
        assert.equal(attempts, 2);
        assert.equal(fs.existsSync(root), false);
      }
    } finally {
      if (fs.existsSync(root)) fs.rmdirSync(root);
    }
  }
});

test('game materials cannot schedule environment operations through an assessment or plugin alias', () => {
  const root = tempProject(sampleXml);
  const file = path.join(root, 'release/publisher/game.json');
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of ['game-meelok-readiness', 'pause-meelok-services', 'restore-meelok-services',
    'cleanup-game-release-containers', 'sync-game-disaster-recovery-image']) {
    const request = {...selectGameChecks(root, id), appTag: 'game-only', includeStackDeploy: true};
    assert.throws(() => createPlan(root, request), /游戏发版资材不能声明环境运维动作/);
    const plugin = structuredClone(original);
    const originalId = plugin.units[0].id;
    plugin.units[0].id = id;
    for (const entry of plugin.coverage) entry.units = entry.units.map(unit => unit === originalId ? id : unit);
    fs.writeFileSync(file, JSON.stringify(plugin));
    assert.throws(() => createPlan(root, request), /GAME_ENVIRONMENT_OPERATION_FORBIDDEN/);
    fs.writeFileSync(file, JSON.stringify(original));
  }
});

test('explicit dual-node gate is mandatory, precedes Compose mutation and accepts last', () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'};
  const plan = createPlan(root, {appTag: 'dual-node', includeStackDeploy: true, requireStandbyCandidate: true}, env);
  const keys = plan.steps.filter(step => !step.recoveryOnly).map(step => step.key);
  assert.ok(keys.indexOf('publish-image') < keys.indexOf('verify-game-standby-candidate'));
  assert.ok(keys.indexOf('verify-game-standby-candidate') < keys.indexOf('update-remote-compose'));
  assert.equal(keys.at(-1), 'accept-game-standby-candidate');
  assert.ok(keys.indexOf('final-runtime-check') < keys.indexOf('accept-game-standby-candidate'));
  const commands = plan.steps.filter(step => step.command.includes('game-standby-candidate.cjs'));
  const candidateIds = commands.map(step => {
    const encoded = step.command.match(/\$candidateRequest = '([0-9A-Za-z+/=]+)'/)[1];
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).candidateId;
  });
  assert.equal(new Set(candidateIds).size, 1);
  const build = plan.steps.find(step => step.key === 'build-image');
  assert.match(build.command, /--iidfile/);
  assert.ok(build.command.includes(candidateIds[0]));
  assert.match(build.command, /build-image\.id/);
  assert.equal(plan.steps.find(step => step.key === 'test-game-backend').command.includes('--iidfile'), false);
  assert.equal(plan.config.standbyCandidate.standbyHost, '185.184.223.41');
  const imageOnly = createPlan(root, {appTag: 'dual-node', includeStackDeploy: false}, env);
  assert.equal(imageOnly.steps.some(step => step.key === 'accept-game-standby-candidate'), false);
  assert.equal(imageOnly.steps.find(step => step.key === 'build-image').command.includes('--iidfile'), false);
});

test('B gate failure prevents A Compose changes and leaves acceptance pending', async () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json')};
  const runCommand = testCommandRunner();
  // The script path may be quoted by PowerShell; fail on the stable action suffix.
  const delegate = runCommand;
  const runner = async (...args) => {
    if (args[1].includes('game-standby-candidate.cjs') && / verify(?:;|\s)/.test(args[1])) throw new Error('B gate failed');
    return delegate(...args);
  };
  const result = await executePlan(root, {appTag: 'dual-node', dryRun: false, includeStackDeploy: true, requireStandbyCandidate: true}, env, {runCommand: runner});
  assert.equal(result.status, 'ERROR');
  for (const key of ['update-remote-compose', 'deploy-stack', 'accept-game-standby-candidate']) {
    assert.equal(result.plan.steps.find(step => step.key === key).status, 'pending');
  }
});

test('ambiguous B acceptance requires recovery and never invokes A rollback', async () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json')};
  const calls = [];
  const runCommand = async (cwd, command, currentEnv, onChunk) => {
    calls.push(command);
    if (command.includes('game-standby-candidate.cjs') && / accept(?:;|\s)/.test(command)) throw new Error('lost CAS receipt');
    if (onChunk) onChunk('mock=PASS');
    return 'mock=PASS';
  };
  const result = await executePlan(root, {appTag: 'dual-node', dryRun: false, includeStackDeploy: true, requireStandbyCandidate: true}, env, {runCommand});
  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.ok(result.completedStepKeys.includes('final-runtime-check'));
  assert.ok(!result.completedStepKeys.includes('accept-game-standby-candidate'));
  assert.ok(!calls.some(command => decodedScriptTree(command).includes('automatic_rollback_validation=PASS')));
});

test('cutover helper refusal or lost submission receipt never rolls back an untouched A service', async () => {
  const root = tempProject(sampleXml);
  const env = {RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true', RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json')};
  const commands = [];
  const runner = async (cwd, command, currentEnv, onChunk) => {
    commands.push(command);
    if (command.includes('game-standby-candidate.cjs') && / cutover(?:;|\s)/.test(command)) throw new Error('B guard refused submission');
    if (onChunk) onChunk('mock=PASS');
    return 'mock=PASS';
  };
  const result = await executePlan(root, {appTag: 'dual-node', dryRun: false, includeStackDeploy: true, requireStandbyCandidate: true}, env, {runCommand: runner});
  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.plan.steps.find(step => step.key === 'accept-game-standby-candidate').status, 'pending');
  assert.ok(!commands.some(command => decodedScriptTree(command).includes('automatic_rollback_validation=PASS')));
});

test('test mode blocks operating-system publication commands when no runner is injected', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_TEST_MODE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'ERROR');
  assert.match(result.logs.join('\n'), /测试模式禁止启动系统发布命令/);
  assert.equal(result.completedStepKeys.length, 0);
});

test('execute can be cancelled before running commands', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const controller = new AbortController();
  const runCommand = testCommandRunner();
  controller.abort();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  }, {
    runCommand,
    signal: controller.signal
  });

  assert.equal(result.status, 'CANCELLED');
  assert.ok(result.logs.some(line => line.includes('CANCELLED')));
  assert.equal(runCommand.commands.length, 0);
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history[0].status, 'CANCELLED');
});





test('PowerShell runner accepts scripts beyond the Windows command-line limit through stdin', {
  skip: process.platform !== 'win32'
}, async () => {
  const payload = 'x'.repeat(50000);
  const command = `# ${payload}\nWrite-Output ${payload.length}`;
  const output = await runPowerShell(process.cwd(), command, {
    RELEASE_PUBLISHER_TEST_MODE: 'false'
  }, null, null, null, 30);

  assert.match(output, /50000/);
  await assert.rejects(() => runPowerShell(process.cwd(), 'Write-Error "expected"; exit 7', {
    RELEASE_PUBLISHER_TEST_MODE: 'false'
  }, null, null, null, 30), /expected/);
});

test('SSH runner streams oversized remote scripts through stdin instead of argv', {
  skip: process.platform !== 'win32'
}, async () => {
  const isolation = createAcceptanceIsolation(path.join(__dirname, '..'));
  try {
    const encoded = Buffer.from(`set -e\n# ${'x'.repeat(50000)}\necho PASS\n`, 'utf8').toString('base64');
    const command = remoteSshCommand({target: 'fake@example', port: '22'},
      `printf %s "${encoded}" | base64 -d | bash`);
    const output = await runPowerShell(process.cwd(), command, isolation.env, null, null, null, 30);

    assert.match(command, /\$remoteScript \| & (?:'ssh'|ssh)/);
    assert.doesNotMatch(command, /'printf %s/);
    assert.match(command, /tr -d ''\\r\\n'' \| base64 -d \| bash/);
    assert.match(output, /isolated_ssh=PASS bash_syntax=PASS remote_script_chars=5002[0-9]/);
  } finally {
    isolation.cleanup();
  }
});

test('full-flow acceptance isolates npm checks from the current application checkout', async () => {
  const isolation = createAcceptanceIsolation(path.join(__dirname, '..'));
  try {
    const output = await runPowerShell(process.cwd(), 'npm run unavailable-in-this-checkout',
      isolation.env, null, null, null, 30);
    assert.match(output, /isolated_npm=PASS/);
  } finally {
    isolation.cleanup();
  }
});

test('full-flow acceptance invokes every executable command and continues after failures', async () => {
  const commands = [];
  const plan = {
    releaseTarget: 'game',
    appTag: '20260825',
    steps: [
      {key: 'metadata', title: 'Metadata', executable: false, command: 'description'},
      {key: 'first', title: 'First', executable: true, command: 'first-command',
        validationCommand: 'first-validation', actionType: 'local-check'},
      {key: 'upload', title: 'Upload', executable: true, command: 'upload-command',
        productionAction: true, actionType: 'production'},
      {key: 'rollback', title: 'Rollback', executable: true, command: 'rollback-command',
        recoveryOnly: true, actionType: 'local-check'}
    ]
  };
  const runCommand = async (_cwd, command) => {
    commands.push(command);
    if (command === 'first-command') throw new Error('expected isolated failure');
    return 'acceptance=PASS\n';
  };
  const result = await executeReleasePlanAcceptance(plan, process.cwd(), {
    [ACCEPTANCE_FLAG]: 'isolated'
  }, {runCommand});

  assert.deepEqual(commands, ['first-command', 'first-validation', 'upload-command', 'rollback-command']);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.executorInvocationCount, 4);
  assert.equal(result.failedStepCount, 1);
  assert.equal(result.steps.find(step => step.key === 'metadata').status, 'METADATA');
  assert.equal(result.steps.find(step => step.key === 'upload').mode, 'SIMULATED_DESTRUCTIVE');
  assert.equal(result.steps.find(step => step.key === 'rollback').status, 'PASS');
});

test('full-flow acceptance rejects execution without the isolated safety flag', async () => {
  await assert.rejects(() => executeReleasePlanAcceptance({steps: []}, process.cwd(), {}),
    /FULL_FLOW_ACCEPTANCE=isolated/);
});

test('release history supports pagination and deletion', () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  for (let index = 1; index <= 12; index += 1) {
    const plan = createPlan(root, {
      appTag: `20260707${String(index).padStart(2, '0')}`,
      dryRun: true,
      includeStackDeploy: false
    }, {
      RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
      RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
      RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
    });
    appendReleaseHistory(root, buildHistoryEntry('DRY_RUN', plan, [], []), {
      RELEASE_PUBLISHER_HISTORY_FILE: historyPath
    });
  }

  const page = readReleaseHistoryPage(root, {page: 2, limit: 5}, {
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });
  assert.equal(page.total, 12);
  assert.equal(page.page, 2);
  assert.equal(page.items.length, 5);
  const deleteResult = deleteReleaseHistoryEntry(root, page.items[0].id, {
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });
  assert.equal(deleteResult.deleted, true);
  assert.equal(deleteResult.total, 11);
  const clearResult = clearReleaseHistory(root, {
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });
  assert.equal(clearResult.total, 0);
  assert.equal(readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}).length, 0);
});

test('rejects invalid app tag', () => {
  assert.throws(() => validateTag('20260707;rm'), /APP_TAG/);
});

test('detects deployable target changes and blocks unchanged or rollback releases', () => {
  const root = tempGitProject();
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const historyPath = path.join(root, 'history.json');
  const history = [
    {
      status: 'EXECUTED',
      releaseTarget: 'forum',
      releaseCommit: baseline,
      appTag: '2026071601',
      imageTag: 'rhospital/flarum-sso:2026071601',
      includeStackDeploy: true
    },
    {
      status: 'EXECUTED',
      releaseTarget: 'game',
      releaseCommit: baseline,
      appTag: '20260716',
      imageTag: 'hospital-backend:20260716',
      includeStackDeploy: true
    }
  ];
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.join(root, 'integrations', 'flarum'), {recursive: true});
  fs.writeFileSync(path.join(root, 'integrations', 'flarum', 'Dockerfile'), 'FROM demo\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'forum change']);

  const forumOnly = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.deepEqual(forumOnly.changedTargets, ['forum']);
  assert.equal(forumOnly.recommendedTarget, 'forum');
  assert.deepEqual(forumOnly.targets.forum.changedPaths, ['integrations/flarum/Dockerfile']);
  assert.equal(assertReleaseTargetChanged(forumOnly, 'forum', 'build'), true);
  assert.throws(() => assertReleaseTargetChanged(forumOnly, 'game', 'build'), /没有游戏运行文件变化/);

  fs.mkdirSync(path.join(root, 'src', 'main'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src', 'main', 'runtime.txt'), 'game\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'game change']);
  const both = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.deepEqual(both.changedTargets, ['game', 'forum']);
  assert.equal(both.recommendedTarget, 'multiple');

  const latestCommit = runGit(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(historyPath, `${JSON.stringify(history.map(entry => ({...entry, releaseCommit: latestCommit})), null, 2)}\n`, 'utf8');
  const rollback = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: baseline
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(rollback.targets.game.direction, 'rollback');
  assert.throws(() => assertReleaseTargetChanged(rollback, 'game', 'build'), /已阻止降级发布/);
  assert.equal(assertReleaseTargetChanged(rollback, 'forum', 'reuse'), true);
});

test('reconciles only the archived healthy game release and retains later successful baselines', () => {
  const root = tempGitProject();
  const previous = '1aa70d92350f8dacbd4fd2895fcd251a4bb893a9';
  const recovered = '8eb540a9f247910007a698ae0f65e8732534aab2';
  const candidate = '85b50f028' + 'f'.repeat(31);
  const skippedPath = 'src/main/resources/bacteria-level-validator.js';
  const reconciled = {
    id: '2026-11-17T14:08:46.113Z-2026111701', appTag: '2026111701',
    imageTag: 'hospital-backend:2026111701', releaseCommit: recovered,
    includeStackDeploy: true, releaseTarget: 'game', status: 'RECOVERY_REQUIRED',
    stepSummary: [
      {key: 'deploy-stack', status: 'done'},
      {key: 'commit-game-cutover', status: 'failed'},
      {key: 'game-rollback-command', status: 'failed', logs: ['ERROR: rollback requires an immutable compatible image']}
    ]
  };
  const successful = {status: 'EXECUTED', releaseTarget: 'game', releaseCommit: previous, includeStackDeploy: true};
  const git = (_bin, args) => ({status: 0, stdout: args[0] === 'rev-parse'
    ? candidate : args[0] === 'diff' && args.at(-1).startsWith(previous) ? skippedPath : ''});
  const scenarios = [
    {entries: [reconciled, successful], baseline: recovered, paths: []},
    {entries: [{...reconciled, releaseCommit: candidate}, successful], baseline: previous, paths: [skippedPath]},
    {entries: [{...reconciled, stepSummary: reconciled.stepSummary.slice(0, 2)}, successful], baseline: previous, paths: [skippedPath]},
    {entries: [{...successful, releaseCommit: candidate}, reconciled], baseline: candidate, paths: []}
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const file = path.join(root, 'reconciliation-' + index + '.json');
    const history = JSON.stringify(scenario.entries);
    fs.writeFileSync(file, history);
    const analysis = analyzeReleaseChanges(root, {}, {RELEASE_PUBLISHER_HISTORY_FILE: file}, git);
    assert.equal(analysis.targets.game.baselineCommit, scenario.baseline);
    assert.deepEqual(analysis.targets.game.changedPaths, scenario.paths);
    assert.equal(fs.readFileSync(file, 'utf8'), history);
  }
});

test('allows a dry-run pre-push plan for a proposed fast-forward commit', () => {
  const root = tempGitProject();
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const historyPath = path.join(root, 'history.json');
  fs.writeFileSync(historyPath, `${JSON.stringify([{
    status: 'EXECUTED',
    releaseTarget: 'game',
    releaseCommit: baseline,
    appTag: '20260917',
    imageTag: 'hospital-backend:20260917',
    includeStackDeploy: true
  }], null, 2)}\n`, 'utf8');

  runGit(root, ['checkout', '-b', 'proposal']);
  fs.mkdirSync(path.join(root, 'src', 'main'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src', 'main', 'proposed.txt'), 'proposed\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'proposed release']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();

  assert.throws(() => analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: target,
    dryRun: true
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}), /不能从该分支快进/);

  const analysis = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: target,
    dryRun: true,
    allowProposedFastForward: true
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(analysis.targetCommit, target);
  assert.equal(analysis.targets.game.direction, 'forward');

  for (const releaseTarget of ['game', 'forum']) {
    for (const options of [
      {dryRun: false, allowProposedFastForward: true},
      {dryRun: true, allowProposedFastForward: false},
      {dryRun: true},
      {dryRun: 'true', allowProposedFastForward: true},
      {dryRun: true, allowProposedFastForward: 'true'},
      {}
    ]) {
      assert.throws(() => analyzeReleaseChanges(root, {
        gitBranch: branch, gitCommit: target, releaseTarget, ...options
      }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}), /不能从该分支快进/,
      `${releaseTarget} must revalidate branch membership after a proposed dry-run warms the cache`);
    }
  }
  assert.equal(analyzeReleaseChanges(root, {
    gitBranch: branch, gitCommit: target, dryRun: true, allowProposedFastForward: true
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}).targetCommit, target);
  assert.equal(analyzeReleaseChanges(root, {
    gitBranch: branch, gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}).targetCommit, baseline);
  assert.equal(analyzeReleaseChanges(root, {
    gitBranch: branch, gitCommit: baseline, dryRun: false
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}).targetCommit, baseline);

  runGit(root, ['checkout', branch]);
  fs.writeFileSync(path.join(root, 'branch-only.txt'), 'diverged\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'diverge branch']);
  assert.throws(() => analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: target,
    dryRun: true,
    allowProposedFastForward: true
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath}), /不能从该分支快进/);
});


test('blocks diverged game plans before resolving migration blobs missing from the target', () => {
  const root = tempProject(sampleXml);
  runGit(root,['init']);runGit(root,['add','.']);
  runGit(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','candidate policy']);
  const request = releaseImpactPlanRequest(
    '19199bfacee6e172b95b99d834b0e7ecd8c1f435',
    '72bb8c036248fd0dd4857ae8036cf89a7e94df58',
    ['scripts/migration/20260813_add_toilet_preference_penalties.sql'],
    []
  );
  request.changeAnalysis.targets.game.direction = 'diverged';
  request.gitCommit=runGit(root,['rev-parse','HEAD']).trim();

  assert.throws(() => createPlan(root, request), error => {
    assert.match(error.message, /游戏目标提交与当前生产基线分叉/);
    assert.doesNotMatch(error.message, /does not exist|不存在于目标提交/);
    return true;
  });
});

test('blocks diverged forum build plans before reading target release files', () => {
  const root = tempProject(sampleXml);
  const request = {
    releaseTarget: 'forum',
    forumImageMode: 'build',
    changeAnalysis: {
      targets: {
        forum: {
          changed: false,
          baselineCommit: '72bb8c036248fd0dd4857ae8036cf89a7e94df58',
          direction: 'diverged',
          changedPaths: [],
          ignoredPaths: []
        }
      }
    }
  };

  assert.throws(() => createPlan(root, request), /论坛目标提交与当前生产基线分叉/);
  assert.equal(assertReleaseTargetChanged(request.changeAnalysis, 'forum', 'reuse'), true);
});

test('uses an observing committed game target as the next production baseline', () => {
  const root = tempGitProject();
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const executedBaseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const historyPath = path.join(root, 'history.json');

  fs.mkdirSync(path.join(root, 'src', 'main'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src', 'main', 'deployed.txt'), 'deployed\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'held target']);
  const heldCommit = runGit(root, ['rev-parse', 'HEAD']).trim();

  fs.writeFileSync(historyPath, `${JSON.stringify([
    {
      status: 'RECOVERY_REQUIRED',
      releaseTarget: 'game',
      releaseCommit: heldCommit,
      appTag: '20260803',
      imageTag: 'hospital-backend:20260803',
      includeStackDeploy: true,
      stepSummary: [
        {key: 'deploy-stack', status: 'done', logs: []},
        {key: 'commit-game-cutover', status: 'done', logs: ['game_cutover_commit=PASS']},
        {key: 'final-runtime-check', status: 'failed', logs: ['post-commit observation failed']},
        {key: 'game-rollback-decision', status: 'pending', logs: []},
        {key: 'game-rollback-command', status: 'pending', logs: []}
      ]
    },
    {
      status: 'EXECUTED',
      releaseTarget: 'game',
      releaseCommit: executedBaseline,
      appTag: '20260731',
      imageTag: 'hospital-backend:20260731',
      includeStackDeploy: true
    }
  ], null, 2)}\n`, 'utf8');

  fs.writeFileSync(path.join(root, 'src', 'main', 'next.txt'), 'next\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'next target']);

  const analysis = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(analysis.targets.game.baselineCommit, heldCommit);
  assert.equal(analysis.targets.game.baselineTag, '20260803');
  assert.deepEqual(analysis.targets.game.changedPaths, ['src/main/next.txt']);
});

test('does not trust a recovery-required game target without explicit hold evidence', () => {
  const root = tempGitProject();
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const executedBaseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const historyPath = path.join(root, 'history.json');
  fs.mkdirSync(path.join(root, 'src', 'main'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src', 'main', 'uncertain.txt'), 'uncertain\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'uncertain target']);
  const uncertainCommit = runGit(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(historyPath, `${JSON.stringify([
    {
      status: 'RECOVERY_REQUIRED',
      releaseTarget: 'game',
      releaseCommit: uncertainCommit,
      appTag: '20260803',
      imageTag: 'hospital-backend:20260803',
      includeStackDeploy: true,
      stepSummary: [
        {key: 'deploy-stack', status: 'done', logs: []},
        {key: 'final-runtime-check', status: 'done', logs: []},
        {key: 'game-rollback-decision', status: 'failed', logs: ['decision check failed']},
        {key: 'game-rollback-command', status: 'pending', logs: []}
      ]
    },
    {
      status: 'EXECUTED',
      releaseTarget: 'game',
      releaseCommit: executedBaseline,
      appTag: '20260731',
      imageTag: 'hospital-backend:20260731',
      includeStackDeploy: true
    }
  ], null, 2)}\n`, 'utf8');

  const analysis = analyzeReleaseChanges(root, {
    gitBranch: branch,
    gitCommit: 'latest'
  }, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(analysis.targets.game.baselineCommit, executedBaseline);
  assert.deepEqual(analysis.targets.game.changedPaths, ['src/main/uncertain.txt']);
});

test('lists branches and commits from a git project', () => {
  const root = tempGitProject();
  runGit(root, ['checkout', '-b', 'release/demo']);
  fs.writeFileSync(path.join(root, 'release.txt'), 'release\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'release commit']);

  const branches = listGitBranches(root, {});
  assert.ok(branches.branches.some(branch => branch.name === 'release/demo' && branch.current));
  assert.equal(branches.defaultBranch, 'master');

  const commits = listGitCommits(root, 'release/demo', 10);
  assert.equal(commits.branch, 'release/demo');
  assert.ok(commits.commits.length >= 1);
  assert.match(commits.commits[0].subject, /release commit/);
});

test('release branch selection uses remote master when local master is stale', () => {
  const root = tempGitProject();
  runGit(root, ['checkout', '-b', 'release/demo']);
  fs.writeFileSync(path.join(root, 'release.txt'), 'remote release\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'remote release']);
  runGit(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);

  const branches = listGitBranches(root, {});
  assert.equal(branches.defaultBranch, 'origin/master');
  assert.ok(branches.branches.some(branch => branch.name === 'origin/master'));
  assert.ok(!branches.branches.some(branch => branch.name === 'master'));
  assert.match(listGitCommits(root, branches.defaultBranch, 1).commits[0].subject, /remote release/);
  assert.doesNotMatch(listGitCommits(root, 'master', 1).commits[0].subject, /remote release/);
});



test('refreshes origin refs before reloading commits', () => {
  const calls = [];
  const result = refreshGitRefs('C:\\repo', {}, (command, args, options) => {
    calls.push({command, args, options});
    return {status: 0, stdout: '', stderr: ''};
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.remote, 'origin');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['fetch', '--prune', 'origin']);
  assert.equal(calls[0].options.cwd, 'C:\\repo');
});

test('rejects invalid git branch and commit', () => {
  assert.throws(() => validateGitBranch('origin/master;rm'), /Git 分支/);
  assert.throws(() => validateGitBranch('../master'), /Git 分支/);
  assert.throws(() => validateGitCommit('not-a-sha'), /Git 提交/);
  assert.equal(validateGitCommit('latest'), 'latest');
});

test('default project root points to sibling hospital backend unless overridden', () => {
  const previous = process.env.RHOSPITAL_PROJECT_ROOT;
  delete process.env.RHOSPITAL_PROJECT_ROOT;
  assert.equal(path.basename(defaultProjectRoot()), 'hospital-backend');
  process.env.RHOSPITAL_PROJECT_ROOT = 'C:\\tmp\\hospital';
  assert.equal(defaultProjectRoot(), path.resolve('C:\\tmp\\hospital'));
  if (previous === undefined) {
    delete process.env.RHOSPITAL_PROJECT_ROOT;
  } else {
    process.env.RHOSPITAL_PROJECT_ROOT = previous;
  }
});













test('native Windows service runs the release console without an interactive window', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-release-console.ps1'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-windows-service.ps1'), 'utf8');
  const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-windows-service.ps1'), 'utf8');
  const uninstaller = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uninstall-windows-service.ps1'), 'utf8');
  const serviceHost = fs.readFileSync(path.join(__dirname, '..', 'service', 'RHospitalReleaseConsoleService.cs'), 'utf8');
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');

  assert.match(runner, /while \(\$true\)/);
  assert.match(runner, /GetEnvironmentVariable\('RHOSPITAL_RELEASE_AUTH_TOKEN_FILE', 'User'\)/);
  assert.match(runner, /GetEnvironmentVariable\('RHOSPITAL_RELEASE_AUTH_TOKEN_FILE', 'Machine'\)/);
  assert.match(runner, /release console exited with code \$exitCode; restarting in \$RestartDelaySeconds seconds/);
  assert.match(builder, /\/target:winexe/);
  assert.match(installer, /New-Service/);
  assert.match(installer, /obj= LocalSystem/);
  assert.match(installer, /sc\.exe failureflag \$ServiceName 1/);
  assert.match(installer, /Unregister-ScheduledTask/);
  assert.match(installer, /-RemoteAddress LocalSubnet/);
  assert.match(installer, /-LocalAddress \$BindAddress/);
  assert.match(uninstaller, /Remove-NetFirewallRule/);
  assert.match(serviceHost, /class ReleaseConsoleService : ServiceBase/);
  assert.match(serviceHost, /WTSQueryUserToken/);
  assert.match(serviceHost, /WTSEnumerateSessions/);
  assert.match(serviceHost, /WTS_CONNECTSTATE_CLASS\.WTSActive/);
  assert.match(serviceHost, /WTS_CONNECTSTATE_CLASS\.WTSDisconnected/);
  assert.match(serviceHost, /TryGetExpectedUserToken\(options\.ExpectedUser/);
  assert.match(serviceHost, /CreateProcessAsUser/);
  assert.match(serviceHost, /CreateNoWindow \| CreateSuspended \| CreateUnicodeEnvironment/);
  assert.match(serviceHost, /JobObjectLimitKillOnJobClose/);
  assert.match(serviceHost, /AssignProcessToJobObject/);
  assert.match(serviceHost, /identity\.Name, expectedUser/);
  assert.match(serviceHost, /--bind-address/);
  assert.match(runner, /RELEASE_PUBLISHER_HOST = \$BindAddress/);
  assert.match(packageJson, /scripts\/install-windows-service\.ps1/);
  assert.doesNotMatch(packageJson, /install-startup-task\.ps1/);
});



test('build engine preflight runs in the build environment and failure blocks build and production', async t => {
  const root = tempProject(sampleXml);
  const env = {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: path.join(root, 'history.json'),
    DOCKER_CONTEXT: 'desktop-linux', DOCKER_CONFIG: 'fixture-config'
  };
  const request = {appTag: '2026070702', dryRun: false, gitBranch: 'master', includeStackDeploy: false};
  const plan = createPlan(root, request, env);
  const preflight = plan.steps.find(step => step.key === 'test-game-backend');
  assert.match(preflight.command, /check-docker-engine\.cjs.*; if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}; docker build/s);
  assert.equal(preflight.productionAction, false);
  assert.equal(preflight.executable, true);
  assert.ok(plan.steps.some(step => step.key === 'test-game-backend' && step.validationCommand.includes('image inspect')));
  const calls = [];
  const result = await executePlan(root, request, env, {runCommand: async (cwd, command, executionEnv, _chunk, _heartbeat, _signal, timeout) => {
    calls.push(command);
    if (command.includes('check-docker-engine.cjs')) {
      assert.equal(cwd, root);
      assert.equal(executionEnv, env);
      assert.equal(timeout, preflight.timeoutSeconds);
      throw new Error('Docker engine preflight: fixture unavailable');
    }
    return 'fixture=PASS';
  }});
  assert.equal(result.status, 'ERROR');
  assert.equal(result.plan.steps.find(step => step.key === preflight.key).status, 'failed');
  assert.ok(result.logs.some(line => line.includes('fixture unavailable')));
  assert.equal(calls.some(command => /docker save|docker load|docker stack deploy/.test(command)), false);
  assert.equal(result.completedStepKeys.includes('test-game-backend'), false);
});

test('resource admission precedes expensive work and preserves final cutover safety guards',()=>{
  const root=tempProject(sampleXml);
  const plan=createPlan(root,{appTag:'2026102801',dryRun:false,includeStackDeploy:true},{RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true'});
  const index=plan.steps.findIndex(s=>s.key==='validate-game-release-resources');
  assert.ok(index>=0&&index<plan.steps.findIndex(s=>s.key==='git-fetch'));
  const step=plan.steps[index];assert.equal(step.notificationOnly,false);assert.equal(step.productionAction,false);
  const readOnlyResourceCheck=decodedScriptTree(step.command);
  assert.match(readOnlyResourceCheck,/MemAvailable/);
  assert.match(readOnlyResourceCheck,/game_release_resources=PASS/);
  assert.doesNotMatch(readOnlyResourceCheck,/meelok|docker|python3/);
  const deploy=decodedScriptTree(plan.steps.find(s=>s.key==='deploy-stack').command);
  assert.match(deploy,/memory headroom changed before game cutover/);
  assert.ok(deploy.indexOf('python3 - attempt --root')<deploy.indexOf('docker stack deploy'));
  for(const key of ['update-remote-compose','deploy-stack','game-config-compensation'])assert.match(decodedScriptTree(plan.steps.find(s=>s.key===key).command),/flock -n 9/);
});

test('proven pre-submit failure compensates config without service rollback or SQL; unknown fails closed',async()=>{
  for(const scenario of ['memory','update-failure','lost-output','compensation-failure','attempted']){
    const root=tempProject(sampleXml),base=testCommandRunner(),commands=[];
    const result=await executePlan(root,{appTag:'2026102801',dryRun:false,includeStackDeploy:true},{RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE:'true',RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE:'true',RELEASE_PUBLISHER_HISTORY_FILE:path.join(root,'history.json')},{runCommand:async(...args)=>{
      const script=decodedScriptTree(args[1]);commands.push(script);
      if(scenario==='update-failure'&&script.includes('python3 - prepare --root'))throw Error('fixture prepare transport lost after write');
      if(script.includes('memory headroom changed before game cutover'))throw Error('fixture deploy rejected');
      if(script.includes('python3 - compensate --root')){
        if(scenario==='compensation-failure')throw Error('fixture compensation write denied');
        if(scenario==='lost-output')return '';
        const id=script.match(/--transaction '([a-f0-9-]{36})'/)[1];
        return `game_deploy_transaction=${scenario==='attempted'?'ATTEMPTED':'NOT_SUBMITTED_RESTORED'} id=${id}\n`;
      }
      if(script.includes('automatic_rollback_evidence'))return 'automatic_rollback_decision=ROLLBACK_NOT_CONFIRMED\n';
      return base(...args);
    }});
    assert.equal(commands.some(s=>s.includes('automatic_rollback_validation=PASS')),false,scenario);
    assert.equal(commands.some(s=>/UPDATE t_toilet_market_listing/.test(s)),false,scenario);
    if(['memory','update-failure'].includes(scenario)){
      assert.equal(result.status,'ERROR',scenario);assert.equal(result.configurationCompensated,true);
      assert.equal(commands.some(s=>s.includes('automatic_rollback_evidence')),false);
      assert.ok(result.plan.steps.some(s=>s.status==='failed'&&s.key!=='game-config-compensation'));
    }else{
      assert.equal(result.status,'RECOVERY_REQUIRED',scenario);
      assert.equal(result.configurationCompensated,undefined);
      assert.equal(commands.some(s=>s.includes('automatic_rollback_evidence')),scenario==='attempted');
    }
  }
});


function seedPlugin(root,target) {
  const directory=path.join(root,'release/publisher');fs.mkdirSync(directory,{recursive:true});
  const plugin={apiVersion:'release-plugin/v1',pluginId:'fixture.'+target,target,
    coverage:[{paths:[],prefixes:['src/','integrations/','scripts/'],units:['fixture-source']}],
    units:[{id:'fixture-source',phase:'source',requires:['engine-context@1','node-test@1'],inputs:['fixture.test.mjs'],
      run:{kind:'node-test',entrypoints:['fixture.test.mjs'],protocol:'tap-v1',timeoutSeconds:15}}],migrations:[]};
  fs.writeFileSync(path.join(directory,target+'.json'),JSON.stringify(plugin));
  fs.writeFileSync(path.join(root,'fixture.test.mjs'),"import test from 'node:test';test('fixture',()=>{});");
}
function mockedPluginPrefix(cwd,command) {
  if(!command.includes('validate-plugin-candidate.mjs'))return '';
  const target=command.includes('--target forum')?'forum':'game';
  const plugin=JSON.parse(fs.readFileSync(path.join(cwd,'release/publisher/'+target+'.json'),'utf8'));
  return JSON.stringify({protocol:'release-candidate-validation/v1',state:'PASS',scope:'before-production',prefixState:'PREFIX_PASS',
    target,pluginId:plugin.pluginId,productionActions:0,selectedKeys:plugin.units.map(unit=>unit.id),migrationDeclarations:plugin.migrations,
    counts:{selected:plugin.units.length,executed:plugin.units.length,reused:0,pending:0}})+'\n';
}

function tempProject(_xml) {
  const root = temporaryDirectory('release-publisher-');
  require('./helpers/applicationPolicyFixture').seedApplicationPolicy(root);
  seedPlugin(root,'game');seedPlugin(root,'forum');
  fs.writeFileSync(path.join(root, 'mvnw.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n', 'utf8');
  const catalogSource = path.join(root, 'src', 'main', 'java', 'com', 'zly', 'hospital', 'service', 'catalog');
  fs.mkdirSync(catalogSource, {recursive: true});
  fs.writeFileSync(path.join(catalogSource, 'CatalogDatabaseUpgradeService.java'), [
    'package com.zly.hospital.service.catalog;',
    'public final class CatalogDatabaseUpgradeService {',
    '    private static final int MARKER_VERSION = 20;',
    '}',
    ''
  ].join('\n'), 'utf8');
  return root;
}

function tempGitProject() {
  const root = temporaryDirectory('release-publisher-git-');
  runGit(root, ['init']);
  fs.writeFileSync(path.join(root, 'README.md'), 'demo\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial commit']);
  return root;
}

function testCommandRunner(options = {}) {
  const commands = [];
  let attempted=false;
  const runner = async (cwd, command, env, onChunk) => {
    commands.push(command);
    if (options.failOnCommand === true) {
      throw new Error('simulated command failure');
    }
    if (options.failOnIncludes && decodedScriptTree(command).includes(options.failOnIncludes)) {
      throw new Error('simulated preflight failure');
    }
    const script=decodedScriptTree(command);
    if (script.includes('game_disaster_recovery_image=')) {
      const tag = script.match(/^tag=(hospital-backend:[\w.-]+)$/m)[1];
      const output = 'game_disaster_recovery_image=PASS tag=' + tag + ' id=sha256:' + 'a'.repeat(64) + ' remaining=1\n';
      onChunk?.(output);
      return output;
    }
    if(script.includes('python3 - attempt --root'))attempted=true;
    if(script.includes('python3 - compensate --root')){
      const id=script.match(/--transaction '([a-f0-9-]{36})'/)[1];
      const output=`game_deploy_transaction=${attempted?'ATTEMPTED':'NOT_SUBMITTED_RESTORED'} id=${id}\n`;
      onChunk?.(output);return output;
    }
    if (onChunk) {
      if (command.includes('git rev-parse HEAD')) {
        onChunk('0123456789abcdef0123456789abcdef01234567\n0123456\t2026-07-07 20:30:40 +0900\tRelease hospital backend\n');
      } else {
        onChunk('test_command=PASS\n');
      }
    }
    return 'test_command=PASS\n';
  };
  runner.commands = commands;
  return runner;
}

function recoveryDecisionTestRunner(decision, options = {}) {
  const commands = [];
  let attempted=false;
  const runner = async (cwd, command, env, onChunk) => {
    commands.push(command);
    const script = decodedScriptTree(command);
    if(script.includes('python3 - attempt --root'))attempted=true;
    if(script.includes('python3 - compensate --root')){
      const id=script.match(/--transaction '([a-f0-9-]{36})'/)[1];
      const output=`game_deploy_transaction=${attempted?'ATTEMPTED':'NOT_SUBMITTED_RESTORED'} id=${id}\n`;
      onChunk?.(output);return output;
    }
    if (options.failAt === 'cutover' && script.includes('game_cutover_observation=PASS')) {
      throw new Error('simulated failure before cutover commit');
    }
    if (options.failAt !== 'cutover' && script.includes('tradepool_release_validation=PASS')) {
      throw new Error('simulated post-deploy verification failure');
    }
    let output = 'test_command=PASS\n';
    if (script.includes('automatic_rollback_evidence')) {
      runner.decisionRuns += 1;
      if (decision === 'CHECK_ERROR') {
        throw new Error('simulated rollback decision check failure');
      }
      output = `automatic_rollback_decision=${decision}\n`;
    } else if (command.includes('evaluate-game-fatal-rollback.mjs')) {
      runner.fatalDecisionRuns += 1;
      if (decision === 'CHECK_ERROR') {
        throw new Error('simulated fatal rollback decision check failure');
      }
      output = `fatal_rollback_decision=${decision}\n`;
    } else if (script.includes('automatic_rollback_validation=PASS')) {
      runner.rollbackRuns += 1;
      output = 'automatic_rollback_validation=PASS\n';
    } else if (command.includes('git rev-parse HEAD')) {
      output = '0123456789abcdef0123456789abcdef01234567\n'
        + '0123456\t2026-07-07 20:30:40 +0900\tRelease hospital backend\n';
    }
    if (onChunk) onChunk(output);
    return output;
  };
  runner.commands = commands;
  runner.decisionRuns = 0;
  runner.fatalDecisionRuns = 0;
  runner.rollbackRuns = 0;
  return runner;
}

function releaseImpactGitProject() {
  const root = tempProject(sampleXml);
  runGit(root, ['init']);
  const runtimePath = path.join(root, 'src', 'main', 'resources', 'release-impact-demo.txt');
  fs.mkdirSync(path.dirname(runtimePath), {recursive: true});
  fs.writeFileSync(runtimePath, 'baseline\n', 'utf8');
  writeReleaseImpact(root, {
    assessmentId: '20260717-impact-baseline',
    coveredRuntimePaths: [],
    checklistDecision: 'checklist-updated'
  });
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline']);
  return root;
}

function releaseImpactPlanRequest(target, baseline, changedPaths, ignoredPaths) {
  return {
    appTag: '2026071705',
    dryRun: true,
    includeStackDeploy: true,
    gitCommit: target,
    changeAnalysis: {
      targets: {
        game: {
          changed: true,
          baselineCommit: baseline,
          changedPaths,
          ignoredPaths
        }
      }
    }
  };
}

function selectGameChecks(root, ...keys) {
  // A matching legacy path alone must never select the trade-pool check.
  const changedPaths = ['src/main/resources/templates/admin_tradepool.html'];
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy',
    'pre-deploy-checklist', 'final-runtime-check', 'verify-game-static-delivery', ...keys];
  writeReleaseImpact(root, {assessmentId: 'fixture-explicit-checks', coveredRuntimePaths: changedPaths,
    checklistDecision: 'checklist-updated', requiredChecks});
  const {changeAnalysis} = releaseImpactPlanRequest('latest', '', changedPaths, ['release/release-impact.json']);
  return {changeAnalysis};
}

function writeReleaseImpact(root, options) {
  for(const target of ['game','forum']){const file=path.join(root,'release/publisher/'+target+'.json');if(fs.existsSync(file)){const plugin=JSON.parse(fs.readFileSync(file,'utf8'));plugin.migrations=(options.coveredRuntimePaths||[]).filter(file=>file.endsWith('.sql'));fs.writeFileSync(file,JSON.stringify(plugin));}}
  const requiredChecks = (options.requiredChecks || [
    'test-game-backend',
    'verify-game-static-assets-predeploy',
    'pre-deploy-checklist',
    'final-runtime-check',
    'verify-game-static-delivery'
  ]).map(stepKey => ({
    stepKey,
    reason: `检查 ${stepKey} 能够覆盖本次发布影响并提供失败证据`
  }));
  const document = {
    schemaVersion: 1,
    assessmentId: options.assessmentId,
    summary: '记录本次运行代码和数据库变化的发布影响与自动检查范围',
    targets: {
      game: {
        checklistDecision: options.checklistDecision,
        riskLevel: options.riskLevel || 'medium',
        codeImpact: '评估目标提交中的游戏运行代码变化及其生产发布风险',
        databaseImpact: options.databaseImpact || 'none',
        coveredRuntimePaths: options.coveredRuntimePaths,
        requiredChecks
      },
      forum: {
        checklistDecision: options.forumChecklistDecision || 'existing-checks-sufficient',
        riskLevel: options.forumRiskLevel || 'low',
        codeImpact: options.forumCodeImpact || '本次评估没有论坛运行代码变化，保留论坛发布基础检查',
        databaseImpact: options.forumDatabaseImpact || 'none',
        coveredRuntimePaths: options.forumCoveredRuntimePaths || [],
        requiredChecks: [
          {stepKey: 'validate-forum-source', reason: '论坛源码发布前必须执行契约测试和脚本语法检查'},
          {stepKey: 'forum-preflight', reason: '论坛切换前必须检查当前容器、数据库和备份条件'},
          {stepKey: 'final-runtime-check', reason: '论坛切换后必须验证运行镜像、扩展、Secret 和公网状态'}
        ]
      }
    }
  };
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir, {recursive: true});
  fs.writeFileSync(path.join(releaseDir, 'release-impact.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function runGit(cwd, args) {
  const result = require('node:child_process').spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function assertStepType(plan, key, actionType, productionAction) {
  const step = plan.steps.find(item => item.key === key);
  assert.ok(step, `missing step ${key}`);
  assert.equal(step.actionType, actionType);
  assert.equal(step.productionAction, productionAction);
}

function tempJetBrainsOptions() {
  const optionsDir = temporaryDirectory('release-publisher-jetbrains-');
  fs.writeFileSync(path.join(optionsDir, 'remote-servers.xml'), `<application>
  <component name="RemoteServers">
    <remote-server name="GAME_PRD2" type="docker">
      <configuration>
        <entry contributedKey="DockerSshConnectionConfigurator.SshConfigId" value="e4ab0b3b-0051-4923-9eeb-03c207819bed" />
        <option name="customConfiguratorId" value="DockerSshConnectionConfigurator" />
        <option name="dockerComposeExePath" value="/usr/bin/docker" />
        <option name="dockerExePath" value="/usr/bin/docker" />
      </configuration>
    </remote-server>
  </component>
</application>`, 'utf8');
  fs.writeFileSync(path.join(optionsDir, 'sshConfigs.xml'), `<application>
  <component name="SshConfigs">
    <configs>
      <sshConfig host="92.113.124.185" id="e4ab0b3b-0051-4923-9eeb-03c207819bed" keyPath="C:\\workspace\\Secure\\sunsxaws.pem" port="22" username="root" />
    </configs>
  </component>
</application>`, 'utf8');
  return optionsDir;
}

function tempPublisherConfig() {
  const root = temporaryDirectory('release-publisher-config-');
  const configPath = path.join(root, 'release-publisher.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    gameStaticDelivery: {
      authTokenFile: 'C:\\ProgramData\\RHospital\\secrets\\game-smoke-token.txt'
    },
    dockerServers: {
      GAME_PRD2: {
        host: '92.113.124.185',
        username: 'root',
        port: '22',
        keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem',
        dockerExePath: '/usr/bin/docker',
        dockerComposeExePath: '/usr/bin/docker'
      },
      FORUM_PRD2: {
        host: '92.113.124.185',
        username: 'root',
        port: '22',
        keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem',
        dockerExePath: '/usr/bin/docker',
        dockerComposeExePath: '/usr/bin/docker'
      }
    },
    releaseTargets: {
      game: {dockerServer: 'GAME_PRD2'},
      forum: {dockerServer: 'FORUM_PRD2'}
    }
  }, null, 2), 'utf8');
  return configPath;
}

test('registers GAME_PRD2 and migration-specific runtime gates', () => {
  const configPath = tempPublisherConfig();
  const details = resolvePublisherDockerServerDetails('GAME_PRD2', {
    RELEASE_PUBLISHER_CONFIG: configPath
  });
  const core = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'releasePublisherCore.js'), 'utf8');

  assert.equal(details.resolved, true);
  assert.equal(details.host, '92.113.124.185');
  assert.match(core, /game-prd2-migration-readiness/);
  assert.match(core, /game-prd2-runtime-contract/);
  const policy=require('./helpers/applicationPolicyFixture').fixturePolicy();
  const probes=policy.read(policy.data.shellChecks.runtimeProbes);
  assert.match(core,/applicationShellCommands\('runtimeProbes'\)/);
  assert.match(probes, /stripe_unsigned/);
  assert.match(probes, /paddle_unsigned/);
});

test('owned publisher configuration and production adapters use current identifiers', () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const publisherConfig = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'release-publisher.config.json'), 'utf8'));
  const retiredIdentifiers = [
    ['SSH', '178'].join(''),
    ['178', '239', '117', '99'].join('.'),
    ['148', '135', '9', '123'].join('.')
  ];
  const tracked = ['release-publisher.config.json','src/releasePublisherCore.js','server.js'];
  assert.deepEqual(Object.keys(publisherConfig.dockerServers).sort(), ['FORUM_PRD2', 'GAME_PRD2']);
  assert.deepEqual(publisherConfig.releaseTargets, {
    game: {dockerServer: 'GAME_PRD2'},
    forum: {dockerServer: 'FORUM_PRD2'}
  });
  for (const relativePath of tracked) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath)).toString('utf8');
    for (const identifier of retiredIdentifiers) {
      assert.equal(contents.includes(identifier), false,
        `retired production identifier remains in ${relativePath}`);
    }
  }
});






test('reads committed source larger than the default child process buffer', () => {
  const root = tempProject(sampleXml);
  const sourcePath = path.join(root, 'src/main/java/com/zly/hospital/service/catalog/CatalogDatabaseUpgradeService.java');
  fs.writeFileSync(sourcePath, '// ' + 'x'.repeat(2 * 1024 * 1024) + '\nclass Catalog { static int MARKER_VERSION = 20; }\n');
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'large source']);
  const commit = runGit(root, ['rev-parse', 'HEAD']).trim();
  assert.equal(resolveCatalogSchemaVersion(root, commit), 20);
  assert.throws(() => resolveCatalogSchemaVersion(root, commit, () => ({error: {code:'ENOBUFS'}, status:null, stdout:'private source'})), /Git read failed: ENOBUFS/);
});









test('Steam release pairs ticket tests and runtime DNS validation with a guarded update', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const runtimePath = 'src/main/resources/release-impact-demo.txt';
  fs.writeFileSync(path.join(root, ...runtimePath.split('/')), 'steam auth change\n');
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy', 'pre-deploy-checklist',
    'final-runtime-check', 'verify-game-static-delivery', 'fixture-source', 'verify-game-steam-runtime'];
  writeReleaseImpact(root, {assessmentId: '20261002-steam-auth', coveredRuntimePaths: [runtimePath],
    checklistDecision: 'checklist-updated', requiredChecks});
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'steam gate']);
  const target = runGit(root, ['rev-parse', 'HEAD']).trim();
  const request = releaseImpactPlanRequest(target, baseline, [runtimePath], ['release/release-impact.json']);
  request.dockerServer = 'GAME_PRD2';
  const plan = createPlan(root, request);
  const step = key => plan.steps.find(item => item.key === key);
  const index = key => plan.steps.findIndex(item => item.key === key);
  assert.ok(step('validate-game-source-impact').command.includes('validate-plugin-candidate.mjs'));
  assert.ok(index('game-steam-preflight') < index('publish-image'));
  assert.ok(index('verify-game-steam-runtime') > index('final-runtime-check'));
  const preflight = decodedRemoteScript(step('game-steam-preflight').command);
  assert.match(preflight, /python3 -c/);
  assert.match(preflight, /runtime_container/);
  const update = decodedRemoteScript(step('update-remote-compose').command);
  assert.ok(update.indexOf('python3 -') < update.indexOf('python3 - prepare --root'));
  assert.match(update, /docker stack config -c -/);
  assert.match(decodedScriptTree(step('update-remote-compose').command), /game_service_snapshot=PASS/);
  assert.equal(update.includes('daemon.json'), false);
  const runtime = decodedRemoteScript(step('verify-game-steam-runtime').command);
  assert.match(runtime, /DNSConfig.Nameservers/);
  assert.match(runtime, /1.1.1.1/);
  assert.match(runtime, /127\[.\]0\[.\]0\[.\]11/);
  assert.match(runtime, /getent ahostsv4 hospital-backend/);
  assert.match(runtime, /steamcommunity.com\/openid\/login/);
  const probeMatch = runtime.match(/printf %s '?([A-Za-z0-9+/=]+)'? \| base64 -d \| python3/);
  const probe = Buffer.from(probeMatch[1], 'base64').toString('utf8');
  assert.match(probe, /partner.steam-api.com/);
  assert.match(probe, /"identity": "rhospital"/);
  assert.match(probe, /"docker", "exec", "-i", container, "curl"/);
  assert.match(probe, /capture_output=True/);
  assert.equal(probe.includes('print(key)'), false);
  assert.equal(probe.includes('str(error)'), false);
  assert(plan.config.pluginProtocol.unitIds.includes('fixture-source'));

});


test('guild B schedules observed A and archive prerequisites before the offline migration boundary', () => {
  const root = releaseImpactGitProject();
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const migrationPath = 'scripts/migration/20261025_finalize_guild_status.sql';
  const migration = "\\set ON_ERROR_STOP on\n-- Guild preparation A must be live and all old instances/transactions retired.\n-- Publisher owns that boundary and backup. Roll back application only to A.\n-- Historical weekly reward fields, guild audit timestamps and version stay intact.\nBEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '60s';\nLOCK TABLE t_guild IN SHARE ROW EXCLUSIVE MODE;\nCREATE TEMP TABLE codegraph_guild_before ON COMMIT DROP AS\nSELECT id, to_jsonb(g) - 'status' AS preserved FROM t_guild g;\nDO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM t_guild WHERE status IS NOT NULL AND status NOT IN ('ACTIVE','DISBANDED')) THEN\n    RAISE EXCEPTION 'Unexpected guild status; review before migration';\n  END IF;\nEND $$;\nUPDATE t_guild SET status = 'ACTIVE' WHERE status IS NULL;\nALTER TABLE t_guild ALTER COLUMN status SET DEFAULT 'ACTIVE', ALTER COLUMN status SET NOT NULL;\nCREATE INDEX IF NOT EXISTS idx_guild_status_level_id ON t_guild (status, level DESC, id ASC);\nDO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM t_guild g FULL JOIN codegraph_guild_before b USING (id)\n             WHERE g.id IS NULL OR b.id IS NULL OR (to_jsonb(g) - 'status') IS DISTINCT FROM b.preserved) THEN\n    RAISE EXCEPTION 'Guild migration changed a preserved field';\n  END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()\n       AND tablename = 't_guild' AND indexname = 'idx_guild_status_level_id'\n       AND indexdef LIKE '% USING btree (status, level DESC, id)') THEN\n    RAISE EXCEPTION 'Guild status index definition differs';\n  END IF;\nEND $$;\nCOMMIT;\nSELECT 'guild_status_b=PASS' AS result, count(*) FILTER (WHERE status = 'ACTIVE') AS active_guilds,\n       count(*) FILTER (WHERE status = 'DISBANDED') AS disbanded_guilds FROM t_guild;\n";
  fs.mkdirSync(path.dirname(path.join(root, migrationPath)), {recursive: true});
  fs.writeFileSync(path.join(root, migrationPath), migration);
  const requiredChecks = ['test-game-backend', 'verify-game-static-assets-predeploy', 'pre-deploy-checklist',
    'final-runtime-check', 'verify-game-static-delivery', 'apply-database-migrations',
    'verify-codegraph-prerequisites', 'codegraph-offline-cutover'];
  const save = checks => {
    writeReleaseImpact(root, {assessmentId: '20261025-guild-b-' + checks.length,
      coveredRuntimePaths: [migrationPath], checklistDecision: 'checklist-updated',
      databaseImpact: 'schema-change', requiredChecks: checks});
    runGit(root, ['add', '.']);
    runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'guild B fixture']);
    return releaseImpactPlanRequest(runGit(root, ['rev-parse', 'HEAD']).trim(), baseline,
      [migrationPath], ['release/release-impact.json']);
  };
  const plan = createPlan(root, save(requiredChecks));
  const index = key => plan.steps.findIndex(step => step.key === key);
  assert.ok(index('backup-game-release') < index('verify-codegraph-prerequisites'));
  assert.ok(index('verify-codegraph-prerequisites') < index('codegraph-offline-cutover'));
  assert.ok(index('codegraph-offline-cutover') < index('apply-database-migrations'));
  assertStepType(plan, 'verify-codegraph-prerequisites', 'remote-check', false);
  const localEvidence = plan.steps.filter(step => step.executable && /^verify-/.test(step.key) && step.actionType !== 'remote-check');
  assert.equal(localEvidence.some(step => step.key === 'verify-codegraph-prerequisites'), false);
  const localPreflight = plan.steps.find(step => step.key === 'validate-game-release-preflight');
  if (localPreflight) {
    const payload = localPreflight.command.match(/--checks-base64 '?([A-Za-z0-9+/=]+)'?/);
    assert.equal(JSON.parse(Buffer.from(payload[1], 'base64').toString('utf8')).checks.some(step => step.key === 'verify-codegraph-prerequisites'), false);
  }
  assertStepType(plan, 'codegraph-offline-cutover', 'production', true);
  assert.equal(plan.steps[index('codegraph-offline-cutover')].recoveryBoundary, true);
  assert.equal(index('technology-offline-cutover'), -1);
  assert.match(decodedRemoteScript(plan.steps[index('apply-database-migrations')].command), /codegraph-offline-backup/);
  for (const missing of ['verify-codegraph-prerequisites', 'codegraph-offline-cutover']) {
    assert.throws(() => createPlan(root, save(requiredChecks.filter(key => key !== missing))), /CodeGraph|codegraph/);
  }
  const technologyPaths = require('../src/gameTechnologyFormatCutover').MIGRATIONS;
  for(const file of technologyPaths) fs.writeFileSync(path.join(root,file), "\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '60s';\nSELECT 1;\nCOMMIT;\nSELECT 1;\n");
  const mixed = save(requiredChecks);
  mixed.changeAnalysis.targets.game.changedPaths.push(...technologyPaths);
  assert.throws(()=>createPlan(root,mixed), /Guild B requires an already prepared A predecessor/);
  for(const file of technologyPaths) fs.unlinkSync(path.join(root,file));
  fs.writeFileSync(path.join(root, migrationPath), migration + '\nALTER TABLE t_hospitals ALTER COLUMN name SET NOT NULL;\n');
  assert.throws(() => createPlan(root, save(requiredChecks)), /compatible|兼容|NOT NULL|destructive/i);
});
