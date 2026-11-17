const RECEIPT_SCRIPT = String.raw`
import hashlib, json, os, re, subprocess, sys
try:
    backup, count = sys.argv[1], int(sys.argv[2])
    with open(os.path.join(backup, "service.inspect.json"), encoding="utf-8") as source:
        spec = json.load(source)[0]["Spec"]
    with open(os.path.join(backup, "image.inspect.json"), encoding="utf-8") as source:
        image = json.load(source)[0]
    if count < 0 or not re.fullmatch(r"sha256:[a-f0-9]{64}", image["Id"]):
        raise ValueError()
    reference = spec["TaskTemplate"]["ContainerSpec"]["Image"]
    base = reference.split("@")[0]
    repository = base.rsplit(":", 1)[0] if ":" in base.split("/")[-1] else base
    digests = sorted(set(item for item in image.get("RepoDigests", []) if re.fullmatch(re.escape(repository) + r"@sha256:[a-f0-9]{64}", item)))
    if len(set(digests)) != 1:
        raise ValueError()
    resolved = json.loads(subprocess.check_output(["docker", "image", "inspect", digests[0]], timeout=15))[0]
    if resolved.get("Id") != image["Id"]:
        raise ValueError()
    receipt = {"version": 1, "baselineHash": hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
               "imageId": image["Id"], "digests": digests, "migrationCount": count}
    with open(os.path.join(backup, "game-service-recovery.json"), "x", encoding="utf-8") as target:
        json.dump(receipt, target, sort_keys=True)
    print("game_recovery_identity=PASS")
except Exception:
    print("game_recovery_identity=FAIL action=verify_original_image_before_release")
    sys.exit(1)
`;
const ROLLBACK_SCRIPT = String.raw`
import copy, hashlib, http.client, json, os, re, socket, subprocess, sys

def read(*args):
    return json.loads(subprocess.check_output(["docker", *args], timeout=15))

def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def resolve(backup, service):
    def load(name):
        with open(os.path.join(backup, name), encoding="utf-8") as source:
            return json.load(source)
    baseline = load("service.inspect.json")[0]["Spec"]
    receipt = load("game-service-recovery.json")
    image = load("image.inspect.json")[0]
    live = read("service", "inspect", service)[0]
    observed = load("service.observed.inspect.json")[0]["Spec"] if os.path.exists(os.path.join(backup, "paused-retry-baseline.json")) else baseline
    if receipt.get("version") != 1 or receipt.get("baselineHash") != fingerprint(baseline) or receipt.get("imageId") != image["Id"]:
        raise ValueError()
    if type(receipt.get("migrationCount")) is not int or receipt["migrationCount"] < 0:
        raise ValueError()
    reference = baseline["TaskTemplate"]["ContainerSpec"]["Image"]
    base = reference.split("@")[0]
    repository = base.rsplit(":", 1)[0] if ":" in base.split("/")[-1] else base
    digests = set(item for item in image.get("RepoDigests", []) if re.fullmatch(re.escape(repository) + r"@sha256:[a-f0-9]{64}", item))
    if len(digests) != 1 or receipt.get("digests") != sorted(digests) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image["Id"]):
        raise ValueError()
    digest = next(iter(digests))
    if "@" in reference and reference.split("@", 1)[1] != digest.split("@", 1)[1]:
        raise ValueError()
    for candidate in (reference, digest):
        if read("image", "inspect", candidate)[0].get("Id") != image["Id"]:
            raise ValueError()
    return baseline, observed, live, digest, image["Id"]

class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/var/run/docker.sock")

def main(backup, service, action, connection_factory=DockerConnection):
    baseline, observed, live, digest, image_id = resolve(backup, service)
    target = copy.deepcopy(baseline)
    target["TaskTemplate"]["ContainerSpec"]["Image"] = digest
    if action == "restored":
        actual = copy.deepcopy(live["Spec"])
        actual["TaskTemplate"].pop("ForceUpdate", None)
        target["TaskTemplate"].pop("ForceUpdate", None)
        if actual != target:
            raise ValueError()
        print("game_service_snapshot=PASS mode=restored")
        return
    if (live.get("Spec") if action == "current" else live.get("PreviousSpec")) != observed:
        raise ValueError()
    if action == "apply":
        connection = connection_factory("localhost", timeout=20)
        connection.request("POST", "/services/" + live["ID"] + "/update?version=" + str(live["Version"]["Index"]), json.dumps(target).encode(), {"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        connection.close()
        if response.status != 200:
            raise ValueError()
    elif action not in ("verify", "current"):
        raise ValueError()
    print(digest + "|" + image_id)

if __name__ == "__main__":
    try:
        main(*sys.argv[1:])
    except Exception:
        print("ERROR: rollback identity receipt mismatch or service changed", file=sys.stderr)
        sys.exit(1)
`;

function gameRollbackIdentityCommands(action = 'verify') {
  if (!['verify', 'current', 'apply', 'restored'].includes(action)) throw new Error('Invalid rollback identity action');
  const command = `printf %s "${Buffer.from(ROLLBACK_SCRIPT).toString('base64')}" | base64 -d | python3 - "$backup_dir" "$service_name" ${action}`;
  if (!['verify', 'current'].includes(action)) return [command];
  return [`rollback_identity=$(${command})`, 'rollback_reference=${rollback_identity%|*}', 'target_image_id=${rollback_identity##*|}'];
}

function gameRecoveryIdentityCommands(migrationCount) {
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 0) throw new Error('Invalid migration count');
  return [`printf %s "${Buffer.from(RECEIPT_SCRIPT).toString('base64')}" | base64 -d | python3 - "$backup_dir" ${migrationCount}`];
}
module.exports = {gameRecoveryIdentityCommands, gameRollbackIdentityCommands};
