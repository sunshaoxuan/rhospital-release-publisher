"""Publisher-owned service-only recovery. Default mode is read-only planning.

Never restores a database, rotates credentials, rewrites compose or starts the app
outside Swarm. The Docker API version query provides an atomic concurrency gate.
"""
import argparse
import base64
import copy
import hashlib
import http.client
import json
import os
import re
import socket
import subprocess
import sys


def fail(code):
    raise ValueError(code)


def docker_json(*args):
    return json.loads(subprocess.check_output(["docker", *args], timeout=20))


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def bind_image(snapshot_image, resolved_image, reference):
    image_id = snapshot_image.get("Id", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id) or resolved_image.get("Id") != image_id:
        fail("backup_image_identity_mismatch")
    digests = sorted(set(snapshot_image.get("RepoDigests", [])) & set(resolved_image.get("RepoDigests", [])))
    repository = reference.split("@")[0].rsplit(":", 1)[0] if ":" in reference.split("/")[-1] else reference.split("@")[0]
    matches = [item for item in digests if re.fullmatch(re.escape(repository) + r"@sha256:[a-f0-9]{64}", item)]
    if len(matches) != 1:
        fail("immutable_backup_digest_unavailable_or_ambiguous")
    return matches[0], image_id


def make_plan(snapshot, live, snapshot_image, resolved_image, digest_image, healthy, migration_count):
    if migration_count != 0:
        fail("service_only_recovery_requires_zero_migrations")
    if live.get("PreviousSpec") != snapshot.get("Spec"):
        fail("previous_spec_differs_from_backup")
    if live.get("UpdateStatus", {}).get("State") not in ("paused", "updating"):
        fail("update_state_changed")
    baseline = snapshot["Spec"]
    if baseline.get("Mode", {}).get("Replicated", {}).get("Replicas") != 1:
        fail("unsupported_replica_contract")
    reference = baseline["TaskTemplate"]["ContainerSpec"]["Image"]
    digest, image_id = bind_image(snapshot_image, resolved_image, reference)
    if digest_image.get("Id") != image_id:
        fail("digest_resolution_mismatch")
    if len(healthy) != 1 or healthy[0].get("Image") != image_id or healthy[0].get("State", {}).get("Health", {}).get("Status") != "healthy":
        fail("original_healthy_instance_unavailable")
    versions = [entry[10:] for entry in baseline["TaskTemplate"]["ContainerSpec"].get("Env", []) if entry.startswith("IMAGE_TAG=")]
    if len(versions) != 1 or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", versions[0]):
        fail("backup_version_unavailable")
    plan = {"protocol": "game-service-recovery-v1", "serviceId": live["ID"], "serviceVersion": live["Version"]["Index"],
            "image": digest, "imageId": image_id, "appTag": versions[0], "replicas": 1,
            "baselineHash": fingerprint(baseline), "currentSpecHash": fingerprint(live["Spec"]),
            "healthyContainer": healthy[0]["Id"], "migrationCount": 0}
    plan["planHash"] = fingerprint(plan)
    return plan


def restore_spec(snapshot, plan):
    spec = copy.deepcopy(snapshot["Spec"])
    spec["TaskTemplate"]["ContainerSpec"]["Image"] = plan["image"]
    # Keep source configuration, secrets, authentication and runtime policy intact.
    return spec


def inspect_plan(backup, service, legacy_evidence=None):
    subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=backup, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    def load(name):
        with open(os.path.join(backup, name), encoding="utf-8") as source:
            return json.load(source)
    # These authenticated publisher snapshots are never printed.
    snapshot = load("service.inspect.json")[0]
    snapshot_image = load("image.inspect.json")[0]
    if os.path.isfile(os.path.join(backup, "game-service-recovery.json")):
        receipt = load("game-service-recovery.json")
    else:
        # Old publisher backups have image identities but no recovery receipt.
        # The local publisher CLI must bind a terminal history record, not an
        # operator-supplied assertion that migrations did not run.
        if not legacy_evidence or legacy_evidence.get("backup") != backup or legacy_evidence.get("status") != "RECOVERY_REQUIRED" or legacy_evidence.get("migrationCount") != 0:
            fail("verified_release_history_required_for_legacy_backup")
        receipt = {"baselineHash": fingerprint(snapshot["Spec"]), "imageId": snapshot_image["Id"], "migrationCount": 0}
    if receipt.get("baselineHash") != fingerprint(snapshot["Spec"]) or receipt.get("imageId") != snapshot_image["Id"]:
        fail("backup_receipt_mismatch")
    live = docker_json("service", "inspect", service)[0]
    if legacy_evidence and live["Spec"]["TaskTemplate"]["ContainerSpec"]["Image"] != legacy_evidence.get("targetImage"):
        fail("release_history_target_changed")
    reference = snapshot["Spec"]["TaskTemplate"]["ContainerSpec"]["Image"]
    image = docker_json("image", "inspect", reference)[0]
    digest, _ = bind_image(snapshot_image, image, reference)
    digest_image = docker_json("image", "inspect", digest)[0]
    ids = subprocess.check_output(["docker", "ps", "-q", "--filter", "label=com.docker.swarm.service.name=" + service, "--filter", "health=healthy"], text=True, timeout=15).split()
    healthy = docker_json("inspect", *ids) if ids else []
    plan = make_plan(snapshot, live, snapshot_image, image, digest_image, healthy, receipt.get("migrationCount"))
    # Match the existing technology/room capability guard, using the already
    # healthy original image. No disposable app/container is started to inspect it.
    classes = ["SupervisionSettlementLedger", "catalog/TechnologyCatalogService", "catalog/RoomCatalogService"]
    listing = subprocess.check_output(["docker", "exec", plan["healthyContainer"], "jar", "tf", "/app/app.jar"], text=True, timeout=30).splitlines()
    if any("BOOT-INF/classes/com/zly/hospital/service/" + name + ".class" not in listing for name in classes):
        fail("original_image_format_capability_missing")
    return snapshot, plan


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/var/run/docker.sock")


def apply_plan(snapshot, plan, expected_hash, expected_version, connection_factory=DockerConnection):
    if plan["planHash"] != expected_hash or plan["serviceVersion"] != expected_version:
        fail("recovery_plan_changed_reinspect_before_approval")
    connection = connection_factory("localhost", timeout=30)
    body = json.dumps(restore_spec(snapshot, plan)).encode()
    connection.request("POST", "/services/" + plan["serviceId"] + "/update?version=" + str(expected_version), body,
                       {"Content-Type": "application/json"})
    response = connection.getresponse()
    response.read()  # Never print daemon response bodies: they may contain config.
    connection.close()
    if response.status != 200:
        fail("service_recovery_rejected_status_" + str(response.status))


def verify_service(snapshot, live, image, containers):
    reference = snapshot["Spec"]["TaskTemplate"]["ContainerSpec"]["Image"]
    digest, image_id = bind_image(image, image, reference)
    expected = copy.deepcopy(snapshot["Spec"])
    expected["TaskTemplate"]["ContainerSpec"]["Image"] = digest
    if live.get("Spec") != expected or live.get("UpdateStatus", {}).get("State") not in ("completed", "rollback_completed"):
        fail("restored_service_not_converged")
    if len(containers) != 1 or containers[0].get("Image") != image_id or containers[0].get("State", {}).get("Health", {}).get("Status") != "healthy":
        fail("restored_healthy_replica_not_confirmed")
    return {"image": digest, "replicas": 1, "baselineHash": fingerprint(snapshot["Spec"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", required=True)
    parser.add_argument("--service", default="hospital_stack_hospital-backend")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--expected-plan")
    parser.add_argument("--expected-version", type=int)
    parser.add_argument("--release-evidence-base64")
    args = parser.parse_args()
    if args.service != "hospital_stack_hospital-backend" or not os.path.isabs(args.backup):
        fail("invalid_recovery_target")
    if args.verify:
        if args.apply:
            fail("conflicting_recovery_modes")
        subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=args.backup, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        with open(os.path.join(args.backup, "service.inspect.json"), encoding="utf-8") as source:
            snapshot = json.load(source)[0]
        with open(os.path.join(args.backup, "image.inspect.json"), encoding="utf-8") as source:
            image = json.load(source)[0]
        live = docker_json("service", "inspect", args.service)[0]
        ids = subprocess.check_output(["docker", "ps", "-q", "--filter", "label=com.docker.swarm.service.name=" + args.service], text=True, timeout=15).split()
        result = verify_service(snapshot, live, image, docker_json("inspect", *ids) if ids else [])
        print("game_service_recovery=RESTORED " + json.dumps(result, sort_keys=True))
        return
    evidence = json.loads(base64.b64decode(args.release_evidence_base64, validate=True)) if args.release_evidence_base64 else None
    snapshot, plan = inspect_plan(args.backup, args.service, evidence)
    if args.apply:
        apply_plan(snapshot, plan, args.expected_plan, args.expected_version)
        print("game_service_recovery=SUBMITTED validation=REQUIRED plan=" + plan["planHash"])
    else:
        print(json.dumps(plan, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Only our bounded error codes can escape. Never echo external errors.
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z0-9_]+", str(error)) else "evidence_unavailable"
        print("game_service_recovery=FAIL reason=" + code + " action=reinspect_original_healthy_instance_and_backup", file=sys.stderr)
        sys.exit(1)
