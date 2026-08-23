# PowerShell script to create the Universal Portable ZIP distribution
param(
    [string]$SourceDir = "release_dist\win-unpacked",
    [string]$Version = "1.0.0",
    [string]$OutputDir = "release_dist"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
$resolvedSource = Join-Path $rootDir $SourceDir
$resolvedOutput = Join-Path $rootDir $OutputDir
$zipFile = Join-Path $resolvedOutput "MYRAA-v$Version-Windows-Universal-Portable.zip"

if (-not (Test-Path $resolvedSource)) {
    Write-Error "Source directory not found: $resolvedSource"
    exit 1
}

if (-not (Test-Path $resolvedOutput)) {
    New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
}

if (Test-Path $zipFile) {
    Remove-Item -Path $zipFile -Force
}

Write-Host "Compressing Universal Portable ZIP from: $resolvedSource"
Compress-Archive -Path "$resolvedSource\*" -DestinationPath $zipFile -CompressionLevel Optimal

if (Test-Path $zipFile) {
    $item = Get-Item $zipFile
    Write-Host "Successfully packaged Universal Portable ZIP: $($item.FullName) ($($item.Length) bytes)"
} else {
    Write-Error "Failed to produce ZIP package: $zipFile"
    exit 1
}
