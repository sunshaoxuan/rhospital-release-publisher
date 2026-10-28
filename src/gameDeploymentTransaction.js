const fs=require('node:fs');
const path=require('node:path');
const {pythonPrelude}=require('./gameMaintenanceHealth');
const quote=value=>`'${String(value).replace(/'/g, `'\\''`)}'`;
function lockCommands(){return [
  'umask 077',
  'transaction_lock=.publisher-game-config.lock',
  '[ ! -L "$transaction_lock" ] || { echo "ERROR: unsafe publisher configuration lock"; exit 1; }',
  'if [ -e "$transaction_lock" ]; then [ "$(stat -c %u:%a:%h "$transaction_lock")" = 0:600:1 ] || { echo "ERROR: publisher configuration lock identity changed"; exit 1; }; fi',
  'exec 9>>"$transaction_lock"',
  'flock -n 9 || { echo "ERROR: publisher configuration transaction is busy"; exit 1; }'
];}
function transactionSource(){return pythonPrelude()+fs.readFileSync(path.resolve(__dirname,'../scripts/game-deployment-transaction.py'),'utf8');}
function transactionCommand(action,root,service,image,id){
  if(!['resource','prepare','attempt','compensate'].includes(action))throw Error('Unknown configuration transaction action');
  const source=Buffer.from(transactionSource()).toString('base64');
  const args=action==='resource'?'':` --backup "$backup_dir" --service ${quote(service)} --transaction ${quote(id)} --image ${quote(image)}${action==='prepare'?' --candidate "$compose_candidate"':''}`;
  return `printf %s "${source}" | base64 -d | python3 - ${action} --root ${quote(root)}${args}`;
}
function transactionOutcome(output,id){
  const lines=String(output).split(/\r?\n/).filter(x=>x.startsWith('game_deploy_transaction='));
  if(lines.some(x=>!x.endsWith(' id='+id)||!/^game_deploy_transaction=(ATTEMPTED|NOT_SUBMITTED_RESTORED) id=/.test(x)))return 'UNKNOWN';
  const outcomes=new Set(lines.map(x=>x.match(/^game_deploy_transaction=(ATTEMPTED|NOT_SUBMITTED_RESTORED) id=/)[1]));
  return outcomes.size===1?[...outcomes][0]:'UNKNOWN';
}
module.exports={lockCommands,transactionCommand,transactionOutcome,transactionSource};
