param(
  [string]$TaskName = 'RHospital Release Console',
  [int]$Port = 8787
)

$taskOutput = & schtasks.exe /Query /TN $TaskName /FO LIST 2>$null
if ($LASTEXITCODE -eq 0) {
  $taskOutput
} else {
  Write-Host "Scheduled task not found: $TaskName"
}

Write-Host ""
Write-Host "Listening process on 127.0.0.1:$Port"
$netstat = & netstat.exe -ano -p tcp
$listeners = $netstat | Select-String -Pattern "127\.0\.0\.1:$Port\s+0\.0\.0\.0:0\s+LISTENING"
if (!$listeners) {
  Write-Host "No listener found."
  exit 0
}

foreach ($line in $listeners) {
  $text = $line.Line.Trim()
  Write-Host $text
  $parts = $text -split '\s+'
  $pidText = $parts[-1]
  $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
  if ($process) {
    [pscustomobject]@{
      ProcessId = $process.Id
      ProcessName = $process.ProcessName
      StartTime = $process.StartTime
    }
  }
}
