[CmdletBinding()]
param(
    [string]$Distro = 'Ubuntu',
    [string]$WslProjectPath = '~/drone-navigation-share'
)

$ErrorActionPreference = 'Stop'

function Invoke-WslBash {
    param([Parameter(Mandatory = $true)][string]$Command)

    & wsl.exe -d $Distro -- bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        throw "WSL command failed with exit code $LASTEXITCODE."
    }
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'wsl.exe was not found. Install WSL2/Ubuntu first.'
}

$wslHome = (& wsl.exe -d $Distro -- bash -lc 'printf %s "$HOME"').Trim()
if ($WslProjectPath -eq '~') {
    $targetPath = $wslHome
} elseif ($WslProjectPath.StartsWith('~/')) {
    $targetPath = "$wslHome/$($WslProjectPath.Substring(2))"
} else {
    $targetPath = $WslProjectPath
}

if ($targetPath.Contains("'")) {
    throw "The WSL target path contains a single quote, which this script cannot safely quote: $targetPath"
}

$quotedTarget = "'$targetPath'"
Invoke-WslBash "test -f $quotedTarget/client/package.json"

Write-Host 'Starting the original Vite development server inside WSL...' -ForegroundColor Cyan
Write-Host 'Open http://127.0.0.1:5173/?fleet=demo in the Windows browser.' -ForegroundColor Green
Invoke-WslBash "cd $quotedTarget/client && npm run dev -- --host 0.0.0.0"
