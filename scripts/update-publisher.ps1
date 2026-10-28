param([Parameter(Mandatory=$true)][string]$CandidateCommit)
$ErrorActionPreference='Stop'
$publisherRoot=Split-Path -Parent $PSScriptRoot
$uri='http://192.168.20.218:8787'
$guard=Join-Path $PSScriptRoot 'publisher-update-guard.cjs'
$updateToken=[guid]::NewGuid().ToString()
$locked=$false
$barrier=$false
$stopped=$false
$activated=$false
function Get-PublisherFileHash([string]$LiteralPath,[string]$Algorithm='SHA256') {
 if($Algorithm -ne 'SHA256') { throw 'Unsupported publisher hash algorithm' }
 $stream=[System.IO.File]::OpenRead($LiteralPath)
 $hasher=[System.Security.Cryptography.SHA256]::Create()
 try { @{Hash=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','')} }
 finally { $stream.Dispose(); $hasher.Dispose() }
}
function Get-PublisherServiceCommandIdentity([string]$Command) {
 # Accept whole quoted or unquoted arguments; never erase grouping or escapes.
 # The service host emits this bounded grammar, not shell command expressions.
 if([string]::IsNullOrWhiteSpace($Command) -or $Command -cne $Command.Trim() -or $Command -match '[\r\n]|\\"') { throw 'Unsupported publisher service command quoting' }
 $parts=[regex]::Matches($Command,'(?:^|[ \t]+)(?:"([^"]*)"|([^ \t"]+))(?=[ \t]|$)')
 if(($parts.Value -join '') -cne $Command) { throw 'Unsupported publisher service command quoting' }
 $arguments=@($parts | ForEach-Object { if($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value } })
 return ConvertTo-Json -InputObject $arguments -Compress
}
function Invoke-Guard([string]$Action) {
 & node $guard $Action $publisherRoot $oldRoot $updateToken
 if($LASTEXITCODE -ne 0) { throw "Publisher guard $Action failed; do not bypass or remove another owner's lock" }
}
function Assert-Idle {
 $activity=Invoke-RestMethod -Uri "$uri/api/jobs/active" -TimeoutSec 10
 if($activity.busy -or $activity.job) { throw 'Publisher is busy; existing task must not be interrupted' }
}
if($CandidateCommit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid publisher candidate' }
$currentService=Get-CimInstance Win32_Service -Filter "Name='RHospitalReleaseConsole'"
if(!$currentService -or $currentService.State -ne 'Running') { throw 'Expected running publisher service missing' }
$oldBinaryPath=$currentService.PathName
$oldServiceIdentity=Get-PublisherServiceCommandIdentity $oldBinaryPath
$oldProcessId=$currentService.ProcessId
$oldServiceArguments=ConvertFrom-Json $oldServiceIdentity
$rootIndexes=@(for($argumentIndex=0;$argumentIndex -lt $oldServiceArguments.Count;$argumentIndex++) { if($oldServiceArguments[$argumentIndex] -ceq '--repository-root') { $argumentIndex } })
if($rootIndexes.Count -ne 1 -or $rootIndexes[0]+1 -ge $oldServiceArguments.Count) { throw 'Unknown or ambiguous publisher installation' }
$oldRoot=$oldServiceArguments[$rootIndexes[0]+1]
$newRoot=Join-Path $publisherRoot ('.service\releases\'+$CandidateCommit.Substring(0,12))
if(!($oldRoot.StartsWith($publisherRoot+'\.service\releases\',[StringComparison]::OrdinalIgnoreCase))) { throw 'Publisher runtime outside installation boundary' }
$versionBefore=Invoke-RestMethod -Uri "$uri/api/version" -TimeoutSec 10
if($versionBefore.status -ne 'UP_TO_DATE') { throw 'Old publisher runtime is not clean and current' }
if($versionBefore.runtime.commit -ne 'b9b28cb1da7dc828d19c96c53c6c35034ab2b43a' -and $versionBefore.publisherUpdateProtocol -ne 1) { throw 'Unsupported legacy publisher; action barrier has not been verified' }
try {
 Invoke-Guard acquire
 $locked=$true
 Invoke-Guard barrier
 $barrier=$true
 # Legacy synchronous post-body version gate now refuses new actions. This GET is
 # serviced after any earlier synchronous gate+job-registration on that event loop.
 $versionBlocked=Invoke-RestMethod -Uri "$uri/api/version" -TimeoutSec 10
 if($versionBlocked.status -ne 'UNCOMMITTED_CHANGES' -or $versionBlocked.runtime.commit -ne $versionBefore.runtime.commit -or $versionBlocked.runtime.contentHash -ne $versionBlocked.repository.contentHash) { throw 'Legacy barrier or runtime identity not confirmed' }
 Assert-Idle
 $stateFiles=@('.release-history.json','.release-jobs.json','.release-history-migrations.json')
 if(!(Test-Path -LiteralPath (Join-Path $publisherRoot '.release-jobs.json'))) { throw 'Canonical publisher job store missing' }
 $before=@{}
 foreach($name in $stateFiles) { $file=Join-Path $publisherRoot $name; if(Test-Path -LiteralPath $file) { $before[$name]=(Get-PublisherFileHash -LiteralPath $file -Algorithm SHA256).Hash } }
 if(Test-Path -LiteralPath $newRoot) { throw 'Candidate path already exists; inspect before retry' }
 & git -C $publisherRoot worktree add --detach $newRoot $CandidateCommit
 if($LASTEXITCODE -ne 0) { throw 'Publisher checkout failed' }
 $runtimeServiceDir=Join-Path $newRoot '.service'
 New-Item -ItemType Directory -Path $runtimeServiceDir | Out-Null
 $oldHost=Join-Path $oldRoot '.service\RHospitalReleaseConsoleService.build.exe'
 $newHost=Join-Path $runtimeServiceDir 'RHospitalReleaseConsoleService.build.exe'
 Copy-Item -LiteralPath $oldHost -Destination $newHost
 if((Get-PublisherFileHash -LiteralPath $oldHost).Hash -ne (Get-PublisherFileHash -LiteralPath $newHost).Hash) { throw 'Host identity changed' }
 foreach($name in $stateFiles) { $source=Join-Path $publisherRoot $name; if(Test-Path -LiteralPath $source) { New-Item -ItemType SymbolicLink -Path (Join-Path $newRoot $name) -Target $source | Out-Null } }
 $protectedConfig=Join-Path $publisherRoot '.service\semantic-diagnostics.clixml'
 if(Test-Path -LiteralPath $protectedConfig) { New-Item -ItemType SymbolicLink -Path (Join-Path $runtimeServiceDir 'semantic-diagnostics.clixml') -Target $protectedConfig | Out-Null }
 $evidenceBefore=@{}
 foreach($name in @('.supplemental-verifications','.runtime-status')) {
  $source=Join-Path $oldRoot $name
  if(Test-Path -LiteralPath $source) {
   $resolved=(Resolve-Path -LiteralPath $source).Path
   if(!$resolved.StartsWith($publisherRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence outside publisher boundary' }
   if($name -eq '.supplemental-verifications') { Get-ChildItem -LiteralPath $source -File | ForEach-Object { $evidenceBefore[$_.FullName]=(Get-PublisherFileHash -LiteralPath $_.FullName).Hash } }
   # Git treats a directory symlink as a file, defeating the existing dir-only
   # ignore rules. A same-target junction retains the directory contract.
   New-Item -ItemType Junction -Path (Join-Path $newRoot $name) -Target $source | Out-Null
  }
 }
 $candidateDrift=@(& git -C $newRoot status --porcelain --untracked-files=all)
 if($LASTEXITCODE -ne 0 -or $candidateDrift.Count) { throw 'Prepared publisher runtime is not clean; original service preserved' }
 Assert-Idle
 $serviceNow=Get-CimInstance Win32_Service -Filter "Name='RHospitalReleaseConsole'"
 if((Get-PublisherServiceCommandIdentity $serviceNow.PathName) -cne $oldServiceIdentity -or $serviceNow.ProcessId -ne $oldProcessId -or $serviceNow.State -ne 'Running') { throw 'Concurrent publisher service change' }
 $newBinaryPath=$oldBinaryPath.Replace($oldRoot,$newRoot)
 $newServiceIdentity=Get-PublisherServiceCommandIdentity $newBinaryPath
 $stopped=$true
 Stop-Service -Name RHospitalReleaseConsole
 & sc.exe config RHospitalReleaseConsole binPath= $newBinaryPath | Out-Null
 if($LASTEXITCODE -ne 0) { throw 'Publisher service configuration failed' }
 Start-Service -Name RHospitalReleaseConsole
 $activated=$true
 $deadline=(Get-Date).AddSeconds(55)
 do {
  Start-Sleep -Milliseconds 750
  try { $version=Invoke-RestMethod -Uri "$uri/api/version" -TimeoutSec 3; $verified=($version.runtime.commit -eq $CandidateCommit -and $version.status -eq 'UP_TO_DATE' -and $version.publisherUpdateProtocol -eq 1) } catch { $verified=$false }
 } while(!$verified -and (Get-Date) -lt $deadline)
 if(!$verified) { throw 'Candidate runtime validation failed' }
 Assert-Idle
 foreach($name in $before.Keys) { if((Get-PublisherFileHash -LiteralPath (Join-Path $publisherRoot $name)).Hash -ne $before[$name]) { throw 'Publisher audit state changed' } }
 foreach($file in $evidenceBefore.Keys) { if((Get-PublisherFileHash -LiteralPath $file).Hash -ne $evidenceBefore[$file]) { throw 'Supplemental evidence changed' } }
 Invoke-Guard unbarrier
 $barrier=$false
 Invoke-Guard release
 $locked=$false
 @{result='PASS';scope='publisher-only';commit=$version.runtime.commit;runtimeVersion=$version.runtimeVersion;historyPreserved=$true;updateProtocol=1} | ConvertTo-Json
} catch {
 $failure=$_.Exception.Message
 if($stopped) {
  # New server respects our lock. If contradictory active jobs exist, preserve it.
  if($activated) {
   $rollbackActivity=$null
   try { $rollbackActivity=Invoke-RestMethod -Uri "$uri/api/jobs/active" -TimeoutSec 10 } catch { }
   if($rollbackActivity -and ($rollbackActivity.busy -or $rollbackActivity.job)) { throw "Contradictory active job; preserve runtime and lock: $failure" }
  }
  $storedJobs=Get-Content -LiteralPath (Join-Path $publisherRoot '.release-jobs.json') -Raw | ConvertFrom-Json
  if(@($storedJobs | Where-Object { $_.status -in @('RUNNING','CANCELLING','RECOVERING') }).Count -gt 0) { throw "Stored active job; preserve runtime and lock: $failure" }
  $rollbackService=Get-CimInstance Win32_Service -Filter "Name='RHospitalReleaseConsole'"
  $rollbackIdentity=Get-PublisherServiceCommandIdentity $rollbackService.PathName
  if($rollbackIdentity -cne $newServiceIdentity -and $rollbackIdentity -cne $oldServiceIdentity) { throw "Concurrent service change; preserve runtime and lock: $failure" }
  Stop-Service -Name RHospitalReleaseConsole -ErrorAction SilentlyContinue
  & sc.exe config RHospitalReleaseConsole binPath= $oldBinaryPath | Out-Null
  if($LASTEXITCODE -ne 0) { throw "Rollback configuration failed; retain guard and lock for review: $failure" }
  $restoredService=Get-CimInstance Win32_Service -Filter "Name='RHospitalReleaseConsole'"
  if((Get-PublisherServiceCommandIdentity $restoredService.PathName) -cne $oldServiceIdentity) { throw "Rollback identity mismatch; retain guard and lock for review: $failure" }
  if($barrier) { Invoke-Guard unbarrier; $barrier=$false }
  if($locked) { Invoke-Guard release; $locked=$false }
  # Old server lacks the lock protocol: restoration is complete before reopening.
  Start-Service -Name RHospitalReleaseConsole
  $stopped=$false
  throw "Publisher update failed; prior runtime restored: $failure"
 }
 throw $failure
} finally {
 # A failed rollback keeps barriers fail-closed. Never delete a foreign/stale lock.
 if(!$stopped) {
  if($barrier) { Invoke-Guard unbarrier; $barrier=$false }
  if($locked) { Invoke-Guard release; $locked=$false }
 }
}
