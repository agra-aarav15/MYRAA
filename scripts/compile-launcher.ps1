# PowerShell script to compile MYRAA-launcher.exe using Roslyn / .NET Framework csc.exe
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
$sourceFile = Join-Path $rootDir "electron\launcher.cs"
$iconFile = Join-Path $rootDir "build\icon.ico"
$outputDir = Join-Path $rootDir "build"
$outputFile = Join-Path $outputDir "MYRAA-launcher.exe"

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

if (-not (Test-Path $sourceFile)) {
    Write-Error "Launcher source file not found: $sourceFile"
    exit 1
}

$cscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$csc = $null
foreach ($candidate in $cscCandidates) {
    if (Test-Path $candidate) {
        $csc = $candidate
        break
    }
}

if (-not $csc) {
    $cmd = Get-Command csc -ErrorAction SilentlyContinue
    if ($cmd) {
        $csc = $cmd.Source
    }
}

if (-not $csc) {
    Write-Error "Could not find csc.exe. Please install .NET Framework or .NET SDK."
    exit 1
}

Write-Host "Compiling MYRAA Launcher using: $csc"
$argsList = @(
    "/target:winexe",
    "/out:$outputFile"
)

if (Test-Path $iconFile) {
    $argsList += "/win32icon:$iconFile"
}

$argsList += $sourceFile

& $csc $argsList

if (Test-Path $outputFile) {
    $item = Get-Item $outputFile
    Write-Host "Successfully compiled MYRAA Launcher: $($item.FullName) ($($item.Length) bytes)"
} else {
    Write-Error "Compilation failed to produce: $outputFile"
    exit 1
}
