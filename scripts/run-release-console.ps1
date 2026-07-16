param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ProjectRoot = 'C:\workspace\hospital-backend',
  [string]$BindAddress = '127.0.0.1',
  [int]$Port = 8787,
  [int]$RestartDelaySeconds = 10
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $RepositoryRoot).Path
$logDir = Join-Path $repo '.service'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'release-console.log'

$env:RELEASE_PUBLISHER_PORT = [string]$Port
$env:RELEASE_PUBLISHER_HOST = $BindAddress
$env:RHOSPITAL_PROJECT_ROOT = $ProjectRoot

Set-Location $repo
while ($true) {
  Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] starting RHospital Release Console on ${BindAddress}:$Port"
  node server.js *>> $logFile
  $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }
  Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] release console exited with code $exitCode; restarting in $RestartDelaySeconds seconds"
  Start-Sleep -Seconds $RestartDelaySeconds
}
