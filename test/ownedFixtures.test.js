const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {fixtureLifecycle} = require('./helpers/ownedFixtures');

function harness(options) {
  const callbacks = [];
  const lifecycle = fixtureLifecycle((name, body) => callbacks.push(body), options);
  const hooks = [];
  return {...lifecycle, callbacks, hooks, run: index => callbacks[index]({after: fn => hooks.push(fn)})};
}

test('owned fixtures clean success, rejected async work and initialization failure', async () => {
  for (const fail of [false, true]) {
    const h = harness();
    let root;
    h.test('fixture', async () => {
      root = h.temporaryDirectory('release-publisher-lifecycle-');
      fs.writeFileSync(path.join(root, 'fixture'), 'owned');
      await Promise.resolve();
      if (fail) throw new Error('initialization failed');
    });
    if (fail) await assert.rejects(h.run(0), /initialization failed/);
    else await h.run(0);
    assert.ok(fs.existsSync(root));
    h.hooks[0]();
    assert.equal(fs.existsSync(root), false);
  }
});

test('owned fixtures refuse active, leased and unrelated directories', async () => {
  const h = harness();
  let root, release;
  assert.throws(() => h.temporaryDirectory('release-publisher-test-'), /owning test/);
  assert.throws(() => h.cleanup(os.tmpdir()), /unowned/);
  h.test('fixture', () => {
    assert.throws(() => h.temporaryDirectory('../escape'), /prefix/);
    root = h.temporaryDirectory('release-publisher-lifecycle-');
    assert.throws(() => h.cleanup(root), /still in use/);
    release = h.hold(root);
  });
  await h.run(0);
  assert.throws(h.hooks[0], /still in use/);
  assert.ok(fs.existsSync(root));
  release(); release();
  h.cleanup(root);
  assert.equal(fs.existsSync(root), false);
});

test('owned fixtures retain changed identity and report deletion errors', async () => {
  const h = harness();
  let root;
  h.test('fixture', () => { root = h.temporaryDirectory('release-publisher-lifecycle-'); });
  await h.run(0);
  const original = `${root}-original`;
  try { fs.renameSync(root, original); }
  catch (error) { h.cleanup(root); throw error; }
  fs.mkdirSync(root);
  try {
    assert.throws(h.hooks[0], /identity changed/);
    assert.ok(fs.existsSync(root));
  } finally {
    fs.rmdirSync(root);
    fs.renameSync(original, root);
    h.cleanup(root);
  }
  let calls = 0;
  const failing = harness({remove: () => { calls++; throw new Error('EBUSY'); }});
  failing.test('fixture', () => { root = failing.temporaryDirectory('release-publisher-lifecycle-'); });
  await failing.run(0);
  try { assert.throws(failing.hooks[0], /EBUSY/); assert.equal(calls, 1); }
  finally { fs.rmdirSync(root); failing.cleanup(root); }
});

test('owned fixtures isolate concurrent owners and accept already released roots', async () => {
  const h = harness();
  const roots = [];
  let finish;
  h.test('first', async () => {
    roots[0] = h.temporaryDirectory('release-publisher-lifecycle-');
    await new Promise(resolve => { finish = resolve; });
  });
  h.test('second', () => { roots[1] = h.temporaryDirectory('release-publisher-lifecycle-'); });
  const first = h.run(0);
  await h.run(1);
  h.hooks[1]();
  assert.ok(fs.existsSync(roots[0]));
  finish(); await first;
  fs.rmdirSync(roots[0]);
  h.hooks[0]();
});

test('owned fixtures do not follow a nested directory link outside their root', async () => {
  const h = harness();
  let root, outside;
  h.test('fixture', () => {
    root = h.temporaryDirectory('release-publisher-lifecycle-');
    outside = h.temporaryDirectory('release-publisher-lifecycle-');
    fs.writeFileSync(path.join(outside, 'keep'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  });
  await h.run(0);
  h.hooks[0]();
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'outside');
  h.hooks[1]();
});

test('owned fixtures real node test hooks clean passed and failed Git fixtures', () => {
  const outer = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'release-publisher-lifecycle-proof-'));
  const worker = path.join(outer, 'worker.cjs');
  const manifest = path.join(outer, 'roots.jsonl');
  fs.writeFileSync(path.join(outer, 'unrelated'), 'keep');
  fs.writeFileSync(worker, `
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {test,temporaryDirectory}=require(${JSON.stringify(require.resolve('./helpers/ownedFixtures'))}).fixtureLifecycle(require('node:test'));
for(const fails of [false,true]) test('worker '+fails,async()=>{
 const root=temporaryDirectory('release-publisher-lifecycle-worker-');
 fs.appendFileSync(${JSON.stringify(manifest)},JSON.stringify(root)+'\\n');
 const git=spawnSync('git',['init',root],{encoding:'utf8'});
 if(git.status!==0) throw Error('Git fixture failed: '+git.stderr);
 fs.writeFileSync(path.join(root,'file'),'fixture');
 await Promise.resolve();
 if(fails) throw Error('expected fixture population failure');
});
`);
  try {
    const env = {...process.env, NODE_OPTIONS: ''};
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', worker], {encoding: 'utf8', timeout: 30000, env});
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /expected fixture population failure/);
    const roots = fs.readFileSync(manifest, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(roots.length, 2);
    for (const root of roots) assert.equal(fs.existsSync(root), false, root);
    assert.equal(fs.readFileSync(path.join(outer, 'unrelated'), 'utf8'), 'keep');
  } finally {
    assert.equal(path.dirname(outer), fs.realpathSync(os.tmpdir()));
    fs.rmSync(outer, {recursive: true});
  }
});
