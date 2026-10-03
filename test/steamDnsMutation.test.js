const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function scripts() {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/releasePublisherCore.js'), 'utf8');
    const code = source.slice(source.indexOf('function gameSteamPartnerProbeCommands()'), source.indexOf('function gameComposeSsoContractCommands()'));
    const context = { Buffer, shellToken: value => "'" + String(value).replaceAll("'", "'\\''") + "'" };
    vm.runInNewContext(code + ';this.commands=gameSteamDnsUpdateCommands()', context);
    const encoded = context.commands[1].match(/printf %s '([^']+)'/)[1];
    return Buffer.from(encoded, 'base64').toString('utf8');
}

test('actual structured DNS update is idempotent and preserves other services and contracts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rhospital-steam-dns-'));
    try {
        const fixture = {version: '3.8', services: {
            'hospital-backend': { image: 'hospital-backend:test', environment: {SPRING_PROFILE: 'prod'},
                secrets: [{source: 'existing', target: 'steam.web.api.key'}],
                deploy: {replicas: 1, update_config: {order: 'start-first'}}, networks: ['default'] },
            other: { image: 'postgres:16', dns: ['9.9.9.9'] }
        }, secrets: {existing: {external: true}}, networks: {default: {driver: 'overlay'}}};
        const file = path.join(directory, 'docker-compose.yml');
        fs.writeFileSync(file, JSON.stringify(fixture));
        const code = scripts();
        const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = spawnSync(python, ['-c', code], {cwd: directory, encoding: 'utf8', windowsHide: true});
            assert.equal(result.status, 0, result.stderr);
        }
        const decoded = spawnSync(python, ['-c', 'import yaml,json;print(json.dumps(yaml.safe_load(open("docker-compose.yml"))))'],
            {cwd: directory, encoding: 'utf8', windowsHide: true});
        assert.equal(decoded.status, 0, decoded.stderr);
        const actual = JSON.parse(decoded.stdout);
        fixture.services['hospital-backend'].dns = ['1.1.1.1', '8.8.8.8'];
        assert.deepEqual(actual, fixture);
        assert.deepEqual(fs.readdirSync(directory), ['docker-compose.yml']);

        fs.writeFileSync(file, JSON.stringify({services: {other: fixture.services.other}}));
        const before = fs.readFileSync(file, 'utf8');
        const failed = spawnSync(python, ['-c', code], {cwd: directory, encoding: 'utf8', windowsHide: true});
        assert.notEqual(failed.status, 0);
        assert.equal(fs.readFileSync(file, 'utf8'), before);
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
