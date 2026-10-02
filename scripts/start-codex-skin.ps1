param([ValidateRange(1,65535)][int]$Port = 9223)
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $repoPath 'dist\codex-glass.runtime.js'
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw 'Build dist/codex-glass.runtime.js before launching Codex with the skin.'
}
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
if ($running.Count -gt 0) {
    throw 'Codex is still running. Finish active work, save your content, and fully exit Codex normally first. Closing one window may leave the app in the tray. This launcher never closes, kills, or restarts an existing process.'
}
foreach ($envName in @('BUILD_FLAVOR', 'ELECTRON_RENDERER_URL', 'CODEX_ELECTRON_USER_DATA_PATH')) {
    if ([Environment]::GetEnvironmentVariable($envName)) {
        throw "The inherited $envName setting could change the Codex profile or runtime. Use an ordinary clean shell; this launcher does not edit environment or profile settings."
    }
}
$listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) { throw "Port $Port is already in use. No app was started." }
Write-Host "Starting the installed production Codex with a temporary loopback debugger on 127.0.0.1:$Port."
Start-Process -FilePath $appExe -ArgumentList @("--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1') -WindowStyle Hidden | Out-Null
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
$clock = [Diagnostics.Stopwatch]::StartNew()
$ready = $false
try {
    while ($clock.ElapsedMilliseconds -lt 20000) {
        $remaining = [int](20000 - $clock.ElapsedMilliseconds)
        if ($remaining -le 0) { break }
        $cancel = New-Object System.Threading.CancellationTokenSource
        $cancel.CancelAfter([Math]::Min(1000, $remaining))
        try {
            $response = $client.GetAsync("http://127.0.0.1:$Port/json/list", $cancel.Token).GetAwaiter().GetResult()
            try {
                if ($response.IsSuccessStatusCode) {
                    $targetList = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    $mainTargets = @($targetList | Where-Object { $_.type -eq 'page' -and $_.url -cmatch '^app://-/index\.html(?:\?[^#]*)?$' })
                    if ($mainTargets.Count -eq 1) { $ready = $true; break }
                    if ($mainTargets.Count -gt 1) { throw 'More than one native Codex main renderer was found.' }
                }
            } finally { $response.Dispose() }
        } catch { }
        finally { $cancel.Dispose() }
        $remaining = [int](20000 - $clock.ElapsedMilliseconds)
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(200, $remaining)) }
    }
} finally { $client.Dispose(); $handler.Dispose(); $clock.Stop() }
if (-not $ready) {
    throw 'No debugger appeared within 20 seconds. The skin was not applied. Codex was left running; inspect its window, then exit and relaunch it normally if needed. Do not rerun this launcher while it remains open.'
}
& $nodePath (Join-Path $repoPath 'scripts\codex-skin.mjs') --apply --port $Port
if ($LASTEXITCODE -ne 0) { throw 'Skin attachment did not complete cleanly. Read the status above before retrying; Codex was left running.' }
