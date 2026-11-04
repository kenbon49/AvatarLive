[CmdletBinding()]
param(
    [switch]$Purge,
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }
$env:AVATAR_ENV_FILE = $EnvFile
$compose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.yml"), "--env-file", $EnvFile, "--profile", "media")
$down = $compose + @("down", "--remove-orphans")
if ($Purge) { $down += "-v" }
& docker @down
if ($LASTEXITCODE -ne 0) { throw "AvatarLive shutdown failed." }
