const PRODUCTION_CONFIG_GUARD_SCRIPT = String.raw`
import json, re, subprocess, sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        root = json.load(source)
    service = root["services"]["hospital-backend"]
    result = subprocess.run(["docker", "service", "inspect", sys.argv[2]],
                            capture_output=True, text=True, check=True, timeout=15)
    live = json.loads(result.stdout)[0]["Spec"]["TaskTemplate"]["ContainerSpec"]
    failures = set()
    environment = service.get("environment", {})
    live_environment = dict(item.split("=", 1) for item in live.get("Env", []))
    expected_environment = {key: str(value) for key, value in environment.items() if key != "IMAGE_TAG"}
    actual_environment = {key: value for key, value in live_environment.items() if key != "IMAGE_TAG"}
    if expected_environment != actual_environment or len(live_environment) != len(live.get("Env", [])):
        failures.add("environment")
    if environment.get("SPRING_PROFILE") != "prod":
        failures.add("production_profile")
    if any(re.sub(r"[._-]", "", key).lower() in ("stripeapikey", "stripewebhooksecret") for key in environment):
        failures.add("stripe_override")
    options = " ".join(str(environment.get(key, "")) for key in ("JAVA_OPTS", "JAVA_EXTRA_OPTS"))
    if re.search(r"(?i)stripe[._-](api[._-]key|webhook[._-]secret)|spring[._-](config[._-](import|location|additional[._-]location)|profiles[._-]active)", options):
        failures.add("property_override")
    for compose_key, live_key in (("entrypoint", "Command"), ("command", "Args")):
        expected = service.get(compose_key) or []
        if expected != (live.get(live_key) or []):
            failures.add(compose_key)
        if expected:
            failures.add("startup_override")
    expected_mounts = sorted((item["type"], item["source"], item["target"], bool(item.get("read_only", False)))
                             for item in service.get("volumes", []))
    actual_mounts = sorted((item["Type"], item["Source"], item["Target"], bool(item.get("ReadOnly", False)))
                           for item in live.get("Mounts", []))
    if expected_mounts != actual_mounts:
        failures.add("mounts")
    expected_secrets = sorted((root["secrets"][item["source"]].get("name", item["source"]), item["target"])
                              for item in service.get("secrets", []))
    actual_secrets = sorted((item["SecretName"], item["File"]["Name"]) for item in live.get("Secrets", []))
    if expected_secrets != actual_secrets:
        failures.add("secrets")
    required_stripe = {("game_stripe_api_key", "stripe.api.key"), ("game_stripe_webhook_secret", "stripe.webhook.secret")}
    if not required_stripe.issubset(set(expected_secrets)):
        failures.add("stripe_secrets")
    if service.get("configs") or live.get("Configs"):
        failures.add("configs")
    if failures:
        print("game_compose_live_config=FAIL fields=" + ",".join(sorted(failures)))
        sys.exit(1)
    print("game_compose_live_config=PASS ignored=IMAGE_TAG")
except Exception as error:
    print("game_compose_live_config=FAIL failureType=" + type(error).__name__)
    sys.exit(1)
`;

const STRIPE_AUTHENTICATION_SCRIPT = String.raw`
import json, subprocess, sys

try:
    container = sys.argv[1]
    key = subprocess.check_output(["docker", "exec", container, "cat", "/run/secrets/stripe.api.key"], text=True, timeout=10).strip()
    if not key.startswith("sk_live_"):
        raise ValueError("Expected live Stripe key")
    config = "url = \"https://api.stripe.com/v1/balance\"\n" + "header = " + json.dumps("Authorization: Bearer " + key) + "\n"
    result = subprocess.run(["docker", "exec", "-i", container, "curl", "--config", "-",
                             "--silent", "--show-error", "--connect-timeout", "5", "--max-time", "15",
                             "--write-out", "\n%{http_code}"], input=config, text=True, capture_output=True, timeout=20)
    body, status = result.stdout.rsplit("\n", 1)
    if result.returncode != 0 or status != "200" or json.loads(body).get("livemode") is not True:
        raise ValueError("Stripe authentication failed")
    print("game_stripe_authentication=PASS live=true method=GET")
except Exception as error:
    print("game_stripe_authentication=FAIL failureType=" + type(error).__name__)
    sys.exit(1)
`;

function encodedPythonCommand(script, argumentsText) {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return `printf %s "${encoded}" | base64 -d | python3 - ${argumentsText}`;
}

function gameProductionConfigGuardCommands() {
  return [encodedPythonCommand(PRODUCTION_CONFIG_GUARD_SCRIPT, '"$compose_contract_file" "$service_name"')];
}

function gameStripeAuthenticationCommands() {
  return [encodedPythonCommand(STRIPE_AUTHENTICATION_SCRIPT, '"$runtime_container"')];
}

function gameProductionImageConfigCommands() {
  return [
    `production_import_count=$(grep -Ec '^[[:space:]]*spring[.]config[.]import([[:space:]]+|[:=])' BOOT-INF/classes/application-prod.properties || true)`,
    `[ "$production_import_count" -eq 1 ] || { echo 'ERROR: production image must contain exactly one configuration import'; exit 1; }`,
    `grep -Eq '^spring[.]config[.]import=(optional:)?configtree:/run/secrets/[[:space:]]*$' BOOT-INF/classes/application-prod.properties || { echo 'ERROR: production image must load controlled configuration secrets'; exit 1; }`,
    `! grep -Eq '^[[:space:]]*stripe[.](api[.]key|webhook[.]secret)([[:space:]]+|[:=])' BOOT-INF/classes/application-prod.properties || { echo 'ERROR: production image contains a Stripe credential override'; exit 1; }`
  ];
}

module.exports = {gameProductionConfigGuardCommands, gameStripeAuthenticationCommands, gameProductionImageConfigCommands};
