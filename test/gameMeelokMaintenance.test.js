const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {
  MEELOK_PAUSE_ORDER, gameMeelokStatusCommands, gameMeelokReadinessCommands,
  gameMeelokPauseCommands, gameMeelokRestoreCommands
} = require('../src/gameMeelokMaintenance');

const identity = '01234567-89ab-cdef-0123-456789abcdef';
const otherIdentity = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const qaRoot = path.resolve(__dirname, '../.qa');
const bash = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';

// Exercise the generated shell and filesystem protocol, without real Docker or waits.
const harness = `
set -euo pipefail
sleep() { :; }
seq() { printf '1\\n'; }
awk() { printf '%s\\n' "\${MEMORY_KB:-3000000}"; }
jq() {
  if [ "$1" = -r ]; then
    case "$5" in *replicas*) echo 1 ;; *image*) echo "image-$4" ;; *) return 1 ;; esac
  else
    cat >/dev/null
    printf '[]\\n'
  fi
}
docker() {
  printf '%s\\n' "$*" >> calls
  case "$1 $2" in
    'service inspect')
      [ "\${INSPECT_FAIL:-}" != "$3" ] || return 1
      if [ "$3" = game ]; then
        if [ -n "\${REPLACE_MARKER:-}" ]; then printf '%s\\n' "$REPLACE_MARKER" > .meelok-release-pause; fi
        echo completed
      elif [ "$#" -gt 4 ] && [[ "$5" = *Replicas* ]]; then
        if [ "\${BAD_SERVICE:-}" = "$3" ] && [ -n "\${BAD_DESIRED:-}" ]; then echo "$BAD_DESIRED"
        elif [ -f "$3.replicas" ]; then cat "$3.replicas"
        else echo 1; fi
      elif [ "$#" -gt 4 ] && [[ "$5" = *Image* ]]; then
        if [ "\${BAD_SERVICE:-}" = "$3" ] && [ -n "\${BAD_IMAGE:-}" ]; then echo changed
        else echo "image-$3"; fi
      else echo '[]'; fi ;;
    'service scale')
      local target="$3"; if [ "$target" = --detach ]; then target="$4"; fi
      printf '%s\\n' "\${target#*=}" > "\${target%=*}.replicas" ;;
    'ps -q')
      local service='' arg count=1
      for arg in "$@"; do case "$arg" in label=com.docker.swarm.service.name=*) service="\${arg#*=}"; service="\${service#*=}" ;; esac; done
      [ "\${PS_FAIL:-}" != "$service" ] || return 1
      if [ -f "$service.replicas" ] && [ "$(cat "$service.replicas")" = 0 ]; then return 0; fi
      if [ "$service" = "\${BAD_SERVICE:-}" ]; then count="\${BAD_COUNT:-1}"; fi
      if [ "$service" = game ] && [ "\${BAD_GAME:-}" = true ]; then count=0; fi
      if [ "$count" = 1 ]; then echo "$service-container"
      elif [ "$count" = 2 ]; then printf '%s\\n%s\\n' "$service-container" "$service-other"; fi ;;
    inspect*)
      [ "$2" != "\${CONTAINER_INSPECT_FAIL:-}-container" ] || return 1
      local health=healthy
      if [ "\${NO_HEALTH_ROLES:-}" = true ]; then case "$2" in meelok_worker-container|meelok_object_storage-container) health=none ;; esac; fi
      if [ "$2" = "\${BAD_SERVICE:-}-container" ]; then health="\${BAD_HEALTH:-healthy}"; fi
      if [[ "$4" = *started_at* ]]; then
        echo "health=$health started_at=2026-10-16T00:00:00Z restart_count=\${RESTART_COUNT:-0}"
        return 0
      fi
      echo "$health" ;;
    *) echo "unexpected docker call" >&2; return 1 ;;
  esac
}
flock() { [ "\${LOCK_BUSY:-false}" != true ]; }
sync() { :; }
timeout() { if [ "\${RECOVERY_TIMEOUT:-false}" = true ]; then return 124; fi; command timeout "$@"; }
export -f docker jq sleep seq awk flock timeout sync
`;

function fixture(t) {
  fs.mkdirSync(qaRoot, {recursive: true});
  const root = fs.mkdtempSync(path.join(qaRoot, 'meelok-'));
  fs.mkdirSync(path.join(root, 'backup'));
  fs.writeFileSync(path.join(root, '.last-game-release-backup'), 'backup\n');
  t.after(() => {
    assert.equal(path.dirname(root), qaRoot);
    fs.rmSync(root, {recursive: true, force: true});
  });
  const run = (commands, env = {}) => {
    const script=path.join(root,'fixture-command.sh');
    fs.writeFileSync(script,harness+'\n'+commands.join('\n'));
    return spawnSync(bash, [script], {
    // Git Bash starts external coreutils for each simulated service. Windows
    // cold process startup can exceed ten seconds for the five-service fixture;
    // this is a harness bound, not a production health/restore timeout.
    cwd: root, env: {...process.env, ...env}, encoding: 'utf8', windowsHide: true,
    timeout: process.platform === 'win32' ? 30000 : 10000
    });
  };
  const calls = () => fs.existsSync(path.join(root, 'calls')) ? fs.readFileSync(path.join(root, 'calls'), 'utf8') : '';
  const resetCalls = () => fs.writeFileSync(path.join(root, 'calls'), '');
  const seed=()=>{
    const snapshot=`backup/meelok-replicas-${identity}.json`;
    fs.writeFileSync(path.join(root,snapshot),JSON.stringify(MEELOK_PAUSE_ORDER.map(name=>({name,replicas:1,image:`image-${name}`}))));
    fs.writeFileSync(path.join(root,'.meelok-release-pause'),snapshot+'\n');
    for(const name of MEELOK_PAUSE_ORDER)fs.writeFileSync(path.join(root,`${name}.replicas`),'0');
  };
  return {root, run, calls, resetCalls,seed};
}

test('status notification reports startup and restart facts without any writes', t => {
  const f = fixture(t);
  const result = f.run(gameMeelokStatusCommands('.'), {RESTART_COUNT: '2'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const service of MEELOK_PAUSE_ORDER) {
    assert.match(result.stdout, new RegExp(`meelok_status service=${service} desired=1 running=1`));
    assert.match(result.stdout, new RegExp(`service=${service} container=.*health=healthy started_at=2026-10-16T00:00:00Z restart_count=2`));
  }
  assert.doesNotMatch(result.stdout, /WARNING|ERROR/);
  assert.doesNotMatch(f.calls(), /service scale|service update|stack deploy/);
});

test('missing unhealthy or unavailable Meelok and old markers produce notifications and retain all five observations', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.meelok-release-pause'), 'foreign-snapshot\n');
  for (const env of [
    {BAD_DESIRED: '0'}, {BAD_COUNT: '0'}, {BAD_COUNT: '2'}, {BAD_HEALTH: 'unhealthy'},
    {INSPECT_FAIL: 'meelok_web'}, {PS_FAIL: 'meelok_web'}, {CONTAINER_INSPECT_FAIL: 'meelok_web'}
  ]) {
    const result = f.run(gameMeelokStatusCommands('.'), {BAD_SERVICE: 'meelok_web', ...env});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /WARNING:.*retained maintenance marker/);
    for (const service of MEELOK_PAUSE_ORDER) assert.ok(result.stdout.includes(`meelok_status service=${service} `), service);
    if (env.INSPECT_FAIL || env.PS_FAIL || env.CONTAINER_INSPECT_FAIL) assert.match(result.stdout, /state=unknown reason=/);
    assert.doesNotMatch(f.calls(), /service scale|service update|stack deploy/);
    assert.equal(fs.readFileSync(path.join(f.root, '.meelok-release-pause'), 'utf8'), 'foreign-snapshot\n');
  }
});

test('readiness accepts monitored health and only designated healthcheck-free roles without writes', t => {
  const f = fixture(t);
  for (const [service,health] of [['meelok_web','healthy'],['meelok_worker','none'],['meelok_object_storage','none']]) {
    const result = f.run(gameMeelokReadinessCommands('.'), {BAD_SERVICE: service, BAD_HEALTH: health});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /meelok_readiness=PASS services=5/);
    assert.doesNotMatch(f.calls(), /service scale|service update|stack deploy/);
    assert.equal(fs.existsSync(path.join(f.root, '.meelok-release-pause')), false);
  }
});

test('readiness rejects stale markers before Docker and preserves their contents', t => {
  const f = fixture(t);
  const marker = path.join(f.root, '.meelok-release-pause');
  fs.writeFileSync(marker, 'prior-backup/meelok-replicas.json\n');
  const result = f.run(gameMeelokReadinessCommands('.'));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /prior Meelok pause requires recovery before a new release/);
  assert.equal(f.calls(), '');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'prior-backup/meelok-replicas.json\n');
});

test('readiness fails closed on wrong desired replicas, absent/extra tasks, unhealthy state and inspect failure', t => {
  const f = fixture(t);
  for (const env of [
    {BAD_DESIRED: '0'}, {BAD_DESIRED: '2'}, {BAD_COUNT: '0'},
    {BAD_COUNT: '2'}, {BAD_HEALTH: 'unhealthy'}, {BAD_HEALTH:'none'}, {BAD_HEALTH:'unknown'}, {BAD_HEALTH:'starting'}, {BAD_HEALTH:'stopped'}, {INSPECT_FAIL: 'meelok_web'}, {CONTAINER_INSPECT_FAIL:'meelok_web'}
  ]) {
    const result = f.run(gameMeelokReadinessCommands('.'), {BAD_SERVICE: 'meelok_web', ...env});
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.doesNotMatch(result.stdout, /meelok_readiness=PASS/);
    assert.doesNotMatch(f.calls(), /service scale|service update|stack deploy/);
  }
});

test('owned pause and restore preserve five services and clear only the owned marker', t => {
  const f = fixture(t);
  const pause = f.run(gameMeelokPauseCommands('.', identity));
  assert.equal(pause.status, 0, pause.stdout + pause.stderr);
  assert.match(pause.stdout, /meelok_pause=PASS/);
  const marker = path.join(f.root, '.meelok-release-pause');
  assert.ok(fs.readFileSync(marker, 'utf8').trim().endsWith(`/.publisher-maintenance/${identity}/meelok-replicas-${identity}.json`));
  for (const service of MEELOK_PAUSE_ORDER) assert.equal(fs.readFileSync(path.join(f.root, `${service}.replicas`), 'utf8').trim(), '0');
  const restore = f.run(gameMeelokRestoreCommands('.', 'game', identity));
  assert.equal(restore.status, 0, restore.stdout + restore.stderr);
  assert.match(restore.stdout, /meelok_restore=PASS services=5/);
  for (const service of MEELOK_PAUSE_ORDER) assert.match(restore.stdout,
    new RegExp(`meelok_restore_status service=${service} restart_requested=true running=1 health=healthy`));
  for (const service of MEELOK_PAUSE_ORDER) assert.equal(fs.readFileSync(path.join(f.root, `${service}.replicas`), 'utf8').trim(), '1');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(f.calls().match(/service scale/g).length, 10);
});

test('owned maintenance accepts designated unmonitored processes without labelling them healthy',t=>{
  const f=fixture(t),env={NO_HEALTH_ROLES:'true'};
  const pause=f.run(gameMeelokPauseCommands('.',identity),env);
  assert.equal(pause.status,0,pause.stdout+pause.stderr);
  const restore=f.run(gameMeelokRestoreCommands('.','game',identity),env);
  assert.equal(restore.status,0,restore.stdout+restore.stderr);
  for(const service of ['meelok_worker','meelok_object_storage'])assert.match(restore.stdout,new RegExp(`meelok_restore_status service=${service} .*health=none`));
  assert.equal(fs.existsSync(path.join(f.root,'.meelok-release-pause')),false);
});

test('pause rechecks drift after readiness and never overwrites an older marker', t => {
  const f = fixture(t);
  assert.equal(f.run(gameMeelokReadinessCommands('.')).status, 0);
  f.resetCalls();
  fs.writeFileSync(path.join(f.root, '.meelok-release-pause'), 'older-release\n');
  const pause = f.run(gameMeelokPauseCommands('.', identity));
  assert.notEqual(pause.status, 0);
  assert.equal(f.calls(), '');
  assert.equal(fs.readFileSync(path.join(f.root, '.meelok-release-pause'), 'utf8'), 'older-release\n');
});

test('restore refuses a foreign plan or backup without touching any service or marker', t => {
  const f = fixture(t);
  assert.equal(f.run(gameMeelokPauseCommands('.', identity)).status, 0);
  f.resetCalls();
  const marker = path.join(f.root, '.meelok-release-pause');
  const original = fs.readFileSync(marker, 'utf8');
  for (const snapshot of [original, `other-backup/meelok-replicas-${otherIdentity}.json\n`]) {
    fs.writeFileSync(marker, snapshot);
    const restore = f.run(gameMeelokRestoreCommands('.', 'game', otherIdentity));
    assert.notEqual(restore.status, 0);
    assert.match(restore.stdout, /belongs to another release|automatic replay refused/);
    assert.equal(f.calls(), '');
    assert.equal(fs.readFileSync(marker, 'utf8'), snapshot);
  }
});

test('restore retains marker when game, memory, image or web readiness fails', t => {
  for (const env of [
    {BAD_GAME: 'true'}, {MEMORY_KB: '1000000'},
    {BAD_SERVICE: 'meelok_object_storage', BAD_IMAGE: 'true'},
    {BAD_SERVICE: 'meelok_web', BAD_COUNT: '0'},
    {BAD_SERVICE:'meelok_web',BAD_HEALTH:'none'},
    {BAD_SERVICE:'meelok_worker',BAD_HEALTH:'unknown'}
  ]) {
    const f=fixture(t);f.seed();
    f.resetCalls();
    const restore = f.run(gameMeelokRestoreCommands('.', 'game', identity), env);
    assert.notEqual(restore.status, 0, JSON.stringify(env));
    assert.equal(fs.existsSync(path.join(f.root, '.meelok-release-pause')), true);
    assert.doesNotMatch(f.calls(), /service update|stack deploy/);
    if (env.BAD_COUNT) assert.match(restore.stdout, /meelok_web did not become healthy desired=1 running=0 health=absent/);
    else if(env.BAD_HEALTH)assert.ok(restore.stdout.includes(`${env.BAD_SERVICE} did not become healthy desired=1 running=1 health=${env.BAD_HEALTH}`));
    else assert.doesNotMatch(f.calls(), /service scale/);
  }
});

test('restore timeout is observable and unknown outcomes cannot automatically replay',t=>{
 const f=fixture(t);f.seed();
 const first=f.run(gameMeelokRestoreCommands('.','game',identity),{RECOVERY_TIMEOUT:'true'});
 assert.equal(first.status,124,first.stdout+first.stderr);
 assert.match(first.stdout,/meelok_recovery=UNKNOWN exit_code=124 assets=RETAINED/);
 const state=path.join(f.root,'.publisher-maintenance',identity,'restore.state');
 assert.equal(fs.readFileSync(state,'utf8').trim(),'UNKNOWN');
 const calls=f.calls();
 const second=f.run(gameMeelokRestoreCommands('.','game',identity));
 assert.equal(second.status,75);
 assert.match(second.stdout,/automatic replay refused/);
 assert.equal(f.calls(),calls);
 assert.ok(fs.existsSync(path.join(f.root,'.meelok-release-pause')));
 assert.ok(fs.existsSync(path.join(f.root,'backup',`meelok-replicas-${identity}.json`)));
});

test('concurrent maintenance refuses before recovery commands and preserves assets',t=>{
 const f=fixture(t);f.seed();
 const r=f.run(gameMeelokRestoreCommands('.','game',identity),{LOCK_BUSY:'true'});
 assert.equal(r.status,75,r.stdout+r.stderr);
 assert.equal(f.calls(),'');
 assert.ok(fs.existsSync(path.join(f.root,'.meelok-release-pause')));
 assert.equal(fs.existsSync(path.join(f.root,'.publisher-maintenance',identity,'restore.state')),false);
});

test('dedicated snapshot survives ordinary backup removal and terminal archive is idempotent',t=>{
 const f=fixture(t);
 const p=f.run(gameMeelokPauseCommands('.',identity));assert.equal(p.status,0,p.stdout+p.stderr);
 const retained=path.join(f.root,'.publisher-maintenance',identity);
 assert.ok(fs.existsSync(path.join(f.root,'backup',`.publisher-maintenance-pin-${identity}`)));
 fs.renameSync(path.join(f.root,'backup'),path.join(f.root,'backup-retained-fixture'));
 const r=f.run(gameMeelokRestoreCommands('.','game',identity));assert.equal(r.status,0,r.stdout+r.stderr);
 assert.ok(fs.existsSync(path.join(retained,`meelok-replicas-${identity}.json`)));
 assert.ok(fs.existsSync(path.join(retained,'marker.completed')));
 assert.equal(fs.readFileSync(path.join(retained,'restore.state'),'utf8').trim(),'VERIFIED');
 const calls=f.calls();
 const again=f.run(gameMeelokRestoreCommands('.','game',identity));assert.equal(again.status,0,again.stdout+again.stderr);
 assert.match(again.stdout,/ALREADY_VERIFIED/);assert.equal(f.calls(),calls);
});

test('ownership drift during recovery blocks scaling and marker deletion', t => {
  const f = fixture(t);
  assert.equal(f.run(gameMeelokPauseCommands('.', identity)).status, 0);
  f.resetCalls();
  const restore = f.run(gameMeelokRestoreCommands('.', 'game', identity), {REPLACE_MARKER: 'other-release'});
  assert.notEqual(restore.status, 0);
  assert.match(restore.stdout, /ownership changed during restore/);
  assert.doesNotMatch(f.calls(), /service scale/);
  assert.equal(fs.readFileSync(path.join(f.root, '.meelok-release-pause'), 'utf8').trim(), 'other-release');
});

test('restore without a marker is read-only and invalid plan identities are rejected', t => {
  const f = fixture(t);
  const restore = f.run(gameMeelokRestoreCommands('.', 'game', identity));
  assert.equal(restore.status, 0);
  assert.match(restore.stdout, /meelok_restore=NOT_REQUIRED/);
  assert.equal(f.calls(), '');
  for (const value of ['', undefined, '../other', identity + '; echo unsafe']) {
    assert.throws(() => gameMeelokPauseCommands('.', value), /Invalid Meelok maintenance identity/);
    assert.throws(() => gameMeelokRestoreCommands('.', 'game', value), /Invalid Meelok maintenance identity/);
  }
});
