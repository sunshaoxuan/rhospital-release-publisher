const assert = require('node:assert/strict');
const test = require('node:test');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const {expectedTomcatVersion, tomcatJarCheckScript} = require('../src/tomcatSecurityCheck');

test('requires explicit supported Tomcat patch and rejects interpolation or duplicates', () => {
  assert.equal(expectedTomcatVersion('<tomcat.version>10.1.59</tomcat.version>'), '10.1.59');
  for (const version of ['10.1.40', '11.0.0', '${tomcat}', '10.1.59;id', '']) {
    assert.throws(() => expectedTomcatVersion(`<tomcat.version>${version}</tomcat.version>`));
  }
  assert.throws(() => expectedTomcatVersion('<!-- <tomcat.version>10.1.59</tomcat.version> -->'));
  assert.throws(() => expectedTomcatVersion('<tomcat.version>10.1.59</tomcat.version>'.repeat(2)));
});

test('actual shell probe rejects missing, mixed and duplicate packaged components', () => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  assert.ok(fs.existsSync(bash));
  const valid = ['core', 'el', 'websocket'].map(c => `BOOT-INF/lib/tomcat-embed-${c}-10.1.59.jar`);
  for (const [names, success] of [
    [valid, true], [valid.slice(1), false],
    [[...valid, valid[0]], false],
    [[valid[0].replace('10.1.59', '10.1.40'), ...valid.slice(1)], false]
  ]) {
    const script = `jar() { cat <<'FIXTURE'\n${names.join('\n')}\nFIXTURE\n}\n${tomcatJarCheckScript('10.1.59')}`;
    const result = spawnSync(bash, ['-c', script], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status === 0, success, result.stderr);
    assert.equal(result.stdout.includes('tomcat_security_version=PASS'), success);
  }
});
