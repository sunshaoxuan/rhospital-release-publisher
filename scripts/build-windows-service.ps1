param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $RepositoryRoot).Path
$source = Join-Path $repo 'service\RHospitalReleaseConsoleService.cs'
$outputDir = Join-Path $repo '.service'
$output = Join-Path $outputDir 'RHospitalReleaseConsoleService.build.exe'
$frameworkDir = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $frameworkDir 'csc.exe'

if (!(Test-Path $compiler)) {
  throw "C# compiler not found: $compiler"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
& $compiler `
  /nologo `
  /target:winexe `
  /platform:anycpu `
  /optimize+ `
  "/out:$output" `
  "/reference:$(Join-Path $frameworkDir 'System.dll')" `
  "/reference:$(Join-Path $frameworkDir 'System.Core.dll')" `
  "/reference:$(Join-Path $frameworkDir 'System.ServiceProcess.dll')" `
  $source

if ($LASTEXITCODE -ne 0 -or !(Test-Path $output)) {
  throw 'Windows service host build failed'
}

Write-Host "Built Windows service host: $output"
