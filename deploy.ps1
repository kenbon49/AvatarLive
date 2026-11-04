[CmdletBinding()]
param(
    [string]$EnvFile = "",
    [switch]$NoBuild,
    [switch]$InitOnly,
    [switch]$Check,
    [switch]$Install,
    [switch]$WithPostgres
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path
. (Join-Path $Root "scripts\windows-docker.ps1")
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Test-CommandAvailable {
    param([Parameter(Mandatory = $true)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage {
    param([Parameter(Mandatory = $true)][string]$Id)
    Write-Host "Installing $Id with winget..." -ForegroundColor Cyan
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget could not install $Id (exit code $LASTEXITCODE)." }
}

function Install-OptionalDependencies {
    if (-not (Test-CommandAvailable "git")) { Install-WingetPackage "Git.Git" }
    if (-not (Test-CommandAvailable "docker")) { Install-WingetPackage "Docker.DockerDesktop" }

    # winget updates PATH for future processes; refresh this process as well.
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($userPath -or $machinePath) { $env:Path = (($userPath, $machinePath) -ne $null) -join ";" }

    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if ((Test-Path -LiteralPath $dockerDesktop) -and -not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
        Write-Host "Starting Docker Desktop..." -ForegroundColor Cyan
        Start-Process -FilePath $dockerDesktop | Out-Null
    }
    if (Test-CommandAvailable "docker") {
        Write-Host "Waiting for Docker Desktop to become ready (up to 90 checks, 2 seconds apart)..." -ForegroundColor Cyan
        for ($attempt = 0; $attempt -lt 90; $attempt++) {
            $probe = Invoke-DockerProbe -Arguments @("info")
            if ($probe.ExitCode -eq 0) { return }
            if ($attempt -lt 89) { Start-Sleep -Seconds 2 }
        }
        throw ("Docker Desktop did not become ready after 90 checks.`n" + (Get-DockerStartupHelp -Details $probe.Output))
    }
}

function Test-DeploymentEnvironment {
    $issues = [System.Collections.Generic.List[string]]::new()

    if (-not (Test-CommandAvailable "git")) {
        $issues.Add("Git is missing. Install Git for Windows or rerun with -Install.")
    }
    $dockerAvailable = Test-CommandAvailable "docker"
    if (-not $dockerAvailable) {
        $issues.Add("Docker Desktop is missing. Install Docker Desktop or rerun with -Install.")
    }
    else {
        $composeProbe = Invoke-DockerProbe -Arguments @("compose", "version")
        if ($composeProbe.ExitCode -ne 0) {
            $issues.Add("Docker Compose v2 is unavailable. Update Docker Desktop.`n$($composeProbe.Output)")
        }
        $dockerProbe = Invoke-DockerProbe -Arguments @("info")
        if ($dockerProbe.ExitCode -ne 0) { $issues.Add((Get-DockerStartupHelp -Details $dockerProbe.Output)) }
    }

    if ($issues.Count -gt 0) {
        Write-Host "Environment check found $($issues.Count) issue(s):" -ForegroundColor Yellow
        $issues | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
        return $false
    }
    Write-Host "Environment check passed: Git, Docker Compose, and Docker daemon are ready." -ForegroundColor Green
    return $true
}

function Get-EnvValue {
    param([string]$Name)
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return "" }
    $line = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -split "=", 2)[1]
}

function Set-EnvValue {
    param([string]$Name, [string]$Value)
    $content = if (Test-Path -LiteralPath $EnvFile) { [IO.File]::ReadAllText($EnvFile) } else { "" }
    $line = "$Name=$Value"
    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    if ([regex]::IsMatch($content, $pattern)) {
        $expression = [regex]::new($pattern)
        $content = $expression.Replace($content, $line, 1)
    }
    else {
        if ($content -and -not $content.EndsWith("`n")) { $content += "`n" }
        $content += "$line`n"
    }
    [IO.File]::WriteAllText($EnvFile, $content, [Text.UTF8Encoding]::new($false))
}

function New-UrlSafeSecret {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($buffer).Replace("+", "-").Replace("/", "_")
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination $EnvFile
    Write-Host "Created $EnvFile from .env.example."
}
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path

$postgresPassword = Get-EnvValue "POSTGRES_PASSWORD"
$postgresUser = Get-EnvValue "POSTGRES_USER"
if (-not $postgresUser) { $postgresUser = "synlive" }
$postgresDatabase = Get-EnvValue "POSTGRES_DB"
if (-not $postgresDatabase) { $postgresDatabase = "synlive" }
$postgresPort = Get-EnvValue "POSTGRES_PORT"
if (-not $postgresPort) { $postgresPort = "5432" }
if (-not $postgresPassword) {
    $postgresPassword = New-UrlSafeSecret 24
    Set-EnvValue "POSTGRES_PASSWORD" $postgresPassword
}
if (-not (Get-EnvValue "DATABASE_URL")) {
    Set-EnvValue "DATABASE_URL" "postgresql+psycopg://$postgresUser`:$postgresPassword@localhost`:$postgresPort/$postgresDatabase"
}
if (-not (Get-EnvValue "PLATFORM_ENCRYPTION_KEY")) { Set-EnvValue "PLATFORM_ENCRYPTION_KEY" (New-UrlSafeSecret 32) }

if ($InitOnly) {
    Write-Host "AvatarLive environment initialized at $EnvFile" -ForegroundColor Green
    return
}

if ($Install) {
    if (-not (Test-CommandAvailable "winget")) {
        throw "-Install requires winget. Install App Installer from the Microsoft Store, then rerun .\deploy.ps1 -Install."
    }
    if ($env:OS -eq "Windows_NT" -and -not (Initialize-WindowsWsl)) { return }
    Install-OptionalDependencies
}

if ($Check) {
    if (-not (Test-DeploymentEnvironment)) { exit 1 }
    return
}

if (-not (Test-DeploymentEnvironment)) {
    throw "Environment is not ready. Fix the reported issues, or run .\deploy.ps1 -Check for a diagnostic-only check."
}

if ($WithPostgres -or $Install) {
    & (Join-Path $Root "deploy-postgres.ps1") -EnvFile $EnvFile
}

$databaseCompose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.postgres.yml"), "--env-file", $EnvFile)
$databaseCheck = $databaseCompose + @("exec", "-T", "postgres", "pg_isready", "-U", $postgresUser, "-d", $postgresDatabase)
$databaseProbe = Invoke-DockerProbe -Arguments $databaseCheck
if ($databaseProbe.ExitCode -ne 0) {
    throw "PostgreSQL is not ready. Run .\deploy.ps1 -WithPostgres or deploy it first with .\deploy-postgres.ps1."
}

$env:AVATAR_ENV_FILE = $EnvFile
$compose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.yml"), "--env-file", $EnvFile, "--profile", "media")
$up = $compose + @("up", "-d")
if (-not $NoBuild) { $up += "--build" }
Write-Host "Starting AvatarLive core services..." -ForegroundColor Cyan
Invoke-Docker -Arguments $up

$accessPort = Get-EnvValue "ACCESS_PORT"
if (-not $accessPort) { $accessPort = "8018" }
$readyUrl = "http://127.0.0.1:$accessPort/health/ready"
$loginUrl = "http://127.0.0.1:$accessPort/login"
Write-Host "Waiting for the API and login page at http://127.0.0.1:$accessPort ..."
$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $readyUrl -TimeoutSec 5 -MaximumRedirection 0
        $page = Invoke-WebRequest -UseBasicParsing -Uri $loginUrl -TimeoutSec 5 -MaximumRedirection 0
        if ($response.StatusCode -eq 200 -and $page.StatusCode -eq 200) { $ready = $true; break }
    }
    catch { }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    $logArguments = $compose + @("logs", "--tail", "80", "api", "web", "proxy")
    & docker @logArguments
    throw "AvatarLive did not become ready."
}

$accessHost = Get-EnvValue "ACCESS_HOST"
if (-not $accessHost) { $accessHost = "localhost" }
Write-Host "`nAvatarLive is ready: http://$accessHost`:$accessPort/live" -ForegroundColor Green
Write-Host "API readiness:       http://$accessHost`:$accessPort/health/ready"

$credentialArguments = $compose + @("exec", "-T", "api", "sh", "-c", "test ! -f /app/runtime/admin/initial-admin.txt || cat /app/runtime/admin/initial-admin.txt")
$credentials = & docker @credentialArguments 2>$null
if ($credentials) {
    Write-Host "`nInitial administrator credentials (store them securely):" -ForegroundColor Yellow
    $credentials | ForEach-Object { Write-Host $_ }
}
Write-Host "`nCloud services are configured through $EnvFile." -ForegroundColor Yellow
