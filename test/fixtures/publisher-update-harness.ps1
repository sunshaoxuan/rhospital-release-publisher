param([string]$Root,[string]$Scenario)
# All process/service/network entrypoints below are isolated in-memory doubles.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$script:events=[System.Collections.Generic.List[string]]::new()
$script:locked=$false
$script:barrierPresent=$false
$script:newRunning=$false
$script:clock=[datetime]'2026-01-01T00:00:00Z'
$candidate='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$old=Join-Path $Root '.service\releases\bbbbbbbbbbbb'
$script:oldBin='fixture --repository-root "'+$old+'"'
$script:bin=$script:oldBin
$script:fixtureProcessId=123
function node {
 $action=$args[1]
 [void]$script:events.Add('guard-'+$action)
 if($action -eq 'acquire') { $script:locked=$true }
 if($action -eq 'release') { $script:locked=$false }
 if($action -eq 'barrier') { $script:barrierPresent=$true }
 if($action -eq 'unbarrier') { $script:barrierPresent=$false }
 $global:LASTEXITCODE=0
}
function git { [System.IO.Directory]::CreateDirectory($args[5]) | Out-Null; $global:LASTEXITCODE=0 }
function Get-CimInstance {
 param($ClassName,$Filter)
 if($Scenario -eq 'service-drift' -and $script:barrierPresent) { $script:fixtureProcessId=999 }
 [pscustomobject]@{State='Running';PathName=$script:bin;ProcessId=$script:fixtureProcessId}
}
function Invoke-RestMethod {
 param($Uri,$TimeoutSec)
 if($Uri.EndsWith('/api/jobs/active')) { return @{busy=($Scenario -eq 'busy');job=$null} }
 if($script:newRunning) {
  $commit=if($Scenario -eq 'bad-runtime' -or $Scenario -eq 'rollback-failure') {'wrong'} else {$candidate}
  return @{status='UP_TO_DATE';runtime=@{commit=$commit};publisherUpdateProtocol=1}
 }
 @{status=$(if($script:barrierPresent){'UNCOMMITTED_CHANGES'}else{'UP_TO_DATE'});runtime=@{commit='b9b28cb1da7dc828d19c96c53c6c35034ab2b43a';contentHash='fixture'};repository=@{contentHash='fixture'}}
}
function Stop-Service { param($Name,$ErrorAction); [void]$script:events.Add('stop') }
function Start-Service {
 param($Name)
 $script:newRunning=($script:bin -ne $script:oldBin)
 [void]$script:events.Add($(if($script:newRunning){'start-new'}else{'start-old'}))
}
function sc.exe {
 $target=$args[3]
 $script:bin=$target
 [void]$script:events.Add($(if($target -eq $script:oldBin){'config-old'}else{'config-new'}))
 $global:LASTEXITCODE=if($Scenario -eq 'rollback-failure' -and $target -eq $script:oldBin){1}else{0}
}
function Start-Sleep { param($Milliseconds) }
function Get-Date { $script:clock=$script:clock.AddSeconds(60); return $script:clock }
function New-Item {
 param($ItemType,$Path,$Target)
 if($ItemType -eq 'SymbolicLink') { Copy-Item -LiteralPath $Target -Destination $Path; return }
 Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Path $Path
}
$failure=$null
try { . (Join-Path $Root 'scripts\update-publisher.ps1') -CandidateCommit $candidate | Out-Null }
catch { $failure=$_.Exception.Message }
@{events=@($script:events.ToArray());locked=$script:locked;barrier=$script:barrierPresent;oldRestored=($script:bin -eq $script:oldBin);failure=$failure} | ConvertTo-Json -Compress
