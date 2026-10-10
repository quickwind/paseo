# Installs or updates Wukong from the seven wukong-*.tgz files in a folder, then starts the daemon.
#
#   powershell -ExecutionPolicy Bypass -File .\windows-update.ps1             # tarballs in this folder
#   powershell -ExecutionPolicy Bypass -File .\windows-update.ps1 -Path D:\wukong-dist
#   powershell -ExecutionPolicy Bypass -File .\windows-update.ps1 -DryRun     # only print the steps
#
# The steps, in order:
#   1. wukong daemon stop    Windows locks the files of a running daemon, so stop it first.
#   2. npm uninstall -g ...  Removes the old seven packages so no old files are left behind.
#   3. npm install -g ...    All seven tarballs together, so npm never fetches upstream packages.
#   4. wukong daemon start   Starts the daemon hidden in the background and returns.
#
# ONNXRUNTIME_NODE_INSTALL=skip is set for this run only: it skips a large voice download that
# Wukong does not use and that can stall on a company network.
param(
  [string]$Path = (Get-Location).Path,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$packages = "cli", "server", "client", "protocol", "relay", "plugin", "highlight"

$files = @(Get-ChildItem -Path $Path -Filter "wukong-*.tgz" | ForEach-Object { $_.FullName })
if ($files.Count -ne $packages.Count) {
  throw "Expected $($packages.Count) wukong-*.tgz files in '$Path' (one per package), found $($files.Count). All seven must be installed together."
}

function Step([string]$Title, [scriptblock]$Action, [switch]$MayFail) {
  Write-Host "==> $Title"
  if ($DryRun) { return }
  & $Action
  if ($LASTEXITCODE -ne 0 -and -not $MayFail) { throw "'$Title' failed (exit code $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
}

# Nothing is running or installed on a first install, so these two may fail without stopping us.
Step "wukong daemon stop" { wukong daemon stop } -MayFail
Step "npm uninstall -g (old packages)" {
  npm uninstall -g ($packages | ForEach-Object { "@wukong/$_" })
} -MayFail

$env:ONNXRUNTIME_NODE_INSTALL = "skip"
Step "npm install -g ($($files.Count) tarballs)" { npm install -g $files }
Step "wukong --version" { wukong --version }
Step "wukong daemon start" { wukong daemon start }

if ($DryRun) { Write-Host "Dry run: nothing was changed." }
