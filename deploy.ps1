[CmdletBinding()]
param(
    [switch]$Gpu,
    [switch]$Tunnel,
    [string]$BackendDir = "",
    [string]$EnvFile = "",
    [switch]$NoBuild,
    [switch]$NoModelDownload,
    [switch]$InitOnly,
    [switch]$Check,
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }
if (-not $BackendDir) { $BackendDir = Join-Path (Split-Path $Root -Parent) "AvatarLive-backend" }

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
    if (-not (Test-CommandAvailable "winget")) {
        throw "-Install requires winget. Install App Installer from the Microsoft Store, then rerun .\deploy.ps1 -Install."
    }
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
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            & docker info *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 2
        }
    }
}

function Test-DeploymentEnvironment {
    param([switch]$RequireGpu)
    $issues = [System.Collections.Generic.List[string]]::new()

    if (-not (Test-CommandAvailable "git")) {
        $issues.Add("Git is missing. Install Git for Windows or rerun with -Install.")
    }
    $dockerAvailable = Test-CommandAvailable "docker"
    if (-not $dockerAvailable) {
        $issues.Add("Docker Desktop is missing. Install Docker Desktop or rerun with -Install.")
    }
    else {
        & docker compose version *> $null
        if ($LASTEXITCODE -ne 0) { $issues.Add("Docker Compose v2 is unavailable. Update Docker Desktop.") }
        & docker info *> $null
        if ($LASTEXITCODE -ne 0) { $issues.Add("Docker Desktop is not running. Start it and wait for the engine to become ready.") }
    }

    if ($RequireGpu) {
        if (-not (Test-CommandAvailable "wsl")) {
            $issues.Add("WSL2 is required for the optional -Gpu mode. Install it with 'wsl --install' and restart Windows.")
        }
        else {
            & wsl --status *> $null
            if ($LASTEXITCODE -ne 0) { $issues.Add("WSL2 is not initialized. Run 'wsl --install' and restart Windows.") }
        }
        if (-not (Test-CommandAvailable "nvidia-smi")) {
            $issues.Add("nvidia-smi is missing. Install a current NVIDIA driver before using -Gpu.")
        }
        if ($dockerAvailable) {
            $probeImage = if ($env:CUDA_PROBE_IMAGE) { $env:CUDA_PROBE_IMAGE } else { "nvidia/cuda:12.8.0-base-ubuntu22.04" }
            & docker run --rm --gpus all --entrypoint nvidia-smi $probeImage *> $null
            if ($LASTEXITCODE -ne 0) { $issues.Add("Docker cannot access the NVIDIA GPU. Enable Docker Desktop WSL2 GPU support and verify the NVIDIA driver.") }
        }
    }

    if ($issues.Count -gt 0) {
        Write-Host "Environment check found $($issues.Count) issue(s):" -ForegroundColor Yellow
        $issues | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
        return $false
    }
    Write-Host "Environment check passed: Git, Docker Compose, and Docker daemon are ready." -ForegroundColor Green
    if ($RequireGpu) { Write-Host "GPU check passed: WSL2 and NVIDIA Docker runtime are available." -ForegroundColor Green }
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

$postgresPassword = Get-EnvValue "POSTGRES_PASSWORD"
if (-not $postgresPassword) {
    $postgresPassword = New-UrlSafeSecret 24
    Set-EnvValue "POSTGRES_PASSWORD" $postgresPassword
}
if (-not (Get-EnvValue "DATABASE_URL")) {
    Set-EnvValue "DATABASE_URL" "postgresql+psycopg://synlive:$postgresPassword@localhost:5432/synlive"
}
if (-not (Get-EnvValue "MINIO_SECRET_KEY")) { Set-EnvValue "MINIO_SECRET_KEY" (New-UrlSafeSecret 24) }
if (-not (Get-EnvValue "PLATFORM_ENCRYPTION_KEY")) { Set-EnvValue "PLATFORM_ENCRYPTION_KEY" (New-UrlSafeSecret 32) }

New-Item -ItemType Directory -Force -Path (Join-Path $Root "runtime\avatar-assets") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root ".deploy-data\avatar-base-videos") | Out-Null
$secretsDir = Join-Path $Root "secrets"
New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
$tunnelToken = Join-Path $secretsDir "cloudflare-tunnel-token"
if (-not (Test-Path -LiteralPath $tunnelToken)) { New-Item -ItemType File -Path $tunnelToken | Out-Null }

if ($InitOnly) {
    Write-Host "AvatarLive environment initialized at $EnvFile" -ForegroundColor Green
    return
}

if ($Install) { Install-OptionalDependencies }

if ($Check) {
    if (-not (Test-DeploymentEnvironment -RequireGpu:$Gpu)) { exit 1 }
    return
}

if ($Tunnel -and (-not (Test-Path -LiteralPath $tunnelToken -PathType Leaf) -or (Get-Item -LiteralPath $tunnelToken).Length -eq 0)) {
    throw "Cloudflare Tunnel requires a nonempty secrets/cloudflare-tunnel-token file."
}

if (-not (Test-DeploymentEnvironment -RequireGpu:$Gpu)) {
    throw "Environment is not ready. Fix the reported issues, or run .\deploy.ps1 -Check for a diagnostic-only check."
}

if ($Gpu) {
    $backendScript = Join-Path $BackendDir "deploy.ps1"
    if (-not (Test-Path -LiteralPath $backendScript -PathType Leaf)) {
        throw "AvatarLive-backend was not found at $BackendDir. Clone it beside AvatarLive or pass -BackendDir."
    }
    $backendParams = @{
        EnvFile = $EnvFile
        AvatarAssetDir = (Join-Path $Root "runtime\avatar-assets")
        NoBuild = $NoBuild
        NoModelDownload = $NoModelDownload
    }
    & $backendScript @backendParams
    if ($LASTEXITCODE -ne 0) { throw "AvatarLive-backend deployment failed." }
    if ((Get-EnvValue "AVATAR_BASE_VIDEO_HOST_DIR") -eq "../.deploy-data/avatar-base-videos") {
        $env:AVATAR_BASE_VIDEO_HOST_DIR = Join-Path $BackendDir "data\public"
    }
}

$env:AVATAR_ENV_FILE = $EnvFile
$compose = @("compose", "-f", (Join-Path $Root "infra\docker-compose.yml"), "--env-file", $EnvFile, "--profile", "media")
if ($Tunnel) {
    $compose += @("--profile", "tunnel")
}
$up = $compose + @("up", "-d")
if (-not $NoBuild) { $up += "--build" }
Write-Host "Starting AvatarLive core services..." -ForegroundColor Cyan
Invoke-Docker -Arguments $up

$accessPort = Get-EnvValue "ACCESS_PORT"
if (-not $accessPort) { $accessPort = "8018" }
$readyUrl = "http://127.0.0.1:$accessPort/health/ready"
Write-Host "Waiting for $readyUrl ..."
$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $readyUrl -TimeoutSec 3
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { $ready = $true; break }
    }
    catch { Start-Sleep -Seconds 2 }
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
if (-not $Gpu) {
    Write-Host "`nCloud/Core mode is active. No local MuseTalk, MeloTTS, server-total, GPU, or model download was used." -ForegroundColor Yellow
    Write-Host "Configure the cloud API credentials in .env; use -Gpu only for the optional local inference stack."
}
