param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$BaseUrl = 'http://ccnode.briconbric.com:49530/v1',
  [string]$Model = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S',
  [Security.SecureString]$ApiKey,
  [switch]$Disable
)
$ErrorActionPreference = 'Stop'
$directory = Join-Path (Resolve-Path -LiteralPath $RepositoryRoot).Path '.service'
$file = Join-Path $directory 'semantic-diagnostics.clixml'
if ($Disable) {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
  Write-Output 'Semantic diagnostics disabled for the next console process start.'
  return
}
$uri = [Uri]$BaseUrl
if (!$uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
  throw 'Invalid diagnostics base URL'
}
if ([string]::IsNullOrWhiteSpace($Model)) { throw 'Model is required' }
if (!$ApiKey) { $ApiKey = Read-Host 'Diagnostics API key' -AsSecureString }
if (!$ApiKey.Length) { throw 'API key is required' }
New-Item -ItemType Directory -Force -Path $directory | Out-Null
# On Windows SecureString is protected by DPAPI for the current account.
[pscustomobject]@{ BaseUrl = $BaseUrl; Model = $Model; ApiKey = $ApiKey } | Export-Clixml -LiteralPath $file
Write-Output 'Semantic diagnostics configured. The next console process start will load the encrypted credential.'
