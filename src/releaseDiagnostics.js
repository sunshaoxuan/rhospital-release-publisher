const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function loadProtectedDiagnosticConfig(repositoryRoot) {
  const file = path.join(repositoryRoot, '.service', 'semantic-diagnostics.clixml');
  if (!fs.existsSync(file)) return {};
  if (process.platform !== 'win32') return {RELEASE_PUBLISHER_JEV_CONFIG_ERROR: 'true'};
  const command = "$ErrorActionPreference='Stop'; $c=Import-Clixml -LiteralPath $env:RELEASE_DIAGNOSTICS_SECRET_PATH; @{ BaseUrl=[string]$c.BaseUrl; Model=[string]$c.Model; ApiKey=[Net.NetworkCredential]::new('', $c.ApiKey).Password } | ConvertTo-Json -Compress";
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: {...process.env, RELEASE_DIAGNOSTICS_SECRET_PATH: file}
  });
  try {
    if (child.status !== 0) throw new Error('decrypt failed');
    const value = JSON.parse(child.stdout);
    if (!value.ApiKey || !value.BaseUrl || !value.Model) throw new Error('invalid config');
    return {RELEASE_PUBLISHER_JEV_BASE_URL: value.BaseUrl, RELEASE_PUBLISHER_JEV_MODEL: value.Model,
      RELEASE_PUBLISHER_JEV_API_KEY: value.ApiKey};
  } catch { return {RELEASE_PUBLISHER_JEV_CONFIG_ERROR: 'true'}; }
}

const OPTIONS = [
  {id: 'A', label: '发布流程或环境', description: 'Build, tests, migrations, configuration, transport or deployment pipeline needs investigation.'},
  {id: 'B', label: '上线版本运行异常', description: 'Post-deployment application, health, static assets or functional checks need investigation.'},
  {id: 'C', label: '维护警告', description: 'Release checks completed; only maintenance or cleanup warnings remain.'},
  {id: 'D', label: '证据不足', description: 'Available evidence is insufficient or conflicting; human verification is needed.'}
];
const SIGNALS = [
  ['database', /database|migration|flyway|数据库|迁移/i, '数据库或迁移相关输出'],
  ['transport', /connection refused|timed out|timeout|ssh:|scp:|connection reset|连接失败|超时/i, '连接或超时相关输出'],
  ['static_assets', /mime|javascript module|static.delivery|静态资源/i, '静态资源或 MIME 校验输出'],
  ['test_failure', /tests? failed|test failures|BUILD FAILURE|测试失败/i, '构建或测试失败输出'],
  ['runtime_health', /unhealthy|health.*fail|健康.*失败|rollout.*paused/i, '运行健康异常输出']
];
const OUTCOMES = {
  SUCCESS: ['发布检查完成', '本次计划中的步骤已经完成。'],
  SUCCESS_WITH_WARNINGS: ['发布检查完成，有待处理提示', '执行状态为成功；以下步骤仍有警告或异常文本，需要逐项复核。'],
  FAILED: ['发布失败', '执行在失败步骤停止；请先处理该步骤的证据。'],
  ROLLED_BACK: ['发布失败，回滚完成', '目标版本未通过检查，发布器已完成回滚命令及其校验。'],
  RECOVERY_REQUIRED: ['需要恢复复核', '执行未通过全部检查，当前现场需要人工复核。'],
  CANCELLED: ['执行已取消', '执行已停止，请结合切换与恢复记录确认现场。'],
  INTERRUPTED: ['执行已中断', '执行结果尚未确认，请先核对当前运行版本。'],
  DRY_RUN: ['计划演练完成', '这是 dry run 结果，不代表生产发布完成。'],
  UNKNOWN: ['结果待确认', '缺少受支持的终态证据。']
};

// Command text is not evidence that its embedded warning/error was emitted.
function outputLines(logs) {
  return (logs || []).filter(value => !/^\[(RUN|VALIDATE|CHECK)\]/.test(String(value)))
    .flatMap(value => String(value).split(/\r?\n/))
    .map(line => line.trim()).filter(line => line && !/^\[(START|DONE|RUNNING)\]/.test(line));
}

function stepFamily(key) {
  if (/rollback/.test(key)) return 'recovery';
  if (/cleanup/.test(key)) return 'cleanup';
  if (/migration|database/.test(key)) return 'database';
  if (/static|asset/.test(key)) return 'static_assets';
  if (/test|build|maven/.test(key)) return 'build_test';
  if (/upload|publish|transfer|load-image/.test(key)) return 'delivery';
  if (/runtime|verify|cutover|deploy/.test(key)) return 'runtime_check';
  return 'preparation';
}

function buildReleaseDiagnostics(result, scope = 'execution') {
  const steps = result.plan?.steps || result.stepSummary || [];
  const observations = [];
  for (const step of steps) {
    const lines = outputLines(step.logs);
    const signals = SIGNALS.filter(([, regex]) => lines.some(line => regex.test(line))).map(([id]) => id);
    const warning = lines.some(line => /(^|\s)(WARNING:|WARN:|\[WARN(?:ING)?\])|post_release_container_cleanup=WARNING/i.test(line));
    const errorText = lines.some(line => /(^|\s)(ERROR:|\[ERROR\])/.test(line));
    if (['failed', 'cancelled', 'interrupted'].includes(step.status) || warning || errorText) {
      observations.push({id: `E${observations.length + 1}`, stepKey: step.key,
        title: step.title || step.key, status: step.status, family: stepFamily(step.key || ''),
        warning, errorText, signals});
    }
  }
  const globalWarnings = outputLines(result.logs).some(line => /^(WARNING:|WARN:|\[WARN(?:ING)?\])/.test(line));
  const firstFailure = observations.find(item => item.status === 'failed' && item.family !== 'recovery') || null;
  const recoveryStep = steps.find(step => /rollback-command$/.test(step.key));
  const decisions = steps.filter(step => /rollback-decision$/.test(step.key));
  const decisionLines = decisions.flatMap(step => outputLines(step.logs));
  const confirmed = decisionLines.some(line => /^(?:fatal|automatic)_rollback_decision=ROLLBACK_CONFIRMED\s*$/.test(line));
  const held = decisionLines.some(line => /^(?:fatal|automatic)_rollback_decision=HOLD_TARGET\s*$/.test(line));
  const cutover = steps.find(step => step.key === 'commit-game-cutover');
  const cutoverCommitted = result.cutoverCommitted === true || cutover?.status === 'done';
  const deployAttempted = steps.some(step => ['deploy-stack', 'update-remote-compose', 'deploy-forum-compose'].includes(step.key)
    && ['done', 'failed', 'running', 'cancelled', 'interrupted'].includes(step.status));
  let rollback = {code: 'NOT_REQUIRED', text: '本次结果未要求执行回滚。'};
  if (recoveryStep?.status === 'failed') rollback = {code: 'FAILED', text: '回滚执行或校验失败，必须复核运行版本与服务健康。'};
  else if (result.status === 'ROLLED_BACK') rollback = {code: 'COMPLETED', text: '回滚步骤及其校验已完成。'};
  else if (held && confirmed) rollback = {code: 'CONFLICTING', text: '回滚决策记录相互冲突，必须人工复核。'};
  else if (held) rollback = {code: 'HOLD_TARGET', text: cutoverCommitted
    ? '已健康切换；致命故障复核未满足自动回滚条件，保留目标版本待复核。'
    : '复核记录要求保留目标版本，尚有失败检查待处理。'};
  else if (decisions.some(step => step.status === 'failed')) rollback = {code: 'DECISION_FAILED', text: '回滚复核本身失败，自动回滚未获确认，现场待复核。'};
  else if (result.status === 'RECOVERY_REQUIRED') rollback = {code: 'MANUAL_REVIEW', text: (result.releaseTarget || result.plan?.releaseTarget) === 'forum'
    ? '论坛已进入生产修改边界，现有规则要求人工复核备份与恢复操作。'
    : '恢复状态尚未闭合，请核对目标版本、检查结果和备份。'};
  else if (result.status === 'ERROR' && !deployAttempted) rollback = {code: 'BEFORE_DEPLOY', text: '尚未进入版本部署步骤；已执行的前置动作仍需结合失败步骤复核。'};
  const hasWarnings = globalWarnings || observations.some(item => item.warning || (item.errorText && item.status === 'done'));
  const outcome = result.status === 'EXECUTED' ? (hasWarnings ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS')
    : result.status === 'ERROR' ? 'FAILED' : Object.hasOwn(OUTCOMES, result.status) ? result.status : 'UNKNOWN';
  let [title, summary] = OUTCOMES[outcome];
  if (outcome === 'RECOVERY_REQUIRED' && rollback.code === 'FAILED') title = '回滚失败，需要恢复复核';
  if (outcome === 'RECOVERY_REQUIRED' && rollback.code === 'HOLD_TARGET') title = '目标版本保留，验收未通过';
  const actions = {
    database: '核对迁移失败语句、目标数据库归属、账号权限和已应用版本，再按迁移门禁处理。',
    static_assets: '核对失败资源的 HTTP 状态、Content-Type、入口引用和实际文件版本，确认浏览器能够加载。',
    build_test: '定位第一个构建或测试失败，修复后通过相同检查，再重新发布。',
    delivery: '核对镜像 TAG、传输结果、目标磁盘空间和镜像加载结果。',
    runtime_check: '核对目标镜像、运行副本、健康检查和失败功能的实际响应。',
    cleanup: '核对残留容器与清理日志，确认当前服务健康后单独处理维护问题。'
  };
  const nextAction = firstFailure ? `先查看「${firstFailure.title}」的原始日志。${actions[firstFailure.family] || '根据失败校验补充证据，再决定修复与重试。'}`
    : hasWarnings ? '逐项复核提示步骤；异常文本是否影响业务需要原始证据确认。'
      : outcome === 'SUCCESS' ? '本次计划检查已完成，按业务验收范围继续确认。' : summary;
  return {version: 1, scope, outcome, title, summary, nextAction, firstFailure, observations,
    rollback, cutoverCommitted, hasWarnings,
    semantic: {status: 'NOT_CONFIGURED', reason: '语义辅助诊断尚未配置。'}};
}

// A closed vocabulary is the external-data boundary. No raw logs, commands,
// paths, hostnames, titles, configuration or user text are sent to the model.
function modelEvidence(diagnostic) {
  const rollbackCodes = ['NOT_REQUIRED', 'FAILED', 'COMPLETED', 'CONFLICTING', 'HOLD_TARGET', 'DECISION_FAILED', 'MANUAL_REVIEW', 'BEFORE_DEPLOY'];
  const families = ['recovery', 'cleanup', 'database', 'static_assets', 'build_test', 'delivery', 'runtime_check', 'preparation'];
  const ordered = [...diagnostic.observations].sort((left, right) =>
    Number(right.id === diagnostic.firstFailure?.id) - Number(left.id === diagnostic.firstFailure?.id));
  return {outcome: Object.hasOwn(OUTCOMES, diagnostic.outcome) ? diagnostic.outcome : 'UNKNOWN',
    rollback: rollbackCodes.includes(diagnostic.rollback.code) ? diagnostic.rollback.code : 'MANUAL_REVIEW',
    cutoverCommitted: diagnostic.cutoverCommitted === true,
    scope: diagnostic.scope === 'execution' ? 'execution' : 'retained_history',
    observations: ordered.slice(0, 32).map((item, index) => ({id: `E${index + 1}`,
      family: families.includes(item.family) ? item.family : 'preparation',
      status: ['failed', 'done', 'cancelled', 'interrupted'].includes(item.status) ? item.status : 'unknown',
      warning: item.warning === true, errorText: item.errorText === true,
      signals: SIGNALS.map(([id]) => id).filter(id => item.signals.includes(id))}))};
}

function parseScores(response) {
  const choice = response?.choices?.[0];
  const content = choice?.logprobs?.content;
  if (!Array.isArray(content) || content.length !== 1 || choice.message?.reasoning || choice.message?.reasoning_content
      || !OPTIONS.some(option => option.id === choice.message?.content)
      || content[0].token !== choice.message.content) throw new Error('INVALID_READOUT');
  const candidates = content[0].top_logprobs;
  const logits = OPTIONS.map(option => {
    const matches = Array.isArray(candidates) ? candidates.filter(item => item.token === option.id) : [];
    if (matches.length !== 1 || !Number.isFinite(matches[0].logprob) || matches[0].logprob > 0) throw new Error('INCOMPLETE_SCORES');
    return matches[0].logprob;
  });
  const maximum = Math.max(...logits);
  const weights = logits.map(value => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return OPTIONS.map((option, index) => ({id: option.id, label: option.label, score: weights[index] / total}));
}

async function addSemanticDiagnosis(diagnostic, env = process.env, options = {}) {
  if (diagnostic.outcome === 'DRY_RUN' || diagnostic.outcome === 'SUCCESS') {
    return {...diagnostic, semantic: {status: 'NOT_NEEDED', reason: '当前结果无需调用语义辅助分类。'}};
  }
  if (env.RELEASE_PUBLISHER_JEV_CONFIG_ERROR) return {...diagnostic,
    semantic: {status: 'UNAVAILABLE', code: 'INVALID_CONFIG', reason: '无法读取加密诊断配置，请核对运行账户。'}};
  if (!env.RELEASE_PUBLISHER_JEV_BASE_URL || !env.RELEASE_PUBLISHER_JEV_MODEL) return diagnostic;
  const reasons = {NOT_CONFIGURED: '缺少诊断凭据。', INVALID_CONFIG: '诊断服务配置无效。',
    INVALID_READOUT: '模型未返回单个候选标签，未采用结果。', INCOMPLETE_SCORES: '候选标签分数不完整，未采用结果。',
    TIMEOUT: '诊断请求超时。', REQUEST_FAILED: '诊断服务请求失败。'};
  let timer;
  try {
    const url = new URL(env.RELEASE_PUBLISHER_JEV_BASE_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('INVALID_CONFIG');
    const apiKey = env.RELEASE_PUBLISHER_JEV_API_KEY || (env.RELEASE_PUBLISHER_JEV_API_KEY_FILE
      ? fs.readFileSync(env.RELEASE_PUBLISHER_JEV_API_KEY_FILE, 'utf8').trim() : '');
    if (!apiKey) throw new Error('NOT_CONFIGURED');
    const evidence = modelEvidence(diagnostic);
    const prompt = JSON.stringify({evidence, question: 'Which area should a human investigate first? Classify evidence only. Do not decide success or rollback.', options: OPTIONS});
    const controller = new AbortController();
    const configuredTimeout = Number(env.RELEASE_PUBLISHER_JEV_TIMEOUT_MS || 10000);
    const timeoutMs = Math.min(30000, Math.max(100, Number.isFinite(configuredTimeout) ? configuredTimeout : 10000));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, timeoutMs); });
    const operation = async () => {
      const response = await (options.fetch || fetch)(`${url.href.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
        body: JSON.stringify({model: env.RELEASE_PUBLISHER_JEV_MODEL,
          messages: [{role: 'system', content: 'Classify the supplied evidence. Reply with exactly one uppercase letter A, B, C or D. No explanation or reasoning.'},
            {role: 'user', content: prompt}], reasoning_effort: 'none', temperature: 1,
          max_tokens: 1, logprobs: true, top_logprobs: 20, stream: false})
      });
      if (!response.ok) throw new Error('REQUEST_FAILED');
      return parseScores(await response.json());
    };
    const scores = await Promise.race([operation(), timeout]);
    const winner = scores.reduce((best, item) => item.score > best.score ? item : best);
    return {...diagnostic, semantic: {status: 'AVAILABLE', model: env.RELEASE_PUBLISHER_JEV_MODEL,
      promptVersion: 'publisher-diagnosis-v1', inputSha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      category: winner.label, optionId: winner.id, scores,
      reason: '候选条件分数仅供排查参考；发布状态和回滚依据以上方执行证据为准。'}};
  } catch (error) {
    const code = Object.hasOwn(reasons, error.message) ? error.message : 'REQUEST_FAILED';
    return {...diagnostic, semantic: {status: 'UNAVAILABLE', code, reason: reasons[code]}};
  } finally { clearTimeout(timer); }
}

module.exports = {buildReleaseDiagnostics, addSemanticDiagnosis, modelEvidence, parseScores, loadProtectedDiagnosticConfig};
