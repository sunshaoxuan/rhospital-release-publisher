const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const PRIMARY = '92.113.124.185';
const STANDBY = '185.184.223.41';
const HELPER = '/usr/local/sbin/rhospital-release-candidate-v1';
const LOCK = '/etc/rhospital-ha/stage.lock';
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/;

function publicReceipt(binding) {
  requireCondition(binding && ID.test(binding.candidateId) && IMAGE.test(binding.imageId)
    && HASH.test(binding.configVersion) && /^[a-f0-9]{40}$/.test(binding.sourceCommit), 'invalid_binding');
  const result = {};
  for (const key of ['candidateId', 'imageTag', 'imageId', 'sourceCommit', 'configVersion',
    'archiveSha256', 'configurationId', 'secretVersion', 'previousAccepted', 'accepted']) {
    if (binding[key] !== undefined) result[key] = binding[key];
  }
  requireCondition(/^hospital-backend:[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(result.imageTag)
    && typeof result.accepted === 'boolean'
    && (!result.archiveSha256 || HASH.test(result.archiveSha256))
    && (!result.configurationId || HASH.test(result.configurationId))
    && (!result.secretVersion || ID.test(result.secretVersion))
    && (result.previousAccepted === undefined || result.previousAccepted === null || ID.test(result.previousAccepted)), 'invalid_binding');
  return result;
}

function requireCondition(condition, code) {
  if (!condition) throw new Error(`standby_candidate=${code}`);
}

// Subprocess output remains private until a narrow receipt is validated.
function run(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 900000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('standby_candidate=transport_failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || size > 65536 || timedOut) reject(new Error('standby_candidate=transport_failed'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
    child.stdin.end(input);
  });
}

function sshArgs(node, settings) {
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15'];
  if (settings.keyPath) args.push('-i', settings.keyPath);
  args.push('-p', String(node === PRIMARY ? settings.port || 22 : 22));
  return args.concat(`${settings.user || 'root'}@${node}`);
}

function createTransport(settings, runner = run) {
  return {
    async request(node, action, payload) {
      const text = await runner('ssh', sshArgs(node, settings).concat(HELPER, action), JSON.stringify(payload));
      try { return JSON.parse(text); } catch { throw new Error('standby_candidate=invalid_receipt'); }
    },
    async upload(node, file, candidateId, operationId) {
      requireCondition(ID.test(candidateId) && ID.test(operationId), 'invalid_input');
      const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15'];
      if (settings.keyPath) args.push('-i', settings.keyPath);
      args.push('-P', String(node === PRIMARY ? settings.port || 22 : 22));
      await runner('scp', args.concat(file,
        `${settings.user || 'root'}@${node}:/opt/rhospital-dr/release-incoming/${candidateId}.${operationId}.tar`));
    }
  };
}

function validateCapabilities(receipt, node) {
  requireCondition(receipt && receipt.protocol === 1 && receipt.node === node
    && receipt.sharedLock === LOCK && receipt.versionedCandidates === true
    && receipt.atomicAcceptance === true && receipt.pinnedCutover === true
    && receipt.noSecretOutput === true, 'contract_unavailable');
}

function validateReady(receipt, binding) {
  requireCondition(receipt && receipt.protocol === 1 && receipt.node === STANDBY
    && receipt.candidateId === binding.candidateId && receipt.imageId === binding.imageId
    && receipt.configVersion === binding.configVersion && receipt.sourceCommit === binding.sourceCommit
    && receipt.archiveSha256 === binding.archiveSha256, 'binding_mismatch');
  requireCondition(HASH.test(receipt.configurationId) && ID.test(receipt.secretVersion)
    && ID.test(receipt.previousAccepted), 'configuration_missing');
  for (const key of ['standbyStopped', 'jobsDisabled', 'databaseUnchanged', 'localConnections',
    'productionSemantics', 'secretsReady', 'isolatedCandidate', 'complete']) {
    requireCondition(receipt[key] === true, 'readiness_failed');
  }
  if (binding.configurationId) {
    requireCondition(receipt.configurationId === binding.configurationId
      && receipt.secretVersion === binding.secretVersion
      && receipt.previousAccepted === binding.previousAccepted, 'configuration_changed');
  }
  return {...binding, configurationId: receipt.configurationId,
    secretVersion: receipt.secretVersion, previousAccepted: receipt.previousAccepted};
}

async function archiveHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function executeCandidate(action, settings, options = {}) {
  requireCondition(ID.test(settings.candidateId), 'invalid_input');
  const root = path.join(options.cwd || process.cwd(), '.release-candidates', settings.candidateId);
  fs.mkdirSync(root, {recursive: true});
  const lock = path.join(root, 'operation.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('standby_candidate=preparation_busy'); }
  try { return await executeUnlocked(action, settings, options); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

async function executeUnlocked(action, settings, options = {}) {
  requireCondition(['distribute', 'verify', 'cutover', 'accept'].includes(action), 'unknown_action');
  requireCondition(ID.test(settings.candidateId) && HASH.test(settings.configVersion)
    && /^hospital-backend:[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(settings.imageTag), 'invalid_input');
  const runner = options.run || run;
  const transport = options.transport || createTransport(settings.ssh, runner);
  const root = path.join(options.cwd || process.cwd(), '.release-candidates', settings.candidateId);
  const stateFile = path.join(root, 'candidate.json');
  fs.mkdirSync(root, {recursive: true});
  let binding = fs.existsSync(stateFile) ? publicReceipt(JSON.parse(fs.readFileSync(stateFile, 'utf8'))) : null;
  const save = value => {
    const temp = `${stateFile}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600});
    fs.renameSync(temp, stateFile);
    binding = value;
  };
  const operationId = crypto.randomUUID();
  const payload = () => ({protocol: 1, ...binding, operationId});
  const primaryIdentity = async runtime => {
    const receipt = await transport.request(PRIMARY, runtime ? 'verify-runtime' : 'verify-image', payload());
    requireCondition(receipt && receipt.protocol === 1 && receipt.node === PRIMARY
      && receipt.candidateId === binding.candidateId && receipt.imageId === binding.imageId
      && (!runtime || receipt.healthy === true), 'primary_identity_mismatch');
  };
  if (action === 'distribute') {
    let imageId;
    try { imageId = fs.readFileSync(path.join(root, 'build-image.id'), 'utf8').trim(); }
    catch { throw new Error('standby_candidate=build_identity_missing'); }
    requireCondition(IMAGE.test(imageId), 'invalid_image_identity');
    for (const node of [PRIMARY, STANDBY]) {
      validateCapabilities(await transport.request(node, 'capabilities', {protocol: 1}), node);
    }
    const prefix = settings.docker && settings.docker.mode === 'context'
      ? ['--context', settings.docker.context] : [];
    const taggedImageId = await runner('docker', prefix.concat('image', 'inspect', settings.imageTag, '--format', '{{.Id}}'));
    requireCondition(taggedImageId === imageId, 'build_identity_mismatch');
    const sourceCommit = await runner('git', ['rev-parse', 'HEAD']);
    requireCondition(/^[a-f0-9]{40}$/.test(sourceCommit), 'invalid_source_commit');
    if (binding) {
      requireCondition(binding.imageId === imageId && binding.sourceCommit === sourceCommit
        && binding.configVersion === settings.configVersion, 'retry_binding_changed');
    } else {
      save({candidateId: settings.candidateId, imageTag: settings.imageTag, imageId,
        sourceCommit, configVersion: settings.configVersion, accepted: false});
    }
    const archive = path.join(root, 'image.tar');
    const reservations = [];
    let operationError;
    try {
      await runner('docker', prefix.concat('image', 'save', '--output', archive, binding.imageId));
      const archiveSha256 = await archiveHash(archive);
      requireCondition(!binding.archiveSha256 || binding.archiveSha256 === archiveSha256, 'retry_archive_changed');
      save({...binding, archiveSha256});
      for (const node of [PRIMARY, STANDBY]) {
        const begin = await transport.request(node, 'begin', payload());
        requireCondition(begin && begin.candidateId === binding.candidateId
          && begin.operationId === operationId && begin.ready === true, 'preparation_busy');
        reservations.push(node);
        await transport.upload(node, archive, binding.candidateId, operationId);
        const receipt = await transport.request(node, node === PRIMARY ? 'load' : 'prepare', payload());
        if (node === STANDBY) save(validateReady(receipt, binding));
        else requireCondition(receipt && receipt.imageId === binding.imageId
          && receipt.candidateId === binding.candidateId && receipt.archiveSha256 === archiveSha256, 'primary_load_mismatch');
      }
      await primaryIdentity(false);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      fs.rmSync(archive, {force: true});
      let cleanupComplete = true;
      for (const node of reservations) {
        try {
          const receipt = await transport.request(node, 'finish-upload', payload());
          cleanupComplete = cleanupComplete && receipt && receipt.candidateId === binding.candidateId
            && receipt.operationId === operationId && receipt.finished === true;
        } catch { cleanupComplete = false; }
      }
      if (!operationError) requireCondition(cleanupComplete, 'upload_cleanup_failed');
    }
  } else {
    requireCondition(binding && binding.configurationId && binding.candidateId === settings.candidateId
      && binding.configVersion === settings.configVersion && binding.imageTag === settings.imageTag, 'candidate_missing');
    save(validateReady(await transport.request(STANDBY, 'verify', payload()), binding));
    await primaryIdentity(action === 'accept');
    if (action === 'cutover') {
      requireCondition(typeof settings.cutoverScript === 'string' && settings.cutoverScript.length > 0, 'cutover_missing');
      const receipt = await transport.request(PRIMARY, 'cutover', {...payload(), script: settings.cutoverScript});
      requireCondition(receipt && receipt.candidateId === binding.candidateId
        && receipt.imageId === binding.imageId && receipt.submitted === true, 'cutover_unconfirmed');
    } else if (action === 'accept') {
      const receipt = await transport.request(STANDBY, 'accept', payload());
      requireCondition(receipt && receipt.candidateId === binding.candidateId
        && receipt.imageId === binding.imageId && receipt.configVersion === binding.configVersion
        && receipt.configurationId === binding.configurationId && receipt.secretVersion === binding.secretVersion
        && receipt.accepted === true && receipt.standbyStopped === true, 'acceptance_unconfirmed');
      save({...binding, accepted: true});
    } else requireCondition(action === 'verify', 'unknown_action');
  }
  return publicReceipt(binding);
}

module.exports = {executeCandidate, createTransport, validateReady, publicReceipt, PRIMARY, STANDBY, HELPER, LOCK};
