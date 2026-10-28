const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {AsyncLocalStorage} = require('node:async_hooks');

// Own only directories allocated by this instance; never discover old fixtures.
function fixtureLifecycle(nodeTest, {remove = fs.rmSync} = {}) {
  const context = new AsyncLocalStorage();
  const owned = new Map();
  const base = fs.realpathSync(os.tmpdir());
  const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;

  function cleanup(root) {
    const record = owned.get(root);
    if (!record) throw new Error('Refusing unowned fixture cleanup');
    if (!record.scope.finished || record.leases) throw new Error(`Fixture still in use; retained: ${root}`);
    let stat;
    try { stat = fs.lstatSync(root, {bigint: true}); }
    catch (error) {
      if (error.code === 'ENOENT') { owned.delete(root); return; }
      throw error;
    }
    if (path.dirname(root) !== base || stat.isSymbolicLink() || !stat.isDirectory()
        || identity(stat) !== record.identity || fs.realpathSync(root) !== root) {
      throw new Error(`Fixture identity changed; retained: ${root}`);
    }
    remove(root, {recursive: true, force: false, maxRetries: 2, retryDelay: 50});
    owned.delete(root);
  }

  function temporaryDirectory(prefix) {
    const scope = context.getStore();
    if (!scope || scope.finished) throw new Error('Fixture must be created inside its owning test');
    if (!/^release-publisher-[a-z0-9-]*$/.test(prefix)) throw new Error('Unsupported fixture prefix');
    const root = fs.mkdtempSync(path.join(base, prefix));
    owned.set(root, {scope, leases: 0, identity: identity(fs.lstatSync(root, {bigint: true}))});
    // Register before populating files or initializing Git (both can throw).
    scope.test.after(() => cleanup(root));
    return root;
  }

  function hold(root) {
    const record = owned.get(root);
    if (!record || record.scope !== context.getStore()) throw new Error('Unowned fixture lease');
    record.leases++;
    let released = false;
    return () => { if (!released) { released = true; record.leases--; } };
  }

  function wrap(register) {
    return new Proxy(register, {
      apply(target, receiver, args) {
        const index = args.length - 1;
        if (typeof args[index] === 'function') {
          const body = args[index];
          args[index] = test => {
            const scope = {test, finished: false};
            return context.run(scope, async () => {
              try { return await body(test); }
              finally { scope.finished = true; }
            });
          };
        }
        return Reflect.apply(target, receiver, args);
      },
      get(target, key) {
        return ['only', 'skip', 'todo'].includes(key) ? wrap(target[key]) : Reflect.get(target, key);
      }
    });
  }
  return {test: wrap(nodeTest), temporaryDirectory, hold, cleanup};
}

module.exports = {fixtureLifecycle};
