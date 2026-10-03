const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('static asset manifest parser and artifact validator verify full hashes and object paths', async () => {
  const module = await import('../scripts/game-static-assets.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-asset-artifact-'));
  try {
    const body = Buffer.from('immutable asset');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const entry = {
      publicHash: sha256.slice(0, 20),
      sha256,
      size: body.length,
      publicPath: '/js/example.js'
    };
    const objectPath = path.join(root, module.objectRelativePath(entry));
    fs.mkdirSync(path.dirname(objectPath), { recursive: true });
    fs.writeFileSync(objectPath, body);
    fs.writeFileSync(path.join(root, 'manifest.tsv'),
      `${entry.publicHash}\t${entry.sha256}\t${entry.size}\t${entry.publicPath}\n`);

    assert.deepEqual(module.validateArtifact(root), [entry]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('static asset manifest parser rejects traversal and truncated hashes', async () => {
  const { parseManifest } = await import('../scripts/game-static-assets.mjs');
  assert.throws(() => parseManifest(`abc\tabc\t1\t/../escape.js\n`), /invalid hash/);
  const hash = 'a'.repeat(20);
  const sha = `${hash}${'b'.repeat(44)}`;
  assert.throws(() => parseManifest(`${hash}\t${sha}\t1\t/../escape.js\n`), /unsafe public path/);
});

test('gateway verifier enforces the root scope header for the content addressed service worker', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'game-static-assets.mjs'), 'utf8');
  assert.match(source, /entry\.publicPath === '\/sw\.js'/);
  assert.match(source, /service-worker-allowed/);
  assert.match(source, /does not allow the root service worker scope/);
});

test('route preflight samples a real manifest entry and rejects a failed gateway probe', async () => {
  const { latestGatewayManifestEntry, verifyGatewayRoutes } = await import('../scripts/game-static-assets.mjs');
  const sha256 = crypto.createHash('sha256').update('asset').digest('hex');
  const line = `${sha256.slice(0, 20)}\t${sha256}\t5\t/CHANGELOG.md`;
  let command;
  const gateway = {id: 'gate', host: 'example.test', username: 'root', remoteAssetRoot: '/objects'};
  const entry = latestGatewayManifestEntry(gateway, (tool, args, options) => {
    command = {tool, args, input: options.input};
    return line;
  });
  assert.equal(command.tool, 'ssh');
  assert.deepEqual(command.args.slice(-4), ['bash', '-s', '--', '/objects']);
  assert.match(command.input, /find "\$root\/manifests"/);
  assert.equal(entry.publicPath, '/CHANGELOG.md');
  const probed = [];
  await verifyGatewayRoutes([gateway], () => entry, async (target, sample) => {
    probed.push([target.id, sample.publicPath]);
  });
  assert.deepEqual(probed, [['gate', '/CHANGELOG.md']]);
  await assert.rejects(() => verifyGatewayRoutes([gateway], () => entry, async () => {
    throw new Error('missing LOCAL object');
  }), /missing LOCAL object/);
});
