param([ValidateRange(1,65535)][int]$Port = 4785)
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js was not found. Install Node.js 22 or newer, then retry.' }
$env:CODEX_THEME_PREVIEW_PORT = [string]$Port
Push-Location -LiteralPath $repoPath
try { & $nodePath (Join-Path $repoPath 'scripts\preview.mjs'); if ($LASTEXITCODE -ne 0) { throw 'Preview exited with an error.' } }
finally { Pop-Location }
