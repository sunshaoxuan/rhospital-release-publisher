// Publisher-only helper. No application repository, process or production command.
const path = require('node:path');
const {installationOperationLock, acquireOperationLock, releaseOperationLock} = require('../src/publisherOperationLock');
const {createLegacyBarrier, removeLegacyBarrier} = require('../src/publisherLegacyBarrier');
const [action, root, runtime, token] = process.argv.slice(2);
if (process.argv.length !== 6 || !['acquire', 'release', 'barrier', 'unbarrier'].includes(action)) throw new Error('Invalid update guard arguments');
const canonical = path.resolve(root);
const live = path.resolve(runtime);
if (!live.startsWith(canonical + path.sep + '.service' + path.sep + 'releases' + path.sep)) throw new Error('Publisher runtime outside installation boundary');
const lock = installationOperationLock(canonical);
if (action === 'acquire') acquireOperationLock(lock, 'update', token);
if (action === 'release') releaseOperationLock(lock, token);
if (action === 'barrier') createLegacyBarrier(live, token);
if (action === 'unbarrier') removeLegacyBarrier(live, token);
console.log('publisher_update_guard=' + action.toUpperCase());
