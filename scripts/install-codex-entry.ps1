[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [ValidateSet('Install', 'Uninstall')][string]$Action = 'Install',
    [string]$Destination = [Environment]::GetFolderPath('DesktopDirectory'),
    [ValidateRange(1,65535)][int]$Port = 9223
)
$ErrorActionPreference = 'Stop'
$owner = 'codex-liquid-glass-entry-v1'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcherPath = Join-Path $repoPath 'scripts\start-codex-skin.ps1'
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) { throw 'The destination must be an existing directory.' }
$shortcutPath = Join-Path $destinationPath 'Codex 液态玻璃.lnk'
$targetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'CodexLiquidGlass\entries'
$sha = [Security.Cryptography.SHA256]::Create()
try { $entryId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($shortcutPath.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
$recordPath = Join-Path $stateDirectory ($entryId + '.json')
function Get-EntryArguments([int]$EntryPort) {
    return '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '" -Port ' + $EntryPort + ' -FromShortcut'
}
function Assert-OrdinaryFile([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing a directory or linked file: $Path" }
}
function Assert-OwnedEntry($Record, $Shell) {
    if ($Record.owner -ne $owner -or $Record.repoPath -ine $repoPath -or $Record.launcherPath -ine $launcherPath -or $Record.shortcutPath -ine $shortcutPath -or $Record.targetPath -ine $targetPath) {
        throw 'The entry record does not belong to this repository and exact shortcut path. Nothing was changed.'
    }
    if ($Record.port -isnot [ValueType] -or $Record.port -lt 1 -or $Record.port -gt 65535 -or $Record.port -ne [int]$Record.port -or $Record.arguments -cne (Get-EntryArguments ([int]$Record.port))) {
        throw 'The entry record contains an invalid launch target. Nothing was changed.'
    }
    Assert-OrdinaryFile $shortcutPath
    $link = $Shell.CreateShortcut($shortcutPath)
    if ($link.TargetPath -ine $Record.targetPath -or $link.Arguments -cne $Record.arguments -or $link.WorkingDirectory -ine $repoPath -or $link.IconLocation -ine $Record.iconLocation -or $link.WindowStyle -ne 7) {
        throw 'The existing shortcut differs from its owned installation record. Nothing was changed.'
    }
}
$hasShortcut = Test-Path -LiteralPath $shortcutPath
$hasRecord = Test-Path -LiteralPath $recordPath
if ($hasShortcut -ne $hasRecord) { throw 'An unrecognized shortcut or incomplete installation already exists. Nothing was overwritten or removed.' }
$shell = $null
$record = $null
if ($hasRecord) {
    Assert-OrdinaryFile $recordPath
    try { $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
    catch { throw 'The entry installation record is unreadable. Nothing was changed.' }
    $shell = New-Object -ComObject WScript.Shell
    Assert-OwnedEntry $record $shell
}
if ($Action -eq 'Uninstall') {
    if (-not $hasShortcut) { Write-Host 'No owned Codex Liquid Glass entry is installed in this destination.'; return }
    $plan = [pscustomobject]@{ action = 'Uninstall'; shortcutPath = $shortcutPath; recordPath = $recordPath; launcherPath = $launcherPath }
    $plan
    if ($PSCmdlet.ShouldProcess($shortcutPath, 'Remove only this verified Codex Liquid Glass shortcut and its ownership record')) {
        # Recheck immediately before deleting these two individual files.
        Assert-OrdinaryFile $recordPath
        Assert-OwnedEntry $record $shell
        Remove-Item -LiteralPath $shortcutPath
        Remove-Item -LiteralPath $recordPath
    }
    return
}
if ($hasShortcut) { Write-Host 'This owned entry is already installed. The native Codex entry was not changed.'; return }
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $repoPath 'dist\codex-glass.runtime.js') -PathType Leaf)) { throw 'Build the skin runtime before installing its entry.' }
if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { throw 'The Windows PowerShell executable was not found.' }
$packages = @(Get-AppxPackage -Name 'OpenAI.Codex' | Where-Object { $_.Name -eq 'OpenAI.Codex' })
if ($packages.Count -ne 1) { throw 'Expected exactly one installed production OpenAI.Codex package.' }
$appExe = [IO.Path]::GetFullPath((Join-Path $packages[0].InstallLocation 'app\ChatGPT.exe'))
if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) { throw 'The installed native Codex executable was not found.' }
$arguments = Get-EntryArguments $Port
$iconLocation = $appExe + ',0'
$plan = [pscustomobject]@{ action = 'Install'; shortcutPath = $shortcutPath; recordPath = $recordPath; launcherPath = $launcherPath; nativeApp = $appExe; targetPath = $targetPath; arguments = $arguments }
$plan
if (-not $PSCmdlet.ShouldProcess($shortcutPath, 'Create a separate Codex Liquid Glass entry with a hidden companion shell')) { return }
if ((Test-Path -LiteralPath $shortcutPath) -or (Test-Path -LiteralPath $recordPath)) { throw 'The entry appeared after the installation check. Nothing was overwritten.' }
$shell = New-Object -ComObject WScript.Shell
$temporaryShortcut = Join-Path $destinationPath ('.codex-glass-' + [Guid]::NewGuid().ToString('N') + '.lnk')
$temporaryRecord = Join-Path $stateDirectory ('.' + [Guid]::NewGuid().ToString('N') + '.json')
$installedShortcut = $false
$installedRecord = $false
try {
    [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
    $link = $shell.CreateShortcut($temporaryShortcut)
    $link.TargetPath = $targetPath
    $link.Arguments = $arguments
    $link.WorkingDirectory = $repoPath
    $link.IconLocation = $iconLocation
    $link.WindowStyle = 7
    $link.Description = '启动原生 Codex，并自动加载可随时开关的液态玻璃皮肤。'
    $link.Save()
    # Store the shell's actual serialized icon form for exact later validation.
    $savedLink = $shell.CreateShortcut($temporaryShortcut)
    $record = [pscustomobject]@{ owner = $owner; repoPath = $repoPath; launcherPath = $launcherPath; shortcutPath = $shortcutPath; targetPath = $targetPath; arguments = $arguments; iconLocation = $savedLink.IconLocation; port = $Port }
    $record | ConvertTo-Json | Set-Content -LiteralPath $temporaryRecord -Encoding UTF8
    Move-Item -LiteralPath $temporaryShortcut -Destination $shortcutPath
    $installedShortcut = $true
    Move-Item -LiteralPath $temporaryRecord -Destination $recordPath
    $installedRecord = $true
} catch {
    if ($installedShortcut -and -not $installedRecord) {
        # Roll back only an unchanged link created by this invocation.
        try { Assert-OwnedEntry $record $shell; Remove-Item -LiteralPath $shortcutPath }
        catch { Write-Warning 'The incomplete shortcut changed during installation and was preserved for manual inspection.' }
    }
    throw
} finally {
    foreach ($temporaryPath in @($temporaryShortcut, $temporaryRecord)) {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath }
    }
}
Write-Host 'The separate desktop entry is installed. It resolves the current native Codex package each time; the original Store and taskbar entries are unchanged.'
