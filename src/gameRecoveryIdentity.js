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
    digests = [item for item in image.get("RepoDigests", []) if re.fullmatch(re.escape(repository) + r"@sha256:[a-f0-9]{64}", item)]
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
function gameRecoveryIdentityCommands(migrationCount) {
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 0) throw new Error('Invalid migration count');
  return [`printf %s "${Buffer.from(RECEIPT_SCRIPT).toString('base64')}" | base64 -d | python3 - "$backup_dir" ${migrationCount}`];
}
module.exports = {gameRecoveryIdentityCommands};
