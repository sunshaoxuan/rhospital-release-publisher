function selectedRuntimeChecks(policy, requiredChecks) {
  return policy.runtimeChecks.filter(check => requiredChecks.has(check.id));
}
function runtimeCheckCommands(check) {
  if(check.kind!=='http-get')throw new Error('Unsupported application runtime check');
  return [
    `application_http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time ${check.timeoutSeconds} 'http://127.0.0.1:8190${check.path}')`,
    `[ "$application_http_code" = '${check.status}' ] || { echo 'application_runtime_check=FAIL id=${check.id}'; exit 1; }`,
    `echo 'application_runtime_check=PASS id=${check.id}'`
  ];
}
module.exports={selectedRuntimeChecks,runtimeCheckCommands};
