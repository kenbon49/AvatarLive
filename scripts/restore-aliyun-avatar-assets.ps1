[CmdletBinding()]
param(
    [string]$DownloadDirectory = "",
    [string]$DestinationRoot = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $DownloadDirectory) { $DownloadDirectory = Join-Path $Root ".cache\avatar-previews-2026-11-05" }
if (-not $DestinationRoot) { $DestinationRoot = $Root }
$DownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
$ReleaseUrl = "https://github.com/kenbon49/AvatarLive/releases/download/avatar-previews-2026-11-05"
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Receive-Asset {
    param([string]$Name, [string]$Destination)
    $temporary = "$Destination.download"
    try {
        Write-Host "Downloading $Name ..."
        Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/$Name" -OutFile $temporary
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    }
    finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

$manifestPath = Join-Path $DownloadDirectory "aliyun-avatar-previews-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Receive-Asset -Name "aliyun-avatar-previews-manifest.json" -Destination $manifestPath
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.version -ne "2026-11-05" -or
    -not $manifest.archives -or -not $manifest.files) { throw "Unexpected preview resource manifest." }
$catalogPath = Join-Path $DestinationRoot "src/data/aliyun-public-avatars.json"
if ((Test-Path -LiteralPath $catalogPath -PathType Leaf) -and
    (Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash -ne $manifest.catalog.sha256) {
    throw "The preview bundle does not match this checkout's avatar catalog. Use the matching resource release."
}

# Verify every ZIP before extracting any files, including archives supplied offline.
foreach ($archive in $manifest.archives) {
    if ($archive.name -notmatch '^aliyun-avatar-previews-2026-11-05-part-[0-9]{2}\.zip$') {
        throw "Unexpected archive name in resource manifest."
    }
    $path = Join-Path $DownloadDirectory $archive.name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Receive-Asset -Name $archive.name -Destination $path
    }
    if ((Get-Item -LiteralPath $path).Length -ne $archive.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $archive.sha256) {
        throw "Checksum mismatch: $path. Remove this ZIP and rerun to download it again."
    }
}
foreach ($archive in $manifest.archives) {
    Write-Host "Extracting $($archive.name) ..."
    Expand-Archive -LiteralPath (Join-Path $DownloadDirectory $archive.name) -DestinationPath $DestinationRoot -Force
}
foreach ($file in $manifest.files) {
    if ($file.path -notmatch '^public/assets/aliyun-avatars/(covers/[A-Za-z0-9_-]+\.webp|videos/[A-Za-z0-9_-]+\.mp4)$') {
        throw "Unexpected asset path in resource manifest."
    }
    $path = Join-Path $DestinationRoot $file.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing restored asset: $path" }
    if ((Get-Item -LiteralPath $path).Length -ne $file.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) {
        throw "Restored asset checksum mismatch: $path"
    }
}
Write-Host "Restored $($manifest.catalog.avatarCount) covers and $($manifest.catalog.videoCount) preview videos. Rebuild the web image to include them." -ForegroundColor Green
