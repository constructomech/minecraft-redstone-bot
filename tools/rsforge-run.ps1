#Requires -Version 7
<#
.SYNOPSIS
    Start the forge daemon and the Bedrock Dedicated Server in one shot.

.DESCRIPTION
    Convenience wrapper that:
      1. Preflight-checks that nothing is already holding the forge
         daemon port or running as bedrock_server.exe.
      2. Spawns `node tools/forge.mjs daemon` hidden, with its output
         streamed to a temp log file.
      3. Waits for the daemon to print "listening on ...".
      4. Runs `bedrock_server.exe` in the foreground so you can type
         `stop` at its prompt for a clean shutdown.
      5. On BDS exit (clean or otherwise), kills the daemon.

    Logs:
      Daemon stdout goes to $env:TEMP\rsforge-daemon-<random>.log.
      The path is printed at startup and again at exit. Use
      `-TailDaemon` to also stream daemon logs to this console
      (interleaved with BDS, prefixed with [daemon]).

.PARAMETER InstallRoot
    Where BDS installs live. Defaults to %LOCALAPPDATA%\RedstoneForge\bds.

.PARAMETER BdsVersion
    Specific BDS version subfolder to run. Defaults to the
    highest-versioned installed.

.PARAMETER TailDaemon
    Also stream daemon stdout into this console, prefixed with [daemon].
    Useful when diagnosing transport issues.

.EXAMPLE
    pwsh tools/rsforge-run.ps1

.EXAMPLE
    pwsh tools/rsforge-run.ps1 -TailDaemon
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RedstoneForge\bds'),
    [string]$BdsVersion,
    [switch]$TailDaemon
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Note([string]$msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Write-Ok  ([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Err ([string]$msg) { Write-Host "    $msg" -ForegroundColor Red }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..')).Path

# ----- Load .env (FORGE_PORT) so the preflight knows which port to check -----

$forgePort = 33000
$dotenv = Join-Path $repoRoot '.env'
if (Test-Path -LiteralPath $dotenv) {
    foreach ($line in Get-Content -LiteralPath $dotenv) {
        if ($line -match '^\s*FORGE_PORT\s*=\s*(\d+)') { $forgePort = [int]$matches[1] }
    }
}

# ----- Preflight: nothing else holding the daemon port or running BDS -----

Write-Step "Preflight"

$portHolder = Get-NetTCPConnection -LocalPort $forgePort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($portHolder) {
    $proc = Get-Process -Id $portHolder.OwningProcess -ErrorAction SilentlyContinue
    Write-Err "Port $forgePort is already in use (PID $($portHolder.OwningProcess) $($proc.ProcessName))."
    Write-Err "Stop the other process first; rsforge-run won't start a competing daemon."
    exit 1
}
Write-Note "port ${forgePort}: free"

$existingBds = Get-Process -Name 'bedrock_server' -ErrorAction SilentlyContinue
if ($existingBds) {
    Write-Err "bedrock_server.exe is already running (PID $($existingBds.Id -join ', '))."
    Write-Err "Stop it first — the world LevelDB and server port are exclusive."
    exit 1
}
Write-Note "no leftover bedrock_server.exe"

# ----- Find the BDS install we'll launch -----

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    throw "BDS install root not found at $InstallRoot. Run tools/bds-install.ps1 first."
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
if ($BdsVersion) {
    $bdsDir = $candidates | Where-Object { $_.Name -eq $BdsVersion } | Select-Object -First 1
    if (-not $bdsDir) {
        $available = ($candidates | ForEach-Object { $_.Name }) -join ', '
        throw "BDS version '$BdsVersion' not installed under $InstallRoot. Available: $available"
    }
} else {
    $bdsDir = $candidates |
        Sort-Object -Property @{ Expression = { Get-VersionFromName $_.Name } } -Descending |
        Select-Object -First 1
}
Write-Note "BDS install: $($bdsDir.FullName)"

# ----- Start the forge daemon -----

$daemonLog    = Join-Path $env:TEMP "rsforge-daemon-$([guid]::NewGuid().ToString().Substring(0,8)).log"
$daemonErrLog = $daemonLog + '.err'
Write-Step "Starting forge daemon"
Write-Note "log: $daemonLog"

# Truncate / create the log files so we can tail from byte zero.
Set-Content -LiteralPath $daemonLog    -Value '' -Encoding utf8
Set-Content -LiteralPath $daemonErrLog -Value '' -Encoding utf8

$daemon = Start-Process `
    -FilePath 'node' `
    -ArgumentList @('tools/forge.mjs', 'daemon') `
    -WorkingDirectory $repoRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $daemonLog `
    -RedirectStandardError  $daemonErrLog

# Background log tail (optional, for -TailDaemon). Started before
# readiness check so we catch the "listening on" line if you opted in.
$tailJob = $null
if ($TailDaemon) {
    $tailJob = Start-Job -ScriptBlock {
        param($Path)
        Get-Content -LiteralPath $Path -Wait -Tail 0 |
            ForEach-Object { Write-Host "[daemon] $_" -ForegroundColor Magenta }
    } -ArgumentList $daemonLog
}

# Wait for the daemon to be ready (up to 5s).
$ready = $false
for ($i = 0; $i -lt 25; $i++) {
    if ($daemon.HasExited) { break }
    $content = Get-Content -LiteralPath $daemonLog -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -match 'listening on') { $ready = $true; break }
    Start-Sleep -Milliseconds 200
}
if (-not $ready) {
    if ($daemon.HasExited) {
        Write-Err "daemon exited before becoming ready (code $($daemon.ExitCode)). Log:"
        Get-Content -LiteralPath $daemonLog    | ForEach-Object { Write-Err "  $_" }
        $errContent = Get-Content -LiteralPath $daemonErrLog -Raw -ErrorAction SilentlyContinue
        if ($errContent) {
            Write-Err 'stderr:'
            Get-Content -LiteralPath $daemonErrLog | ForEach-Object { Write-Err "  $_" }
        }
    } else {
        Write-Err "daemon did not print 'listening on' within 5s. Killing."
        Stop-Process -Id $daemon.Id -Force
    }
    if ($tailJob) { Remove-Job -Job $tailJob -Force }
    exit 1
}
Write-Ok "daemon PID $($daemon.Id) on http://127.0.0.1:$forgePort"

# ----- Run BDS in the foreground -----

Write-Host ''
Write-Host "Starting BDS $($bdsDir.Name). Type 'stop' at its prompt for a clean shutdown." -ForegroundColor Cyan
Write-Host "  (Ctrl+C also works but can leave the world LevelDB in recovery state.)" -ForegroundColor DarkGray
Write-Host ''

Push-Location -LiteralPath $bdsDir.FullName
try {
    & '.\bedrock_server.exe'
}
finally {
    Pop-Location

    # ----- Tear down the daemon when BDS exits -----

    if ($daemon -and -not $daemon.HasExited) {
        Write-Host ''
        Write-Step "Stopping forge daemon (PID $($daemon.Id))"
        try {
            Stop-Process -Id $daemon.Id -Force -ErrorAction Stop
            Write-Ok 'daemon stopped'
        } catch {
            Write-Err "could not stop daemon: $($_.Exception.Message)"
        }
    }

    if ($tailJob) {
        Stop-Job -Job $tailJob -ErrorAction SilentlyContinue
        Remove-Job -Job $tailJob -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host "daemon log preserved at:" -ForegroundColor DarkGray
    Write-Host "  $daemonLog" -ForegroundColor DarkGray
}
