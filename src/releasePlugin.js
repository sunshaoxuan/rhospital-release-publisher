const fs = require('node:fs');
const path = require('node:path');
const {git, text, manifest} = require('./changeValidationGit');
const {hash} = require('./changeValidationReceipts');

const VERSION = 'release-plugin/v1';
const CONTEXT_VERSION = 'release-context/v1';
const PHASES = ['source', 'artifact', 'pre-deploy', 'post-deploy'];
const CAPABILITIES = ['engine-context@1', 'node-test@1', 'node-module@1', 'local-tools@1', 'node-dependencies@1'];
const ID = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const ENVIRONMENT = new Set(['SystemRoot', 'TEMP', 'TMP', 'TZ', 'LANG', 'NODE_ENV', 'MAVEN_OPTS', 'MAVEN_ARGS', 'MAVEN_SKIP_RC']);
const isDocument=file=>/^(?:AGENTS|README|CHANGELOG)\.md$/.test(file)||/^(?:docs|release\/evidence)\/.+\.(?:md|json)$/.test(file)||file==='release/release-impact.json';
function fail(code, detail = '') { throw new Error(code + (detail ? ': ' + detail : '')); }
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function shape(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail('INVALID_PLUGIN_FIELDS');
}
function list(values, validate, min = 0, max = 4096) {
  if (!Array.isArray(values) || values.length < min || values.length > max || new Set(values).size !== values.length) fail('INVALID_OR_DUPLICATE_LIST');
  for (const value of values) validate(value);
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID'); }
function pluginPath(value, prefix = false) {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_./-]+$/.test(value)) fail('UNSAFE_PATH');
  const parts = (prefix && value.endsWith('/') ? value.slice(0, -1) : value).split('/');
  if (parts.some(p => !p || p === '.' || p === '..') || (prefix && !value.endsWith('/'))) fail('UNSAFE_PATH', value);
  return value;
}
function validatePlugin(data) {
  shape(data, ['apiVersion', 'pluginId', 'target', 'coverage', 'units', 'migrations']);
  if (data.apiVersion !== VERSION) fail('UNSUPPORTED_PLUGIN_VERSION');
  id(data.pluginId); id(data.target);
  list(data.units, () => {}, 1, 128);
  const ids = new Set();
  for (const unit of data.units) {
    shape(unit, ['id', 'phase', 'requires', 'inputs', 'run', ...['dependencies','images','tools'].filter(k=>Object.hasOwn(unit,k))]); id(unit.id);
    if (ids.has(unit.id)) fail('DUPLICATE_UNIT_ID', unit.id); ids.add(unit.id);
    if (!PHASES.includes(unit.phase)) fail('UNKNOWN_PHASE');
    list(unit.requires, c => { if (typeof c !== 'string' || !/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(c)) fail('INVALID_CAPABILITY'); }, 1, 32);
    list(unit.inputs, p => pluginPath(p), 1);
    if(unit.dependencies!==undefined)list(unit.dependencies,name=>{if(typeof name!=='string'||!/^(@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/.test(name))fail('INVALID_DEPENDENCY_NAME');},1,128);
    if(unit.requires.includes('node-dependencies@1')!==Boolean(unit.dependencies?.length))fail('MISSING_DECLARED_DEPENDENCIES');
    if(unit.requires.includes('local-tools@1')&&!Array.isArray(unit.images))fail('MISSING_LOCAL_IMAGE_DECLARATION');
    if(unit.requires.includes('local-tools@1')&&!unit.tools?.length)fail('MISSING_TOOL_DECLARATION');
    if(unit.tools!==undefined){
      list(unit.tools,name=>{if(!['node','git','powershell','java','python','docker','cmd'].includes(name))fail('UNKNOWN_LOCAL_TOOL',name);},1,7);
      if(!unit.requires.includes('local-tools@1'))fail('UNGRANTED_LOCAL_TOOL');
    }
    if(unit.images!==undefined){
      list(unit.images,name=>{if(typeof name!=='string'||!(/^[a-z0-9][a-z0-9:._/@-]{0,255}$/).test(name))fail('INVALID_LOCAL_IMAGE');},0,32);
      if(!unit.requires.includes('local-tools@1'))fail('UNGRANTED_LOCAL_IMAGE');
      if(unit.images.length&&!unit.tools.includes('docker'))fail('UNGRANTED_LOCAL_IMAGE');
    }
    const run = unit.run;
    if (!run || !['node-test', 'node-module', 'maven-test'].includes(run.kind)) fail('UNKNOWN_RUNNER');
    const fields = run.kind === 'node-test' ? ['entrypoints'] : run.kind === 'node-module' ? ['entrypoint', 'args'] : ['testClasses'];
    shape(run, ['kind', ...fields, 'timeoutSeconds', 'protocol']);
    if (!Number.isInteger(run.timeoutSeconds) || run.timeoutSeconds < 1 || run.timeoutSeconds > 3600) fail('INVALID_TIMEOUT');
    const protocol = {'node-test':'tap-v1', 'node-module':'check-result-v1', 'maven-test':'junit-xml-v1'}[run.kind];
    if (run.protocol !== protocol) fail('UNKNOWN_RESULT_PROTOCOL');
    if (run.kind === 'node-test') list(run.entrypoints, p => pluginPath(p), 1);
    if (run.kind === 'node-module') {
      pluginPath(run.entrypoint);
      if (!Array.isArray(run.args) || run.args.length > 64 || run.args.some(a => typeof a !== 'string' || a.length > 4096 || /[\x00-\x1f]/.test(a))) fail('INVALID_ARGUMENT');
    }
    if (run.kind === 'maven-test') list(run.testClasses, c => { if (typeof c !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(c)) fail('INVALID_TEST_CLASS'); }, 1);
    for (const entry of run.entrypoints || (run.entrypoint ? [run.entrypoint] : [])) {
      if (!unit.inputs.includes(entry)) fail('UNOWNED_ENTRYPOINT', entry);
    }
    if (!unit.requires.includes('engine-context@1') || !unit.requires.includes(run.kind + '@1')) fail('MISSING_RUNNER_CAPABILITY');
  }
  list(data.coverage, () => {}, 1, 1024);
  const declared = new Set();
  for (const rule of data.coverage) {
    shape(rule, ['paths', 'prefixes', 'units']);
    list(rule.paths, p => pluginPath(p)); list(rule.prefixes, p => pluginPath(p, true));
    if (!rule.paths.length && !rule.prefixes.length) fail('EMPTY_COVERAGE');
    for (const p of [...rule.paths, ...rule.prefixes]) {
      if (declared.has(p)) fail('DUPLICATE_COVERAGE', p); declared.add(p);
    }
    list(rule.units, value => { id(value); if (!ids.has(value)) fail('UNKNOWN_UNIT', value); }, 1, 128);
  }
  list(data.migrations, p => { pluginPath(p); if (!p.endsWith('.sql')) fail('INVALID_MIGRATION'); });
  return data;
}
function regular(root, relative) {
  pluginPath(relative);
  const base = fs.realpathSync(root); let full = base;
  for (const component of relative.split('/')) {
    full = path.join(full, component);
    if (fs.lstatSync(full).isSymbolicLink()) fail('UNSAFE_INPUT_LINK', relative);
  }
  if (!fs.lstatSync(full).isFile() || !fs.realpathSync(full).startsWith(base + path.sep)) fail('UNSAFE_INPUT', relative);
  return full;
}
function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || !fs.existsSync(value) || !fs.lstatSync(value).isDirectory() || fs.lstatSync(value).isSymbolicLink()) fail('MISSING_CONTEXT_ROOT');
  return fs.realpathSync(value);
}
function createReleaseContext(options) {
  const {candidateRoot, checkRoot, artifactRoot, target, capabilities, nodeExecutable, environment,
    tools={},dependencyRoot='',dockerHost='',dockerConfigRoot=''} = options || {};
  id(target);
  list(capabilities, c => { if (!CAPABILITIES.includes(c)) fail('UNKNOWN_CAPABILITY', c); }, 1, 32);
  if (!capabilities.includes('engine-context@1')) fail('MISSING_CONTEXT_CAPABILITY');
  if (!environment || Array.isArray(environment) || typeof environment !== 'object'
    || Object.entries(environment).some(([k, v]) => !ENVIRONMENT.has(k) || typeof v !== 'string' || v.includes('\0'))) fail('UNDECLARED_ENVIRONMENT');
  if (typeof nodeExecutable !== 'string' || !path.isAbsolute(nodeExecutable) || !fs.statSync(nodeExecutable).isFile()) fail('MISSING_NODE_TOOL');
  return {apiVersion:CONTEXT_VERSION, target, candidateRoot:directory(candidateRoot), checkRoot:directory(checkRoot), artifactRoot:directory(artifactRoot),
    capabilities:[...capabilities].sort(), nodeExecutable:fs.realpathSync(nodeExecutable), environment:{...environment},
    tools:{...tools},dependencyRoot:dependencyRoot?directory(dependencyRoot):'',dockerHost,dockerConfigRoot:dockerConfigRoot?directory(dockerConfigRoot):''};
}
function loadReleasePlugin({repositoryRoot, candidateCommit, baselineCommit, manifestPath, target, changedPaths, workspaceRoot}) {
  if (!/^[a-f0-9]{40}$/.test(candidateCommit || '') || text(repositoryRoot, 'rev-parse', candidateCommit + '^{commit}') !== candidateCommit) fail('EXACT_CANDIDATE_REQUIRED');
  pluginPath(manifestPath); id(target); directory(workspaceRoot);
  const entries = manifest(repositoryRoot, candidateCommit);
  const read = file => {
    const entry = entries.get(file);
    if (!entry || !['100644', '100755'].includes(entry.mode) || entry.kind !== 'blob') fail('UNSAFE_OR_MISSING_CANDIDATE_INPUT', file);
    if (Number(text(repositoryRoot, 'cat-file', '-s', entry.oid)) > 8 * 1024 * 1024) fail('INPUT_TOO_LARGE');
    return git(repositoryRoot, ['cat-file', 'blob', entry.oid]);
  };
  const bytes = read(manifestPath);
  if (bytes.length > 1024 * 1024) fail('PLUGIN_TOO_LARGE');
  const plugin = validatePlugin(JSON.parse(bytes.toString('utf8')));
  if (plugin.target !== target) fail('TARGET_MISMATCH');
  list(changedPaths, p => pluginPath(p), 0, 4096);
  const selected = new Set(),documents=[];
  for (const file of changedPaths) {
    if (file === manifestPath) {
      if (!/^[a-f0-9]{40}$/.test(baselineCommit || '') || text(repositoryRoot, 'merge-base', baselineCommit, candidateCommit) !== baselineCommit) fail('EXPLICIT_METADATA_BASELINE_REQUIRED');
      const previousEntry = manifest(repositoryRoot, baselineCommit).get(manifestPath);
      if (!previousEntry) { for (const unit of plugin.units) selected.add(unit.id); continue; }
      if (!['100644', '100755'].includes(previousEntry.mode) || Number(text(repositoryRoot, 'cat-file', '-s', previousEntry.oid)) > 1024 * 1024) fail('UNSAFE_BASELINE_MANIFEST');
      const previous = validatePlugin(JSON.parse(git(repositoryRoot, ['cat-file', 'blob', previousEntry.oid]).toString('utf8')));
      if (previous.units.some(old => !plugin.units.some(unit => unit.id === old.id))) fail('REMOVED_UNIT_REQUIRES_ATOMIC_MIGRATION');
      for (const unit of plugin.units) if (previous.pluginId !== plugin.pluginId || previous.target !== plugin.target
        || hash(previous.units.find(old => old.id === unit.id) || null) !== hash(unit)) selected.add(unit.id);
      for (const rule of [...previous.coverage, ...plugin.coverage]) if (!previous.coverage.some(old => hash(old) === hash(rule))
        || !plugin.coverage.some(current => hash(current) === hash(rule))) for (const unit of rule.units) selected.add(unit);
      continue;
    }
    const matches = plugin.coverage.filter(r => r.paths.includes(file) || r.prefixes.some(p => file.startsWith(p)));
    if (!matches.length) {
      if(isDocument(file)&&!plugin.units.some(unit=>unit.inputs.includes(file))){documents.push(file);continue;}
      fail('UNMAPPED_PLUGIN_CHANGE', file);
    }
    for (const rule of matches) for (const unit of rule.units) selected.add(unit);
  }
  const units = plugin.units.filter(u => selected.has(u.id)).sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.id.localeCompare(b.id));
  for (const unit of units) for (const capability of unit.requires) if (!CAPABILITIES.includes(capability)) fail('UNSUPPORTED_CAPABILITY', capability);
  const files = new Map();
  const selectedFiles = [...new Set([...units.flatMap(u => u.inputs), ...plugin.migrations, ...documents.filter(f=>entries.has(f))])];
  if (selectedFiles.length > 16384) fail('TOO_MANY_INPUTS');
  const selectedEntries = selectedFiles.map(file => {
    const entry = entries.get(file);
    if (!entry || !['100644', '100755'].includes(entry.mode) || entry.kind !== 'blob') fail('UNSAFE_OR_MISSING_CANDIDATE_INPUT', file);
    return {file, ...entry};
  });
  // Batch Git object reads keep a real compile closure from spawning thousands of Git processes.
  if (selectedEntries.length) {
    const request = selectedEntries.map(e => e.oid).join('\n') + '\n';
    const sizes = git(repositoryRoot, ['cat-file', '--batch-check'], request).toString('utf8').trim().split('\n');
    let total = 0;
    if (sizes.length !== selectedEntries.length) fail('INVALID_CANDIDATE_BATCH');
    sizes.forEach((line, i) => {
      const m = line.match(/^([a-f0-9]{40}) blob (\d+)$/);
      if (!m || m[1] !== selectedEntries[i].oid || Number(m[2]) > 8 * 1024 * 1024) fail('INPUT_TOO_LARGE_OR_INVALID');
      total += Number(m[2]);
    });
    if (total > 128 * 1024 * 1024) fail('INPUT_CLOSURE_TOO_LARGE');
    const contents = git(repositoryRoot, ['cat-file', '--batch'], request); let offset = 0;
    for (const entry of selectedEntries) {
      const end = contents.indexOf(10, offset), header = contents.subarray(offset, end).toString('utf8').match(/^([a-f0-9]{40}) blob (\d+)$/);
      if (!header || header[1] !== entry.oid) fail('INVALID_CANDIDATE_BATCH');
      const start = end + 1, size = Number(header[2]);
      if (contents[start + size] !== 10) fail('TRUNCATED_CANDIDATE_BATCH');
      files.set(entry.file, contents.subarray(start, start + size)); offset = start + size + 1;
    }
    if (offset !== contents.length) fail('EXCESS_CANDIDATE_BATCH_DATA');
  }
  const root = fs.mkdtempSync(path.join(workspaceRoot, 'plugin-source-'));
  try {
    for (const [file, content] of files) {
      const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), {recursive:true});
      fs.writeFileSync(destination, content, {flag:'wx', mode:0o400});
    }
    return freeze({apiVersion:VERSION, pluginId:plugin.pluginId, target, candidateCommit, baselineCommit, manifestDigest:hash(bytes), units,
      inputDigests:Object.fromEntries([...files].map(([f, b]) => [f, hash(b)])), migrations:plugin.migrations,documents,sourceRoot:root,
      close:() => fs.rmSync(root, {recursive:true, force:true})});
  } catch (error) { fs.rmSync(root, {recursive:true, force:true}); throw error; }
}
module.exports = {VERSION, CONTEXT_VERSION, PHASES, CAPABILITIES, validatePlugin, loadReleasePlugin, createReleaseContext, regular, fail,isDocument};
