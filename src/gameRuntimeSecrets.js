const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readGameSigningApproval, signingPrelude} = require('./gameSigningBinding');

const GAME_PRODUCTION_SECRET_MAPPINGS = [
  ['game_failback_firebase_service_account', 'firebase_service_account'],
  ['forum_sso_secret', 'forum_sso_secret'],
  ['game_new_relic_license_key', 'newrelic.license.key'],
  ['game_paddle_api_key', 'paddle.api.key'],
  ['game_paddle_client_token', 'paddle.client.token'],
  ['game_paddle_webhook_secret', 'paddle.webhook.secret'],
  ['game_snailjob_recovery_properties_20261003', 'snail-job.properties'],
  ['game_failback_spring_datasource_password', 'spring.datasource.password'],
  ['game_failback_steam_auth', 'steam-auth.properties'],
  ['game_steam_microtxn_publisher_key', 'steam.microtxn.publisher.key'],
  ['game_stripe_api_key', 'stripe.api.key'],
  ['game_stripe_webhook_secret', 'stripe.webhook.secret'],
  ['support_mail_password', 'spring.mail.password'],
  ['support_mail_password', 'support_mail_password']
];

function gameRuntimeSecretCommands(contract, approval = readGameSigningApproval()) {
  if (contract && (contract.version !== 2 || contract.checker !== '--check-login-signing-key'
      || !/^[a-f0-9]{64}$/.test(contract.sourceHash))) throw new Error('Unknown runtime startup contract');
  const startupScript = signingPrelude(approval) + fs.readFileSync(path.resolve(__dirname, '../scripts/check-game-startup.py'), 'utf8');
  const config = {mappings: GAME_PRODUCTION_SECRET_MAPPINGS, approval: contract ? approval : null,
    bindingHash: contract ? crypto.createHash('sha256').update(contract.sourceHash).update(startupScript).digest('hex') : null};
  const script = 'CONFIG=' + JSON.stringify(JSON.stringify(config)) + '\n' + fs.readFileSync(path.resolve(__dirname, '../scripts/check-game-runtime-secrets.py'), 'utf8');
  return [`printf %s "${Buffer.from(script).toString('base64')}" | base64 -d | python3 - "$service_name" "$runtime_container"`];
}
module.exports = {GAME_PRODUCTION_SECRET_MAPPINGS, gameRuntimeSecretCommands};
