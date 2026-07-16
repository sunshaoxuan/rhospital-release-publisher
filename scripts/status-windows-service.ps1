param(
  [string]$ServiceName = 'RHospitalReleaseConsole',
  [string]$BindAddress = '192.168.20.218',
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'

$service = Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
if (!$service) {
  Write-Host "Windows service not found: $ServiceName"
  exit 1
}

$listener = Get-NetTCPConnection -LocalAddress $BindAddress -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$listenerProcess = if ($listener) {
  Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
} else {
  $null
}
$parentProcess = if ($listenerProcess) {
  Get-CimInstance Win32_Process -Filter "ProcessId = $($listenerProcess.ParentProcessId)"
} else {
  $null
}
$health = if ($listener) {
  try {
    (Invoke-WebRequest -UseBasicParsing -Uri "http://${BindAddress}:$Port/" -TimeoutSec 5).StatusCode
  } catch {
    "ERROR: $($_.Exception.Message)"
  }
} else {
  'NO LISTENER'
}

[pscustomobject]@{
  ServiceName = $service.Name
  DisplayName = $service.DisplayName
  State = $service.State
  StartMode = $service.StartMode
  ServiceAccount = $service.StartName
  ServiceProcessId = $service.ProcessId
  ServicePath = $service.PathName
  BindAddress = $BindAddress
  Listener = [bool]$listener
  ListenerProcessId = $listenerProcess.ProcessId
  ListenerProcess = $listenerProcess.Name
  RunnerProcessId = $parentProcess.ProcessId
  RunnerProcess = $parentProcess.Name
  HttpStatus = $health
} | Format-List

if ($service.State -ne 'Running' -or !$listener -or $health -ne 200) {
  exit 1
}
