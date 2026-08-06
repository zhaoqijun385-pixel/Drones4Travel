[CmdletBinding()]
param(
    [string]$Distro = 'Ubuntu',
    [string]$WslProjectPath = '~/drone-navigation-share',
    [string]$ExistingProjectPath = '~/drone-navigation',
    [switch]$SkipPython
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
    throw 'wsl.exe was not found. Install WSL2/Ubuntu first: wsl --install -d Ubuntu'
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($sourceRoot.Contains("'")) {
    throw "The extracted path contains a single quote, which this bootstrap script cannot safely quote: $sourceRoot"
}

$wslHome = (& wsl.exe -d $Distro -- bash -lc 'printf %s "$HOME"').Trim()
if ([string]::IsNullOrWhiteSpace($wslHome)) {
    throw "Could not resolve the WSL home directory for distro '$Distro'."
}

$wslSource = (& wsl.exe -d $Distro -- wslpath -a $sourceRoot).Trim()
if ([string]::IsNullOrWhiteSpace($wslSource)) {
    throw "Could not convert the extracted Windows path to a WSL path: $sourceRoot"
}

if ($WslProjectPath -eq '~') {
    $targetPath = $wslHome
} elseif ($WslProjectPath.StartsWith('~/')) {
    $targetPath = "$wslHome/$($WslProjectPath.Substring(2))"
} else {
    $targetPath = $WslProjectPath
}

if ($targetPath.Contains("'")) {
    throw "The WSL target path contains a single quote, which this bootstrap script cannot safely quote: $targetPath"
}

$existingPath = ''
if (-not [string]::IsNullOrWhiteSpace($ExistingProjectPath)) {
    if ($ExistingProjectPath -eq '~') {
        $existingPath = $wslHome
    } elseif ($ExistingProjectPath.StartsWith('~/')) {
        $existingPath = "$wslHome/$($ExistingProjectPath.Substring(2))"
    } else {
        $existingPath = $ExistingProjectPath
    }
}

if ($existingPath.Contains("'")) {
    throw "The existing WSL project path contains a single quote, which this bootstrap script cannot safely quote: $existingPath"
}

$quotedSource = "'$wslSource'"
$quotedTarget = "'$targetPath'"
$quotedExisting = if ($existingPath) { "'$existingPath'" } else { "''" }

Write-Host "Copying the package into WSL: $targetPath" -ForegroundColor Cyan
Invoke-WslBash "test ! -e $quotedTarget"
Invoke-WslBash "cp -a $quotedSource $quotedTarget"

Write-Host 'Checking the WSL Node.js toolchain...' -ForegroundColor Cyan
$nodeSetup = @"
set -e
if ! command -v npm >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt install -y nodejs
fi
"@
Invoke-WslBash $nodeSetup

Write-Host 'Installing or reusing the locked frontend dependencies in WSL...' -ForegroundColor Cyan
$frontendSetup = @"
set -e
if [ -n $quotedExisting ] && [ -d $quotedExisting/client/node_modules ] && cmp -s $quotedExisting/client/package-lock.json $quotedTarget/client/package-lock.json; then
  ln -s $quotedExisting/client/node_modules $quotedTarget/client/node_modules
  echo 'Reused client/node_modules from the original project.'
else
  cd $quotedTarget/client
  npm ci
fi
if [ -n $quotedExisting ] && [ -f $quotedExisting/client/config.json ]; then
  cp $quotedExisting/client/config.json $quotedTarget/client/config.json
elif [ ! -f $quotedTarget/client/config.json ]; then
  cp $quotedTarget/client/config.example.json $quotedTarget/client/config.json
fi
if [ -n $quotedExisting ] && [ -f $quotedExisting/server/config.json ]; then
  cp $quotedExisting/server/config.json $quotedTarget/server/config.json
elif [ ! -f $quotedTarget/server/config.json ]; then
  cp $quotedTarget/server/config.example.json $quotedTarget/server/config.json
fi
"@
Invoke-WslBash $frontendSetup

Write-Host 'Reusing original local configuration when available...' -ForegroundColor Cyan

if (-not $SkipPython) {
    Write-Host 'Reusing or creating the original conda environment...' -ForegroundColor Cyan
    $pythonSetup = @"
set -e
if command -v conda >/dev/null 2>&1; then
  source "`$(conda info --base)/etc/profile.d/conda.sh"
  if ! conda env list | sed 's/^[*[:space:]]*//' | grep -qE '^drone-navigation([[:space:]]|$)'; then
    conda create -n drone-navigation python=3.12 -y
  fi
  conda run -n drone-navigation python -m pip install -r $quotedTarget/server/requirements.txt
  conda run -n drone-navigation python -m pip install -r $quotedTarget/extension/crazyflie_bridge/requirements.txt
else
  echo 'Conda is not installed in WSL. Re-run with -SkipPython for frontend-only demo mode,' >&2
  echo 'or install Miniconda and run this script again.' >&2
  exit 3
fi
"@
    Invoke-WslBash $pythonSetup
}

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host "WSL project: $targetPath"
Write-Host 'Next: .\scripts\windows\Start-DroneNavigationDemo.ps1'
