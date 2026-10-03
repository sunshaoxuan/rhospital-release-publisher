const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {gameServiceSnapshotCommands, gameFormalComposeCommands} = require('../src/gameFormalProductionTransition');

function snapshotResult(mode, change) {
  const command = gameServiceSnapshotCommands(mode)[0];
  const script = Buffer.from(command.match(/printf %s "([^"]+)"/)[1], 'base64').toString();
  const spec = {TaskTemplate: {ContainerSpec: {Image: 'hospital-backend:recovered',
    Env: ['SNAIL_JOB_ENABLED=true', 'SPRING_DATASOURCE_URL=current-db'], Secrets: [{SecretID: 'restored'}]}}};
  const live = {Spec: structuredClone(spec), PreviousSpec: structuredClone(spec)};
  if (change) change(live);
  const harness = [
    'import io,json,sys,subprocess',
    'from unittest.mock import patch',
    'f=json.load(sys.stdin)',
    `sys.argv=['snapshot','backup.json','game','${mode}']`,
    'with patch("builtins.open",return_value=io.StringIO(json.dumps([{"Spec":f["spec"]}]))), patch("subprocess.check_output",return_value=json.dumps([f["live"]]).encode()):',
    '    exec(' + JSON.stringify(script) + ')'
  ].join('\n');
  return spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness],
    {input: JSON.stringify({spec, live}), encoding: 'utf8', windowsHide: true});
}

test('snapshot gate verifies the current source and the exact Docker previous configuration', () => {
  assert.equal(snapshotResult('current').status, 0);
  assert.equal(snapshotResult('rollback').status, 0);
  assert.equal(snapshotResult('restored', live => {live.Spec.TaskTemplate.ForceUpdate = 1;}).status, 0);
  assert.notEqual(snapshotResult('current', live => {live.Spec.Mode = {Replicated: {Replicas: 2}};}).status, 0);
  for (const mode of ['current', 'rollback']) {
    assert.notEqual(snapshotResult(mode, live => {
      live[mode === 'rollback' ? 'PreviousSpec' : 'Spec'].TaskTemplate.ContainerSpec.Env[0] = 'SNAIL_JOB_ENABLED=false';
    }).status, 0);
    assert.notEqual(snapshotResult(mode, live => {
      live[mode === 'rollback' ? 'PreviousSpec' : 'Spec'].TaskTemplate.ContainerSpec.Secrets[0].SecretID = 'obsolete';
    }).status, 0);
  }
});

test('formal Compose generation uses the target source and pins both version fields', () => {
  assert.throws(() => gameFormalComposeCommands('', 'hospital-backend:next', 'next'));
  const source = 'services:\n  hospital-backend:\n    image: hospital-backend:${APP_TAG}\n';
  const commands = gameFormalComposeCommands(source, 'hospital-backend:next', 'next').join('\n');
  assert.ok(commands.includes(Buffer.from(source).toString('base64')));
  assert.match(commands, /APP_TAG='next' HOST_IP=92\.113\.124\.185/);
  assert.match(commands, /--arg image 'hospital-backend:next' --arg version 'next'/);
  assert.doesNotMatch(commands, /stack deploy|service update|cp .*docker-compose.yml/);
});
