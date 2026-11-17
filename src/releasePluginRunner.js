const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {hash, receiptStore} = require('./changeValidationReceipts');
const {VERSION, CONTEXT_VERSION, createReleaseContext, regular, fail} = require('./releasePlugin');
const {dependencyClosure,installDependencies,assertDependencyExport,localIdentity,localEnvironment}=require('./releasePluginContext');

function digestFile(file) { return hash(fs.readFileSync(file)); }
function artifactIdentity(root) {
  const inputs = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const file = relative ? relative + '/' + name : name, full = path.join(root, file), stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail('UNSAFE_ARTIFACT_LINK');
      if (stat.isDirectory()) visit(file);
      else inputs[file] = digestFile(regular(root, file));
    }
  }
  visit(''); return inputs;
}
function prepare(plan, context, onlyUnit) {
  if (plan?.apiVersion !== VERSION || !Array.isArray(plan.units) || new Set(plan.units.map(u => u.id)).size !== plan.units.length) fail('INVALID_PLUGIN_PLAN');
  if (context?.apiVersion !== CONTEXT_VERSION) fail('MISSING_RELEASE_CONTEXT');
  const admitted = createReleaseContext(context);
  if (admitted.target !== plan.target) fail('CONTEXT_TARGET_MISMATCH');
  if (admitted.candidateRoot !== admitted.checkRoot) fail('CONTEXT_SOURCE_MISMATCH');
  // Admission for the entire selection precedes both store creation and lookup.
  for (const unit of plan.units) for (const capability of unit.requires) {
    if (!admitted.capabilities.includes(capability)) fail('MISSING_CONTEXT_CAPABILITY', capability);
  }
  const executor = hash(Object.fromEntries(['releasePluginRunner.js', 'releasePluginContext.js', 'changeValidationReceipts.js']
    .map(f => [f, hash(fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n'))])));
  const environment = Object.fromEntries(Object.entries(admitted.environment).filter(([k]) => !['TEMP', 'TMP'].includes(k)));
  const tools = {node:digestFile(admitted.nodeExecutable), platform:process.platform, arch:process.arch, os:os.release()};
  const prepared = plan.units.filter(unit => !onlyUnit || unit.id === onlyUnit).map(unit => {
    const dependencies=dependencyClosure(unit,admitted);
    const inputs = Object.fromEntries(unit.inputs.slice().sort().map(file => {
      const actual = digestFile(regular(admitted.checkRoot, file));
      if (actual !== plan.inputDigests[file]) fail('PLUGIN_INPUT_DRIFT', file);
      return [file, actual];
    }));
    const identity = {schema:VERSION, pluginId:plan.pluginId, target:plan.target, unit, inputs, executor, tools,
      context:{apiVersion:CONTEXT_VERSION, requires:unit.requires.slice().sort(),
        environment:Object.fromEntries(Object.entries(environment).filter(([k])=>unit.requires.includes('local-tools@1')||!k.startsWith('MAVEN_')))},
      dependencies:Object.fromEntries(Object.entries(dependencies).map(([name,spec])=>[name,{version:spec.version,files:spec.files}])),
      localTools:localIdentity(unit,admitted),artifacts:unit.phase === 'source' ? {} : artifactIdentity(admitted.artifactRoot)};
    return {unit, identity, dependencies,inputDigest:hash(inputs)};
  });
  for (const file of onlyUnit ? [] : plan.migrations) {
    if (digestFile(regular(admitted.candidateRoot, file)) !== plan.inputDigests[file]) fail('PLUGIN_MIGRATION_DRIFT', file);
  }
  return {context:admitted, prepared};
}
function assertPluginResult(unit, result, inputDigest) {
  if (result?.status !== 0 || result.error || result.signal) fail('PLUGIN_EXECUTION_FAILED', unit.id);
  if (unit.run.kind === 'node-test') {
    const output = String(result.output || '').replace(/\x1b\[[0-9;]*m/g, '');
    const values = key => [...output.matchAll(new RegExp('^#\\s*' + key + '\\s+(\\d+)\\s*$', 'gm'))].map(m => Number(m[1]));
    const count = values('tests');
    if (count.length !== 1 || count[0] < 1 || values('pass').length !== 1 || values('pass')[0] !== count[0]
      || ['fail', 'skipped', 'cancelled', 'todo'].some(k => values(k).length !== 1 || values(k)[0] !== 0)
      || /^\s*not ok\b/m.test(output) || /^\s*(?:ok|not ok)\b[^\r\n]*#\s*(?:SKIP|TODO)\b/mi.test(output)) fail('INCOMPLETE_PLUGIN_TAP', unit.id);
    return;
  }
  if (unit.run.kind !== 'node-module') fail('UNSUPPORTED_RUNNER_CAPABILITY');
  let report;
  try { report = JSON.parse(result.output); } catch { fail('INVALID_PLUGIN_RESULT', unit.id); }
  const keys = ['protocol', 'unitId', 'state', 'inputDigest', 'checks', 'passed', 'failed', 'skipped', 'cancelled', 'todo'];
  if (!report || Object.keys(report).length !== keys.length || keys.some(k => !Object.hasOwn(report, k))
    || report.protocol !== 'check-result-v1' || report.unitId !== unit.id || report.state !== 'PASS' || report.inputDigest !== inputDigest
    || !Number.isSafeInteger(report.checks) || report.checks < 1 || report.passed !== report.checks
    || ['failed', 'skipped', 'cancelled', 'todo'].some(k => report[k] !== 0)) fail('INCOMPLETE_PLUGIN_RESULT', unit.id);
}
function launch(executable, args, options) {
  return new Promise(resolve => {
    execFile(executable, args, options, (error, stdout, stderr) => resolve({status:error ? (typeof error.code === 'number' ? error.code : null) : 0,
      error:error?.message || '', signal:error?.signal || null, output:stdout || '', diagnostics:stderr || ''}));
  });
}
async function executeReleasePlugin(plan, context, {boundary, stage, receiptsDirectory, signal,
  requireReceipts=false,beforeExecute=()=>{},write = () => {}, run = launch, storeFactory = receiptStore} = {}) {
  if (boundary !== 'before-production' || !['precheck', 'formal'].includes(stage)) fail('UNSUPPORTED_EXECUTION_BOUNDARY');
  if (typeof receiptsDirectory !== 'string' || !path.isAbsolute(receiptsDirectory)) fail('EXPLICIT_RECEIPT_DIRECTORY_REQUIRED');
  const {context:admitted, prepared} = prepare(plan, context);
  if (signal?.aborted) fail('PLUGIN_CANCELLED');
  await beforeExecute();
  const store = storeFactory(receiptsDirectory), checks = [], pending = [];
  const counts = {selected:prepared.length, executed:0, reused:0, pending:0};
  for (const {unit, identity, dependencies,inputDigest} of prepared) {
    if (['pre-deploy', 'post-deploy'].includes(unit.phase)) { pending.push(unit.id); counts.pending++; continue; }
    if (signal?.aborted) fail('PLUGIN_CANCELLED');
    const current = prepare(plan, context, unit.id).prepared[0];
    if (hash(current.identity) !== hash(identity)) fail('PLUGIN_INPUTS_CHANGED_BEFORE_EXECUTION', unit.id);
    const identityParts = {definition:hash(unit), inputs:hash(identity.inputs), executor:identity.executor,
      tools:hash({tools:identity.tools,localTools:identity.localTools}),dependencies:hash(identity.dependencies),context:hash(identity.context), artifacts:hash(identity.artifacts)};
    const prior = store.read(identity);
    if (prior) {
      assertPluginResult(unit, prior.execution, inputDigest);
      checks.push({id:unit.id, reused:true, identity:hash(identity), identityParts}); counts.reused++;
      write({unitId:unit.id, stage, result:'REUSED', reason:'OWNED_INPUTS_TOOL_CONTEXT_MATCH', identityParts}); continue;
    }
    write({unitId:unit.id, stage, result:'CACHE_MISS', reason:'NO_AUTHENTIC_OWNED_INPUT_RECEIPT', identityParts});
    if(requireReceipts)fail('MISSING_PLUGIN_RECEIPT',unit.id);
    const scratch = fs.mkdtempSync(path.join(path.dirname(plan.sourceRoot), 'plugin-context-'));
    let result;
    try {
      const workerRoot=path.join(scratch,'source');fs.mkdirSync(workerRoot);
      for(const file of unit.inputs) {
        const destination=path.join(workerRoot,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
        fs.copyFileSync(regular(admitted.checkRoot,file),destination);
      }
      installDependencies(dependencies,workerRoot);
      const workerContext=createReleaseContext({...admitted,candidateRoot:workerRoot,checkRoot:workerRoot});
      const contextFile = path.join(scratch, 'context.json');
      fs.writeFileSync(contextFile, JSON.stringify({apiVersion:CONTEXT_VERSION, candidateRoot:workerRoot,
        checkRoot:workerRoot, artifactRoot:admitted.artifactRoot, target:admitted.target, unitId:unit.id, inputDigest,
        environment:unit.requires.includes('local-tools@1')?localEnvironment(admitted):Object.fromEntries(Object.entries(admitted.environment).filter(([k])=>!k.startsWith('MAVEN_'))),
        tools:unit.requires.includes('local-tools@1')?admitted.tools:{}}), {flag:'wx', mode:0o400});
      // Windows may add user defaults even to an explicit child environment. Preload in every test worker too.
      const bootstrap = path.join(scratch, 'bootstrap.mjs');
      fs.writeFileSync(bootstrap, `import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('./context.json',import.meta.url));
const context=JSON.parse(fs.readFileSync(file,'utf8'));
for(const key of Object.keys(process.env))delete process.env[key];
for(const [key,value] of Object.entries(context.environment))process.env[key]=value;
process.env.RELEASE_CONTEXT_FILE=file;
process.env.NODE_OPTIONS='--import '+import.meta.url;
`, {flag:'wx', mode:0o400});
      const args = ['--import', pathToFileURL(bootstrap).href, ...(unit.run.kind === 'node-test'
        ? ['--experimental-vm-modules', '--test', '--test-reporter=tap', '--test-concurrency=1', ...unit.run.entrypoints]
        : [unit.run.entrypoint, ...unit.run.args])];
      result = await run(admitted.nodeExecutable, args, {cwd:workerRoot,
        env:{...admitted.environment, RELEASE_CONTEXT_FILE:contextFile}, signal, windowsHide:true, shell:false,
        timeout:unit.run.timeoutSeconds * 1000, maxBuffer:8 * 1024 * 1024});
      assertPluginResult(unit, result, inputDigest);
      if (signal?.aborted) fail('PLUGIN_CANCELLED');
      const workerAfter=prepare(plan,workerContext,unit.id).prepared[0];
      if(hash(workerAfter.identity)!==hash(identity))fail('PLUGIN_WORKER_INPUT_DRIFT',unit.id);
      assertDependencyExport(dependencies,workerRoot);
      const after = prepare(plan, context, unit.id).prepared[0];
      if (hash(after.identity) !== hash(identity)) fail('PLUGIN_INPUTS_CHANGED_DURING_EXECUTION', unit.id);
      store.write(identity, {state:'PASS', execution:result});
    } finally { fs.rmSync(scratch, {recursive:true, force:true}); }
    checks.push({id:unit.id, reused:false, identity:hash(identity), identityParts}); counts.executed++;
    write({unitId:unit.id, stage, result:'EXECUTED', reason:'COMPLETE_BOUND_RESULT'});
  }
  return {state:'PREFIX_PASS', boundary, candidateCommit:plan.candidateCommit, manifestDigest:plan.manifestDigest,
    counts, checks, pending, productionActions:0, stoppedBeforeProduction:true};
}
module.exports = {executeReleasePlugin, assertPluginResult};
