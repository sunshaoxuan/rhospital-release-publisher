param(
  [string]$ServiceName = 'RHospitalReleaseConsole',
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required to uninstall the Windows service'
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (!$service) {
  Write-Host "Windows service not found: $ServiceName"
  exit 0
}

if ($service.Status -ne 'Stopped') {
  Stop-Service -Name $ServiceName -Force
  $service.WaitForStatus('Stopped', (New-TimeSpan -Seconds 20))
}
& sc.exe delete $ServiceName | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not delete Windows service $ServiceName"
}

$serviceExe = Join-Path (Resolve-Path $RepositoryRoot).Path '.service\RHospitalReleaseConsoleService.exe'
Remove-Item -LiteralPath $serviceExe -Force -ErrorAction SilentlyContinue
$builtServiceExe = Join-Path (Resolve-Path $RepositoryRoot).Path '.service\RHospitalReleaseConsoleService.build.exe'
Remove-Item -LiteralPath $builtServiceExe -Force -ErrorAction SilentlyContinue
Write-Host "Uninstalled Windows service: $ServiceName"
