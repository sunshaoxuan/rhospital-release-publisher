// One contract for advisory observations, maintenance and resource admission.
const SERVICES=['meelok_web','meelok_worker','meelok_api','meelok_redis','meelok_object_storage'];
const NO_HEALTHCHECK_SERVICES=['meelok_worker','meelok_object_storage'];
// Read only the configured-check flag, running flag and health status. No logs,
// environment or healthcheck command text are returned. Missing state is unknown.
const HEALTH_FORMAT='{{$configured := false}}{{with index .Config "Healthcheck"}}{{with index . "Test"}}{{if ne (index . 0) "NONE"}}{{$configured = true}}{{end}}{{end}}{{end}}{{if not .State.Running}}stopped{{else}}{{with index .State "Health"}}{{if $configured}}{{.Status}}{{else}}unknown{{end}}{{else}}{{if $configured}}unknown{{else}}none{{end}}{{end}}{{end}}';
function readyPattern(prefix=''){
  return ['*:'+prefix+'healthy',...NO_HEALTHCHECK_SERVICES.map(name=>name+':'+prefix+'none')].join('|');
}
function pythonPrelude(){
  return `MEELOK_HEALTH_FORMAT = ${JSON.stringify(HEALTH_FORMAT)}\nMEELOK_SERVICES = ${JSON.stringify(SERVICES)}\nMEELOK_NO_HEALTHCHECK_SERVICES = ${JSON.stringify(NO_HEALTHCHECK_SERVICES)}\n`;
}
module.exports={SERVICES,NO_HEALTHCHECK_SERVICES,HEALTH_FORMAT,readyPattern,pythonPrelude};
