const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function harness(requestJson, appTag = '20261005') {
  const shown = [];
  const pipeline = {
    children: ['old error'],
    replaceChildren() { this.children = []; },
    setAttribute() {}
  };
  const fields = {
    targetImageFlow: {classList: {contains: () => false}},
    targetImage: {},
    productionImageFlow: {classList: {contains: () => false}}
  };
  const context = vm.createContext({
    planRequestId: 0,
    pipeline,
    fields,
    payload: () => ({appTag}),
    requestJson,
    setStatus: value => shown.push(value),
    setLoadingValue() {},
    setStaticValue() {},
    renderPlan: value => shown.push(value.id),
    renderPlanError: value => shown.push(value)
  });
  const loading = source.slice(source.indexOf('  function renderPlanLoading()'), source.indexOf('  function renderPlanError('));
  const planning = source.slice(source.indexOf('  async function plan()'), source.indexOf('  async function execute()'));
  vm.runInContext(`${loading}\n${planning}`, context);
  return {context, shown, pipeline};
}

test('new plan clears a previous error and late failure cannot replace its success', async () => {
  const old = deferred();
  const current = deferred();
  let calls = 0;
  const h = harness(() => ++calls === 1 ? old.promise : current.promise);
  const first = h.context.plan();
  assert.deepEqual(h.pipeline.children, []);
  const second = h.context.plan();
  current.resolve({id: 'current'});
  await second;
  old.reject(new Error('APP_TAG invalid'));
  assert.equal(await first, null);
  assert.ok(h.shown.includes('current'));
  assert.ok(!h.shown.includes('APP_TAG invalid'));
});

test('a new config load invalidates an outstanding plan response', async () => {
  const old = deferred();
  const h = harness(() => old.promise);
  const first = h.context.plan();
  h.context.planRequestId += 1;
  h.context.renderPlanLoading();
  old.resolve({id: 'old'});
  assert.equal(await first, null);
  assert.ok(!h.shown.includes('old'));
});

test('empty tag waits for configuration without submitting an invalid plan', async () => {
  const h = harness(() => { throw new Error('unexpected plan request'); }, '');
  assert.equal(await h.context.plan(), null);
  assert.ok(h.shown.includes('等待镜像 TAG'));
  assert.deepEqual(h.pipeline.children, []);
});
