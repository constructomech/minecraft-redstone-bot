#Requires -Version 7
<#
.SYNOPSIS
    Restart the Redstone Forge stack (forge daemon + BDS) as background
    processes the agent can drive without a foreground terminal.

.DESCRIPTION
    1. Stops any running bedrock_server.exe and any node process
       holding the forge daemon port.
    2. Spawns the forge daemon as a hidden background process.
    3. Waits for the daemon to log "listening on …".
    4. Spawns BDS as a hidden background process in its install dir.
    5. Waits for the pack's first heartbeat to arrive at the daemon.

    Unlike rsforge-run.ps1, BDS runs in the background — no foreground
    terminal is consumed. The agent issues server-side commands via
    `forge cmd "<verb args>"`.

    Logs:
      Daemon stdout/err: $env:TEMP\rsforge-agent-daemon.log[.err]
      BDS stdout/err:    $env:TEMP\rsforge-agent-bds.log[.err]
    Paths printed at startup.

.PARAMETER InstallRoot
    Where BDS installs live. Defaults to %LOCALAPPDATA%\RedstoneForge\bds.

.PARAMETER BdsVersion
    Specific BDS version subfolder to run. Defaults to the highest-
    versioned installed.

.PARAMETER ReadyTimeoutSec
    How long to wait for the pack heartbeat after BDS launch. Default 60.

.EXAMPLE
    pwsh tools/rsforge-restart.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RedstoneForge\bds'),
    [string]$BdsVersion,
    [int]$ReadyTimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Note([string]$msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Write-Ok  ([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Err ([string]$msg) { Write-Host "    $msg" -ForegroundColor Red }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..')).Path

# ---- Load .env for port + token ----

$forgePort  = 33000
$forgeToken = $null
$dotenv = Join-Path $repoRoot '.env'
if (Test-Path -LiteralPath $dotenv) {
    foreach ($line in Get-Content -LiteralPath $dotenv) {
        if ($line -match '^\s*FORGE_PORT\s*=\s*(\d+)') { $forgePort = [int]$matches[1] }
        if ($line -match '^\s*FORGE_TOKEN\s*=\s*(.+?)\s*$') { $forgeToken = $matches[1].Trim('"', "'") }
    }
}

# ---- Stop existing stack ----

Write-Step "Stopping any running stack"

$bdsProcs = @(Get-Process -Name 'bedrock_server' -ErrorAction SilentlyContinue)
if ($bdsProcs.Count -gt 0) {
    foreach ($p in $bdsProcs) {
        Write-Note "killing bedrock_server.exe PID $($p.Id)"
        try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { Write-Err $_.Exception.Message }
    }
} else {
    Write-Note "no bedrock_server.exe running"
}

# Anyone holding the daemon port: kill if it's a node process.
$conn = Get-NetTCPConnection -LocalPort $forgePort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($conn) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
        Write-Note "killing daemon node PID $($proc.Id) (held port $forgePort)"
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { Write-Err $_.Exception.Message }
    } elseif ($proc) {
        throw "Port $forgePort is held by non-node process $($proc.ProcessName) (PID $($proc.Id)); won't kill."
    }
} else {
    Write-Note "daemon port $forgePort is free"
}

# Brief settle for LevelDB lock release.
Start-Sleep -Seconds 2

# ---- Locate BDS install ----

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
        throw "BDS version '$BdsVersion' not installed. Available: $available"
    }
} else {
    $bdsDir = $candidates |
        Sort-Object -Property @{ Expression = { Get-VersionFromName $_.Name } } -Descending |
        Select-Object -First 1
}
Write-Note "BDS install: $($bdsDir.FullName)"

# ---- Start daemon ----

$daemonLog    = Join-Path $env:TEMP 'rsforge-agent-daemon.log'
$daemonErrLog = $daemonLog + '.err'
Write-Step "Starting forge daemon (background)"
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

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if ($daemon.HasExited) { break }
    $content = Get-Content -LiteralPath $daemonLog -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -match 'listening on') { $ready = $true; break }
    Start-Sleep -Milliseconds 200
}
if (-not $ready) {
    if ($daemon.HasExited) {
        Write-Err "daemon exited (code $($daemon.ExitCode)). Log:"
        Get-Content -LiteralPath $daemonLog | ForEach-Object { Write-Err "  $_" }
    } else {
        Stop-Process -Id $daemon.Id -Force
        Write-Err "daemon failed to print 'listening on' in 6s. Killed."
    }
    exit 1
}
Write-Ok "daemon PID $($daemon.Id) on http://127.0.0.1:$forgePort"
Write-Note "daemon log: $daemonLog"

# ---- Start BDS ----

$bdsLog    = Join-Path $env:TEMP 'rsforge-agent-bds.log'
$bdsErrLog = $bdsLog + '.err'
Write-Step "Starting BDS $($bdsDir.Name) (background)"
Set-Content -LiteralPath $bdsLog    -Value '' -Encoding utf8
Set-Content -LiteralPath $bdsErrLog -Value '' -Encoding utf8

$bds = Start-Process `
    -FilePath (Join-Path $bdsDir.FullName 'bedrock_server.exe') `
    -WorkingDirectory $bdsDir.FullName `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $bdsLog `
    -RedirectStandardError  $bdsErrLog

Write-Note "BDS PID $($bds.Id), log: $bdsLog"

# ---- Wait for first heartbeat ----

Write-Step "Waiting for pack heartbeat"
$heartbeatReady = $false
for ($i = 0; $i -lt $ReadyTimeoutSec; $i++) {
    if ($bds.HasExited) {
        Write-Err "BDS exited (code $($bds.ExitCode)) before heartbeat. Log tail:"
        Get-Content -LiteralPath $bdsLog -Tail 30 | ForEach-Object { Write-Err "  $_" }
        Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Start-Sleep -Seconds 1
    try {
        $h = Invoke-RestMethod `
            -Uri "http://127.0.0.1:$forgePort/health" `
            -Headers @{ 'X-Forge-Token' = $forgeToken } `
            -ErrorAction Stop
        if ($h.heartbeatCount -gt 0) { $heartbeatReady = $true; break }
    } catch {
        # daemon not yet handling requests, retry
    }
}
if (-not $heartbeatReady) {
    Write-Err "no pack heartbeat after ${ReadyTimeoutSec}s. BDS may be stuck loading the world."
    Write-Err "BDS log tail:"
    Get-Content -LiteralPath $bdsLog -Tail 30 | ForEach-Object { Write-Err "  $_" }
    exit 1
}

Write-Ok "pack heartbeat received; stack is up"
Write-Host ''
Write-Host "Ready. To stop the stack, run:" -ForegroundColor Green
Write-Host "  pwsh tools/rsforge-restart.ps1   # next restart" -ForegroundColor Green
Write-Host "  Stop-Process -Id $($bds.Id) -Force; Stop-Process -Id $($daemon.Id) -Force" -ForegroundColor DarkGray
