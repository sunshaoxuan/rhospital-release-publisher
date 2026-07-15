const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes('docker save -o')
    && step.command.includes('scp')
    && step.command.includes('docker load -i')));
  assert.ok(plan.steps.some(step => step.key === 'read-remote-compose'
    && decodedRemoteScript(step.command).includes(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`)
    && decodedRemoteScript(step.command).includes('IMAGE_TAG')));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && step.command.includes('base64 -d | bash')
    && decodedRemoteScript(step.command).includes('sed -i -E')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*image:[[:space:]]*)hospital-backend:[^[:space:]]+#\\1hospital-backend:2026070702#')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*-[[:space:]]*IMAGE_TAG=).*$#\\12026070702#')
    && decodedRemoteScript(step.command).includes('s#^([[:space:]]*IMAGE_TAG:[[:space:]]*).*$#\\1"2026070702"#')
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
    && decodedRemoteScript(step.command).includes('active_other_count')
    && decodedRemoteScript(step.command).includes('rollout_validation=PASS')));
  assertStepType(plan, 'git-status-before-update', 'local-check', false);
  assertStepType(plan, 'git-fetch', 'local-code', false);
  assertStepType(plan, 'git-update', 'local-code', false);
  assertStepType(plan, 'validate-release-input', 'local-check', false);
  assertStepType(plan, 'save-run-config', 'local-config', false);
  assertStepType(plan, 'compile-artifact', 'build', false);
  assertStepType(plan, 'build-image', 'build', false);
  assertStepType(plan, 'publish-image', 'production', true);
  assertStepType(plan, 'resolve-ssh-target', 'local-check', false);
  assertStepType(plan, 'read-remote-compose', 'remote-check', false);
  assertStepType(plan, 'update-remote-compose', 'production', true);
  assertStepType(plan, 'deploy-stack', 'production', true);
  assertStepType(plan, 'final-runtime-check', 'remote-check', false);
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
    && step.command.includes('git diff --quiet HEAD -- integrations/flarum/04-rhospital-secret.sh integrations/flarum/05-rhospital-env.sh')
    && step.command.includes("bash -o pipefail -c 'git show HEAD:integrations/flarum/04-rhospital-secret.sh | bash -n'")
    && step.command.includes("bash -o pipefail -c 'git show HEAD:integrations/flarum/05-rhospital-env.sh | bash -n'")
    && !step.command.includes('bash -n integrations/flarum/')));
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('-f integrations/flarum/Dockerfile')
    && step.command.includes('-t rhospital/flarum-sso:2026071501 integrations/flarum')));
  assert.ok(plan.steps.some(step => step.key === 'validate-forum-image'
    && decodedRemoteScript(step.command).includes('forum_image_validation=PASS')
    && decodedRemoteScript(step.command).includes('/run/rhospital-secrets/forum_sso_secret')));
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
  const commit = '0123456789abcdef0123456789abcdef01234567';
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

test('execute dry run marks every pipeline step checked without mutating file', async () => {
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
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'DRY_RUN');
  assert.equal(history[0].imageTag, 'hospital-backend:2026070702');
  assert.equal(history[0].completedStepCount, result.plan.steps.length);
});

test('forum dry run records target and never changes the game IDEA release config', async () => {
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
  assert.equal(history.length, 1);
  assert.equal(history[0].releaseTarget, 'forum');
  assert.equal(history[0].releaseTargetLabel, '论坛');
  assert.equal(history[0].imageTag, 'rhospital/flarum-sso:2026071501');
});

test('execute runs validation commands after executable steps', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const commandBin = tempCommandBin();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    gitBranch: 'master',
    dockerContext: 'SSH178',
    includeStackDeploy: false
  }, {
    PATH: `${commandBin}${path.delimiter}${process.env.PATH || ''}`,
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'EXECUTED');
  assert.ok(result.logs.some(line => line.includes('[VALIDATE] docker image inspect hospital-backend:2026070702-buildcheck')));
  assert.ok(result.logs.some(line => line.includes('[VALIDATE] docker image inspect hospital-backend:2026070702')));
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history[0].status, 'EXECUTED');
  assert.ok(history[0].stepSummary.some(step => step.key === 'build-image'
    && step.validationCommand.includes('docker image inspect hospital-backend:2026070702')));
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
  const commandBin = tempCommandBin();
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    dockerContext: 'SSH178',
    includeStackDeploy: false
  }, {
    PATH: `${commandBin}${path.delimiter}${process.env.PATH || ''}`,
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
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
});

test('execute can be cancelled before running commands', async () => {
  const root = tempProject(sampleXml);
  const historyPath = path.join(root, 'history.json');
  const controller = new AbortController();
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
    signal: controller.signal
  });

  assert.equal(result.status, 'CANCELLED');
  assert.ok(result.logs.some(line => line.includes('CANCELLED')));
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history[0].status, 'CANCELLED');
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

test('completed final flow node uses the same success background as other completed nodes', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.flow-node\.checked\.final-node\s*\{\s*background:\s*var\(--mint\);/);
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

test('startup task restores the release console after process and standby exits', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-release-console.ps1'), 'utf8');
  const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-startup-task.ps1'), 'utf8');

  assert.match(runner, /while \(\$true\)/);
  assert.match(runner, /release console exited with code \$exitCode; restarting in \$RestartDelaySeconds seconds/);
  assert.match(runner, /Start-Sleep -Seconds \$RestartDelaySeconds/);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(installer, /\$triggers = @\(\$logonTrigger, \$watchdogTrigger\)/);
  assert.match(installer, /-AllowStartIfOnBatteries/);
  assert.match(installer, /-DontStopIfGoingOnBatteries/);
  assert.match(installer, /-StartWhenAvailable/);
});

test('release console exposes game and forum targets with target-aware API payloads', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(html, /id="release-target"/);
  assert.match(html, /option value="game">游戏后端<\/option>/);
  assert.match(html, /option value="forum">论坛<\/option>/);
  assert.match(html, /id="forum-image-mode"/);
  assert.match(html, /option value="build">构建并上传新镜像<\/option>/);
  assert.match(html, /option value="reuse">复用生产已有镜像<\/option>/);
  assert.match(html, /id="deploy-toggle-label"/);
  assert.match(app, /releaseTarget:\s*releaseTarget\.value/);
  assert.match(app, /forumImageMode:\s*forumImageMode\.value/);
  assert.match(app, /gitBranch\.disabled = reuseForumImage/);
  assert.match(app, /gitBranchField\.hidden = reuseForumImage/);
  assert.match(app, /将复用生产已有镜像/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(app, /api\/config\?releaseTarget=/);
  assert.match(app, /执行论坛 Compose 发布/);
  assert.match(app, /function compactBranchLabel/);
  assert.match(app, /option\.title = branch\.name/);
  assert.match(app, /previousTarget !== config\.releaseTarget/);
  assert.match(server, /RELEASE_PUBLISHER_FORUM_REMOTE_COMPOSE_DIR/);
});

function tempProject(xml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-'));
  const runDir = path.join(root, '.run');
  fs.mkdirSync(runDir, {recursive: true});
  fs.writeFileSync(path.join(runDir, '148.135.9.123.run.xml'), xml, 'utf8');
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

function tempCommandBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-bin-'));
  fs.writeFileSync(path.join(root, 'git.cmd'), [
    '@echo off',
    'if "%1"=="status" echo ## master...origin/master',
    'if "%1"=="rev-parse" echo 0123456789abcdef0123456789abcdef01234567',
    'if "%1"=="log" echo 0123456\t2026-07-07 20:30:40 +0900\tRelease hospital backend',
    'exit /b 0',
    ''
  ].join('\r\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'docker.cmd'), [
    '@echo off',
    'echo docker %*',
    'exit /b 0',
    ''
  ].join('\r\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'scp.cmd'), [
    '@echo off',
    'echo scp %*',
    'exit /b 0',
    ''
  ].join('\r\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'ssh.cmd'), [
    '@echo off',
    'echo ssh %*',
    'exit /b 0',
    ''
  ].join('\r\n'), 'utf8');
  return root;
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
