param([ValidateRange(1,65535)][int]$Port = 9223, [switch]$FromShortcut)
$ErrorActionPreference = 'Stop'
try {
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $repoPath 'dist\codex-glass.runtime.js'
$loaderPath = Join-Path $repoPath 'scripts\codex-skin.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'Node.js 22 or newer is required. No app was started.'
}
$nodeVersion = & $nodePath -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 22) {
    throw 'Node.js 22 or newer is required. No app was started.'
}
$packages = @(Get-AppxPackage -Name 'OpenAI.Codex' | Where-Object { $_.Name -eq 'OpenAI.Codex' })
if ($packages.Count -ne 1) { throw 'Expected exactly one installed production OpenAI.Codex package. No app was started.' }
$appExe = [IO.Path]::GetFullPath((Join-Path $packages[0].InstallLocation 'app\ChatGPT.exe'))
if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) { throw 'Installed Codex executable was not found. No app was started.' }
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $appExe })
$listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
$startedApp = $false
if ($running.Count -gt 0) {
    if ($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1' -or $listener[0].OwningProcess -notin @($running.ProcessId)) {
        throw 'Codex is already running without a usable skin connection. Save your work and fully exit Codex normally when convenient, then open the Codex Liquid Glass entry. Closing one window may leave the app in the tray. No process was closed or restarted.'
    }
    $inspectionOutput = @(& $nodePath $loaderPath --inspect --port $Port --timeout-ms 5000)
    if ($LASTEXITCODE -ne 0) { throw 'The existing Codex connection could not be inspected. No skin was applied and no additional Codex was started.' }
    try { $inspection = ($inspectionOutput -join "`n") | ConvertFrom-Json }
    catch { throw 'The existing Codex connection returned an invalid status. No skin was applied and no additional Codex was started.' }
    if ($inspection.runtimePresent -eq $true) {
        if ($inspection.status.mounted -eq $true -or $inspection.status.active -eq $true) {
            Write-Host 'The skin controls are already loaded in the existing Codex. Its enabled/disabled setting was preserved; no new window was opened.'
            return
        }
        throw 'An existing skin runtime could not be verified. Inspect its status before retrying; no runtime or app was replaced.'
    }
    Write-Host 'Attaching the skin controls to the existing Codex; no new application or window will be started.'
} else {
    if ($listener.Count -gt 0) { throw "Port $Port is already in use. No app was started." }
    foreach ($envName in @('BUILD_FLAVOR', 'ELECTRON_RENDERER_URL', 'CODEX_ELECTRON_USER_DATA_PATH')) {
        if ([Environment]::GetEnvironmentVariable($envName)) {
            throw "The inherited $envName setting could change the Codex profile or runtime. Use an ordinary clean shell; this launcher does not edit environment or profile settings."
        }
    }
    if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
        throw 'Build dist/codex-glass.runtime.js before launching Codex with the skin.'
    }
    Write-Host "Starting the installed production Codex with a temporary loopback debugger on 127.0.0.1:$Port."
    # The user's native app is visible. Only the shortcut's companion shell is hidden.
    Start-Process -FilePath $appExe -ArgumentList @("--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1') -WindowStyle Normal | Out-Null
    $startedApp = $true
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { throw 'Build dist/codex-glass.runtime.js before attaching the skin.' }
# Discovery and window filtering live in one place. The avatar overlay can be
# the first index.html page to appear and must never count as the main window.
# Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords.
# Keep collecting those records instead of stopping before the native exit code.
$previousErrorAction = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $applyOutput = @(& $nodePath $loaderPath --apply --port $Port --timeout-ms 20000 2>&1)
    $applyExitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorAction }
$outputText = ($applyOutput | ForEach-Object { $_.ToString() }) -join "`n"
if ($outputText) { Write-Output $outputText }
if ($applyExitCode -ne 0) {
    $loaderStatus = $null
    # Successful JSON output is on stdout; stderr may accompany an error.
    $stdoutText = ($applyOutput | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) -join "`n"
    try { $loaderStatus = $stdoutText | ConvertFrom-Json } catch {}
    $unknown = $applyExitCode -eq 2 -or $loaderStatus.outcome -eq 'unknown'
    $summary = if ($unknown) { '皮肤挂载结果暂时无法确认。' } else { '皮肤加载没有完成。' }
    $appState = if ($startedApp) { '启动器已启动 Codex，并保留它运行。' } else { '启动器复用了当前 Codex，并保留它运行。' }
    $detail = if ($loaderStatus.reason) { [string]$loaderStatus.reason } elseif ($loaderStatus.error) { [string]$loaderStatus.error } elseif ($outputText) { $outputText } else { "加载器未返回详情，退出码：$applyExitCode。" }
    $nextStep = if ($unknown) { '请先查询皮肤状态再决定下一步；启动器没有重复挂载。' } else { '请按下面的具体原因排查；启动器没有再次启动或挂载。' }
    $logNote = ''
    try {
        $logDirectory = Join-Path $env:LOCALAPPDATA 'CodexLiquidGlass\logs'
        [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
        $logPath = Join-Path $logDirectory ("attachment-{0}-{1}.log" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'), [Guid]::NewGuid().ToString('N'))
        # Only the loader's own redacted output is persisted, never a transcript
        # of the shell, machine environment, application state or conversations.
        [IO.File]::WriteAllText($logPath, "exitCode: $applyExitCode`n$outputText`n", [Text.UTF8Encoding]::new($false))
        $logNote = "`n诊断日志：$logPath"
    } catch { $logNote = "`n诊断日志无法保存；具体原因仍显示在本提示中。" }
    throw "$summary`n$appState 这不是在说启动前后台没有退出。`n$nextStep`n`n具体原因：$detail$logNote"
}
} catch {
    if ($FromShortcut) {
        # A hidden companion shell must still surface an actionable failure.
        # This runs only after the user explicitly opens the installed entry.
        try { (New-Object -ComObject WScript.Shell).Popup($_.Exception.Message, 0, 'Codex Liquid Glass', 16) | Out-Null } catch {}
    }
    throw
}
