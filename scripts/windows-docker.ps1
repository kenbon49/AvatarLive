function Invoke-NativeProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    # Windows PowerShell 5.1 treats redirected native stderr as PowerShell errors.
    # Keep expected probe failures local so callers can inspect the exit code and retry.
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    $output = & $Command @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    }
}

function Invoke-DockerProbe {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    return Invoke-NativeProbe -Command "docker" -Arguments $Arguments
}

function Get-WslCommand {
    if ($env:ProgramFiles) {
        $installed = Join-Path $env:ProgramFiles "WSL\wsl.exe"
        if (Test-Path -LiteralPath $installed -PathType Leaf) { return $installed }
    }
    $command = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return ""
}

function Test-WindowsWslReady {
    $command = Get-WslCommand
    if (-not $command) { return $false }
    $status = Invoke-NativeProbe -Command $command -Arguments @("--status")
    if ($status.ExitCode -ne 0) { return $false }
    $default = Invoke-NativeProbe -Command $command -Arguments @("--set-default-version", "2")
    if ($default.ExitCode -ne 0) { return $false }
    try {
        $features = @(Get-CimInstance -ClassName Win32_OptionalFeature -Filter "Name = 'Microsoft-Windows-Subsystem-Linux' OR Name = 'VirtualMachinePlatform'" -ErrorAction Stop)
        return (@($features | Where-Object { $_.InstallState -eq 1 }).Count -eq 2)
    }
    catch { return $false }
}

function Initialize-WindowsWsl {
    if (Test-WindowsWslReady) {
        Write-Host "WSL is ready." -ForegroundColor Green
        return $true
    }

    Write-Host "WSL is missing or unavailable. Installing/repairing WSL 2 (administrator access required)..." -ForegroundColor Cyan
    $resultFile = [IO.Path]::GetTempFileName()
    try {
        # Encode paths so spaces, quotes, and non-ASCII characters survive elevation.
        $installer = (Join-Path $PSScriptRoot "install-wsl.ps1").Replace("'", "''")
        $escapedResult = $resultFile.Replace("'", "''")
        $command = "& '$installer' -ResultFile '$escapedResult'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded
        ) | Out-Null
        $content = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8
        if (-not $content) { throw "The elevated WSL installer did not return a result." }
        $result = $content | ConvertFrom-Json -ErrorAction Stop
        if ($result.Error) { throw "$($result.Error)`n$($result.Details)" }
        if ($result.RebootRequired) {
            Write-Host "WSL 2 setup requires a Windows restart. Restart Windows, then rerun .\deploy.ps1 -Install." -ForegroundColor Yellow
            return $false
        }
        if (-not $result.Ready -or -not (Test-WindowsWslReady)) {
            throw "WSL 2 is still unavailable after setup.`n$($result.Details)"
        }
        Write-Host "WSL 2 is ready. Continuing deployment..." -ForegroundColor Green
        return $true
    }
    finally { Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue }
}

function Get-DockerStartupHelp {
    param([string]$Details)

    $message = @"
Docker Desktop is not ready. Open Docker Desktop, complete its initial setup, and wait for the engine to be running.
If Docker Desktop reports 'unable to start', restart Windows if installation requested it, and verify hardware virtualization and the WSL 2 backend.
Run 'wsl --status', 'wsl -l -v', and 'docker info' in PowerShell to diagnose the startup failure.
If WSL or its kernel is missing, rerun .\deploy.ps1 -Install for automatic setup/repair and allow administrator access.
See docs/cross-platform-deployment.md for Windows Docker Desktop troubleshooting.
"@
    if ($Details) { $message += "`nDocker diagnostic output:`n$Details" }
    return $message
}
