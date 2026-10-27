const fs=require('node:fs');
const path=require('node:path');
const {signingPrelude}=require('./gameSigningBinding');
function retryHistoryEvidence(env=process.env) {
  const file=env.RELEASE_PUBLISHER_HISTORY_FILE || path.resolve(__dirname,'../.release-history.json');
  if(!fs.existsSync(file)) return null;
  const records=JSON.parse(fs.readFileSync(file,'utf8'));
  const record=records.find(r=>r.releaseTarget==='game' && r.status==='RECOVERY_REQUIRED');
  if(!record) return null;
  const steps=record.stepSummary || [];
  if(!steps.some(s=>s.key==='pre-deploy-checklist' && s.status==='done' && (s.logs || []).some(l=>/^checklist_database_migrations=PASS count=0$/m.test(l)))) return null;
  if(steps.some(s=>/apply.*migration|offline-cutover/.test(s.key) && s.status!=='pending')) return null;
  const paths=steps.filter(s=>s.key==='backup-game-release' && s.status==='done').flatMap(s=>(s.logs || []).flatMap(l=>[...l.matchAll(/^game_backup_dir=(\/opt\/1panel\/backup\/game-release-[A-Za-z0-9_-]+)$/gm)].map(m=>m[1])));
  if(paths.length!==1 || !/^hospital-backend:[A-Za-z0-9_.-]+$/.test(record.imageTag || '')) return null;
  return {historyId:record.id,backup:paths[0],targetImage:record.imageTag,migrationCount:0};
}
function gameRetryBaselineCommand(mode, extra='') {
  if(!['capture','verify','deploy','rollback'].includes(mode)) throw new Error('Unknown retry baseline mode');
  const script=signingPrelude()+fs.readFileSync(path.resolve(__dirname,'../scripts/game-retry-baseline.py'),'utf8');
  const witness=mode==='capture'?' '+Buffer.from(JSON.stringify(retryHistoryEvidence())).toString('base64'):'';
  return `printf %s "${Buffer.from(script).toString('base64')}" | base64 -d | python3 - ${mode} "$backup_dir" "$service_name"${extra?' '+extra:''}${witness}`;
}
module.exports={gameRetryBaselineCommand,retryHistoryEvidence};
