const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const DEFAULT_RUN_CONFIG = '.run/148.135.9.123.run.xml';
const DEFAULT_IMAGE_NAME = 'hospital-backend';
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml';
const DEFAULT_STACK_NAME = 'hospital_stack';
const TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

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
  const includeStackDeploy = Boolean(request.includeStackDeploy);

  const steps = [
    {
      key: 'validate',
      title: '校验 TAG 一致性',
      command: `APP_TAG=${appTag}, image=${imageTag}`,
      productionAction: false
    },
    {
      key: 'save-config',
      title: '更新 IDEA 发布配置',
      command: `${config.runConfigPath}: imageTag=${imageTag}, APP_TAG=${appTag}`,
      productionAction: false
    },
    {
      key: 'remote-build',
      title: '编译 Docker 镜像并写入目标镜像池',
      command: dockerCommand(dockerContext, [
        'build',
        '-f', config.dockerfile,
        '--build-arg', `APP_TAG=${appTag}`,
        '-t', imageTag,
        '.'
      ]),
      productionAction: true
    }
  ];

  if (includeStackDeploy) {
    steps.push({
      key: 'stack-deploy',
      title: '使用新 TAG 发布 Docker Stack',
      command: `$env:APP_TAG='${escapePowerShell(appTag)}'; ${dockerCommand(dockerContext, [
        'stack', 'deploy', '-c', config.composeFile, config.stackName
      ])}`,
      productionAction: true
    });
  }

  return {
    config: {
      ...config,
      dockerContext,
      executionEnabled: env.RELEASE_PUBLISHER_ALLOW_EXECUTE === 'true'
    },
    appTag,
    imageTag,
    includeStackDeploy,
    dryRun: request.dryRun !== false,
    steps,
    guardrails: [
      'dry run 只生成命令和写入预览',
      '正式编译和远端镜像池写入需要 RELEASE_PUBLISHER_ALLOW_EXECUTE=true'
    ]
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

async function executePlan(projectRoot, request, env = process.env) {
  const plan = createPlan(projectRoot, request, env);
  const logs = [];
  const saved = saveTag(projectRoot, {
    appTag: plan.appTag,
    runConfigPath: request.runConfigPath,
    dryRun: plan.dryRun
  });
  logs.push(`${saved.status}: ${plan.imageTag}`);
  if (plan.dryRun) {
    return {status: 'DRY_RUN', plan, logs};
  }
  if (env.RELEASE_PUBLISHER_ALLOW_EXECUTE !== 'true') {
    return {status: 'BLOCKED', plan, logs: logs.concat('RELEASE_PUBLISHER_ALLOW_EXECUTE is not true')};
  }
  for (const step of plan.steps.filter(step => step.productionAction)) {
    logs.push(`[RUN] ${step.command}`);
    logs.push(await runPowerShell(projectRoot, step.command));
  }
  return {status: 'EXECUTED', plan, logs};
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

function dockerCommand(context, args) {
  const parts = ['docker'];
  if (context) {
    parts.push('--context', context);
  }
  return parts.concat(args).map(shellToken).join(' ');
}

function runPowerShell(cwd, command) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd,
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', data => {
      output += data.toString();
    });
    child.stderr.on('data', data => {
      output += data.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(output || `command exited with ${code}`));
        return;
      }
      resolve(output.trim() || '[OK]');
    });
  });
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
  defaultProjectRoot,
  parseIdeaRunConfig,
  readConfig,
  createPlan,
  saveTag,
  updateIdeaRunConfigTag,
  executePlan,
  proposeNextTag,
  validateTag
};
