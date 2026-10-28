const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

for (const scenario of ['success', 'busy', 'service-drift', 'identity-drift', 'artifact-drift', 'duplicate-root', 'unquoted-old', 'quote-success', 'bad-runtime', 'quote-bad-runtime', 'rollback-failure', 'rollback-identity-drift', 'restore-identity-mismatch']) {
  test(`publisher update script isolated service transaction: ${scenario}`, {skip: process.platform !== 'win32'}, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-update-script-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, 'scripts'), {recursive: true});
    const host = path.join(root, '.service', 'releases', 'bbbbbbbbbbbb', '.service');
    fs.mkdirSync(host, {recursive: true});
    for (const name of ['.runtime-status', '.supplemental-verifications']) fs.mkdirSync(path.join(root, '.service', 'releases', 'bbbbbbbbbbbb', name));
    fs.writeFileSync(path.join(host, 'RHospitalReleaseConsoleService.build.exe'), 'unchanged fixture host, never executed');
    for (const file of ['.release-history.json', '.release-jobs.json', '.release-history-migrations.json']) fs.writeFileSync(path.join(root, file), '[]');
    fs.copyFileSync(path.join(__dirname, '../scripts/update-publisher.ps1'), path.join(root, 'scripts/update-publisher.ps1'));
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fixtures/publisher-update-harness.ps1'), '-Root', root, '-Scenario', scenario], {encoding: 'utf8', windowsHide: true, timeout: 30000});
    assert.equal(r.status, 0, r.stderr);
    let result;
    try { result = JSON.parse(r.stdout.trim()); } catch { assert.fail(r.stdout + r.stderr); }
    if (['success', 'quote-success', 'unquoted-old'].includes(scenario)) {
      assert.equal(result.failure, null);
      assert.deepEqual(result.events, ['guard-acquire','guard-barrier','stop','config-new','start-new','guard-unbarrier','guard-release']);
    } else if (['busy', 'service-drift', 'identity-drift', 'artifact-drift', 'duplicate-root'].includes(scenario)) {
      assert.ok(result.failure);
      assert.equal(result.events.includes('stop'), false);
      assert.equal(result.oldRestored, true);
    } else if (['bad-runtime', 'quote-bad-runtime'].includes(scenario)) {
      assert.match(result.failure, /prior runtime restored/);
      assert.deepEqual(result.events.slice(-4), ['config-old','guard-unbarrier','guard-release','start-old']);
    } else {
      assert.match(result.failure, scenario === 'rollback-failure' ? /Rollback configuration failed/ : scenario === 'rollback-identity-drift' ? /Concurrent service change/ : /Rollback identity mismatch/);
      assert.equal(result.locked, true);
      assert.equal(result.barrier, true);
      assert.equal(result.events.includes('start-old'), false);
    }
    if (!['rollback-failure', 'rollback-identity-drift', 'restore-identity-mismatch'].includes(scenario)) { assert.equal(result.locked, false); assert.equal(result.barrier, false); }
    if (!['busy', 'duplicate-root'].includes(scenario)) {
      assert.deepEqual(result.directoryLinkTypes, ['Junction', 'Junction']);
      for (const name of ['.runtime-status', '.supplemental-verifications']) {
        const current = path.join(root, '.service', 'releases', 'aaaaaaaaaaaa', name);
        const original = path.join(root, '.service', 'releases', 'bbbbbbbbbbbb', name);
        assert.equal(fs.realpathSync(current), fs.realpathSync(original));
      }
    }
    for (const file of ['.release-history.json', '.release-jobs.json', '.release-history-migrations.json']) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), '[]');
  });
}

test('publisher service identity normalizes only argument-equivalent quotes', {skip: process.platform !== 'win32'}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-command-identity-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = fs.readFileSync(path.join(__dirname, '../scripts/update-publisher.ps1'), 'utf8');
  const fn = source.slice(source.indexOf('function Get-PublisherServiceCommandIdentity('), source.indexOf('function Invoke-Guard('));
  const cases = [
    {a: '"C:\\publisher\\host.exe" --repository-root "C:\\publisher\\runtime" --port 8787', b: 'C:\\publisher\\host.exe --repository-root C:\\publisher\\runtime --port 8787', equal: true},
    {a: 'exe --project-root "C:\\game projects\\one"', b: 'exe --project-root "C:\\game projects\\one"', equal: true},
    {a: 'exe --project-root "C:\\game projects\\one"', b: 'exe --project-root C:\\game projects\\one', equal: false},
    {a: 'exe --port 8787', b: 'exe --port 8788', equal: false},
    {a: 'exe --repository-root C:\\old', b: 'exe --repository-root C:\\other', equal: false},
    {a: 'exe --port 8787', b: 'exe --port 8787 --extra', equal: false},
    {a: 'exe ""', b: 'exe', equal: false},
    {a: 'exe ""', b: 'exe ""', equal: true},
    {a: 'exe "path\\"', b: 'exe path', invalid: true},
    {a: 'exe "path"suffix', b: 'exe path', invalid: true},
    {a: 'exe "unterminated', b: 'exe path', invalid: true}
  ];
  const data = path.join(root, 'cases.json');
  const runner = path.join(root, 'identity.ps1');
  fs.writeFileSync(data, JSON.stringify(cases));
  fs.writeFileSync(runner, 'param([string]$Cases)\n$ErrorActionPreference="Stop"\n' + fn + '\n$caseData=Get-Content -LiteralPath $Cases -Raw | ConvertFrom-Json; $result=@(foreach($case in $caseData) { try { @{equal=((Get-PublisherServiceCommandIdentity $case.a) -ceq (Get-PublisherServiceCommandIdentity $case.b));invalid=$false} } catch { @{invalid=$true} } }); ConvertTo-Json -InputObject $result -Compress\n');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-File', runner, '-Cases', data], {encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(r.status, 0, r.stderr);
  const actual = JSON.parse(r.stdout.trim());
  for (let i=0;i<cases.length;i++) {
    assert.equal(actual[i].invalid, Boolean(cases[i].invalid), `case ${i}`);
    if (!cases[i].invalid) assert.equal(actual[i].equal, cases[i].equal, `case ${i}`);
  }
});

test('publisher evidence junctions retain Git directory-ignore semantics', {skip: process.platform !== 'win32'}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-junction-ignore-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'publisher-junction-ignore-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  fs.writeFileSync(path.join(root, '.gitignore'), fs.readFileSync(path.join(__dirname, '../.gitignore')));
  fs.mkdirSync(path.join(root, '.service', 'evidence'), {recursive:true});
  for (const name of ['.runtime-status', '.supplemental-verifications']) fs.symlinkSync(path.join(root, '.service', 'evidence'), path.join(root, name), 'junction');
  for (const args of [['init'],['add','.gitignore'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']]) {
    const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,r.stderr);
  }
  const r=spawnSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.trim(),'');
});
