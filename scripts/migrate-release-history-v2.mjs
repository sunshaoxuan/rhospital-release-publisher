import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATION_ID = 'release-history-v2-retired-target-redaction';
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const options = parseArgs(process.argv.slice(2));
const historyPath = path.resolve(options.history || path.join(repositoryRoot, '.release-history.json'));
const receiptPath = path.resolve(options.receipt || path.join(repositoryRoot, '.release-history-migrations.json'));
const direction = options.direction || 'apply';
const retiredValues = new Map([
  [['SSH', '178'].join(''), '历史生产目标别名已清除'],
  [['178', '239', '117', '99'].join('.'), '历史生产主机V1已清除'],
  [['148', '135', '9', '123'].join('.'), '历史生产主机V0已清除']
]);

if (!['apply', 'rollback'].includes(direction)) {
  throw new Error('direction must be apply or rollback');
}
if (!fs.existsSync(historyPath)) {
  throw new Error(`release history not found: ${historyPath}`);
}

const historyText = fs.readFileSync(historyPath, 'utf8');
const history = JSON.parse(historyText);
if (!Array.isArray(history)) {
  throw new Error('release history must be a JSON array');
}
const replacements = direction === 'apply'
  ? new Map([...retiredValues.entries(),
      ['RETIRED_TARGET_ALIAS_V1', '历史生产目标别名已清除'],
      ['RETIRED_TARGET_HOST_V1', '历史生产主机V1已清除'],
      ['RETIRED_TARGET_HOST_V0', '历史生产主机V0已清除']])
  : new Map([...retiredValues.entries()].map(([source, replacement]) => [replacement, source]));
let replacementCount = 0;
const migrated = transform(history, replacements);
const migratedText = `${JSON.stringify(migrated, null, 2)}\n`;
writeAtomic(historyPath, migratedText);

const receipt = fs.existsSync(receiptPath)
  ? JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  : {schemaVersion: 2, migrations: []};
const record = {
  id: MIGRATION_ID,
  status: direction === 'apply' ? 'applied' : 'rolled_back',
  appliedAt: new Date().toISOString(),
  replacementCount,
  beforeSha256: sha256(historyText),
  afterSha256: sha256(migratedText)
};
receipt.schemaVersion = 2;
receipt.migrations = Array.isArray(receipt.migrations)
  ? receipt.migrations.filter(item => item.id !== MIGRATION_ID).concat(record)
  : [record];
writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

for (const [retired] of retiredValues) {
  if (direction === 'apply' && migratedText.includes(retired)) {
    throw new Error('retired production identifier remains after migration');
  }
}
console.log(`release_history_migration=PASS direction=${direction} replacements=${replacementCount}`);

function transform(value, mapping) {
  if (Array.isArray(value)) return value.map(item => transform(item, mapping));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item, mapping)]));
  }
  if (typeof value !== 'string') return value;
  let result = value;
  for (const [source, replacement] of mapping) {
    const pieces = result.split(source);
    if (pieces.length > 1) {
      replacementCount += pieces.length - 1;
      result = pieces.join(replacement);
    }
  }
  return result;
}

function writeAtomic(targetPath, contents) {
  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, contents, 'utf8');
  fs.renameSync(temporaryPath, targetPath);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}
