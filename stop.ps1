[CmdletBinding()]
param(
    [switch]$Gpu,
    [switch]$Purge,
    [string]$BackendDir = "",
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }
if (-not $BackendDir) { $BackendDir = Join-Path (Split-Path $Root -Parent) "AvatarLive-backend" }
$env:AVATAR_ENV_FILE = $EnvFile
$compose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.yml"), "--env-file", $EnvFile, "--profile", "media")
$down = $compose + @("down", "--remove-orphans")
if ($Purge) { $down += "-v" }
& docker @down
if ($LASTEXITCODE -ne 0) { throw "AvatarLive shutdown failed." }

if ($Gpu) {
    $backendScript = Join-Path $BackendDir "stop.ps1"
    if (Test-Path -LiteralPath $backendScript -PathType Leaf) {
        & $backendScript -EnvFile $EnvFile -Purge:$Purge
        if ($LASTEXITCODE -ne 0) { throw "AvatarLive-backend shutdown failed." }
    }
}
