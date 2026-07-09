param(
  [string]$TaskName = 'RHospital Release Console',
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ProjectRoot = 'C:\workspace\hospital-backend',
  [int]$Port = 8787,
  [switch]$AllowExecute
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $RepositoryRoot).Path
$runner = Join-Path $repo 'scripts\run-release-console.ps1'
$args = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', "`"$runner`"",
  '-RepositoryRoot', "`"$repo`"",
  '-ProjectRoot', "`"$ProjectRoot`"",
  '-Port', $Port
)
if ($AllowExecute) {
  $args += '-AllowExecute'
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($args -join ' ') -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed startup task: $TaskName"
Write-Host "URL: http://127.0.0.1:$Port"
Write-Host "AllowExecute: $($AllowExecute.IsPresent)"
