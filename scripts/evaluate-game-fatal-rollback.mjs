import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {
  resolveStaticDeliveryPrerequisites,
  runChromeProbe,
  summarizeProbe
} from './verify-game-static-delivery.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

function shellToken(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function required(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

function runSshProbe(args, token) {
  const host = required(args, 'remote-host');
  const user = required(args, 'remote-user');
  const port = required(args, 'remote-port');
  const key = required(args, 'remote-key');
  const serviceName = required(args, 'service-name');
  const expectedImage = required(args, 'expected-image');
  const expectedVersion = required(args, 'expected-version');
  const script = `set -eu
service_name=${shellToken(serviceName)}
expected_image=${shellToken(expectedImage)}
expected_version=${shellToken(expectedVersion)}
auth_token=${shellToken(token)}
service_image=$(docker service inspect "$service_name" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
service_env=$(docker service inspect "$service_name" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}')
service_version=$(printf '%s\n' "$service_env" | sed -n 's/^IMAGE_TAG=//p' | head -n 1)
expected_replicas=$(docker service inspect "$service_name" --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}1{{end}}')
healthy_target=0
for container_id in $(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name"); do
  container_image=$(docker inspect "$container_id" --format '{{.Config.Image}}')
  container_health=$(docker inspect "$container_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
  container_env=$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}')
  container_version=$(printf '%s\n' "$container_env" | sed -n 's/^IMAGE_TAG=//p' | head -n 1)
  case "$container_image" in
    "$expected_image"|"$expected_image"@*) if [ "$container_health" = healthy ] && [ "$container_version" = "$expected_version" ]; then healthy_target=$((healthy_target + 1)); fi ;;
  esac
done
database_container=$(docker ps -q --filter name=postgresql | head -n 1)
database_probe=FAIL
if [ -n "$database_container" ]; then
  if docker exec "$database_container" psql -X -U hospital -d hospital -v ON_ERROR_STOP=1 -Atc "begin; create temp table release_heartbeat(value integer) on commit drop; insert into release_heartbeat values (1); select value from release_heartbeat; rollback;" >/dev/null 2>&1; then
    database_probe=PASS
  fi
fi
local_business=FAIL
local_response=$(mktemp)
trap 'rm -f "$local_response"' EXIT
local_status=$(curl -sS --max-time 20 -o "$local_response" -w '%{http_code}' -X POST -H "Authorization: Bearer $auth_token" "http://127.0.0.1:8190/api/task/run?version=$expected_version" || true)
if [ "$local_status" = 200 ] && grep -q '"versionMismatch":false' "$local_response" && grep -q '"hospitalId"' "$local_response"; then local_business=PASS; fi
rm -f "$local_response"
trap - EXIT
image_matches=false
case "$service_image" in "$expected_image"|"$expected_image"@*) image_matches=true ;; esac
control_plane=FAIL
if [ "$image_matches" = true ] && [ "$service_version" = "$expected_version" ] && [ "$healthy_target" -ge "$expected_replicas" ]; then control_plane=PASS; fi
echo "control_plane=$control_plane database_probe=$database_probe local_business=$local_business healthy_target=$healthy_target expected_replicas=$expected_replicas"
`;
  return new Promise(resolve => {
    const child = spawn('ssh', ['-i', key, '-p', port, `${user}@${host}`, 'bash', '-s'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => resolve({ok: false, error: error.message}));
    child.on('close', code => {
      const line = stdout.trim().split(/\r?\n/).at(-1) || '';
      resolve({
        ok: code === 0,
        controlPlane: /control_plane=PASS/.test(line),
        database: /database_probe=PASS/.test(line),
        localBusiness: /local_business=PASS/.test(line),
        evidence: line,
        error: code === 0 ? '' : stderr.trim().slice(0, 300)
      });
    });
    child.stdin.end(script);
  });
}

function runOriginHeartbeat({host, port, token, expectedVersion, timeoutMs}) {
  return new Promise(resolve => {
    const request = http.request({
      host,
      port,
      method: 'POST',
      path: `/api/task/run?version=${encodeURIComponent(expectedVersion)}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Length': '0'
      },
      timeout: timeoutMs
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const valid = response.statusCode === 200
            && body && typeof body === 'object'
            && body.versionMismatch === false
            && (body.hospitalId != null || body.id != null || body.directorName != null);
          resolve({ok: valid, status: response.statusCode || 0, validPayload: valid});
        } catch (error) {
          resolve({ok: false, status: response.statusCode || 0, validPayload: false});
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('origin heartbeat timed out')));
    request.on('error', error => resolve({ok: false, status: 0, error: error.message}));
    request.end();
  });
}

export function decideFatalRollback(rounds, requiredRounds = 3) {
  if (!Array.isArray(rounds) || rounds.length < requiredRounds) {
    return {decision: 'HOLD_TARGET', reason: 'insufficient_rounds'};
  }
  const evaluated = rounds.slice(-requiredRounds);
  if (evaluated.some(round => !round.database)) {
    return {decision: 'HOLD_TARGET', reason: 'database_or_infrastructure_unhealthy'};
  }
  const fatal = evaluated.every(round =>
    round.gatewayFailures >= round.gatewayCount
    && round.gatewayCount >= 2
    && !round.origin
    && !round.remoteBusiness
    && round.database);
  return fatal
    ? {decision: 'ROLLBACK_CONFIRMED', reason: 'three_round_full_chain_failure_with_healthy_database'}
    : {decision: 'HOLD_TARGET', reason: 'fatal_threshold_not_met'};
}

async function evaluateRound(prerequisites, args, roundNumber) {
  const gatewayResults = [];
  for (const gateway of prerequisites.gateways) {
    try {
      const result = await runChromeProbe({
        chromePath: prerequisites.chromePath,
        gateway,
        host: prerequisites.gameHost,
        mappedHosts: [prerequisites.gameHost, prerequisites.steamHost],
        route: '/run/newGame',
        token: prerequisites.token,
        probeKey: `${prerequisites.appTag}-fatal-${roundNumber}-${gateway.name}`,
        timeoutMs: prerequisites.timeoutMs
      });
      const summary = summarizeProbe(result);
      gatewayResults.push({gateway: gateway.name, launched: summary.launched});
    } catch (error) {
      gatewayResults.push({gateway: gateway.name, launched: false, error: error.message.slice(0, 200)});
    }
  }
  const origin = await runOriginHeartbeat({
    host: required(args, 'origin-host'),
    port: Number(args['origin-port'] || 8190),
    token: prerequisites.token,
    expectedVersion: prerequisites.appTag,
    timeoutMs: prerequisites.timeoutMs
  });
  const remote = await runSshProbe(args, prerequisites.token);
  return {
    round: roundNumber,
    gatewayCount: gatewayResults.length,
    gatewayFailures: gatewayResults.filter(result => !result.launched).length,
    gateways: gatewayResults,
    origin: origin.ok === true,
    originStatus: origin.status || 0,
    database: remote.database === true,
    remoteBusiness: remote.localBusiness === true,
    controlPlane: remote.controlPlane === true,
    remoteEvidence: remote.evidence || '',
    remoteError: remote.error || ''
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roundsRequired = Math.max(3, Number(args.rounds || 3));
  const delayMs = Math.max(0, Number(args['round-delay-ms'] || 5000));
  try {
    const prerequisites = resolveStaticDeliveryPrerequisites(args);
    const rounds = [];
    for (let round = 1; round <= roundsRequired; round += 1) {
      const evidence = await evaluateRound(prerequisites, args, round);
      rounds.push(evidence);
      console.log(`fatal_heartbeat_round=${JSON.stringify(evidence)}`);
      if (round < roundsRequired) await delay(delayMs);
    }
    const result = decideFatalRollback(rounds, roundsRequired);
    console.log(`fatal_rollback_reason=${result.reason}`);
    console.log(`fatal_rollback_decision=${result.decision}`);
  } catch (error) {
    console.log(`fatal_rollback_reason=evaluator_error:${String(error.message || error).slice(0, 300)}`);
    console.log('fatal_rollback_decision=HOLD_TARGET');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
