const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const test = require('node:test');
const path = require('node:path');

let rehearsalModule;

test('remote rehearsal config requires an isolated root and distinct gateway identities', async () => {
  rehearsalModule = rehearsalModule || await import('../scripts/game-static-assets.mjs');
  const production = {
    gateways: [
      {id: 'prod-a', host: 'prod-a.example', username: 'tester', port: '22', domain: 'rhospital.cc', remoteAssetRoot: '/var/lib/assets'},
      {id: 'prod-b', host: 'prod-b.example', username: 'tester', port: '22', domain: 'rhospital.cc', remoteAssetRoot: '/var/lib/assets'}
    ]
  };
  const rehearsal = {
    environment: 'rehearsal',
    gateways: [
      {id: 'stage-a', host: 'stage-a.example', username: 'tester', port: '22', domain: 'stage.rhospital.test', remoteAssetRoot: '/tmp/rhospital-release-rehearsal'},
      {id: 'stage-b', host: 'stage-b.example', username: 'tester', port: '22', domain: 'stage.rhospital.test', remoteAssetRoot: '/tmp/rhospital-release-rehearsal'}
    ]
  };

  assert.equal(rehearsalModule.validateRehearsalConfig(rehearsal, production).length, 2);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({
    ...rehearsal,
    gateways: [{...rehearsal.gateways[0], host: 'prod-a.example', domain: 'rhospital.cc'}, rehearsal.gateways[1]]
  }, production), /duplicates a production gateway identity/);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({
    ...rehearsal,
    gateways: [{...rehearsal.gateways[0], remoteAssetRoot: '/var/lib/assets'}, rehearsal.gateways[1]]
  }, production), /must use \/tmp\/rhospital-release-rehearsal/);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({...rehearsal, environment: 'production'}, production), /environment=rehearsal/);
});

test('production host rehearsal requires explicit scope and reuses exact production SSH identities', async () => {
  rehearsalModule = rehearsalModule || await import('../scripts/game-static-assets.mjs');
  const production = {
    gateways: [
      {id: 'riven-45', host: '45.94.40.77', username: 'root', port: '22', keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem', domain: 'rhospital.cc', remoteAssetRoot: '/var/lib/rhospital-assets'},
      {id: 'vmiss-64', host: '64.83.37.55', username: 'root', port: '3022', keyPath: 'C:\\workspace\\Secure\\sunsxaws.pem', domain: 'rhospital.cc', remoteAssetRoot: '/opt/1panel/www/sites/rhospital.cc/index/rhospital-assets'}
    ]
  };
  const rehearsal = {
    environment: 'rehearsal',
    allowProductionHosts: true,
    scope: 'production-temp-root',
    gateways: production.gateways.map(gateway => ({
      ...gateway,
      id: `${gateway.id}-rehearsal`,
      remoteAssetRoot: '/tmp/rhospital-release-rehearsal'
    }))
  };

  assert.equal(rehearsalModule.validateRehearsalConfig(rehearsal, production).length, 2);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({...rehearsal, scope: 'isolated-frontends'}, production), /scope=production-temp-root/);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({
    ...rehearsal,
    gateways: [{...rehearsal.gateways[0], host: '45.94.40.78'}, rehearsal.gateways[1]]
  }, production), /must match a production gateway identity/);
  assert.throws(() => rehearsalModule.validateRehearsalConfig({
    ...rehearsal,
    gateways: [{...rehearsal.gateways[0], keyPath: 'C:\\workspace\\Secure\\other.pem'}, rehearsal.gateways[1]]
  }, production), /must reuse production SSH credentials/);
});

test('remote rehearsal script covers create, delete detection, restore and cleanup', async () => {
  rehearsalModule = rehearsalModule || await import('../scripts/game-static-assets.mjs');
  const script = rehearsalModule.buildRehearsalRemoteScript();

  assert.match(script, /scp|tar -xzf/);
  assert.match(script, /rehearsal_create_validate=PASS/);
  assert.match(script, /rm -f "\$first_destination"/);
  assert.match(script, /rehearsal_delete_detection=PASS/);
  assert.match(script, /rehearsal_restore_validate=PASS/);
  assert.match(script, /gateway_static_rehearsal=PASS/);
  assert.match(script, /if ! test -f "\$source_file" \|\| ! test -f "\$destination"; then\s+return 1/);
  assert.match(script, /rm -rf "\$run_root"/);
  assert.match(script, /rmdir "\$base"/);
  assert.match(script, /test ! -e "\$base"/);
});

test('remote rehearsal forwards gateway PASS markers to the publisher log', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'game-static-assets.mjs'), 'utf8');
  assert.match(source, /const output = run\('ssh'/);
  assert.match(source, /output\.split\(\/\\r\?\\n\/\)\.filter\(Boolean\)\.forEach|for \(const line of output\.split/);
  assert.match(source, /console\.log\(line\)/);
});

test('remote rehearsal command requires a production gateway config', () => {
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '..', 'scripts', 'game-static-assets.mjs'),
    '--mode', 'rehearse',
    '--image', 'rhospital/game:demo',
    '--app-tag', 'demo'
  ], {encoding: 'utf8'});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--production-config is required for rehearsal/);
});
