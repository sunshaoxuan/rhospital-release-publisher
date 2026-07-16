param(
  [string]$ServiceName = 'RHospitalReleaseConsole',
  [string]$DisplayName = 'RHospital Release Console',
  [string]$LegacyTaskName = 'RHospital Release Console',
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ProjectRoot = 'C:\workspace\hospital-backend',
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required to install the Windows service'
}

$repo = (Resolve-Path $RepositoryRoot).Path
$project = (Resolve-Path $ProjectRoot).Path
$builder = Join-Path $repo 'scripts\build-windows-service.ps1'
$serviceExe = Join-Path $repo '.service\RHospitalReleaseConsoleService.exe'
$builtServiceExe = Join-Path $repo '.service\RHospitalReleaseConsoleService.build.exe'
$expectedUser = $identity.Name
$legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
$legacyTaskWasEnabled = $legacyTask -and $legacyTask.Settings.Enabled

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $builder -RepositoryRoot $repo
if ($LASTEXITCODE -ne 0) {
  throw 'Service host build command failed'
}

function Stop-LegacyTaskAndListener {
  if ($legacyTask) {
    Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue | Out-Null
  }

  $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (!$listener) {
    return
  }
  $node = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($node.ParentProcessId)"
  if ($node.Name -ne 'node.exe' -or $node.CommandLine -notmatch 'server\.js') {
    throw "Port $Port is owned by an unexpected process: $($node.Name) $($node.CommandLine)"
  }
  $targetPid = if ($parent.Name -eq 'powershell.exe' -and $parent.CommandLine -match 'run-release-console\.ps1') {
    $parent.ProcessId
  } else {
    $node.ProcessId
  }
  & taskkill.exe /pid $targetPid /t /f | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop legacy release console process tree $targetPid"
  }
}

function Wait-PortFree {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 300
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  } while ($listener -and (Get-Date) -lt $deadline)
  if ($listener) {
    throw "Port $Port remained occupied"
  }
}

try {
  Stop-LegacyTaskAndListener
  Wait-PortFree

  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Status -ne 'Stopped') {
      Stop-Service -Name $ServiceName -Force
      $existing.WaitForStatus('Stopped', (New-TimeSpan -Seconds 20))
    }
    $existing.Dispose()
    & sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not delete existing service $ServiceName"
    }
    $deleteDeadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 300
      $deletedService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    } while ($deletedService -and (Get-Date) -lt $deleteDeadline)
    if ($deletedService) {
      throw "Service $ServiceName remained marked for deletion"
    }
  }

  Copy-Item -LiteralPath $builtServiceExe -Destination $serviceExe -Force

  $binaryPath = '"{0}" --service --repository-root "{1}" --project-root "{2}" --user "{3}" --port {4}' -f `
    $serviceExe, $repo, $project, $expectedUser, $Port
  New-Service `
    -Name $ServiceName `
    -BinaryPathName $binaryPath `
    -DisplayName $DisplayName `
    -Description 'Runs the RHospital release console without an interactive console window.' `
    -StartupType Automatic | Out-Null

  & sc.exe config $ServiceName obj= LocalSystem | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not configure the LocalSystem service account'
  }

  & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/30000 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not configure service recovery actions'
  }
  & sc.exe failureflag $ServiceName 1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not enable recovery for clean service exits'
  }

  Start-Service -Name $ServiceName
  $service = Get-Service -Name $ServiceName
  $service.WaitForStatus('Running', (New-TimeSpan -Seconds 20))

  $deadline = (Get-Date).AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 500
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  } while (!$listener -and (Get-Date) -lt $deadline)
  if (!$listener) {
    throw "Windows service started but port $Port did not open"
  }
  $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 10
  if ($response.StatusCode -ne 200) {
    throw "Release console health check returned $($response.StatusCode)"
  }

  if ($legacyTask) {
    Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
  }

  Write-Host "Installed Windows service: $ServiceName"
  Write-Host "Runs as service account: LocalSystem"
  Write-Host "Launches release console as: $expectedUser"
  Write-Host "URL: http://127.0.0.1:$Port"
} catch {
  $failedService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($failedService) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
  }
  if ($legacyTask) {
    if ($legacyTaskWasEnabled) {
      Enable-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue | Out-Null
    }
    Start-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
  }
  throw
}
