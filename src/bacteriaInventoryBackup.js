const {GAME_DATABASE} = require('./gameProductionDatabase');

const MIGRATION = 'scripts/migration/20261020_repair_bacteria_opportunity_inventory.sql';
const selected = migrations => migrations.some(item => item.filePath === MIGRATION);

function verifyBacteriaInventoryBackupCommands(migrations) {
  if (!selected(migrations)) return [];
  return [
    'test -s "$backup_dir/database/bacteria-backpack.dump"',
    '(cd "$backup_dir/database" && sha256sum -c bacteria-backpack.SHA256SUMS)',
    'docker exec -i "$database_container_id" pg_restore --list < "$backup_dir/database/bacteria-backpack.dump" > /dev/null',
    'echo bacteria_inventory_backup=PASS'
  ];
}

function bacteriaInventoryBackupCommands(migrations) {
  if (!selected(migrations)) return [];
  return [
    'docker exec "$database_container_id" pg_dump --format=custom --table=public.t_backpack'
      + ` -h ${GAME_DATABASE.host} -p ${GAME_DATABASE.port} -U ${GAME_DATABASE.user} -d ${GAME_DATABASE.name}`
      + ' > "$backup_dir/database/bacteria-backpack.dump"',
    '(cd "$backup_dir/database" && sha256sum bacteria-backpack.dump > bacteria-backpack.SHA256SUMS)',
    ...verifyBacteriaInventoryBackupCommands(migrations)
  ];
}

module.exports = {MIGRATION, bacteriaInventoryBackupCommands, verifyBacteriaInventoryBackupCommands};
