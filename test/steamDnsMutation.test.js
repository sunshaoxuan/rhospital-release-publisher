const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {gameFormalComposeCommands} = require('../src/gameFormalProductionTransition');

test('target-source Compose rendering is repeatable and preserves service DNS and unrelated services', () => {
  const root = path.resolve(__dirname, '../.qa');
  fs.mkdirSync(root, {recursive: true});
  const directory = fs.mkdtempSync(path.join(root, 'formal-dns-'));
  try {
    const fixture = {version: '3.8', services: {
      'hospital-backend': {image: 'hospital-backend:${APP_TAG}', environment: {IMAGE_TAG: '${APP_TAG}', SPRING_PROFILE: 'prod'},
        dns: ['1.1.1.1', '8.8.8.8'], secrets: [{source: 'existing', target: 'steam-auth.properties'}],
        deploy: {replicas: 1, update_config: {order: 'start-first'}}, networks: ['default']},
      other: {image: 'postgres:16', dns: ['9.9.9.9']}
    }, secrets: {existing: {external: true}}, networks: {default: {driver: 'overlay'}}};
    const source = JSON.stringify(fixture);
    const commands = gameFormalComposeCommands(source, 'hospital-backend:test', 'test');
    const encoded = commands.find(command => command.includes('| base64 -d | docker stack config')).match(/printf %s "([^"]+)"/)[1];
    assert.equal(Buffer.from(encoded, 'base64').toString(), source);
    const execute = () => {
      const rendered = spawnSync('docker', ['stack', 'config', '-c', '-'],
        {input: source, env: {...process.env, APP_TAG: 'test'}, encoding: 'utf8', windowsHide: true});
      assert.equal(rendered.status, 0, rendered.stderr);
      const stackValidation = spawnSync('docker', ['stack', 'config', '-c', '-'],
        {input: rendered.stdout, encoding: 'utf8', windowsHide: true});
      assert.equal(stackValidation.status, 0, stackValidation.stderr);
      const result = spawnSync('docker', ['compose', '--project-directory', directory, '-f', '-', 'config', '--format', 'json'],
        {input: rendered.stdout, env: {...process.env, APP_TAG: 'test'}, encoding: 'utf8', windowsHide: true});
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const actual = execute();
    assert.deepEqual(execute(), actual);
    assert.deepEqual(actual.services['hospital-backend'].dns, ['1.1.1.1', '8.8.8.8']);
    assert.deepEqual(actual.services.other.dns, ['9.9.9.9']);
    assert.equal(actual.services['hospital-backend'].image, 'hospital-backend:test');
    assert.equal(actual.services['hospital-backend'].environment.IMAGE_TAG, 'test');
    assert.equal(actual.services['hospital-backend'].deploy.update_config.order, 'start-first');
    assert.equal(actual.services['hospital-backend'].secrets[0].target, 'steam-auth.properties');
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    assert.ok(directory.startsWith(root + path.sep));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
