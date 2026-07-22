const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.RELEASE_PUBLISHER_TEST_MODE = 'true';

const {
  createPlan,
  DEFAULT_REMOTE_COMPOSE_DIR,
  DEFAULT_FORUM_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  executePlan,
  resolveDockerContextDetails,
  resolvePublisherDockerServerDetails,
  resolveIdeaDockerServerDetails,
  listGitBranches,
  listGitCommits,
  refreshGitRefs,
  parseSshGOutput,
  parseIdeaRunConfig,
  readReleaseConfig,
  proposeNextTag,
  readReleaseHistory,
  readReleaseHistoryPage,
  deleteReleaseHistoryEntry,
  clearReleaseHistory,
  appendReleaseHistory,
  buildHistoryEntry,
  saveTag,
  updateIdeaRunConfigTag,
  validateTag,
  validateGitBranch,
  validateGitCommit,
  resolveCatalogSchemaVersion,
  analyzeReleaseChanges,
  assertReleaseTargetChanged,
  readRemoteComposeImageTag
} = require('../src/releasePublisherCore');

const sampleXml = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="148.135.9.123" type="docker-deploy" factoryName="dockerfile" server-name="SSH178">
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
              <option name="value" value="148.135.9.123" />
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
  const match = String(command).match(/printf %s "([0-9A-Za-z+/=]+)" \| base64 -d \| (?:bash|sh)/);
  assert.ok(match, `command does not contain an encoded remote script: ${command}`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

function decodedScriptTree(command) {
  const decoded = [];
  const pending = [String(command)];
  const pattern = /printf %s ["']([0-9A-Za-z+/=]+)["'] \| base64 -d/g;
  while (pending.length > 0) {
    const value = pending.shift();
    decoded.push(value);
    for (const match of value.matchAll(pattern)) {
      const child = Buffer.from(match[1], 'base64').toString('utf8');
      if (!decoded.includes(child) && !pending.includes(child)) pending.push(child);
    }
  }
  return decoded.join('\n');
}

test('parses IDEA Docker run config release values', () => {
  const config = parseIdeaRunConfig(sampleXml);

  assert.equal(config.serverName, 'SSH178');
  assert.equal(config.imageTag, 'hospital-backend:2026070701');
  assert.equal(config.appTag, '2026070701');
  assert.equal(config.hostIp, '148.135.9.123');
  assert.equal(config.volumeHostPath, '/usr/local/software/rhospital');
  assert.equal(config.buildOnly, true);
});

test('suggests next tag from current date and sequence', () => {
  const now = new Date(2026, 6, 9);

  assert.equal(proposeNextTag('2026070809', now), '20260709');
  assert.equal(proposeNextTag('20260709', now), '2026070901');
  assert.equal(proposeNextTag('hospital-backend:20260709', now), '2026070901');
  assert.equal(proposeNextTag(['20260708', '2026070901'], now), '2026070902');
  assert.equal(proposeNextTag(['20260710'], now), '2026070901');
});

test('updates image tag and APP_TAG together', () => {
  const updated = updateIdeaRunConfigTag(sampleXml, 'hospital-backend:2026070702', '2026070702');

  assert.match(updated, /imageTag" value="hospital-backend:2026070702"/);
  assert.match(updated, /value="APP_TAG"[\s\S]*?name="value" value="2026070702"/);
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
    appTag: '2026070702',
    dryRun: true,
    dockerContext: 'SSH178',
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
    && step.command.includes('e54c5fba27b79b7d13ea9993e02eedf830875733')
    && step.command.includes('ForumSsoController.java')
    && step.command.includes('ForumSsoDatabaseUpgradeService.java')));
  assert.ok(plan.steps.some(step => step.key === 'test-game-backend'
    && step.command === '.\\mvnw.cmd -q test'));
  assert.ok(plan.steps.some(step => step.key === 'compile-artifact'
    && step.command.includes('docker build --target build')
    && !step.command.includes('-H')
    && !step.command.includes('--context')
    && step.command.includes('hospital-backend:2026070702-buildcheck')));
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('docker build')
    && !step.command.includes('-H')
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
    && step.command.includes('docker load -i')));
  assert.ok(plan.steps.some(step => step.key === 'read-remote-compose'
    && decodedRemoteScript(step.command).includes(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`)
    && decodedRemoteScript(step.command).includes('IMAGE_TAG')
    && decodedRemoteScript(step.command).includes('FORUM_SSO_ENABLED=true is missing or duplicated')
    && decodedRemoteScript(step.command).includes('FORUM_SSO_SECRET_FILE is missing or duplicated')));
  assert.ok(plan.steps.some(step => step.key === 'game-database-preflight'
    && decodedScriptTree(step.command).includes('RELEASE_DB_AUDIT_MODE=inspect')
    && decodedScriptTree(step.command).includes('RELEASE_EXPECTED_CATALOG_VERSION=20')
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
    && decodedRemoteScript(step.command).includes('sed -i -E')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\\1hospital-backend:2026070702#')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*-[[:space:]]*IMAGE_TAG=).*$#\\12026070702#')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*IMAGE_TAG:[[:space:]]*).*$#\\1"2026070702"#')
    && decodedRemoteScript(step.command).includes('forum_sso_secret declaration is missing or duplicated')
    && decodedRemoteScript(step.command).includes('docker stack config -c docker-compose.yml')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-stack'
    && decodedRemoteScript(step.command).includes('docker stack deploy -c docker-compose.yml hospital_stack')));
  assert.ok(plan.steps.every(step => step.summary && step.validation && step.status === 'pending'));
  assert.ok(plan.steps.some(step => step.key === 'compile-artifact'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702-buildcheck')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && decodedRemoteScript(step.validationCommand).includes('grep -nE')
    && decodedRemoteScript(step.validationCommand).includes('hospital-backend:2026070702')
    && decodedRemoteScript(step.validationCommand).includes('IMAGE_TAG=2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-stack'
    && decodedRemoteScript(step.validationCommand).includes('docker stack services hospital_stack')));
  assert.ok(plan.steps.some(step => step.key === 'final-runtime-check'
    && step.finalCheck
    && step.validation.includes('hospital-backend:2026070702')
    && decodedRemoteScript(step.command).includes('expected_image=hospital-backend:2026070702')
    && decodedRemoteScript(step.command).includes('expected_version=2026070702')
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
  assert.ok(plan.steps.some(step => step.key === 'verify-tradepool-release'
    && decodedScriptTree(step.command).includes('RELEASE_DB_AUDIT_MODE=verify')
    && decodedScriptTree(step.command).includes('RELEASE_EXPECTED_CATALOG_VERSION=20')
    && decodedScriptTree(step.command).includes('status.markerVersion() != EXPECTED_VERSION')
    && decodedScriptTree(step.command).includes('idx_toilet_tx_actor_id')
    && decodedScriptTree(step.command).includes('idx_toilet_tx_target_id')
    && decodedScriptTree(step.command).includes('Catalog marker must equal target version')
    && decodedScriptTree(step.command).includes('catalog database upgrade failed')
    && decodedScriptTree(step.command).includes('timeout 20 docker service logs')
    && decodedScriptTree(step.command).includes('--tail 2000')
    && decodedScriptTree(step.command).includes('/admin/tradepool')
    && decodedScriptTree(step.command).includes('/api/admin/toilet-market/pool')
    && decodedScriptTree(step.command).includes('tradepool_release_validation=PASS')));
  const gameRollback = plan.steps.find(step => step.key === 'game-rollback-command');
  assert.ok(gameRollback);
  assert.equal(gameRollback.executable, false);
  assert.ok(decodedScriptTree(gameRollback.command).includes('update t_toilet_market_listing set status='));
  assert.ok(decodedScriptTree(gameRollback.command).includes('automatic_rollback_validation=PASS'));
  assert.ok(decodedScriptTree(gameRollback.command).includes('.last-game-release-backup'));
  assertStepType(plan, 'git-status-before-update', 'local-check', false);
  assertStepType(plan, 'git-fetch', 'local-code', false);
  assertStepType(plan, 'git-update', 'local-code', false);
  assertStepType(plan, 'validate-game-sso-source', 'local-check', false);
  assertStepType(plan, 'pre-deploy-checklist', 'remote-check', false);
  assertStepType(plan, 'test-game-backend', 'local-check', false);
  assertStepType(plan, 'validate-release-input', 'local-check', false);
  assertStepType(plan, 'save-run-config', 'local-config', false);
  assertStepType(plan, 'compile-artifact', 'build', false);
  assertStepType(plan, 'build-image', 'build', false);
  assertStepType(plan, 'validate-game-image', 'build', false);
  assertStepType(plan, 'publish-image', 'production', true);
  assertStepType(plan, 'resolve-ssh-target', 'local-check', false);
  assertStepType(plan, 'read-remote-compose', 'remote-check', false);
  assertStepType(plan, 'game-database-preflight', 'remote-check', false);
  assertStepType(plan, 'backup-game-release', 'production', true);
  assertStepType(plan, 'update-remote-compose', 'production', true);
  assertStepType(plan, 'deploy-stack', 'production', true);
  assertStepType(plan, 'final-runtime-check', 'remote-check', false);
  assertStepType(plan, 'verify-tradepool-release', 'remote-check', false);
});

test('backs up and applies changed database migrations before switching the production image', () => {
  const root = tempProject(sampleXml);
  const migrationPath = 'scripts/migration/20260716_add_google_uid.sql';
  const absoluteMigration = path.join(root, ...migrationPath.split('/'));
  fs.mkdirSync(path.dirname(absoluteMigration), {recursive: true});
  fs.writeFileSync(absoluteMigration, [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "set local lock_timeout = '10s';",
    "set local statement_timeout = '120s';",
    'alter table t_directors add column if not exists google_uid varchar(128);',
    'commit;',
    "select count(*) from information_schema.columns where column_name = 'google_uid';",
    ''
  ].join('\n'), 'utf8');

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
  assert.match(plan.config.databaseMigrations[0].sha256, /^[0-9a-f]{64}$/);
  const backupStep = plan.steps.find(step => step.key === 'backup-game-release');
  const migrationStep = plan.steps.find(step => step.key === 'apply-database-migrations');
  const composeStep = plan.steps.find(step => step.key === 'update-remote-compose');
  const checklistStep = plan.steps.find(step => step.key === 'pre-deploy-checklist');
  assert.ok(backupStep);
  assert.ok(migrationStep);
  assert.ok(composeStep);
  assert.ok(checklistStep);
  assert.ok(plan.steps.indexOf(backupStep) < plan.steps.indexOf(migrationStep));
  assert.ok(plan.steps.indexOf(migrationStep) < plan.steps.indexOf(composeStep));
  assert.ok(plan.steps.indexOf(migrationStep) < plan.steps.indexOf(checklistStep));
  assert.ok(plan.steps.indexOf(checklistStep) < plan.steps.indexOf(composeStep));
  assert.match(decodedScriptTree(backupStep.command), /pg_dump -Fc/);
  assert.match(decodedScriptTree(backupStep.command), /hospital\.pre-migration\.dump/);
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
  assert.doesNotMatch(decodedScriptTree(migrationStep.command), /alter table t_directors add column/);
  assert.match(decodedScriptTree(migrationStep.command), /database_migrations_applied=1/);
  assert.match(decodedScriptTree(checklistStep.command), /pre_deploy_checklist=PASS/);
  assert.match(decodedScriptTree(checklistStep.command), /migration source image ID mismatch/);
  assertStepType(plan, 'apply-database-migrations', 'production', true);
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
    'pre-deploy-checklist',
    'final-runtime-check'
  ]);
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
    requiredChecks: ['test-game-backend', 'pre-deploy-checklist']
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
    forumChecklistDecision: 'existing-checks-sufficient'
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
  assert.ok(plan.steps.some(step => step.key === 'validate-release-impact-checklist'));
});

test('creates reusable forum compose release plan with backup validation and rollback evidence', () => {
  const root = tempProject(sampleXml);
  const config = readReleaseConfig(root, 'forum');
  const plan = createPlan(root, {
    releaseTarget: 'forum',
    appTag: '2026071501',
    dryRun: true,
    dockerContext: 'SSH178',
    remoteSshTarget: 'root@178.239.117.99',
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
  assert.equal(plan.steps.some(step => step.key === 'save-run-config'), false);
  assert.equal(plan.steps.some(step => step.key === 'compile-artifact'), false);
  assert.ok(plan.steps.some(step => step.key === 'validate-forum-source'
    && step.command.includes('ForumFlarumImageAssetTest,ForumDeploymentConfigTest')
    && step.command.includes('git status --porcelain --untracked-files=all -- integrations/flarum')
    && step.command.includes("bash -o pipefail -c 'git show HEAD:integrations/flarum/04-rhospital-secret.sh | bash -n'")
    && step.command.includes("bash -o pipefail -c 'git show HEAD:integrations/flarum/05-rhospital-env.sh | bash -n'")
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
  assert.ok(plan.steps.some(step => step.key === 'backup-forum-release'
    && decodedRemoteScript(step.command).includes('mysqldump --single-transaction')
    && decodedRemoteScript(step.command).includes('flarum-data.tar.gz')
    && decodedRemoteScript(step.command).includes('.last-forum-release-backup')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
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
  assert.equal(rollback.executable, false);
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
    dockerContext: 'SSH178',
    remoteSshTarget: 'root@178.239.117.99',
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
    dockerContext: 'SSH178',
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
    dockerContext: 'SSH178',
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
    dockerContext: 'SSH178',
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

test('uses explicit SSH target and remote compose directory in hot deploy plan', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    dockerContext: 'docker-prod',
    remoteSshTarget: 'root@148.135.9.123',
    remoteComposeDir: '/opt/1panel/docker/compose/hospital-stack',
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.config.dockerContext, 'docker-prod');
  assert.equal(plan.config.remoteSshTarget, 'root@148.135.9.123');
  assert.equal(plan.config.remoteComposeDir, '/opt/1panel/docker/compose/hospital-stack');
  assert.ok(plan.steps.some(step => step.command.includes("ssh 'root@148.135.9.123'")));
  assert.ok(plan.steps.some(step => step.command.includes('base64 -d | bash')
    && decodedRemoteScript(step.command).includes('cd /opt/1panel/docker/compose/hospital-stack')));
});

test('reads remote compose image tag through SSH output', () => {
  const calls = [];
  const result = readRemoteComposeImageTag({
    host: '178.239.117.99',
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
  const result = readRemoteComposeImageTag('root@178.239.117.99', DEFAULT_FORUM_REMOTE_COMPOSE_DIR,
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
  const parsed = parseSshGOutput(`host SSH178
user root
hostname 148.135.9.123
port 22
identityfile C:/Users/user/.ssh/id_ed25519
identityfile C:/Users/user/.ssh/id_rsa
identitiesonly yes`);

  assert.equal(parsed.user, 'root');
  assert.equal(parsed.hostname, '148.135.9.123');
  assert.equal(parsed.port, '22');
  assert.deepEqual(parsed.identityfile, [
    'C:/Users/user/.ssh/id_ed25519',
    'C:/Users/user/.ssh/id_rsa'
  ]);
  assert.equal(parsed.identitiesonly, 'yes');
});

test('resolves docker context inspect output for display', () => {
  const result = resolveDockerContextDetails('SSH178', {}, () => ({
    status: 0,
    stdout: JSON.stringify([{
      Name: 'SSH178',
      Metadata: {Description: 'prod docker'},
      Endpoints: {docker: {Host: 'ssh://root@148.135.9.123'}}
    }]),
    stderr: ''
  }));

  assert.equal(result.resolved, true);
  assert.equal(result.description, 'prod docker');
  assert.equal(result.dockerEndpoint, 'ssh://root@148.135.9.123');
});

test('reports missing docker context for display', () => {
  const result = resolveDockerContextDetails('SSH178', {}, () => ({
    status: 1,
    stdout: '',
    stderr: 'context "SSH178": context not found'
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
    dockerContext: 'SSH178',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: optionsDir
  });

  assert.equal(plan.config.ideaDockerServerResolution.resolved, true);
  assert.equal(plan.config.ideaDockerServerResolution.host, '178.239.117.99');
  assert.equal(plan.config.ideaDockerServerResolution.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.equal(plan.config.dockerCommandTarget.mode, 'local');
  assert.equal(plan.config.dockerCommandTarget.description, '本机 Docker');
  assert.equal(plan.config.remoteImageTarget.host, '178.239.117.99');
  assert.equal(plan.config.remoteImageTarget.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('docker build')
    && !step.command.includes('178.239.117.99')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes("scp -i 'C:\\workspace\\Secure\\sunsxaws.pem' -P 22")
    && step.command.includes("ssh -i 'C:\\workspace\\Secure\\sunsxaws.pem' -p 22 'root@178.239.117.99'")
    && step.command.includes('docker load -i')));
});

test('resolves release Docker Server from repository config without JetBrains options', () => {
  const root = tempProject(sampleXml);
  const configPath = tempPublisherConfig();
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    dockerContext: 'SSH178',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_CONFIG: configPath,
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: path.join(os.tmpdir(), 'missing-jetbrains-options')
  });

  assert.equal(plan.config.ideaDockerServerResolution.source, 'release-publisher.config.json');
  assert.equal(plan.config.ideaDockerServerResolution.resolved, true);
  assert.equal(plan.config.remoteImageTarget.host, '178.239.117.99');
  assert.equal(plan.config.remoteImageTarget.keyPath, 'C:\\workspace\\Secure\\sunsxaws.pem');
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes("scp -i 'C:\\workspace\\Secure\\sunsxaws.pem' -P 22")
    && step.command.includes("ssh -i 'C:\\workspace\\Secure\\sunsxaws.pem' -p 22 'root@178.239.117.99'")));
});

test('resolves repository Docker Server details directly', () => {
  const configPath = tempPublisherConfig();
  const result = resolvePublisherDockerServerDetails('SSH178', {
    RELEASE_PUBLISHER_CONFIG: configPath
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'release-publisher.config.json');
  assert.equal(result.dockerHost, 'ssh://root@178.239.117.99:22');
});

test('resolves IDEA Docker Server details directly', () => {
  const optionsDir = tempJetBrainsOptions();
  const result = resolveIdeaDockerServerDetails('SSH178', {
    RELEASE_PUBLISHER_JETBRAINS_OPTIONS_DIR: optionsDir
  });

  assert.equal(result.resolved, true);
  assert.equal(result.sshConfigId, 'e4ab0b3b-0051-4923-9eeb-03c207819bed');
  assert.equal(result.dockerExePath, '/usr/bin/docker');
  assert.equal(result.dockerHost, 'ssh://root@178.239.117.99:22');
});

test('save tag dry run returns preview and does not mutate file', () => {
  const root = tempProject(sampleXml);
  const configPath = path.join(root, '.run', '148.135.9.123.run.xml');
  const result = saveTag(root, {appTag: '2026070702', dryRun: true});

  assert.equal(result.status, 'DRY_RUN');
  assert.match(result.preview, /2026070702/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), sampleXml);
});

test('execute dry run marks every pipeline step checked without mutating files or history', async () => {
  const root = tempProject(sampleXml);
  const configPath = path.join(root, '.run', '148.135.9.123.run.xml');
  const historyPath = path.join(root, 'history.json');
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: true,
    dockerContext: 'SSH178',
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'DRY_RUN');
  assert.ok(result.completedStepKeys.length >= 1);
  assert.ok(result.plan.steps.every(step => step.status === 'dry-run-checked'));
  assert.equal(fs.readFileSync(configPath, 'utf8'), sampleXml);
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 0);
});

test('forum dry run returns its target without changing config or history', async () => {
  const root = tempProject(sampleXml);
  const configPath = path.join(root, '.run', '148.135.9.123.run.xml');
  const historyPath = path.join(root, 'forum-history.json');
  const result = await executePlan(root, {
    releaseTarget: 'forum',
    appTag: '2026071501',
    dryRun: true,
    dockerContext: 'SSH178',
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'DRY_RUN');
  assert.equal(result.plan.releaseTarget, 'forum');
  assert.equal(result.plan.steps.some(step => step.key === 'save-run-config'), false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), sampleXml);
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
    dockerContext: 'SSH178',
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
    dockerContext: 'SSH178',
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

test('execute without dry run runs without a separate environment authorization flag', async () => {
  const root = tempProject(sampleXml);
  const configPath = path.join(root, '.run', '148.135.9.123.run.xml');
  const historyPath = path.join(root, 'history.json');
  const runCommand = testCommandRunner();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    dockerContext: 'SSH178',
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
  assert.match(fs.readFileSync(configPath, 'utf8'), /2026070702/);
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
    dockerContext: 'SSH178',
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

test('test mode blocks operating-system publication commands when no runner is injected', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    dockerContext: 'SSH178',
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
    dockerContext: 'SSH178',
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

test('runtime source exposes automatic recovery and visible active job heartbeat states', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'releasePublisherCore.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(core, /status: 'ROLLED_BACK'/);
  assert.match(core, /status: 'RECOVERY_REQUIRED'/);
  assert.match(core, /automatic_rollback_validation=PASS/);
  assert.match(core, /stepRemainingSeconds/);
  assert.match(app, /value === 'RECOVERING'/);
  assert.match(app, /距超时约/);
  assert.match(server, /'ROLLED_BACK', 'RECOVERY_REQUIRED'/);
});

test('release history supports pagination and deletion', () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  for (let index = 1; index <= 12; index += 1) {
    const plan = createPlan(root, {
      appTag: `20260707${String(index).padStart(2, '0')}`,
      dryRun: true,
      dockerContext: 'SSH178',
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

test('lists branches and commits from a git project', () => {
  const root = tempGitProject();
  runGit(root, ['checkout', '-b', 'release/demo']);
  fs.writeFileSync(path.join(root, 'release.txt'), 'release\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'release commit']);

  const branches = listGitBranches(root, {});
  assert.ok(branches.branches.some(branch => branch.name === 'release/demo' && branch.current));

  const commits = listGitCommits(root, 'release/demo', 10);
  assert.equal(commits.branch, 'release/demo');
  assert.ok(commits.commits.length >= 1);
  assert.match(commits.commits[0].subject, /release commit/);
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

test('step backgrounds communicate execution status instead of final-check type', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.doesNotMatch(css, /\.flow-node\.final-node\s*\{[^}]*background\s*:/s);
  assert.doesNotMatch(css, /\.step\.final-step\s*\{[^}]*background\s*:/s);
  assert.match(css, /\.flow-node\s*\{[^}]*background:\s*#fffdf6;/s);
  assert.match(css, /\.step\s*\{[^}]*background:\s*#fffdf6;/s);
  assert.match(css, /\.flow-node\.running\s*\{\s*background:\s*var\(--lavender\);/);
  assert.match(css, /\.step\.running\s*\{\s*background:\s*var\(--lavender\);/);
  assert.match(css, /\.flow-node\.checked\.final-node\s*\{\s*background:\s*var\(--mint\);/);
  assert.match(css, /\.step\.checked\s*\{\s*background:\s*var\(--mint\);/);
  assert.match(css, /\.flow-node\.failed\s*\{\s*background:\s*#ffd8cf;/);
  assert.match(css, /\.step\.failed\s*\{\s*background:\s*#ffd8cf;/);
  assert.match(app, /const done = status === 'done' \|\| status === 'dry-run-checked';[\s\S]*item\.className = `step \$\{done \? 'checked' : ''\}/);
});

test('plan loading and image labels distinguish target from production compose', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.doesNotMatch(html, />未生成</);
  assert.match(html, /本次计划发布镜像/);
  assert.match(html, /生产编排当前镜像/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /pipeline-loading/);
  assert.match(html, /本地发布配置镜像/);
  assert.match(html, /本地发布配置 APP_TAG/);
  assert.match(html, /Catalog 预期版本/);
  assert.match(html, /id="publisher-version-panel"/);
  assert.match(html, /id="publisher-runtime-version"/);
  assert.match(html, /id="publisher-repository-version"/);
  assert.match(app, /catalogSchemaVersion\.textContent/);
  assert.match(app, /requestJson\('\/api\/version'\)/);
  assert.match(app, /version\.status/);
  assert.match(css, /\.publisher-version\.version-up_to_date/);
  assert.match(app, /productionImageFlow/);
  assert.match(app, /remoteOnlineResolved: remote.resolved/);
  assert.match(app, /remoteOnlineResolved: false/);
  assert.match(app, /renderProductionImage/);
  assert.match(app, /setStaticValue/);
  assert.match(css, /loading-spinner/);
  assert.match(css, /animation: refresh-spin 0.8s linear infinite/);
});

test('commit selector includes a refresh control wired to the git refresh endpoint', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.match(html, /id="git-refresh"/);
  assert.match(html, /aria-label="刷新提交列表"/);
  assert.match(app, /requestJson\('\/api\/git\/refresh', \{method: 'POST'\}\)/);
  assert.match(app, /gitRefresh\.addEventListener\('click'/);
  assert.match(css, /\.select-action-row\s*\{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 44px;/);
});

test('native Windows service runs the release console without an interactive window', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-release-console.ps1'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-windows-service.ps1'), 'utf8');
  const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-windows-service.ps1'), 'utf8');
  const uninstaller = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uninstall-windows-service.ps1'), 'utf8');
  const serviceHost = fs.readFileSync(path.join(__dirname, '..', 'service', 'RHospitalReleaseConsoleService.cs'), 'utf8');
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');

  assert.match(runner, /while \(\$true\)/);
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
  assert.match(serviceHost, /CreateProcessAsUser/);
  assert.match(serviceHost, /CreateNoWindow \| CreateSuspended \| CreateUnicodeEnvironment/);
  assert.match(serviceHost, /JobObjectLimitKillOnJobClose/);
  assert.match(serviceHost, /AssignProcessToJobObject/);
  assert.match(serviceHost, /identity\.Name, options\.ExpectedUser/);
  assert.match(serviceHost, /--bind-address/);
  assert.match(runner, /RELEASE_PUBLISHER_HOST = \$BindAddress/);
  assert.match(packageJson, /scripts\/install-windows-service\.ps1/);
  assert.doesNotMatch(packageJson, /install-startup-task\.ps1/);
});

test('release console exposes game and forum targets with target-aware API payloads', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(html, /id="release-target"/);
  assert.match(html, /id="change-analysis"/);
  assert.match(html, /option value="game">游戏后端<\/option>/);
  assert.match(html, /option value="forum">论坛<\/option>/);
  assert.match(html, /id="forum-image-mode"/);
  assert.match(html, /option value="build">构建并上传新镜像<\/option>/);
  assert.match(html, /option value="reuse">复用生产已有镜像<\/option>/);
  assert.match(html, /id="deploy-toggle-label"/);
  assert.match(app, /releaseTarget:\s*releaseTarget\.value/);
  assert.match(app, /forumImageMode:\s*forumImageMode\.value/);
  assert.match(app, /releaseChangedOnly:\s*true/);
  assert.match(app, /api\/changes/);
  assert.match(app, /recommendedTarget === 'game'/);
  assert.match(app, /function renderChangeAnalysis/);
  assert.match(app, /gitBranch\.disabled = reuseForumImage/);
  assert.match(app, /gitBranchField\.hidden = reuseForumImage/);
  assert.match(app, /将复用生产已有镜像/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.step-title\s*>\s*div,[\s\S]*?min-width:\s*0/);
  assert.match(css, /word-break:\s*break-all/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(app, /api\/config\?releaseTarget=/);
  assert.match(app, /执行论坛 Compose 发布/);
  assert.match(app, /function compactBranchLabel/);
  assert.match(app, /option\.title = branch\.name/);
  assert.match(app, /previousTarget !== config\.releaseTarget/);
  assert.match(server, /RELEASE_PUBLISHER_FORUM_REMOTE_COMPOSE_DIR/);
  assert.match(server, /pathname === '\/api\/version'/);
  assert.match(server, /capturePublisherRuntimeVersion/);
  assert.match(server, /assertReleaseTargetChanged/);
  assert.match(server, /gitCommit:\s*body\.gitCommit === 'latest'[\s\S]*?analysis\.targetCommit/);
});

function tempProject(xml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-'));
  const runDir = path.join(root, '.run');
  fs.mkdirSync(runDir, {recursive: true});
  fs.writeFileSync(path.join(runDir, '148.135.9.123.run.xml'), xml, 'utf8');
  fs.writeFileSync(path.join(root, 'mvnw.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-git-'));
  runGit(root, ['init']);
  fs.writeFileSync(path.join(root, 'README.md'), 'demo\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial commit']);
  return root;
}

function testCommandRunner(options = {}) {
  const commands = [];
  const runner = async (cwd, command, env, onChunk) => {
    commands.push(command);
    if (options.failOnCommand === true) {
      throw new Error('simulated command failure');
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

function writeReleaseImpact(root, options) {
  const requiredChecks = (options.requiredChecks || [
    'test-game-backend',
    'pre-deploy-checklist',
    'final-runtime-check'
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
        databaseImpact: 'none',
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
  const optionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-jetbrains-'));
  fs.writeFileSync(path.join(optionsDir, 'remote-servers.xml'), `<application>
  <component name="RemoteServers">
    <remote-server name="SSH178" type="docker">
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
      <sshConfig host="178.239.117.99" id="e4ab0b3b-0051-4923-9eeb-03c207819bed" keyPath="C:\\workspace\\Secure\\sunsxaws.pem" port="22" username="root" />
    </configs>
  </component>
</application>`, 'utf8');
  return optionsDir;
}

function tempPublisherConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-config-'));
  const configPath = path.join(root, 'release-publisher.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    dockerServers: {
      SSH178: {
        host: '178.239.117.99',
        username: 'root',
        port: '22',
        keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem',
        dockerExePath: '/usr/bin/docker',
        dockerComposeExePath: '/usr/bin/docker'
      }
    }
  }, null, 2), 'utf8');
  return configPath;
}
