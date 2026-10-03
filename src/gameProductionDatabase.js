const GAME_DATABASE = Object.freeze({
  container: 'rhospital-failback-game-db',
  host: '127.0.0.1',
  port: 35433,
  user: 'hospital',
  name: 'hospital',
  jdbcUrl: 'jdbc:postgresql://92.113.124.185:35433/hospital',
  systemIdentifier: '7692118169925038123'
});

function gameDatabasePsqlCommand(options = '', stdin = true) {
  return 'docker exec' + (stdin ? ' -i' : '') + ' "$database_container_id" psql -X -v ON_ERROR_STOP=1'
    + ' -h ' + GAME_DATABASE.host + ' -p ' + GAME_DATABASE.port
    + ' -U ' + GAME_DATABASE.user + ' -d ' + GAME_DATABASE.name + (options ? ' ' + options : '');
}

function gameDatabaseContainerResolutionCommands(requireHealthyGame = true) {
  const query = 'BEGIN READ ONLY; SELECT current_database(), inet_server_port(), pg_is_in_recovery(), system_identifier FROM pg_control_system(); ROLLBACK;';
  const identity = GAME_DATABASE.name + '|' + GAME_DATABASE.port + '|f|' + GAME_DATABASE.systemIdentifier;
  const binding = requireHealthyGame ? [
    "production_game_container=$(docker ps -q --filter \"label=com.docker.swarm.service.name=hospital_stack_hospital-backend\" --filter health=healthy | head -n 1)",
    "[ -n \"$production_game_container\" ] || { echo \"ERROR: production database binding requires a healthy game container\"; exit 1; }",
    "production_game_database_url=$(docker exec \"$production_game_container\" sh -lc 'if [ -n \"${SPRING_DATASOURCE_URL:-}\" ]; then printf \"%s\" \"$SPRING_DATASOURCE_URL\"; else tr -d \"\\r\\n\" < /run/secrets/spring.datasource.url; fi')",
  ] : [
    "production_game_database_url=$(docker service inspect hospital_stack_hospital-backend --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's/^SPRING_DATASOURCE_URL=//p')"
  ];
  return [
    ...binding,
    "[ \"$production_game_database_url\" = \"" + GAME_DATABASE.jdbcUrl + "\" ] || { echo \"ERROR: live game datasource differs from the current production database\"; exit 1; }",
    'database_container_name=' + GAME_DATABASE.container,
    "database_container_ids=$(docker ps -q --filter \"name=^/${database_container_name}$\")",
    "database_container_count=$(printf \"%s\\n\" \"$database_container_ids\" | sed '/^$/d' | wc -l)",
    "[ \"$database_container_count\" -eq 1 ] || { echo \"ERROR: expected one current production database container\"; exit 1; }",
    "database_container_id=$(printf \"%s\\n\" \"$database_container_ids\" | head -n 1)",
    "database_identity=$(" + gameDatabasePsqlCommand('-At -F "|"', false) + " -c '" + query + "' | sed '/^BEGIN$/d; /^ROLLBACK$/d')",
    "[ \"$database_identity\" = \"" + identity + "\" ] || { echo \"ERROR: production database identity, port or writable role mismatch\"; exit 1; }",
    'echo game_database_identity=PASS'
  ];
}

module.exports = {GAME_DATABASE, gameDatabasePsqlCommand, gameDatabaseContainerResolutionCommands};
