const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createPlan,
  DEFAULT_REMOTE_COMPOSE_DIR,
  defaultProjectRoot,
  executePlan,
  resolveDockerContextDetails,
  resolveIdeaDockerServerDetails,
  parseSshGOutput,
  parseIdeaRunConfig,
  proposeNextTag,
  readReleaseHistory,
  saveTag,
  updateIdeaRunConfigTag,
  validateTag,
  validateGitRef
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
  const now = new Date(2026, 6, 7);

  assert.equal(proposeNextTag('2026070701', now), '2026070702');
  assert.equal(proposeNextTag('2026070609', now), '2026070701');
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
  assert.equal(plan.gitMode, 'latest');
  assert.equal(plan.config.executionEnabled, false);
  assert.equal(plan.config.dockerContextResolution.note, '已跳过 Docker context 解析');
  assert.ok(plan.steps.some(step => step.key === 'git-status-before-update'
    && step.command.includes('git status --short --branch')));
  assert.ok(plan.steps.some(step => step.key === 'git-fetch'
    && step.command === 'git fetch --prune origin'));
  assert.ok(plan.steps.some(step => step.key === 'git-update'
    && step.command === 'git pull --ff-only'));
  assert.ok(plan.steps.some(step => step.key === 'compile-artifact'
    && step.command.includes('docker --context SSH178 build --target build')
    && step.command.includes('hospital-backend:2026070702-buildcheck')));
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes('docker --context SSH178 build')
    && step.command.includes('-t hospital-backend:2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'publish-image'
    && step.command.includes('docker --context SSH178 image inspect hospital-backend:2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'read-remote-compose'
    && step.command.includes(`cd ${DEFAULT_REMOTE_COMPOSE_DIR}`)));
  assert.ok(plan.steps.some(step => step.key === 'update-remote-compose'
    && step.command.includes('sed -i -E')
    && step.command.includes('hospital-backend:')
    && step.command.includes('2026070702')));
  assert.ok(plan.steps.some(step => step.key === 'deploy-stack'
    && step.command.includes('docker stack deploy -c docker-compose.yml hospital_stack')));
  assert.ok(plan.steps.every(step => step.summary && step.validation && step.status === 'pending'));
  assert.ok(plan.steps.some(step => step.key === 'final-runtime-check'
    && step.finalCheck
    && step.validation.includes('hospital-backend:2026070702')));
});

test('creates specified Git ref update plan', () => {
  const root = tempProject(sampleXml);
  const plan = createPlan(root, {
    appTag: '2026070702',
    dryRun: true,
    gitMode: 'ref',
    gitRef: 'origin/release/20260707',
    dockerContext: 'SSH178',
    includeStackDeploy: false
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true'
  });

  assert.equal(plan.gitMode, 'ref');
  assert.equal(plan.gitRef, 'origin/release/20260707');
  assert.ok(plan.steps.some(step => step.key === 'git-update'
    && step.title === '切换到指定代码'
    && step.command === 'git checkout origin/release/20260707'));
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
  assert.ok(plan.steps.some(step => step.command.includes('cd /opt/1panel/docker/compose/hospital-stack')));
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

test('resolves IDEA Docker Server and uses ssh docker host command target', () => {
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
  assert.equal(plan.config.dockerCommandTarget.mode, 'host');
  assert.equal(plan.config.dockerCommandTarget.host, 'ssh://root@178.239.117.99:22');
  assert.ok(plan.steps.some(step => step.key === 'build-image'
    && step.command.includes("docker -H 'ssh://root@178.239.117.99:22' build")));
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

test('execute without dry run is blocked before mutating file when execution is not enabled', async () => {
  const root = tempProject(sampleXml);
  const configPath = path.join(root, '.run', '148.135.9.123.run.xml');
  const historyPath = path.join(root, 'history.json');
  const result = await executePlan(root, {
    appTag: '2026070702',
    dryRun: false,
    dockerContext: 'SSH178',
    includeStackDeploy: true
  }, {
    RELEASE_PUBLISHER_DISABLE_SSH_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_DOCKER_CONTEXT_RESOLVE: 'true',
    RELEASE_PUBLISHER_DISABLE_IDEA_DOCKER_RESOLVE: 'true',
    RELEASE_PUBLISHER_HISTORY_FILE: historyPath
  });

  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.logs.includes('RELEASE_PUBLISHER_ALLOW_EXECUTE is not true'));
  assert.equal(fs.readFileSync(configPath, 'utf8'), sampleXml);
  const history = readReleaseHistory(root, 5, {RELEASE_PUBLISHER_HISTORY_FILE: historyPath});
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'BLOCKED');
  assert.equal(history[0].completedStepCount, 0);
});

test('rejects invalid app tag', () => {
  assert.throws(() => validateTag('20260707;rm'), /APP_TAG/);
});

test('rejects invalid git ref', () => {
  assert.throws(() => validateGitRef('origin/master;rm'), /Git ref/);
  assert.throws(() => validateGitRef('../master'), /Git ref/);
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

function tempProject(xml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-'));
  const runDir = path.join(root, '.run');
  fs.mkdirSync(runDir, {recursive: true});
  fs.writeFileSync(path.join(runDir, '148.135.9.123.run.xml'), xml, 'utf8');
  return root;
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
