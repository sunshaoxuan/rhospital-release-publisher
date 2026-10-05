const {executeCandidate} = require('../src/gameStandbyCandidate');

async function main() {
  const [action] = process.argv.slice(2);
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 262144) throw new Error('standby_candidate=input_too_large');
    chunks.push(chunk);
  }
  const encoded = Buffer.concat(chunks).toString('ascii').trim();
  const settings = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const binding = await executeCandidate(action, settings);
  console.log(`standby_candidate_receipt=${JSON.stringify(binding)}`);
}

main().catch(error => {
  const code = /^standby_candidate=([a-z_]+)$/.exec(error && error.message)?.[1] || 'unconfirmed';
  console.error(`standby_candidate=FAIL code=${code}`);
  process.exitCode = 1;
});
