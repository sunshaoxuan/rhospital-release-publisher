const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const file = path.resolve(__dirname, '../src/releasePublisherCore.js');
const isolated = new Module(file);
isolated.filename = file;
isolated.paths = Module._nodeModulePaths(path.dirname(file));
isolated._compile(fs.readFileSync(file, 'utf8')
  + '\nmodule.exports.probeForTest = gameSmtpSenderProbeCommands;', file);
const script = isolated.exports.probeForTest('test', 'game', {
  host: 'smtp.example.invalid', port: 587,
  username: 'probe@example.invalid', fromAddress: 'probe@example.invalid'
}).join('\n').split("python3 - <<'PY'\n")[1].replace(/\nPY$/, '');
const bundledPython = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.PYTHON || (fs.existsSync(bundledPython) ? bundledPython : 'python3');

// Execute the generated probe and real smtplib AUTH encoding without network or Docker.
const harness = String.raw`
import base64, contextlib, io, json, smtplib, ssl, subprocess, sys
case = sys.argv[1]
commands = []
secret = 'synthetic-secret-never-log'
def output(args, **kwargs):
    if args[1] == 'ps':
        commands.append('container')
        return '' if case == 'no_container' else 'one\ntwo\n' if case == 'two_containers' else 'one\n'
    commands.append('secret')
    assert args[:3] == ['docker', 'exec', 'one']
    return '' if case == 'empty_secret' else secret
subprocess.check_output = output
class SMTP(smtplib.SMTP):
    def __init__(self, host, port, timeout):
        commands.append('connect')
        assert (host, port, timeout) == ('smtp.example.invalid', 587, 10)
        if case == 'timeout': raise TimeoutError(secret)
        self.esmtp_features = {}
        self.ehlos = 0
    def ehlo(self):
        self.ehlos += 1
        commands.append('ehlo' if self.ehlos == 1 else 'tls_ehlo')
        self.esmtp_features = {'auth': 'LOGIN' if case == 'no_plain' else 'PLAIN LOGIN'}
        return (550 if case == commands[-1] else 250, b'')
    def starttls(self, *, context):
        commands.append('starttls')
        assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
        if case == 'tls_cert': raise ssl.SSLCertVerificationError(secret)
        return (454 if case == 'starttls' else 220, b'')
    def docmd(self, cmd, args=''):
        commands.append(cmd.lower())
        assert cmd == 'AUTH'
        mechanism, encoded = args.split(' ', 1)
        assert mechanism == 'PLAIN'
        assert base64.b64decode(encoded) == ('\0probe@example.invalid\0' + secret).encode()
        if case == 'disconnect': raise smtplib.SMTPServerDisconnected(secret)
        return (535 if case == 'auth' else 235, secret.encode())
    def mail(self, sender):
        commands.append('mail_from')
        assert sender == 'probe@example.invalid'
        return (554 if case == 'mail_from' else 250, secret.encode())
    def rset(self):
        commands.append('rset')
        return (550 if case == 'rset' else 250, secret.encode())
    def close(self): commands.append('close')
smtplib.SMTP = SMTP
captured = io.StringIO()
status = 0
with contextlib.redirect_stdout(captured):
    try: exec(sys.stdin.read())
    except SystemExit as error: status = error.code
print(json.dumps({'status': status, 'output': captured.getvalue(), 'commands': commands}))
`;

const failures = {
  no_container: ['container', 'RuntimeError'],
  two_containers: ['container', 'RuntimeError'],
  empty_secret: ['secret', 'RuntimeError'],
  timeout: ['connect', 'TimeoutError'],
  ehlo: ['ehlo', '550'],
  starttls: ['starttls', '454'],
  tls_cert: ['starttls', 'SSLCertVerificationError'],
  tls_ehlo: ['tls_ehlo', '550'],
  no_plain: ['auth', 'SMTPNotSupportedError'],
  auth: ['auth', '535'],
  disconnect: ['auth', 'SMTPServerDisconnected'],
  mail_from: ['mail_from', '554'],
  rset: ['rset', '550']
};
for (const scenario of ['success', ...Object.keys(failures)]) {
  test(`generated SMTP probe behavior: ${scenario}`, () => {
    const result = spawnSync(python, ['-c', harness, scenario], {
      input: script, encoding: 'utf8', timeout: 15000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.doesNotMatch(actual.output + result.stderr, /synthetic-secret-never-log|probe@example\.invalid/);
    assert.ok(actual.commands.every(cmd => !['data', 'rcpt', 'sendmail'].includes(cmd)));
    if (scenario === 'success') {
      assert.equal(actual.status, 0);
      assert.equal(actual.output, 'game_smtp_sender=PASS\n');
      assert.deepEqual(actual.commands, ['container', 'secret', 'connect', 'ehlo', 'starttls', 'tls_ehlo', 'auth', 'mail_from', 'rset', 'close']);
    } else {
      const [stage, reason] = failures[scenario];
      assert.equal(actual.status, 1);
      assert.match(actual.output, new RegExp(`stage=${stage} (code|error_type)=${reason}`));
      assert.doesNotMatch(actual.output, /PASS/);
      if (stage === 'auth') {
        assert.ok(!actual.commands.includes('mail_from'));
        assert.ok(actual.commands.filter(cmd => cmd === 'auth').length <= 1);
      }
    }
    if (actual.commands.includes('ehlo')) assert.equal(actual.commands.at(-1), 'close');
  });
}
