const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test, temporaryDirectory} = require('./helpers/ownedFixtures').fixtureLifecycle(require('node:test'));
const {git} = require('../src/changeValidationGit');
const {createPlanSourceReader} = require('../src/releasePlanSources');

test('plan sources bind committed bytes, missing files and demand reads to one candidate', () => {
  const root = temporaryDirectory('release-publisher-plan-sources-');
  git(root, ['init', '-b', 'master']);
  const texts = {'one.txt':'中文\n二行\n', 'empty.txt':'', 'extra.txt':'no trailing newline\0tail'};
  for (const [name, text] of Object.entries(texts)) fs.writeFileSync(path.join(root, name), text);
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const commit = git(root, ['rev-parse', 'HEAD']).toString().trim();
  fs.writeFileSync(path.join(root, 'one.txt'), 'dirty');
  fs.writeFileSync(path.join(root, 'missing.txt'), 'uncommitted');
  const read = createPlanSourceReader(root, commit, ['one.txt', 'empty.txt', 'missing.txt', 'one.txt']);
  assert.equal(read('one.txt', true), texts['one.txt']);
  assert.equal(read('empty.txt', true), '');
  assert.equal(read('extra.txt', true), texts['extra.txt']);
  assert.equal(read('missing.txt'), '');
  assert.throws(() => read('missing.txt', true), /Missing candidate source/);
  assert.equal(createPlanSourceReader(root, commit.slice(0, 9), ['one.txt'])('one.txt'), texts['one.txt']);
  assert.equal(createPlanSourceReader(root, 'latest', ['one.txt'])('one.txt'), 'dirty');
  assert.throws(() => createPlanSourceReader(root, 'HEAD', []), /Invalid plan source commit/);
  for (const file of ['../one.txt','/one.txt','x\ny','a\\b','x:y','a//b']) {
    assert.throws(() => read(file), /Invalid plan source path/);
  }
});

test('one initial batch deduplicates files and malformed framing cannot yield source', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/releasePlanSources.js'), 'utf8');
  function load(reply) {
    const calls = [];
    const module = {exports:{}};
    vm.runInNewContext(source, {module, Buffer, require(name) {
      if (name === './changeValidationGit') return {git(root,args,input) { calls.push({args,input}); return reply; }};
      return require(name);
    }});
    return {create:module.exports.createPlanSourceReader,calls};
  }
  const ref = 'a'.repeat(40), oid = 'b'.repeat(40);
  const fixture = load(Buffer.from(`${oid} blob 2\nok\n${ref}:absent missing\n`));
  const read = fixture.create('.', ref, ['a','absent','a']);
  assert.equal(read('a'), 'ok'); assert.equal(read('absent'), ''); assert.equal(read('a'), 'ok');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].input, `${ref}:a\n${ref}:absent\n`);
  for (const reply of ['',`${oid} tree 2\nok\n`,`${oid} blob 8\nok\n`,`${oid} blob 2\nokX`,`${oid} blob 2\nok\nextra`]) {
    assert.throws(() => load(Buffer.from(reply)).create('.', ref, ['a']), /plan source/);
  }
});
