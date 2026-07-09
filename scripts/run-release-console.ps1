param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ProjectRoot = 'C:\workspace\hospital-backend',
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $RepositoryRoot).Path
$logDir = Join-Path $repo '.service'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'release-console.log'

$env:RELEASE_PUBLISHER_PORT = [string]$Port
$env:RHOSPITAL_PROJECT_ROOT = $ProjectRoot

Set-Location $repo
Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] starting RHospital Release Console on 127.0.0.1:$Port"
node server.js *>> $logFile
