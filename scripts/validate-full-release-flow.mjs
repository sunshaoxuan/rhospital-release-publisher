import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {analyzeReleaseChanges, createPlan} = require('../src/releasePublisherCore');
const {createAcceptanceIsolation, executeReleasePlanAcceptance} = require('../src/releaseFlowAcceptance');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publisherRoot = path.resolve(scriptDir, '..');
const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args['project-root'] || 'C:\\workspace\\hospital-backend');
const outputPath = args.output ? path.resolve(args.output) : '';
const gameCommit = args['game-commit'] || 'latest';
const forumCommit = args['forum-commit'] || 'latest';
const gameTag = args['game-tag'] || '2099123101';
const forumTag = args['forum-tag'] || '2099123102';

const isolation = createAcceptanceIsolation(publisherRoot);
let report;
try {
  const gameAnalysis = analyzeReleaseChanges(projectRoot, {
    gitBranch: 'origin/master',
    gitCommit: gameCommit,
    releaseTarget: 'game'
  }, isolation.env);
  const gamePlan = createPlan(projectRoot, {
    releaseTarget: 'game',
    appTag: gameTag,
    gitCommit: gameAnalysis.targetCommit,
    changeAnalysis: gameAnalysis,
    dryRun: false,
    includeStackDeploy: true
  }, isolation.env);
  const forumPlan = createPlan(projectRoot, {
    releaseTarget: 'forum',
    forumImageMode: 'build',
    appTag: forumTag,
    gitCommit: forumCommit,
    dryRun: false,
    includeStackDeploy: true
  }, isolation.env);

  const startedAt = new Date().toISOString();
  const game = await executeReleasePlanAcceptance(gamePlan, projectRoot, isolation.env);
  const forum = await executeReleasePlanAcceptance(forumPlan, projectRoot, isolation.env);
  const toolTrace = fs.existsSync(isolation.traceFile)
    ? fs.readFileSync(isolation.traceFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    : [];
  report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    safety: {
      productionRuntimeChanged: false,
      imageUploaded: false,
      productionImageReplaced: false,
      productionDatabaseChanged: false,
      productionComposeChanged: false,
      executor: 'real-powershell-with-isolated-toolchain',
      modes: ['ISOLATED_REAL', 'SIMULATED_DESTRUCTIVE', 'METADATA_ONLY']
    },
    status: game.status === 'PASS' && forum.status === 'PASS' ? 'PASS' : 'FAIL',
    projectRoot,
    requestedCommits: {game: gameCommit, forum: forumCommit},
    resolvedCommits: {game: gamePlan.gitCommit, forum: forumPlan.gitCommit},
    targets: {game, forum},
    toolTraceSummary: summarizeTrace(toolTrace)
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputPath.replace(/\.json$/i, '.md'), markdownReport(report), 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  isolation.cleanup();
}

if (!report || report.status !== 'PASS') process.exitCode = 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    result[item.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function summarizeTrace(entries) {
  const byTool = {};
  let remoteBashSyntaxChecks = 0;
  let longestRemoteScriptChars = 0;
  for (const entry of entries) {
    byTool[entry.tool] = (byTool[entry.tool] || 0) + 1;
    if (entry.bashSyntax === 'PASS') remoteBashSyntaxChecks += 1;
    longestRemoteScriptChars = Math.max(longestRemoteScriptChars, Number(entry.remoteScriptChars || 0));
  }
  return {invocationCount: entries.length, byTool, remoteBashSyntaxChecks, longestRemoteScriptChars};
}

function markdownReport(value) {
  const lines = [
    '# Full Release Flow Acceptance',
    '',
    `Status: ${value.status}`,
    '',
    `Started: ${value.startedAt}`,
    '',
    `Finished: ${value.finishedAt}`,
    '',
    'Safety: no image upload, production image replacement, database write, Compose mutation, or rollout was performed.',
    '',
    '| Target | Status | Steps | Executed | Metadata | Executor invocations | Failed |',
    '|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const target of Object.values(value.targets)) {
    lines.push(`| ${target.releaseTarget} | ${target.status} | ${target.stepCount} | ${target.executableStepCount} | ${target.metadataStepCount} | ${target.executorInvocationCount} | ${target.failedStepCount} |`);
  }
  for (const target of Object.values(value.targets)) {
    lines.push('', `## ${target.releaseTarget}`, '', '| Step | Mode | Status | Invocations |', '|---|---|---:|---:|');
    for (const step of target.steps) {
      lines.push(`| ${step.key} | ${step.mode} | ${step.status} | ${step.invocations.length} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
