[CmdletBinding()]
param(
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }

& (Join-Path $Root "deploy.ps1") -EnvFile $EnvFile -InitOnly
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop is required."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }

function Get-EnvValue {
    param([string]$Name)
    $line = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -split "=", 2)[1]
}

$postgresUser = Get-EnvValue "POSTGRES_USER"
if (-not $postgresUser) { $postgresUser = "synlive" }
$postgresDatabase = Get-EnvValue "POSTGRES_DB"
if (-not $postgresDatabase) { $postgresDatabase = "synlive" }
$compose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.postgres.yml"), "--env-file", $EnvFile)

Write-Host "Starting independent PostgreSQL service..." -ForegroundColor Cyan
$up = $compose + @("up", "-d", "postgres")
& docker @up
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL deployment failed." }

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $check = $compose + @("exec", "-T", "postgres", "pg_isready", "-U", $postgresUser, "-d", $postgresDatabase)
    & docker @check *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "PostgreSQL is ready. Continue with .\deploy.ps1." -ForegroundColor Green
        return
    }
    Start-Sleep -Seconds 2
}

$logs = $compose + @("logs", "--tail", "80", "postgres")
& docker @logs
throw "PostgreSQL did not become ready."
