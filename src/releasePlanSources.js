const fs = require('node:fs');
const path = require('node:path');
const {git} = require('./changeValidationGit');

// One request, one immutable candidate. This cache never authorizes execution.
function createPlanSourceReader(root, commit, files = []) {
  if (commit !== 'latest' && !/^[a-f0-9]{7,40}$/i.test(commit)) throw new Error('Invalid plan source commit');
  const ref = commit === 'latest' || commit.length === 40 ? commit
    : git(root, ['rev-parse', '--verify', `${commit}^{commit}`]).toString('utf8').trim();
  const values = new Map();
  function admit(file) {
    if (typeof file !== 'string' || !file || /[\\:\x00-\x20]/.test(file)
        || path.posix.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid plan source path');
    }
    return file;
  }
  function load(paths) {
    const pending = [...new Set(paths.map(admit))].filter(file => !values.has(file));
    if (!pending.length) return;
    if (ref === 'latest') {
      for (const file of pending) {
        try { values.set(file, fs.readFileSync(path.join(root, file), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') values.set(file, null); else throw error; }
      }
      return;
    }
    const queries = pending.map(file => `${ref}:${file}`);
    const bytes = git(root, ['cat-file', '--batch'], queries.join('\n') + '\n');
    let offset = 0;
    for (let index = 0; index < pending.length; index++) {
      const end = bytes.indexOf(10, offset);
      if (end < 0) throw new Error('Truncated plan source header');
      const header = bytes.subarray(offset, end).toString('utf8');
      offset = end + 1;
      if (header === `${queries[index]} missing`) { values.set(pending[index], null); continue; }
      const match = header.match(/^[a-f0-9]{40} blob (\d+)$/);
      const size = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(size) || size < 0 || offset + size >= bytes.length || bytes[offset + size] !== 10) {
        throw new Error('Invalid plan source blob framing');
      }
      values.set(pending[index], bytes.subarray(offset, offset + size).toString('utf8'));
      offset += size + 1;
    }
    if (offset !== bytes.length) throw new Error('Unexpected plan source output');
  }
  load(files);
  return (file, required = false) => {
    load([file]);
    const source = values.get(file);
    if (source === null && required) throw new Error(`Missing candidate source: ${file}`);
    return source === null ? '' : source;
  };
}
module.exports = {createPlanSourceReader};
