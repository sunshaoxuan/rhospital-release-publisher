param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ProjectRoot = 'C:\workspace\hospital-backend',
  [int]$Port = 8787,
  [switch]$AllowExecute
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $RepositoryRoot).Path
$logDir = Join-Path $repo '.service'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'release-console.log'

$env:RELEASE_PUBLISHER_PORT = [string]$Port
$env:RHOSPITAL_PROJECT_ROOT = $ProjectRoot
if ($AllowExecute) {
  $env:RELEASE_PUBLISHER_ALLOW_EXECUTE = 'true'
} else {
  Remove-Item Env:\RELEASE_PUBLISHER_ALLOW_EXECUTE -ErrorAction SilentlyContinue
}

Set-Location $repo
Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] starting RHospital Release Console on 127.0.0.1:$Port, allowExecute=$($AllowExecute.IsPresent)"
node server.js *>> $logFile
