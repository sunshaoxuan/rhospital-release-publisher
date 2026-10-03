const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const {gameDatabaseContainerResolutionCommands, gameDatabasePsqlCommand} = require('../src/gameProductionDatabase');
const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';

function probe(overrides = {}, requireHealthyGame = true) {
  const mock = String.raw`docker() {
    if [ "$1" = ps ]; then
      case "$*" in
        *swarm.service.name*) printf '%s\n' "$MOCK_APP" ;;
        *) printf '%s\n' "$MOCK_DB" ;;
      esac
    elif [ "$1" = service ] && [ "$2" = inspect ]; then
      printf 'SPRING_DATASOURCE_URL=%s\n' "$MOCK_URL"
    elif [ "$1" = exec ] && [ "$2" = healthy-app ]; then
      printf '%s' "$MOCK_URL"
    elif [ "$1" = exec ] && [ "$2" = production-db ]; then
      case "$*" in *'psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 35433 -U hospital -d hospital -At -F | -c BEGIN READ ONLY;'*) ;; *) return 9 ;; esac
      [ "$MOCK_PSQL_FAIL" != true ] || return 8
      printf '%s\n' BEGIN "$MOCK_IDENTITY" ROLLBACK
    else return 7; fi
  }
  `;
  return spawnSync(bash, ['-s'], {
    input: 'set -euo pipefail\n' + mock + gameDatabaseContainerResolutionCommands(requireHealthyGame).join('\n'),
    encoding: 'utf8', windowsHide: true, env: {...process.env, MOCK_APP: 'healthy-app', MOCK_DB: 'production-db',
      MOCK_URL: 'jdbc:postgresql://92.113.124.185:35433/hospital',
      MOCK_IDENTITY: 'hospital|35433|f|7692118169925038123', MOCK_PSQL_FAIL: 'false', ...overrides}
  });
}

test('current production database requires live app binding, exact cluster identity, port and primary role', () => {
  const result = probe();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /game_database_identity=PASS/);
  assert.match(gameDatabasePsqlCommand('-f -'), /-p 35433 -U hospital -d hospital -f -$/);
});

test('rollback checks service datasource and exact database identity without requiring a healthy failed target', () => {
  assert.equal(probe({MOCK_APP: ''}, false).status, 0);
  assert.notEqual(probe({MOCK_APP: '', MOCK_URL: 'jdbc:postgresql://92.113.124.185:35432/hospital'}, false).status, 0);
  assert.notEqual(probe({MOCK_APP: '', MOCK_IDENTITY: 'hospital|35433|t|7692118169925038123'}, false).status, 0);
});

test('database binding fails closed on old source, replica, replacement cluster and missing or duplicate containers', () => {
  for (const input of [
    {MOCK_URL: 'jdbc:postgresql://92.113.124.185:35432/hospital'}, {MOCK_APP: ''}, {MOCK_DB: ''},
    {MOCK_DB: 'production-db\nother-db'}, {MOCK_IDENTITY: 'hospital|35433|t|7692118169925038123'},
    {MOCK_IDENTITY: 'hospital|35433|f|111'}, {MOCK_IDENTITY: 'hospital|35432|f|7692118169925038123'},
    {MOCK_IDENTITY: 'wrong|35433|f|7692118169925038123'}, {MOCK_PSQL_FAIL: 'true'}
  ]) {
    const result = probe(input);
    assert.notEqual(result.status, 0, JSON.stringify(input));
    assert.doesNotMatch(result.stdout, /game_database_identity=PASS/);
  }
});
