param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Model = 'jev-latest',
  [Security.SecureString]$ApiKey,
  [switch]$Disable
)
$ErrorActionPreference = 'Stop'
$directory = Join-Path (Resolve-Path -LiteralPath $RepositoryRoot).Path '.service'
$file = Join-Path $directory 'typesafe-diagnostics.clixml'
if ($Disable) {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
  Write-Output 'Semantic diagnostics disabled for the next console process start.'
  return
}
if ($Model -cnotmatch '^jev-(latest|preview|\d+(\.\d+){1,3})$') { throw 'A Jev model is required' }
if (!$ApiKey) { $ApiKey = Read-Host 'TypeSafe API key' -AsSecureString }
if (!$ApiKey.Length) { throw 'API key is required' }
New-Item -ItemType Directory -Force -Path $directory | Out-Null
# On Windows SecureString is protected by DPAPI for the current account.
[pscustomobject]@{ BaseUrl = 'https://api.typesafe.ai'; Model = $Model; ApiKey = $ApiKey } | Export-Clixml -LiteralPath $file
Write-Output 'Semantic diagnostics configured. The next console process start will load the encrypted credential.'
