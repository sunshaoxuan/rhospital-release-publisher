const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {signingPrelude}=require('./gameSigningBinding');

// The application owns environment/configtree/file precedence. No key bytes
// enter a publisher plan or log; capability is bound to the selected candidate.
function resolveGameStartupContract(properties, tokenSource = '', mainSource = '') {
  if (!/auth\.token\.secret|AUTH_TOKEN_SECRET|Login signing key must contain/.test(properties+'\n'+tokenSource)) return null;
  if (!mainSource.includes('--check-login-signing-key')) throw new Error('Candidate requires login signing configuration but lacks --check-login-signing-key; update the application fail-fast contract before release');
  return {version:2, checker:'--check-login-signing-key',
    sourceHash:crypto.createHash('sha256').update(properties+'\n'+tokenSource+'\n'+mainSource).digest('hex')};
}
function gameStartupContractCommands(contract, verify = false) {
  if (!contract) return [];
  if (contract.version!==2 || contract.checker!=='--check-login-signing-key' || !/^[a-f0-9]{64}$/.test(contract.sourceHash)) throw new Error('Unknown startup contract');
  const script=signingPrelude()+fs.readFileSync(path.resolve(__dirname,'../scripts/check-game-startup.py'),'utf8');
  const bindingHash=crypto.createHash('sha256').update(contract.sourceHash).update(script).digest('hex');
  return [`candidate_startup_source=${contract.sourceHash}`,
    `printf %s "${Buffer.from(script).toString('base64')}" | base64 -d | python3 - "$service_name" "$target_image" ${bindingHash} "$candidate_startup_compose"${verify ? ' --verify' : ''}`];
}
module.exports={resolveGameStartupContract,gameStartupContractCommands};
