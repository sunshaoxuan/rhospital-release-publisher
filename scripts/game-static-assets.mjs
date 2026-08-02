import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HASH_PATTERN = /^[0-9a-f]{20}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const SAFE_REHEARSAL_ROOT_PATTERN = /^\/tmp\/rhospital-release-rehearsal(?:\/|$)/;
const SAFE_GATEWAY_ID_PATTERN = /^[0-9A-Za-z._-]+$/;

export function parseManifest(text) {
    const entries = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
        const fields = line.split('\t');
        if (fields.length !== 4) {
            throw new Error(`manifest line ${index + 1} must contain four tab-separated fields`);
        }
        const [publicHash, sha256, sizeText, publicPath] = fields;
        const size = Number(sizeText);
        if (!HASH_PATTERN.test(publicHash) || !SHA256_PATTERN.test(sha256)) {
            throw new Error(`manifest line ${index + 1} contains an invalid hash`);
        }
        if (publicHash !== sha256.slice(0, 20)) {
            throw new Error(`manifest line ${index + 1} public hash does not match SHA-256`);
        }
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new Error(`manifest line ${index + 1} contains an invalid size`);
        }
        if (!publicPath.startsWith('/') || publicPath.includes('..') || publicPath.includes('\\')) {
            throw new Error(`manifest line ${index + 1} contains an unsafe public path`);
        }
        return { publicHash, sha256, size, publicPath };
    });
    if (entries.length === 0) {
        throw new Error('static asset manifest is empty');
    }
    const keys = new Set();
    for (const entry of entries) {
        const key = `${entry.publicHash}\t${entry.publicPath}`;
        if (keys.has(key)) {
            throw new Error(`duplicate static asset manifest entry: ${key}`);
        }
        keys.add(key);
    }
    return entries;
}

export function objectRelativePath(entry) {
    return path.join('objects', entry.publicHash, 'assets', ...entry.publicPath.slice(1).split('/'));
}

export function validateArtifact(artifactRoot) {
    const manifestPath = path.join(artifactRoot, 'manifest.tsv');
    const entries = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of entries) {
        const filePath = path.join(artifactRoot, objectRelativePath(entry));
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size !== entry.size) {
            throw new Error(`static asset size mismatch: ${entry.publicPath}`);
        }
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        if (sha256 !== entry.sha256) {
            throw new Error(`static asset hash mismatch: ${entry.publicPath}`);
        }
    }
    return entries;
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
        input: options.input
    });
    if (result.status !== 0) {
        throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
    return (result.stdout || '').trim();
}

function extractArtifact(imageTag, outputRoot, dockerContext = '') {
    const dockerPrefix = dockerContext ? ['--context', dockerContext] : [];
    const containerId = run('docker', [...dockerPrefix, 'create', imageTag]);
    try {
        run('docker', [...dockerPrefix, 'cp', `${containerId}:/frontend-assets/.`, outputRoot]);
    } finally {
        run('docker', [...dockerPrefix, 'rm', '-f', containerId]);
    }
}

function sshArgs(gateway) {
    const args = [];
    if (gateway.keyPath) {
        args.push('-i', gateway.keyPath);
    }
    args.push('-p', String(gateway.port || '22'), `${gateway.username}@${gateway.host}`);
    return args;
}

function scpArgs(gateway) {
    const args = [];
    if (gateway.keyPath) {
        args.push('-i', gateway.keyPath);
    }
    args.push('-P', String(gateway.port || '22'));
    return args;
}

function stageGateway(gateway, archivePath, appTag) {
    const remoteArchive = `/tmp/rhospital-assets-${appTag}-${process.pid}.tgz`;
    run('scp', [
        ...scpArgs(gateway),
        archivePath,
        `${gateway.username}@${gateway.host}:${remoteArchive}`
    ]);
    const script = String.raw`set -eu
root="$1"
tag="$2"
archive="$3"
case "$root" in /*) ;; *) echo "unsafe asset root" >&2; exit 1;; esac
case "$tag" in *[!0-9A-Za-z._-]*|'') echo "unsafe release tag" >&2; exit 1;; esac
incoming="$root/.incoming/$tag-$$"
cleanup() { rm -rf "$incoming"; rm -f "$archive"; }
trap cleanup EXIT
mkdir -p "$incoming" "$root/objects" "$root/manifests"
tar -xzf "$archive" -C "$incoming"
test -s "$incoming/manifest.tsv"
count=0
tab="$(printf '\t')"
while IFS="$tab" read -r public_hash full_hash size public_path; do
  case "$public_hash" in *[!0-9a-f]*|'') echo "invalid public hash" >&2; exit 1;; esac
  test "$(printf '%s' "$public_hash" | wc -c | tr -d ' ')" -eq 20
  case "$full_hash" in *[!0-9a-f]*|'') echo "invalid SHA-256" >&2; exit 1;; esac
  test "$(printf '%s' "$full_hash" | wc -c | tr -d ' ')" -eq 64
  test "$public_hash" = "$(printf '%s' "$full_hash" | cut -c1-20)"
  case "$public_path" in /*) ;; *) echo "invalid public path" >&2; exit 1;; esac
  case "$public_path" in *..*|*\\*) echo "unsafe public path" >&2; exit 1;; esac
  source_file="$incoming/objects/$public_hash/assets$public_path"
  test -f "$source_file"
  test "$(wc -c < "$source_file" | tr -d ' ')" = "$size"
  test "$(sha256sum "$source_file" | awk '{print $1}')" = "$full_hash"
  destination="$root/objects/$public_hash/assets$public_path"
  if test -e "$destination"; then
    cmp -s "$source_file" "$destination"
  else
    install -D -m 0644 "$source_file" "$destination"
  fi
  count=$((count + 1))
done < "$incoming/manifest.tsv"
test "$count" -gt 0
install -m 0644 "$incoming/manifest.tsv" "$root/manifests/$tag.tsv.tmp"
mv -f "$root/manifests/$tag.tsv.tmp" "$root/manifests/$tag.tsv"
echo "gateway_static_stage=PASS gateway=${gateway.id} files=$count manifest=$root/manifests/$tag.tsv"
`;
    run('ssh', [
        ...sshArgs(gateway),
        'bash', '-s', '--', gateway.remoteAssetRoot, appTag, remoteArchive
    ], { input: script });
}

export function buildRehearsalRemoteScript() {
    return String.raw`set -eu
base="$1"
tag="$2"
archive="$3"
run_id="$4"
gateway_id="$5"
case "$base" in
  /tmp/rhospital-release-rehearsal|/tmp/rhospital-release-rehearsal/*) ;;
  *) echo "unsafe rehearsal root" >&2; exit 1 ;;
esac
case "$run_id" in
  rehearsal-[0-9A-Za-z._-]*) ;;
  *) echo "unsafe rehearsal id" >&2; exit 1 ;;
esac
case "$gateway_id" in
  [0-9A-Za-z._-]*) ;;
  *) echo "unsafe gateway id" >&2; exit 1 ;;
esac
run_root="$base/$run_id"
root="$run_root/$gateway_id"
incoming="$root/.incoming"
cleanup() { rm -rf "$run_root"; rm -f "$archive"; rmdir "$base" 2>/dev/null || true; }
trap cleanup EXIT
mkdir -p "$incoming" "$root/objects" "$root/manifests"
tar -xzf "$archive" -C "$incoming"
test -s "$incoming/manifest.tsv"
tab="$(printf '\t')"
validate_objects() {
  count=0
  while IFS="$tab" read -r public_hash full_hash size public_path; do
    source_file="$incoming/objects/$public_hash/assets$public_path"
    destination="$root/objects/$public_hash/assets$public_path"
    test -f "$source_file"
    test -f "$destination"
    test "$(wc -c < "$destination" | tr -d ' ')" = "$size"
    test "$(sha256sum "$destination" | awk '{print $1}')" = "$full_hash"
    count=$((count + 1))
  done < "$incoming/manifest.tsv"
  test "$count" -gt 0
}
count=0
while IFS="$tab" read -r public_hash full_hash size public_path; do
  case "$public_hash" in *[!0-9a-f]*|'') echo "invalid public hash" >&2; exit 1;; esac
  test "$(printf '%s' "$public_hash" | wc -c | tr -d ' ')" -eq 20
  case "$full_hash" in *[!0-9a-f]*|'') echo "invalid SHA-256" >&2; exit 1;; esac
  test "$(printf '%s' "$full_hash" | wc -c | tr -d ' ')" -eq 64
  test "$public_hash" = "$(printf '%s' "$full_hash" | cut -c1-20)"
  case "$public_path" in /*) ;; *) echo "invalid public path" >&2; exit 1;; esac
  case "$public_path" in *..*|*\\*) echo "unsafe public path" >&2; exit 1;; esac
  source_file="$incoming/objects/$public_hash/assets$public_path"
  destination="$root/objects/$public_hash/assets$public_path"
  test -f "$source_file"
  test "$(wc -c < "$source_file" | tr -d ' ')" = "$size"
  test "$(sha256sum "$source_file" | awk '{print $1}')" = "$full_hash"
  install -D -m 0644 "$source_file" "$destination"
  count=$((count + 1))
done < "$incoming/manifest.tsv"
test "$count" -gt 0
install -m 0644 "$incoming/manifest.tsv" "$root/manifests/$tag.tsv"
validate_objects
echo "rehearsal_create_validate=PASS gateway=$gateway_id files=$count"
first_line="$(sed -n '1p' "$incoming/manifest.tsv")"
IFS="$tab" read -r first_public_hash first_full_hash first_size first_public_path <<EOF
$first_line
EOF
first_destination="$root/objects/$first_public_hash/assets$first_public_path"
rm -f "$first_destination"
if validate_objects; then
  echo "rehearsal_delete_detection=FAIL gateway=$gateway_id" >&2
  exit 1
fi
echo "rehearsal_delete_detection=PASS gateway=$gateway_id"
install -D -m 0644 "$incoming/objects/$first_public_hash/assets$first_public_path" "$first_destination"
validate_objects
echo "rehearsal_restore_validate=PASS gateway=$gateway_id"
trap - EXIT
rm -rf "$run_root"
rm -f "$archive"
test ! -e "$run_root"
echo "gateway_static_rehearsal=PASS gateway=$gateway_id files=$count"
`;
}

function rehearseGateway(gateway, archivePath, appTag, runId) {
    const remoteArchive = `/tmp/rhospital-assets-rehearsal-${appTag}-${process.pid}.tgz`;
    run('scp', [
        ...scpArgs(gateway),
        archivePath,
        `${gateway.username}@${gateway.host}:${remoteArchive}`
    ]);
    run('ssh', [
        ...sshArgs(gateway),
        'bash', '-s', '--', gateway.remoteAssetRoot, appTag, remoteArchive, runId, gateway.id
    ], { input: buildRehearsalRemoteScript() });
}

function headAsset(gateway, entry) {
    const requestPath = `/assets${entry.publicPath}?h=${entry.publicHash}`;
    return new Promise((resolve, reject) => {
        const request = https.request({
            host: gateway.host,
            port: 443,
            servername: gateway.domain,
            method: 'HEAD',
            path: requestPath,
            headers: { Host: gateway.domain },
            rejectUnauthorized: true,
            timeout: 15000
        }, response => {
            response.resume();
            if (response.statusCode !== 200) {
                reject(new Error(`${gateway.id} ${requestPath} returned HTTP ${response.statusCode}`));
                return;
            }
            if (String(response.headers['x-cache'] || '').toUpperCase() !== 'LOCAL'
                    || response.headers['x-asset-source'] !== 'gate-object') {
                reject(new Error(`${gateway.id} ${requestPath} was not served by the local immutable store`));
                return;
            }
            if (entry.publicPath === '/sw.js' && response.headers['service-worker-allowed'] !== '/') {
                reject(new Error(`${gateway.id} ${requestPath} does not allow the root service worker scope`));
                return;
            }
            resolve();
        });
        request.on('timeout', () => request.destroy(new Error(`${gateway.id} ${requestPath} timed out`)));
        request.on('error', reject);
        request.end();
    });
}

async function verifyGateway(gateway, entries, concurrency = 16) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
        while (cursor < entries.length) {
            const entry = entries[cursor++];
            await headAsset(gateway, entry);
        }
    });
    await Promise.all(workers);
    console.log(`gateway_static_http=PASS gateway=${gateway.id} files=${entries.length}`);
}

function validateGatewayList(gateways) {
    if (!Array.isArray(gateways) || gateways.length !== 2) {
        throw new Error('gateway config must declare exactly two gateways');
    }
    for (const gateway of gateways) {
        for (const field of ['id', 'host', 'username', 'domain', 'remoteAssetRoot']) {
            if (!gateway[field]) {
                throw new Error(`static gateway is missing ${field}`);
            }
        }
    }
    return gateways;
}

function gatewayIdentity(gateway) {
    return `${String(gateway.host).toLowerCase()}:${String(gateway.port || '22')}:${String(gateway.domain).toLowerCase()}`;
}

function gatewayHostPort(gateway) {
    return `${String(gateway.host).toLowerCase()}:${String(gateway.port || '22')}`;
}

export function validateRehearsalConfig(config, productionConfig = null) {
    if (!config || config.environment !== 'rehearsal') {
        throw new Error('remote rehearsal gateway config must set environment=rehearsal');
    }
    const gateways = validateGatewayList(config.gateways);
    const allowProductionHosts = config.allowProductionHosts === true;
    if (allowProductionHosts && config.scope !== 'production-temp-root') {
        throw new Error('production host rehearsal must set scope=production-temp-root');
    }
    const productionGateways = productionConfig ? validateGatewayList(productionConfig.gateways) : [];
    if (allowProductionHosts && productionGateways.length === 0) {
        throw new Error('production host rehearsal requires the production gateway config');
    }
    const productionIdentities = new Set(productionGateways.map(gatewayIdentity));
    const productionByHostPort = new Map(productionGateways.map(gateway => [gatewayHostPort(gateway), gateway]));
    for (const gateway of gateways) {
        if (!SAFE_GATEWAY_ID_PATTERN.test(String(gateway.id))) {
            throw new Error(`rehearsal gateway ${gateway.id} has an unsafe id`);
        }
        if (!SAFE_REHEARSAL_ROOT_PATTERN.test(String(gateway.remoteAssetRoot))
                || String(gateway.remoteAssetRoot).includes('..')
                || String(gateway.remoteAssetRoot).includes('\\')) {
            throw new Error(`rehearsal gateway ${gateway.id} must use /tmp/rhospital-release-rehearsal`);
        }
        const identity = gatewayIdentity(gateway);
        const hostPort = gatewayHostPort(gateway);
        const productionGateway = productionByHostPort.get(hostPort);
        if (!allowProductionHosts && (productionIdentities.has(identity) || productionGateway)) {
            throw new Error(`rehearsal gateway ${gateway.id} duplicates a production gateway identity`);
        }
        if (allowProductionHosts && (!productionGateway || !productionIdentities.has(identity))) {
            throw new Error(`production host rehearsal gateway ${gateway.id} must match a production gateway identity`);
        }
        if (allowProductionHosts
                && (String(gateway.username) !== String(productionGateway.username)
                    || String(gateway.keyPath || '') !== String(productionGateway.keyPath || ''))) {
            throw new Error(`production host rehearsal gateway ${gateway.id} must reuse production SSH credentials`);
        }
    }
    return gateways;
}

function loadConfig(configPath, options = {}) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (options.rehearsal) {
        const productionConfig = options.productionConfigPath
            ? JSON.parse(fs.readFileSync(options.productionConfigPath, 'utf8'))
            : null;
        return validateRehearsalConfig(config, productionConfig);
    }
    return validateGatewayList(config.gateways);
}

function parseArgs(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`invalid argument near ${name || '(empty)'}`);
        }
        values[name.slice(2)] = value;
    }
    if (!['validate', 'stage', 'verify', 'rehearse'].includes(values.mode)) {
        throw new Error('--mode must be validate, stage, verify or rehearse');
    }
    if (!values.image || !SAFE_TAG_PATTERN.test(values['app-tag'] || '')) {
        throw new Error('--image and a safe --app-tag are required');
    }
    if (values.mode === 'rehearse' && !values['production-config']) {
        throw new Error('--production-config is required for rehearsal');
    }
    return values;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-static-assets-'));
    try {
        const artifactRoot = path.join(workRoot, 'artifact');
        fs.mkdirSync(artifactRoot);
        extractArtifact(args.image, artifactRoot, args['docker-context'] || '');
        const entries = validateArtifact(artifactRoot);
        console.log(`static_asset_artifact=PASS files=${entries.length}`);
        const configPath = path.resolve(args.config || 'release/game-static-gateways.json');
        const gateways = loadConfig(configPath, {
            rehearsal: args.mode === 'rehearse',
            productionConfigPath: args['production-config']
        });
        console.log(`static_gateway_config=PASS gateways=${gateways.length}`);
        if (args.mode === 'validate') {
            return;
        }
        if (args.mode === 'stage' || args.mode === 'rehearse') {
            const archivePath = path.join(workRoot, `rhospital-assets-${args['app-tag']}.tgz`);
            run('tar', ['-czf', archivePath, '-C', artifactRoot, '.']);
            if (args.mode === 'stage') {
                for (const gateway of gateways) {
                    stageGateway(gateway, archivePath, args['app-tag']);
                }
            } else {
                const runId = `rehearsal-${Date.now()}-${process.pid}`;
                for (const gateway of gateways) {
                    rehearseGateway(gateway, archivePath, args['app-tag'], runId);
                }
            }
        } else {
            for (const gateway of gateways) {
                await verifyGateway(gateway, entries);
            }
        }
    } finally {
        fs.rmSync(workRoot, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
