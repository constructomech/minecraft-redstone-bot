#Requires -Version 7
<#
.SYNOPSIS
    Download and install the latest Bedrock Dedicated Server (BDS).

.DESCRIPTION
    Resolves the latest BDS download URL via a documented fallback chain
    (see .agents/skills/bds-setup/SKILL.md), downloads the ZIP, extracts
    it to a versioned subdirectory under $InstallRoot, and patches
    server.properties for development use.

    Idempotent: re-running after a new BDS release installs the new
    version side-by-side. Use -Force to redownload and reinstall the
    same version.

.PARAMETER InstallRoot
    Where to install BDS. Defaults to %LOCALAPPDATA%\RedstoneForge\bds.

.PARAMETER Channel
    'stable' (default) or 'preview'. Picks serverBedrockWindows or
    serverBedrockPreviewWindows from the download-links endpoint.

.PARAMETER ManualUrl
    Bypass URL resolution entirely. Provide a direct
    https://www.minecraft.net/bedrockdedicatedserver/.../bedrock-server-*.zip
    URL. Use this when every automated source has failed.

.PARAMETER Force
    Redownload and reinstall even if the target version is already present.

.EXAMPLE
    pwsh tools/bds-install.ps1

.EXAMPLE
    pwsh tools/bds-install.ps1 -Channel preview

.EXAMPLE
    pwsh tools/bds-install.ps1 -ManualUrl 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.21.1.zip'
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RedstoneForge\bds'),
    [ValidateSet('stable', 'preview')]
    [string]$Channel = 'stable',
    [string]$ManualUrl,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
$DownloadType = if ($Channel -eq 'preview') { 'serverBedrockPreviewWindows' } else { 'serverBedrockWindows' }
$UrlPathSegment = if ($Channel -eq 'preview') { 'bin-win-preview' } else { 'bin-win' }

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Note([string]$msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Write-Ok([string]$msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Resolve-LatestBdsUrl {
    # Step 1: JSON endpoint (primary)
    Write-Step 'Resolving latest BDS URL via minecraft-services JSON endpoint'
    try {
        $resp = Invoke-RestMethod `
            -Uri 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links' `
            -Headers @{ 'User-Agent' = $UA; 'Accept-Language' = 'en-US,en;q=0.9' } `
            -TimeoutSec 30
        $link = $resp.result.links | Where-Object { $_.downloadType -eq $DownloadType } | Select-Object -First 1
        if ($link -and $link.downloadUrl) {
            Write-Ok "Found: $($link.downloadUrl)"
            return @{ Source = 'json-api'; Url = $link.downloadUrl }
        }
        Write-Warn2 "JSON endpoint returned no entry for downloadType=$DownloadType"
    } catch {
        Write-Warn2 "JSON endpoint failed: $($_.Exception.Message)"
    }

    # Step 2: Page scrape
    Write-Step 'Falling back to scraping minecraft.net download page'
    try {
        $page = Invoke-WebRequest `
            -Uri 'https://www.minecraft.net/en-us/download/server/bedrock' `
            -Headers @{ 'User-Agent' = $UA; 'Accept-Language' = 'en-US,en;q=0.9' } `
            -TimeoutSec 30 -UseBasicParsing
        $pattern = "https://www\.minecraft\.net/bedrockdedicatedserver/$([regex]::Escape($UrlPathSegment))/bedrock-server-[\d.]+\.zip"
        $m = [regex]::Match($page.Content, $pattern)
        if ($m.Success) {
            Write-Ok "Found: $($m.Value)"
            return @{ Source = 'page-scrape'; Url = $m.Value }
        }
        Write-Warn2 'Page scrape: no matching link found'
    } catch {
        Write-Warn2 "Page scrape failed: $($_.Exception.Message)"
    }

    # Step 3: Community wiki
    Write-Step 'Falling back to minecraft.wiki Bedrock_Dedicated_Server page'
    try {
        $wiki = Invoke-WebRequest `
            -Uri 'https://minecraft.wiki/w/Bedrock_Dedicated_Server' `
            -Headers @{ 'User-Agent' = $UA; 'Accept-Language' = 'en-US,en;q=0.9' } `
            -TimeoutSec 30 -UseBasicParsing
        $pattern = "https://www\.minecraft\.net/bedrockdedicatedserver/$([regex]::Escape($UrlPathSegment))/bedrock-server-[\d.]+\.zip"
        $m = [regex]::Match($wiki.Content, $pattern)
        if ($m.Success) {
            Write-Ok "Found: $($m.Value)"
            return @{ Source = 'wiki'; Url = $m.Value }
        }
        Write-Warn2 'Wiki: no matching link found'
    } catch {
        Write-Warn2 "Wiki lookup failed: $($_.Exception.Message)"
    }

    # Step 4: ask the user
    throw @"
All automated BDS URL sources failed. Do not guess a URL.

Please visit https://www.minecraft.net/en-us/download/server/bedrock
in a browser, copy the ZIP download URL for the $Channel Windows server,
and re-run:

    pwsh tools/bds-install.ps1 -ManualUrl '<paste-url-here>'
"@
}

function Get-VersionFromUrl([string]$url) {
    $m = [regex]::Match($url, 'bedrock-server-([\d.]+)\.zip')
    if (-not $m.Success) {
        throw "Could not extract version number from URL: $url"
    }
    return $m.Groups[1].Value
}

# --- main ---

if ($ManualUrl) {
    Write-Step 'Using manual URL (skipping resolution)'
    $resolved = @{ Source = 'manual'; Url = $ManualUrl }
} else {
    $resolved = Resolve-LatestBdsUrl
}

$version = Get-VersionFromUrl $resolved.Url
Write-Host ''
Write-Host "Bedrock Dedicated Server $version ($Channel channel)" -ForegroundColor White
Write-Host "  Source: $($resolved.Source)" -ForegroundColor DarkGray
Write-Host "  URL:    $($resolved.Url)" -ForegroundColor DarkGray
Write-Host ''

$installDir = Join-Path $InstallRoot $version

if ((Test-Path -LiteralPath $installDir) -and -not $Force) {
    $exe = Join-Path $installDir 'bedrock_server.exe'
    if (Test-Path -LiteralPath $exe) {
        Write-Ok "Already installed at $installDir"
        Write-Host ''
        Write-Host 'Start the server with:' -ForegroundColor Cyan
        Write-Host '  pwsh tools/bds-run.ps1' -ForegroundColor White
        Write-Output $installDir
        return
    }
}

# License acknowledgment
Write-Host 'By downloading and using the Bedrock Dedicated Server you agree to:' -ForegroundColor Yellow
Write-Host '  - Minecraft EULA:  https://www.minecraft.net/en-us/eula' -ForegroundColor Yellow
Write-Host '  - Minecraft Terms: https://www.minecraft.net/en-us/terms' -ForegroundColor Yellow
Write-Host ''

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}
$cacheDir = Join-Path $InstallRoot '.cache'
if (-not (Test-Path -LiteralPath $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}
$zipPath = Join-Path $cacheDir "bedrock-server-$version.zip"

if ((Test-Path -LiteralPath $zipPath) -and -not $Force) {
    Write-Step "Using cached zip: $zipPath"
} else {
    Write-Step "Downloading $version to $zipPath"
    Invoke-WebRequest `
        -Uri $resolved.Url `
        -Headers @{ 'User-Agent' = $UA } `
        -OutFile $zipPath `
        -TimeoutSec 600
}

$zipInfo = Get-Item -LiteralPath $zipPath
if ($zipInfo.Length -lt 30MB) {
    throw "Downloaded zip is suspiciously small ($([math]::Round($zipInfo.Length / 1MB, 1)) MB). Aborting; re-run with -Force after deleting $zipPath."
}
Write-Ok "Downloaded $([math]::Round($zipInfo.Length / 1MB, 1)) MB"

Write-Step "Extracting to $installDir"
if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force
}
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $installDir -Force

$exe = Join-Path $installDir 'bedrock_server.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "bedrock_server.exe not found after extraction at $exe. Install appears corrupt."
}
Write-Ok 'Extracted'

# Markers so future runs can tell what they're looking at
Set-Content -LiteralPath (Join-Path $installDir 'redstone-forge.version') -Value $version
Set-Content -LiteralPath (Join-Path $installDir 'redstone-forge.source')  -Value $resolved.Source

# Patch server.properties
$propsPath = Join-Path $installDir 'server.properties'
if (Test-Path -LiteralPath $propsPath) {
    Write-Step 'Patching server.properties for development use'
    $overrides = [ordered]@{
        'server-name'  = 'Redstone Forge Dev'
        'gamemode'     = 'creative'
        'difficulty'   = 'peaceful'
        'allow-cheats' = 'true'
        'online-mode'  = 'false'
        'max-players'  = '4'
        'content-log-console-output-enabled' = 'true'
        # The Bedrock client itself reserves UDP ports 19132 through
        # ~19500 via its UWP AppContainer NetworkManifest, blocking any
        # other process from binding ANY of them whenever the client is
        # running on the same machine. Picking a port well outside the
        # range so BDS works without quitting the client first.
        'server-port'   = '25565'
        'server-portv6' = '25566'
    }
    $applied = [System.Collections.Generic.HashSet[string]]::new()
    $lines = Get-Content -LiteralPath $propsPath
    $newLines = foreach ($line in $lines) {
        $replaced = $false
        foreach ($key in $overrides.Keys) {
            $prefix = "$key="
            if ($line.StartsWith($prefix)) {
                "$key=$($overrides[$key])"
                [void]$applied.Add($key)
                $replaced = $true
                break
            }
        }
        if (-not $replaced) { $line }
    }
    Set-Content -LiteralPath $propsPath -Value $newLines
    foreach ($key in $overrides.Keys) {
        if ($applied.Contains($key)) {
            Write-Note "$key = $($overrides[$key])"
        } else {
            Write-Warn2 "override '$key' did not match any existing line in server.properties (key may have been renamed or removed in this BDS version)"
        }
    }
} else {
    Write-Warn2 'server.properties not found in install; skipping patch'
}

Write-Host ''
Write-Host "Done. BDS $version installed at:" -ForegroundColor Green
Write-Host "  $installDir" -ForegroundColor White
Write-Host ''
Write-Host 'Start the server with:' -ForegroundColor Cyan
Write-Host '  pwsh tools/bds-run.ps1' -ForegroundColor White
Write-Output $installDir
