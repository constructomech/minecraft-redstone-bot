#Requires -Version 7
<#
.SYNOPSIS
    Deploy the Redstone Forge behavior pack into the local BDS install.

.DESCRIPTION
    1. Locates the most recent BDS install under $InstallRoot.
    2. Copies pack/manifest.json + pack/scripts/ (and pack_icon.png if
       present) into <bds>/development_behavior_packs/redstone-forge/.
    3. Reads the pack's header UUID and version from manifest.json.
    4. Appends an entry to <bds>/worlds/<LevelName>/world_behavior_packs.json
       so the pack is actually enabled on the world.

    Does NOT start or stop BDS. If BDS is running, restart it for the
    new pack to load.

.PARAMETER InstallRoot
    Where BDS installs live. Defaults to %LOCALAPPDATA%\RedstoneForge\bds.

.PARAMETER BdsVersion
    Specific BDS version subfolder to deploy into. Defaults to the
    highest-versioned subfolder.

.PARAMETER LevelName
    Name of the world to enable the pack on. Defaults to 'Bedrock level',
    BDS's shipped default.

.EXAMPLE
    pwsh tools/pack-deploy.ps1

.NOTES
    Idempotent: re-running replaces any existing redstone-forge pack and
    updates (rather than duplicates) the world's enabled-packs entry.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RedstoneForge\bds'),
    [string]$BdsVersion,
    [string]$LevelName = 'Bedrock level'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Note([string]$msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Write-Ok([string]$msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# --- locate repo root, pack source, manifest ---

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir '..')
$packSrc   = Join-Path $repoRoot 'pack'
$manifest  = Join-Path $packSrc 'manifest.json'
$builtJs   = Join-Path $packSrc 'scripts\main.js'

if (-not (Test-Path -LiteralPath $manifest)) {
    throw "pack/manifest.json not found at $manifest"
}
if (-not (Test-Path -LiteralPath $builtJs)) {
    throw "pack/scripts/main.js not found. Run 'npm run build' first."
}

$manifestJson = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$headerUuid     = $manifestJson.header.uuid
$packVersion    = @($manifestJson.header.version)  # ensure array
$packName       = $manifestJson.header.name
$scriptModule   = $manifestJson.modules | Where-Object { $_.type -eq 'script' } | Select-Object -First 1
if (-not $scriptModule) { throw "manifest has no script module" }
$scriptModuleUuid = $scriptModule.uuid

Write-Step "Deploying $packName v$($packVersion -join '.') (header $headerUuid)"
Write-Note "script module UUID: $scriptModuleUuid"

# --- locate the target BDS install ---

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
Write-Note "Target BDS: $($bdsDir.FullName)"

# Warn if BDS is currently running (file copy will fail or be ignored
# until restart). We don't kill it — that's the user's call.
$bdsProcs = Get-Process -Name 'bedrock_server' -ErrorAction SilentlyContinue
if ($bdsProcs) {
    Write-Warn2 "bedrock_server.exe is currently running (PID $($bdsProcs.Id -join ', ')). Restart BDS after this deploy completes."
}

# --- copy pack into development_behavior_packs ---

$devPacksDir = Join-Path $bdsDir.FullName 'development_behavior_packs'
if (-not (Test-Path -LiteralPath $devPacksDir)) {
    New-Item -ItemType Directory -Path $devPacksDir -Force | Out-Null
}
$packTarget = Join-Path $devPacksDir 'redstone-forge'

Write-Step "Copying pack -> $packTarget"
if (Test-Path -LiteralPath $packTarget) {
    Remove-Item -LiteralPath $packTarget -Recurse -Force
}
New-Item -ItemType Directory -Path $packTarget -Force | Out-Null

# Only ship the deployable subset of pack/ — exclude src/, tsconfig.json,
# etc. so we don't leak build artifacts into BDS.
$deployItems = @('manifest.json', 'scripts', 'pack_icon.png', 'config')
foreach ($item in $deployItems) {
    $src = Join-Path $packSrc $item
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $packTarget -Recurse -Force
        Write-Note "copied $item"
    }
}

# --- enable pack on the world ---

$worldDir = Join-Path $bdsDir.FullName "worlds\$LevelName"
if (-not (Test-Path -LiteralPath $worldDir)) {
    Write-Warn2 "World '$LevelName' does not exist yet at $worldDir."
    Write-Warn2 "Start BDS once to generate it, then re-run this script."
    Write-Warn2 "(Pack files were still copied to $packTarget for later use.)"
    return
}

$worldPacksFile = Join-Path $worldDir 'world_behavior_packs.json'
Write-Step "Enabling pack on world '$LevelName'"

$existing = @()
if (Test-Path -LiteralPath $worldPacksFile) {
    $raw = Get-Content -LiteralPath $worldPacksFile -Raw
    if ($raw.Trim()) {
        $parsed = $raw | ConvertFrom-Json
        $existing = @($parsed)
    }
}

# Drop any prior entry for our UUID, then add the current one.
$filtered = @($existing | Where-Object { $_.pack_id -ne $headerUuid })
$entry = [PSCustomObject]@{
    pack_id = $headerUuid
    version = $packVersion
}
$updated = $filtered + $entry

$json = ConvertTo-Json -InputObject @($updated) -Depth 5
Set-Content -LiteralPath $worldPacksFile -Value $json -Encoding utf8
Write-Note "wrote $worldPacksFile"
Write-Ok   "pack_id $headerUuid version [$($packVersion -join ',')]"

# --- Generate or load the forge bearer token (host side .env) ---

$dotenvPath = Join-Path $repoRoot '.env'
$forgePort  = '33000'
$forgeUrl   = "http://127.0.0.1:$forgePort"
$forgeToken = $null

if (Test-Path -LiteralPath $dotenvPath) {
    foreach ($line in Get-Content -LiteralPath $dotenvPath) {
        if ($line -match '^\s*FORGE_TOKEN\s*=\s*(.+?)\s*$') { $forgeToken = $matches[1].Trim('"', "'") }
        if ($line -match '^\s*FORGE_PORT\s*=\s*(\d+)') { $forgePort = $matches[1] }
        if ($line -match '^\s*FORGE_URL\s*=\s*(.+?)\s*$')  { $forgeUrl = $matches[1].Trim('"', "'") }
    }
}

if (-not $forgeToken) {
    Write-Step 'Generating new forge bearer token in .env'
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $forgeToken = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
    @"
# Auto-generated by tools/pack-deploy.ps1. Token is shared with the pack
# via <bds>/config/<script-module-uuid>/secrets.json.
FORGE_PORT=$forgePort
FORGE_URL=$forgeUrl
FORGE_TOKEN=$forgeToken
"@ | Set-Content -LiteralPath $dotenvPath -Encoding utf8
    Write-Note "wrote $dotenvPath"
} else {
    Write-Note '.env already has FORGE_TOKEN; reusing'
}

# --- Write per-pack config (variables, secrets, permissions) ---
#
# BDS reads each pack's config from <bds>/config/<pack-uuid>/. The exact
# UUID used as the key (data module vs script module vs header) has been
# inconsistent across docs and versions, so we write to BOTH the script
# module UUID dir AND the header UUID dir — whichever BDS picks, it
# finds the right files.
#
# permissions.json here is the **pack-level** module allow-list (a JSON
# object with `allowed_modules`). It is unrelated to the BDS-root
# `permissions.json`, which is for player op/member permissions by XUID.
# Writing this file OVERRIDES the config/default/permissions.json
# fallback for our pack, so we must list every module our pack uses.

$packAllowedModules = @(
    '@minecraft/server',
    '@minecraft/server-net',
    '@minecraft/server-admin',
    '@minecraft/server-gametest'
)

Write-Step 'Writing forge variables + secrets + permissions for the pack'
foreach ($cfgUuid in @($scriptModuleUuid, $headerUuid)) {
    $cfgDir = Join-Path $bdsDir.FullName "config\$cfgUuid"
    if (-not (Test-Path -LiteralPath $cfgDir)) {
        New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    }
    @{
        forge_endpoint = $forgeUrl
        debug_enabled  = $true
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cfgDir 'variables.json') -Encoding utf8
    @{ forge_token    = $forgeToken } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cfgDir 'secrets.json')   -Encoding utf8
    @{ allowed_modules = $packAllowedModules } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $cfgDir 'permissions.json') -Encoding utf8
    Write-Note "config\$cfgUuid\{variables,secrets,permissions}.json"
}

# Ensure Beta APIs experiment is enabled on the world's level.dat.
# Beta @minecraft/server is gated by the 'gametest' experiment NBT flag
# and BDS doesn't expose a server.properties key for it.
$levelDat = Join-Path $worldDir 'level.dat'
$enableScript = Join-Path $repoRoot 'tools\enable-experiments.mjs'
if ((Test-Path -LiteralPath $levelDat) -and (Test-Path -LiteralPath $enableScript)) {
    Write-Step 'Ensuring Beta APIs (gametest) experiment is enabled'
    & node $enableScript $levelDat
    if ($LASTEXITCODE -ne 0) {
        throw "enable-experiments.mjs failed with exit code $LASTEXITCODE"
    }
}

Write-Host ''
Write-Host "Deployed. Restart BDS (Ctrl+C / 'stop' then 'pwsh tools/bds-run.ps1')" -ForegroundColor Green
Write-Host "and run /rsforge:hello in-game to verify." -ForegroundColor Green
