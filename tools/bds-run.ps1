#Requires -Version 7
<#
.SYNOPSIS
    Launch the most recently installed Bedrock Dedicated Server (BDS).

.DESCRIPTION
    Picks the highest-numbered version subdirectory under $InstallRoot
    that contains bedrock_server.exe and launches it in-place, so BDS
    resolves resource_packs/, behavior_packs/, development_*_packs/,
    and worlds/ relative to its cwd.

    Stop the server cleanly by typing 'stop' at its prompt. Ctrl+C also
    works but can leave the world's LevelDB in a recovery state.

.PARAMETER InstallRoot
    Defaults to %LOCALAPPDATA%\RedstoneForge\bds.

.PARAMETER Version
    Optional explicit version to run (e.g. '1.26.21.1'). Defaults to the
    highest installed version.

.EXAMPLE
    pwsh tools/bds-run.ps1

.EXAMPLE
    pwsh tools/bds-run.ps1 -Version 1.26.21.1
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RedstoneForge\bds'),
    [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    throw "No BDS install root at $InstallRoot. Run tools/bds-install.ps1 first."
}

function Get-VersionFromName([string]$name) {
    try { return [version]($name -replace '[^\d.]', '') } catch { return $null }
}

$candidates = @(
    Get-ChildItem -LiteralPath $InstallRoot -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bedrock_server.exe') }
)

if ($candidates.Count -eq 0) {
    throw "No BDS install found under $InstallRoot. Run tools/bds-install.ps1 first."
}

if ($Version) {
    $target = $candidates | Where-Object { $_.Name -eq $Version } | Select-Object -First 1
    if (-not $target) {
        $available = ($candidates | ForEach-Object { $_.Name }) -join ', '
        throw "BDS version '$Version' not installed under $InstallRoot. Available: $available"
    }
} else {
    $target = $candidates |
        Sort-Object -Property @{ Expression = { Get-VersionFromName $_.Name } } -Descending |
        Select-Object -First 1
}

Write-Host "Starting BDS $($target.Name)" -ForegroundColor Cyan
Write-Host "  Path: $($target.FullName)" -ForegroundColor DarkGray
Write-Host "  Stop with 'stop' at the server prompt (Ctrl+C also works)." -ForegroundColor DarkGray
Write-Host ''

Push-Location -LiteralPath $target.FullName
try {
    & '.\bedrock_server.exe'
} finally {
    Pop-Location
}
