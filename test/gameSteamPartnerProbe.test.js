const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {gameSteamPartnerProbeCommands} = require('../src/releasePublisherCore');

function probe(options = {}) {
  const command = gameSteamPartnerProbeCommands().at(-1);
  const script = Buffer.from(command.match(/printf %s ([A-Za-z0-9+/=]+)/)[1], 'base64').toString('utf8');
  const key = 'fixture-auth-do-not-print';
  const fixture = {contents: 'steam.web.api.key=' + key + '\nsteam.web-login.api.key=fixture-web-key\n', status: '200', body: {response: {error: {errorcode: 3}}}, ...options};
  const harness = [
    'import json, subprocess, sys, types',
    'from unittest.mock import patch',
    'fixture = json.load(sys.stdin)',
    'sys.argv = ["probe", "healthy-app"]',
    'def read(args, **kwargs):',
    '    assert args == ["docker", "exec", "healthy-app", "cat", "/run/secrets/steam-auth.properties"]',
    '    return fixture["contents"]',
    'def request(args, **kwargs):',
    '    assert "fixture-auth-do-not-print" not in " ".join(args)',
    '    assert "partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/" in kwargs["input"]',
    '    assert "ticket=00" in kwargs["input"]',
    '    if fixture.get("timeout"): raise subprocess.TimeoutExpired(args, 15)',
    '    return types.SimpleNamespace(returncode=0, stdout=json.dumps(fixture["body"]) + "\\n" + fixture["status"])',
    'with patch("subprocess.check_output", side_effect=read), patch("subprocess.run", side_effect=request):',
    '    exec(' + JSON.stringify(script) + ')'
  ].join('\n');
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness], {
    input: JSON.stringify(fixture), encoding: 'utf8', windowsHide: true
  });
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-auth-do-not-print|fixture-web-key/);
  return result;
}

test('Steam probe reads the current immutable credential bundle and sends only an invalid ticket', () => {
  const result = probe();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /game_steam_publisher_key=PASS invalid_ticket_rejected=true/);
});

test('Steam probe refuses malformed bundles, missing keys and unexpected provider responses without leaking credentials', () => {
  for (const options of [{contents: ''}, {contents: 'steam.web.api.key=\n'},
    {contents: 'steam.web.api.key=fixture-auth-do-not-print\nsteam.web.api.key=duplicate\n'},
    {status: '403'}, {body: {response: {error: {errorcode: 4}}}}, {timeout: true}]) {
    const result = probe(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /game_steam_publisher_key=FAIL failureType=/);
  }
});
