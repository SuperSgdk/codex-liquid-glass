import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const powershell = windows ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : null;
const launcherSource = await readFile(new URL('../scripts/start-codex-skin.ps1', import.meta.url), 'utf8');
const installerSource = await readFile(new URL('../scripts/install-codex-entry.ps1', import.meta.url), 'utf8');
const mocks = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Get-AppxPackage { param($Name) [pscustomobject]@{ Name = 'OpenAI.Codex'; InstallLocation = (Join-Path $env:CODEX_ENTRY_FIXTURE_ROOT 'package') } }
function Get-CimInstance { param($ClassName, $Filter) if ($env:CODEX_ENTRY_RUNNING -eq '1') { [pscustomobject]@{ ProcessId = 501; ExecutablePath = (Join-Path $env:CODEX_ENTRY_FIXTURE_ROOT 'package\app\ChatGPT.exe') } } }
function Get-NetTCPConnection { param($State, $LocalPort, $ErrorAction) if ($env:CODEX_ENTRY_LISTENER -eq 'own') { [pscustomobject]@{ LocalAddress = '127.0.0.1'; OwningProcess = 501 } } elseif ($env:CODEX_ENTRY_LISTENER -eq 'foreign') { [pscustomobject]@{ LocalAddress = '127.0.0.1'; OwningProcess = 999 } } elseif ($env:CODEX_ENTRY_LISTENER -eq 'external') { [pscustomobject]@{ LocalAddress = '0.0.0.0'; OwningProcess = 501 } } }
function Get-Command { param($Name, $ErrorAction) if ($Name -ne 'node') { throw 'Unexpected command lookup in isolated fixture.' }; [pscustomobject]@{ Source = $env:CODEX_ENTRY_MOCK_NODE } }
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) [pscustomobject]@{ file = $FilePath; args = $ArgumentList; window = $WindowStyle } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $env:CODEX_ENTRY_FIXTURE_ROOT 'starts.jsonl') }
function New-Object { param($ComObject) if ($ComObject -ne 'WScript.Shell') { throw 'Unexpected COM object in isolated fixture.' }; return $script:mockShell }
$script:mockShell = [pscustomobject]@{}
$script:mockShell | Add-Member -MemberType ScriptMethod -Name Popup -Value {
    param($Message, $SecondsToWait, $Title, $Type)
    [pscustomobject]@{ message = $Message; title = $Title; type = $Type } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $env:CODEX_ENTRY_FIXTURE_ROOT 'popups.jsonl') -Encoding UTF8
    return 1
}
$script:mockShell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
    param($FilePath)
    $result = [pscustomobject]@{ FilePath = $FilePath; TargetPath = ''; Arguments = ''; WorkingDirectory = ''; IconLocation = ''; WindowStyle = 1; Description = '' }
    if (Test-Path -LiteralPath $FilePath -PathType Leaf) {
        $saved = Get-Content -LiteralPath $FilePath -Raw | ConvertFrom-Json
        foreach ($name in @('TargetPath', 'Arguments', 'WorkingDirectory', 'IconLocation', 'WindowStyle', 'Description')) { $result.$name = $saved.$name }
    }
    $result | Add-Member -MemberType ScriptMethod -Name Save -Value {
        $this | Select-Object TargetPath, Arguments, WorkingDirectory, IconLocation, WindowStyle, Description | ConvertTo-Json | Set-Content -LiteralPath $this.FilePath -Encoding UTF8
        if ($env:CODEX_ENTRY_RACE -eq '1') { Set-Content -LiteralPath (Join-Path $env:CODEX_ENTRY_DESTINATION 'Codex 液态玻璃.lnk') -Value 'unrelated entry created during save' }
    }
    return $result
}
try {
    if ($env:CODEX_ENTRY_SCRIPT_KIND -eq 'installer') {
        $preview = $env:CODEX_ENTRY_WHATIF -eq '1'
        . $env:CODEX_ENTRY_SCRIPT -Action $env:CODEX_ENTRY_ACTION -Destination $env:CODEX_ENTRY_DESTINATION -WhatIf:$preview
    } else { . $env:CODEX_ENTRY_SCRIPT -FromShortcut:($env:CODEX_ENTRY_FROM_SHORTCUT -eq '1') }
    exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-entry-test-')));
  t.after(async () => {
    // Delete only the exact temporary fixture allocated by this test.
    assert.equal(path.dirname(root), await realpath(tmpdir()));
    assert.ok(path.basename(root).startsWith('codex-entry-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'repo');
  const destination = path.join(root, 'desktop');
  for (const dir of [path.join(repo, 'scripts'), path.join(repo, 'dist'), path.join(root, 'package/app'), destination]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(repo, 'scripts/start-codex-skin.ps1'), launcherSource);
  await writeFile(path.join(repo, 'scripts/install-codex-entry.ps1'), installerSource);
  await writeFile(path.join(repo, 'dist/codex-glass.runtime.js'), 'fixture runtime; never evaluated');
  await writeFile(path.join(root, 'package/app/ChatGPT.exe'), 'fixture app; never executed');
  const mockNode = path.join(root, 'mock-node.cmd');
  await writeFile(mockNode, `@"${process.execPath}" "${path.join(root, 'mock-node.mjs')}" %*\r\n`);
  await writeFile(path.join(root, 'mock-node.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    const args = process.argv.slice(2);
    if (args[0] === '-p') console.log('24.0.0');
    else {
      fs.appendFileSync(path.join(process.env.CODEX_ENTRY_FIXTURE_ROOT, 'commands.jsonl'), JSON.stringify(args) + '\\n');
      if (args.includes('--inspect')) {
        if (process.env.CODEX_ENTRY_INSPECT_FAIL === '1') process.exit(1);
        if (process.env.CODEX_ENTRY_INVALID_STATUS === '1') console.log('invalid status');
        else console.log(process.env.CODEX_ENTRY_STATUS || '{"runtimePresent":false}');
      } else {
        const output = process.env.CODEX_ENTRY_APPLY_STDOUT ?? '{"applied":true}';
        if (output) console.log(output);
        if (process.env.CODEX_ENTRY_APPLY_STDERR) console.error(process.env.CODEX_ENTRY_APPLY_STDERR);
        if (process.env.CODEX_ENTRY_APPLY_EXIT) process.exit(Number(process.env.CODEX_ENTRY_APPLY_EXIT));
        if (process.env.CODEX_ENTRY_APPLY_FAIL === '1') process.exit(1);
      }
    }
  `);
  const runner = path.join(root, 'runner.ps1');
  await writeFile(runner, '\uFEFF' + mocks);
  const baseEnv = { ...process.env,
    CODEX_ENTRY_FIXTURE_ROOT: root, CODEX_ENTRY_MOCK_NODE: mockNode,
    CODEX_ENTRY_DESTINATION: destination,
    // Process-local fixture storage keeps ownership records off the real machine profile.
    LOCALAPPDATA: path.join(root, 'profile'),
    BUILD_FLAVOR: '', ELECTRON_RENDERER_URL: '', CODEX_ELECTRON_USER_DATA_PATH: '',
  };
  function run(kind, env = {}) {
    return spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner], {
      encoding: 'utf8', timeout: 20000,
      env: { ...baseEnv, CODEX_ENTRY_SCRIPT_KIND: kind, CODEX_ENTRY_ACTION: 'Install',
        CODEX_ENTRY_SCRIPT: path.join(repo, 'scripts', kind === 'installer' ? 'install-codex-entry.ps1' : 'start-codex-skin.ps1'), ...env },
    });
  }
  async function lines(name) { try { return (await readFile(path.join(root, name), 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
  const logDirectory = path.join(root, 'profile/CodexLiquidGlass/logs');
  async function logs() { return Promise.all((await readdir(logDirectory)).map(async name => ({ path: path.join(logDirectory, name), text: await readFile(path.join(logDirectory, name), 'utf8') }))); }
  return { root, repo, destination, run, lines, logs, shortcut: path.join(destination, 'Codex 液态玻璃.lnk'), recordDirectory: path.join(root, 'profile/CodexLiquidGlass/entries') };
}
function succeeded(result) { assert.equal(result.status, 0, result.stderr || result.stdout); }
function failed(result, message) { assert.notEqual(result.status, 0); assert.match(result.stderr, message); }

test('Windows startup and entry scripts parse without syntax errors', { skip: !windows }, () => {
  const expression = String.raw`$errors = $null; $tokens = $null; foreach ($file in @($env:CODEX_ENTRY_SOURCE_LAUNCHER,$env:CODEX_ENTRY_SOURCE_INSTALLER)) { [Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 } }`;
  const result = spawnSync(powershell, ['-NoProfile', '-Command', expression], { encoding: 'utf8',
    env: { ...process.env, CODEX_ENTRY_SOURCE_LAUNCHER: fileURLToPath(new URL('../scripts/start-codex-skin.ps1', import.meta.url)), CODEX_ENTRY_SOURCE_INSTALLER: fileURLToPath(new URL('../scripts/install-codex-entry.ps1', import.meta.url)) } });
  succeeded(result);
});
test('an existing disabled controller is reused without applying or opening another Codex', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('launcher', { CODEX_ENTRY_RUNNING: '1', CODEX_ENTRY_LISTENER: 'own', CODEX_ENTRY_STATUS: '{"runtimePresent":true,"status":{"mounted":true,"active":false}}' }));
  assert.equal((await f.lines('commands.jsonl')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
test('an existing debuggable Codex receives only one missing-controller attachment', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('launcher', { CODEX_ENTRY_RUNNING: '1', CODEX_ENTRY_LISTENER: 'own' }));
  assert.deepEqual((await f.lines('commands.jsonl')).map(args => args[1]), ['--inspect', '--apply']);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
for (const listener of ['', 'foreign', 'external']) test(`an existing Codex with ${listener || 'no'} listener is preserved`, { skip: !windows }, async t => {
  const f = await fixture(t);
  failed(f.run('launcher', { CODEX_ENTRY_RUNNING: '1', CODEX_ENTRY_LISTENER: listener }), /fully exit Codex normally/);
  assert.equal((await f.lines('commands.jsonl')).length, 0);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
for (const [env, message] of [
  [{ CODEX_ENTRY_INSPECT_FAIL: '1' }, /could not be inspected/],
  [{ CODEX_ENTRY_INVALID_STATUS: '1' }, /invalid status/],
  [{ CODEX_ENTRY_STATUS: '{"runtimePresent":true,"status":{"mounted":false,"active":false}}' }, /could not be verified/],
]) test('failed or incompatible inspection never replaces the existing runtime', { skip: !windows }, async t => {
  const f = await fixture(t);
  failed(f.run('launcher', { CODEX_ENTRY_RUNNING: '1', CODEX_ENTRY_LISTENER: 'own', ...env }), message);
  assert.equal((await f.lines('commands.jsonl')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
test('a fresh launch starts the installed native app visibly and attaches once', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('launcher'));
  const starts = await f.lines('starts.jsonl');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].file, path.join(f.root, 'package/app/ChatGPT.exe'));
  assert.equal(starts[0].window, 'Normal');
  assert.deepEqual(starts[0].args, ['--remote-debugging-port=9223', '--remote-debugging-address=127.0.0.1']);
  assert.equal((await f.lines('commands.jsonl')).length, 1);
});
test('a fresh launch refuses a foreign listener and inherited profile overrides', { skip: !windows }, async t => {
  const f = await fixture(t);
  failed(f.run('launcher', { CODEX_ENTRY_LISTENER: 'foreign' }), /already in use/);
  failed(f.run('launcher', { BUILD_FLAVOR: 'fixture-override' }), /inherited BUILD_FLAVOR/);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
test('an attachment failure is reported without a second mutation attempt', { skip: !windows }, async t => {
  const f = await fixture(t);
  failed(f.run('launcher', { CODEX_ENTRY_RUNNING: '1', CODEX_ENTRY_LISTENER: 'own', CODEX_ENTRY_APPLY_FAIL: '1' }), /皮肤加载没有完成/);
  assert.equal((await f.lines('commands.jsonl')).filter(args => args.includes('--apply')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 0);
});
test('fresh launch failure exposes the loader reason and saves only its output', { skip: !windows }, async t => {
  const f = await fixture(t);
  const loaderOutput = JSON.stringify({ command: 'apply', applied: false, reason: 'Fixture main surface was not compatible.' });
  const result = f.run('launcher', { CODEX_ENTRY_APPLY_STDOUT: loaderOutput, CODEX_ENTRY_APPLY_EXIT: '1' });
  failed(result, /Fixture main surface was not compatible/);
  assert.match(result.stderr, /已启动 Codex.*保留它运行/);
  assert.match(result.stderr, /不是在说启动前后台没有退出/);
  assert.equal((await f.lines('commands.jsonl')).filter(args => args.includes('--apply')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 1);
  const logs = await f.logs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].text, `exitCode: 1\n${loaderOutput}\n`);
  assert.ok(result.stderr.includes(logs[0].path));
});
test('PowerShell 5.1 captures complete native stderr for a hidden-shortcut failure', { skip: !windows }, async t => {
  const f = await fixture(t);
  const result = f.run('launcher', {
    CODEX_ENTRY_FROM_SHORTCUT: '1', CODEX_ENTRY_APPLY_STDOUT: '',
    CODEX_ENTRY_APPLY_STDERR: 'Fixture debugger refused connection.\nFixture final diagnostic line.', CODEX_ENTRY_APPLY_EXIT: '1',
  });
  failed(result, /Fixture debugger refused connection/);
  assert.match(result.stderr, /Fixture final diagnostic line/);
  const popups = await f.lines('popups.jsonl');
  assert.equal(popups.length, 1);
  assert.match(popups[0].message, /皮肤加载没有完成/);
  assert.match(popups[0].message, /Fixture debugger refused connection/);
  assert.match(popups[0].message, /Fixture final diagnostic line/);
  assert.match(popups[0].message, /不是在说启动前后台没有退出/);
  assert.doesNotMatch(popups[0].message, /Read the status above/);
  const logs = await f.logs();
  assert.equal(logs.length, 1);
  assert.match(logs[0].text, /^exitCode: 1\n/);
  assert.match(logs[0].text, /Fixture debugger refused connection/);
  assert.match(logs[0].text, /Fixture final diagnostic line/);
  assert.ok(popups[0].message.includes(logs[0].path));
  assert.equal((await f.lines('commands.jsonl')).filter(args => args.includes('--apply')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 1);
});
test('unknown attachment outcome remains unknown in the popup without a retry or restart', { skip: !windows }, async t => {
  const f = await fixture(t);
  const loaderOutput = JSON.stringify({ command: 'apply', outcome: 'unknown', mutationStarted: true,
    error: 'Fixture evaluation timed out.', verification: { runtimePresent: true, status: { active: true, matched: { main: 1 } } } });
  const result = f.run('launcher', { CODEX_ENTRY_FROM_SHORTCUT: '1', CODEX_ENTRY_APPLY_STDOUT: loaderOutput, CODEX_ENTRY_APPLY_EXIT: '2' });
  failed(result, /皮肤挂载结果暂时无法确认/);
  const popups = await f.lines('popups.jsonl');
  assert.equal(popups.length, 1);
  assert.match(popups[0].message, /Fixture evaluation timed out/);
  assert.match(popups[0].message, /先查询皮肤状态/);
  assert.doesNotMatch(popups[0].message, /皮肤加载没有完成/);
  assert.equal((await f.logs())[0].text, `exitCode: 2\n${loaderOutput}\n`);
  assert.equal((await f.lines('commands.jsonl')).filter(args => args.includes('--apply')).length, 1);
  assert.equal((await f.lines('starts.jsonl')).length, 1);
});
test('entry installation WhatIf creates no shortcut or ownership directory', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('installer', { CODEX_ENTRY_WHATIF: '1' }));
  assert.deepEqual(await readdir(f.destination), []);
  await assert.rejects(readdir(f.recordDirectory), { code: 'ENOENT' });
});
test('owned entry installation and removal preserve the original native shortcut', { skip: !windows }, async t => {
  const f = await fixture(t);
  const nativePath = path.join(f.destination, 'Codex.lnk');
  await writeFile(nativePath, 'unrelated original entry');
  succeeded(f.run('installer'));
  const link = JSON.parse((await readFile(f.shortcut, 'utf8')).replace(/^\uFEFF/, ''));
  assert.equal(link.TargetPath, powershell);
  assert.match(link.Arguments, /-WindowStyle Hidden.*start-codex-skin\.ps1.*-FromShortcut/);
  assert.equal(link.IconLocation, path.join(f.root, 'package/app/ChatGPT.exe') + ',0');
  succeeded(f.run('installer', { CODEX_ENTRY_ACTION: 'Uninstall', CODEX_ENTRY_WHATIF: '1' }));
  assert.ok((await readdir(f.destination)).includes(path.basename(f.shortcut)));
  succeeded(f.run('installer', { CODEX_ENTRY_ACTION: 'Uninstall' }));
  assert.deepEqual(await readdir(f.destination), ['Codex.lnk']);
  assert.deepEqual(await readdir(f.recordDirectory), []);
  assert.equal(await readFile(nativePath, 'utf8'), 'unrelated original entry');
});
test('unknown existing entries are neither overwritten nor deleted', { skip: !windows }, async t => {
  const f = await fixture(t);
  await writeFile(f.shortcut, 'unknown shortcut');
  for (const action of ['Install', 'Uninstall']) failed(f.run('installer', { CODEX_ENTRY_ACTION: action }), /unrecognized shortcut/);
  assert.equal(await readFile(f.shortcut, 'utf8'), 'unknown shortcut');
});
test('a changed shortcut target blocks uninstall and preserves its ownership record', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('installer'));
  const link = JSON.parse((await readFile(f.shortcut, 'utf8')).replace(/^\uFEFF/, ''));
  link.Arguments = '-File unrelated.ps1';
  await writeFile(f.shortcut, '\uFEFF' + JSON.stringify(link));
  failed(f.run('installer', { CODEX_ENTRY_ACTION: 'Uninstall' }), /differs from its owned/);
  assert.equal((await readdir(f.recordDirectory)).length, 1);
  assert.equal(JSON.parse((await readFile(f.shortcut, 'utf8')).replace(/^\uFEFF/, '')).Arguments, '-File unrelated.ps1');
});
test('a record claiming a different shortcut path cannot authorize deletion', { skip: !windows }, async t => {
  const f = await fixture(t);
  succeeded(f.run('installer'));
  const recordPath = path.join(f.recordDirectory, (await readdir(f.recordDirectory))[0]);
  const record = JSON.parse((await readFile(recordPath, 'utf8')).replace(/^\uFEFF/, ''));
  record.shortcutPath = path.join(f.destination, 'Codex.lnk');
  await writeFile(recordPath, JSON.stringify(record));
  failed(f.run('installer', { CODEX_ENTRY_ACTION: 'Uninstall' }), /does not belong/);
  assert.ok((await readdir(f.destination)).includes(path.basename(f.shortcut)));
});
test('an entry appearing during install is preserved and is never overwritten', { skip: !windows }, async t => {
  const f = await fixture(t);
  failed(f.run('installer', { CODEX_ENTRY_RACE: '1' }), /already exists|cannot create a file|已经存在|已存在|创建/);
  assert.match(await readFile(f.shortcut, 'utf8'), /unrelated entry created during save/);
  assert.equal((await readdir(f.destination)).length, 1);
  assert.deepEqual(await readdir(f.recordDirectory), []);
});
