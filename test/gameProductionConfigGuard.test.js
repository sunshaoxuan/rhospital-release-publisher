const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {gameProductionConfigGuardCommands, gameStripeAuthenticationCommands, gameProductionImageConfigCommands} = require('../src/gameProductionConfigGuard');

function pythonScript(command) {
  return Buffer.from(command.match(/printf %s ["']([^"']+)["']/)[1], 'base64').toString('utf8');
}

function productionFixture() {
  const environment = {SPRING_PROFILE: 'prod', JAVA_OPTS: '-Xmx512m', JAVA_EXTRA_OPTS: '', IMAGE_TAG: 'old',
    SNAIL_JOB_ENABLED: 'true', STEAM_MICROTXN_SANDBOX: 'false', FORUM_SSO_ENABLED: 'true',
    SPRING_DATASOURCE_URL: 'jdbc:postgresql://92.113.124.185:35433/hospital', SPRING_DATASOURCE_USERNAME: 'hospital'};
  const mappings = [['game_stripe_api_key', 'stripe.api.key'], ['game_stripe_webhook_secret', 'stripe.webhook.secret'], ['game_spring_datasource_url', 'spring.datasource.url']];
  return {
    compose: {services: {'hospital-backend': {environment, command: null, entrypoint: null,
      volumes: [{type: 'bind', source: '/production/data', target: '/data'}],
      secrets: mappings.map(([source, target]) => ({source, target}))}},
    secrets: Object.fromEntries(mappings.map(([name]) => [name, {name, external: true}]))},
    live: [{Spec: {TaskTemplate: {ContainerSpec: {
      Image: 'hospital-backend:old', Env: Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      Mounts: [{Type: 'bind', Source: '/production/data', Target: '/data'}],
      Secrets: mappings.map(([SecretName, Name]) => ({SecretName, File: {Name}}))
    }}}}]
  };
}

function runGuard(fixture) {
  let script = pythonScript(gameProductionConfigGuardCommands()[0]);
  if (fixture.approved_digest) script = script.replace('61529d8807e2a443383462e6c2a39eb2ef521c2c08399dfb6919e2f1933b22d0', fixture.approved_digest);
  const harness = [
    'import io, json, subprocess, sys, types',
    'from unittest.mock import patch',
    'fixture = json.load(sys.stdin)',
    'sys.argv = ["guard", "fixture.json", "hospital_stack_hospital-backend", "formal" if fixture.get("transition") else "strict"]',
    'def inspect(args, **options):',
    '    assert args == ["docker", "service", "inspect", sys.argv[2]]',
    '    if fixture.get("inspect_error"): raise subprocess.CalledProcessError(1, args, stderr="private-do-not-print")',
    '    return types.SimpleNamespace(stdout=json.dumps(fixture["live"]))',
    'with patch("builtins.open", return_value=io.StringIO(json.dumps(fixture["compose"]))), patch("subprocess.run", side_effect=inspect):',
    '    exec(' + JSON.stringify(script) + ')'
  ].join('\n');
  return spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness],
    {input: JSON.stringify(fixture), encoding: 'utf8', windowsHide: true});
}

function recoveryFixture() {
  const fixture = productionFixture();
  const live = fixture.live[0].Spec.TaskTemplate.ContainerSpec;
  live.Env = live.Env.map(value => value === 'SPRING_PROFILE=prod' ? 'SPRING_PROFILE=dr' : value);
  live.Command = ['/bin/bash'];
  live.Args = ['-c', 'exec java -jar /app/app.jar'];
  live.Mounts[0].Source = '/recovery/data';

  // Compute the same recursive canonical form as Python json.dumps(sort_keys=True).
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  fixture.approved_digest = require('node:crypto').createHash('sha256').update(JSON.stringify(sort(fixture.live[0].Spec))).digest('hex');
  fixture.transition = true;
  return fixture;
}

test('formal handoff accepts only the exact approved recovery source and a valid production target', () => {
  const fixture = recoveryFixture();
  assert.equal(runGuard(fixture).status, 0);
  fixture.transition = false;
  assert.notEqual(runGuard(fixture).status, 0);
});

test('formal handoff refuses changed recovery state and unsafe target configurations', () => {
  for (const mutate of [
    f => f.live[0].Spec.TaskTemplate.ContainerSpec.Env.push('SNAIL_JOB_ENABLED=false'),
    f => f.live[0].Spec.TaskTemplate.ContainerSpec.Secrets.pop(),
    f => f.live[0].Spec.Mode = {Replicated: {Replicas: 2}},
    f => f.compose.services['hospital-backend'].environment.SNAIL_JOB_ENABLED = 'false',
    f => f.compose.services['hospital-backend'].environment.FORUM_SSO_ENABLED = 'false',
    f => f.compose.services['hospital-backend'].environment.SPRING_PROFILE = 'dr',
    f => f.compose.services['hospital-backend'].command = ['unsafe-override']
  ]) {
    const fixture = recoveryFixture();
    mutate(fixture);
    assert.notEqual(runGuard(fixture).status, 0);
  }
});

test('production guard accepts a matching baseline and only ignores the release version', () => {
  const fixture = productionFixture();
  fixture.compose.services['hospital-backend'].environment.IMAGE_TAG = 'next';
  const result = runGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /game_compose_live_config=PASS/);
});

test('production guard rejects disabled restored services and the old database even when Compose matches live', () => {
  for (const [key, value] of [['SNAIL_JOB_ENABLED', 'false'], ['STEAM_MICROTXN_SANDBOX', 'true'],
    ['FORUM_SSO_ENABLED', 'false'],
    ['SPRING_DATASOURCE_URL', 'jdbc:postgresql://92.113.124.185:35432/hospital']]) {
    const fixture = productionFixture();
    fixture.compose.services['hospital-backend'].environment[key] = value;
    fixture.live[0].Spec.TaskTemplate.ContainerSpec.Env = Object.entries(fixture.compose.services['hospital-backend'].environment).map(([k, v]) => k + '=' + v);
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /production_services/);
  }
});

for (const [field, mutate] of [
  ['environment', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Env.push('SPRING_DATASOURCE_URL=private-database-value')],
  ['mounts', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Mounts[0].Source = '/recovery/data'],
  ['secrets', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Secrets.pop()],
  ['command', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Args = ['--spring.config.import=private-import-value']],
  ['entrypoint', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Command = ['/bin/sh']],
  ['configs', fixture => fixture.live[0].Spec.TaskTemplate.ContainerSpec.Configs = [{ConfigName: 'private-config-value'}]]
]) {
  test(`production guard refuses ${field} drift without revealing values`, () => {
    const fixture = productionFixture();
    mutate(fixture);
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, new RegExp(`fields=.*${field}`));
    assert.doesNotMatch(result.stdout + result.stderr, /private-|recovery\/data/);
  });
}

test('production guard refuses placeholders, duplicate env fields and arbitrary startup overrides', () => {
  for (const mutation of [
    fixture => { fixture.compose.services['hospital-backend'].environment.STRIPE_API_KEY = 'placeholder'; },
    fixture => { fixture.live[0].Spec.TaskTemplate.ContainerSpec.Env.push('SPRING_PROFILE=prod'); },
    fixture => { fixture.compose.services['hospital-backend'].command = ['java', '--stripe.api.key=placeholder']; },
    fixture => { fixture.compose.services['hospital-backend'].secrets[0].target = 'other'; },
    fixture => { fixture.compose.services['hospital-backend'].environment.SPRING_PROFILE = 'dr'; }
  ]) {
    const fixture = productionFixture();
    mutation(fixture);
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /placeholder/);
  }
});

test('production guard rejects JVM property overrides even when Compose and service match', () => {
  for (const property of ['stripe.api.key', 'stripe.webhook.secret', 'spring.config.import', 'spring.config.location', 'spring.config.additional-location', 'spring.profiles.active']) {
    const fixture = productionFixture();
    const options = `-D${property}=private-override-value`;
    fixture.compose.services['hospital-backend'].environment.JAVA_EXTRA_OPTS = options;
    fixture.live[0].Spec.TaskTemplate.ContainerSpec.Env = fixture.live[0].Spec.TaskTemplate.ContainerSpec.Env.map(item => item.startsWith('JAVA_EXTRA_OPTS=') ? `JAVA_EXTRA_OPTS=${options}` : item);
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /property_override/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-override-value/);
  }
});

test('production guard fails closed on invalid input and Docker read failures', () => {
  for (const mutation of [fixture => {fixture.inspect_error = true;}, fixture => {fixture.compose = {};}, fixture => {fixture.live = [];}]) {
    const fixture = productionFixture();
    mutation(fixture);
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /FAIL failureType=/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-do-not-print/);
  }
});

function runAuthentication(input = {}) {
  const script = pythonScript(gameStripeAuthenticationCommands()[0]);
  const fixture = {key: ['sk', 'live', 'fixtureDoNotPrint'].join('_'), status: '200', body: {livemode: true}, ...input};
  const harness = [
    'import json, subprocess, sys, types',
    'from unittest.mock import patch',
    'fixture = json.load(sys.stdin)',
    'sys.argv = ["auth", "healthy-container"]',
    'def read_key(args, **options):',
    '    assert args == ["docker", "exec", "healthy-container", "cat", "/run/secrets/stripe.api.key"]',
    '    if fixture.get("missing_secret"): raise subprocess.CalledProcessError(1, args, stderr=fixture["key"])',
    String.raw`    return fixture["key"] + "\r\n"`,
    'def request(args, **options):',
    '    assert args[:6] == ["docker", "exec", "-i", "healthy-container", "curl", "--config"]',
    '    assert "--request" not in args and "--data" not in args',
    '    assert fixture["key"] not in " ".join(args)',
    '    assert "https://api.stripe.com/v1/balance" in options["input"]',
    '    assert "Authorization: Bearer " + fixture["key"] in options["input"]',
    '    if fixture.get("timeout"): raise subprocess.TimeoutExpired(args, 20, stderr=fixture["key"])',
    String.raw`    return types.SimpleNamespace(stdout=json.dumps(fixture["body"]) + "\n" + fixture["status"], returncode=0)`,
    'with patch("subprocess.check_output", side_effect=read_key), patch("subprocess.run", side_effect=request):',
    '    exec(' + JSON.stringify(script) + ')'
  ].join('\n');
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness],
    {input: JSON.stringify(fixture), encoding: 'utf8', windowsHide: true});
  assert.equal((result.stdout + result.stderr).includes(fixture.key), false);
  return result;
}

test('Stripe runtime authentication uses a noncharging GET with the secret on stdin', () => {
  const result = runAuthentication();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /game_stripe_authentication=PASS live=true method=GET/);
});

test('Stripe runtime authentication rejects invalid, missing, test or unavailable credentials', () => {
  for (const input of [{status: '401'}, {body: {livemode: false}}, {key: 'placeholder'},
    {key: ['sk', 'test', 'fixture'].join('_')}, {missing_secret: true}, {timeout: true}]) {
    const result = runAuthentication(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /game_stripe_authentication=FAIL failureType=/);
  }
});

test('actual image contract accepts configtree and rejects missing imports or embedded credentials', () => {
  const qaRoot = path.resolve(__dirname, '../.qa');
  fs.mkdirSync(qaRoot, {recursive: true});
  const directory = fs.mkdtempSync(path.join(qaRoot, 'stripe-image-'));
  const properties = path.join(directory, 'BOOT-INF/classes/application-prod.properties');
  fs.mkdirSync(path.dirname(properties), {recursive: true});
  const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
  try {
    for (const [text, passes] of [
      ['spring.config.import=configtree:/run/secrets/,file:/run/secrets/steam-auth.properties,file:/run/secrets/snail-job.properties\n', true],
      ['spring.config.import=configtree:/run/secrets/,file:/run/secrets/steam-auth.properties,file:/run/secrets/snail-job.properties\r\n', true],
      ['spring.config.import=configtree:/run/secrets/,file:/run/secrets/steam-auth.properties,file:/run/secrets/snail-job.properties,optional:file:/private.properties\r\n', false],
      ['spring.config.import=configtree:/run/secrets/\n', false],
      ['spring.config.import=optional:configtree:/run/secrets/\n', false],
      ['spring.config.import=classpath:application-dev.properties\n', false],
      ['spring.config.import=configtree:/run/secrets/,file:/private.properties\n', false],
      ['spring.config.import=configtree:/run/secrets/\nstripe.api.key=placeholder\n', false],
      ['spring.config.import=configtree:/run/secrets/\nstripe.webhook.secret=placeholder\n', false],
      ['spring.config.import=configtree:/run/secrets/\nspring.config.import=classpath:application-dev.properties\n', false],
      ['spring.config.import=configtree:/run/secrets/\n stripe.api.key : placeholder\n', false]
    ]) {
      fs.writeFileSync(properties, text);
      const result = spawnSync(bash, ['-c', 'set -eu\n' + gameProductionImageConfigCommands().join('\n')],
        {cwd: directory, encoding: 'utf8', windowsHide: true});
      assert.equal(result.status === 0, passes, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /placeholder/);
    }
  } finally {
    assert.ok(directory.startsWith(qaRoot + path.sep));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
