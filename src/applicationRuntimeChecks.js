function selectedRuntimeChecks(policy,analysis,assessment) {
  const changed=analysis?.targets?.game?.changedPaths;
  const required=new Set((assessment?.requiredChecks||[]).map(check=>check.stepKey));
  return policy.runtimeChecks.filter(check=>required.has(check.id)||!Array.isArray(changed)||changed.some(file=>check.paths.includes(file)||check.prefixes.some(prefix=>file.startsWith(prefix))));
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
