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

function ConvertFrom-WslOutput {
    param([byte[]]$Bytes)

    if (-not $Bytes -or $Bytes.Length -eq 0) { return "" }
    # Windows WSL management commands can write UTF-16LE to redirected pipes,
    # irrespective of the console code page. Decode before PowerShell sees text.
    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
        return [Text.Encoding]::BigEndianUnicode.GetString($Bytes).TrimStart([char]0xFEFF)
    }
    if (($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) -or
        [Array]::IndexOf($Bytes, [byte]0) -ge 0) {
        return [Text.Encoding]::Unicode.GetString($Bytes).TrimStart([char]0xFEFF)
    }
    try { return [Text.UTF8Encoding]::new($false, $true).GetString($Bytes).TrimStart([char]0xFEFF) }
    catch { return [Console]::OutputEncoding.GetString($Bytes) }
}

function Invoke-WslProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $process = [Diagnostics.Process]::new()
    $stdout = [IO.MemoryStream]::new()
    $stderr = [IO.MemoryStream]::new()
    try {
        $process.StartInfo.FileName = $Command
        # All WSL probes pass fixed switches and numeric values, without paths.
        $process.StartInfo.Arguments = $Arguments -join " "
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.Start() | Out-Null
        $outTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
        $errTask = $process.StandardError.BaseStream.CopyToAsync($stderr)
        $process.WaitForExit()
        $outTask.GetAwaiter().GetResult()
        $errTask.GetAwaiter().GetResult()
        $output = @(
            (ConvertFrom-WslOutput -Bytes $stdout.ToArray()).TrimEnd([char[]]"`r`n"),
            (ConvertFrom-WslOutput -Bytes $stderr.ToArray()).TrimEnd([char[]]"`r`n")
        ) | Where-Object { $_ }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output -join [Environment]::NewLine }
    }
    finally {
        $process.Dispose()
        $stdout.Dispose()
        $stderr.Dispose()
    }
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
    $status = Invoke-WslProbe -Command $command -Arguments @("--status")
    if ($status.ExitCode -ne 0) { return $false }
    $default = Invoke-WslProbe -Command $command -Arguments @("--set-default-version", "2")
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

function Get-WindowsDockerDiagnostics {
    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add("AvatarLive Windows Docker diagnostics - $([DateTimeOffset]::Now.ToString('o'))")
    $queries = @(
        @{ Title = "Windows"; Class = "Win32_OperatingSystem"; Properties = @("Caption", "Version", "BuildNumber", "LastBootUpTime") },
        @{ Title = "Virtualization"; Class = "Win32_ComputerSystem"; Properties = @("Manufacturer", "Model", "HypervisorPresent") },
        @{ Title = "Processor"; Class = "Win32_Processor"; Properties = @("Name", "VirtualizationFirmwareEnabled", "SecondLevelAddressTranslationExtensions", "VMMonitorModeExtensions") },
        @{ Title = "Windows features (InstallState: 1=enabled, 2=disabled)"; Class = "Win32_OptionalFeature"; Properties = @("Name", "InstallState"); Filter = "Name = 'Microsoft-Windows-Subsystem-Linux' OR Name = 'VirtualMachinePlatform'" }
    )
    foreach ($query in $queries) {
        try {
            $arguments = @{ ClassName = $query.Class; ErrorAction = "Stop" }
            if ($query.Filter) { $arguments.Filter = $query.Filter }
            $items = Get-CimInstance @arguments
            $text = ($items | Select-Object -Property $query.Properties | Format-List | Out-String -Width 200).Trim()
            $report.Add("`n[$($query.Title)]`n$text")
        }
        catch { $report.Add("`n[$($query.Title)]`nUnavailable: $($_.Exception.Message)") }
    }

    try {
        $services = Get-Service -Name "WslService", "LxssManager", "vmcompute", "com.docker.service" -ErrorAction SilentlyContinue
        $text = ($services | Select-Object Name, Status, StartType | Format-Table -AutoSize | Out-String -Width 200).Trim()
        $report.Add("`n[Services (some names vary by WSL version)]`n$text")
    }
    catch { $report.Add("`n[Services]`nUnavailable: $($_.Exception.Message)") }

    if ($env:APPDATA) {
        $settingsDirectory = Join-Path $env:APPDATA "Docker"
        foreach ($name in @("settings-store.json", "settings.json")) {
            $path = Join-Path $settingsDirectory $name
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            try {
                $settings = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
                $value = if ($settings.PSObject.Properties["wslEngineEnabled"]) { $settings.wslEngineEnabled } else { "not specified (Docker Desktop default)" }
                $report.Add("`n[Docker Desktop backend]`nSettings: $path`nwslEngineEnabled: $value")
            }
            catch { $report.Add("`n[Docker Desktop backend]`nCannot read settings: $($_.Exception.Message)") }
            break
        }
    }

    $commands = @()
    $wsl = Get-WslCommand
    # Docker Desktop can invoke System32 directly even when PATH or our installer
    # selects a newer WSL package. Probe both entry points to expose that mismatch.
    $wslCandidates = @($wsl)
    if ($env:WINDIR) { $wslCandidates += Join-Path $env:WINDIR "System32\wsl.exe" }
    $wslCandidates += @(Get-Command wsl.exe -All -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -Unique)
    $wslPaths = @()
    foreach ($candidate in $wslCandidates) {
        if (-not $candidate -or $wslPaths -contains $candidate) { continue }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $wslPaths += $candidate
        $commands += @{ Title = "WSL version"; Command = $candidate; Arguments = @("--version") }
    }
    if ($wsl) {
        $commands += @(
            @{ Title = "WSL status"; Command = $wsl; Arguments = @("--status") },
            @{ Title = "WSL distributions"; Command = $wsl; Arguments = @("--list", "--verbose") }
        )
    }
    else { $report.Add("`n[WSL]`nWSL executable not found.") }
    if (Get-Command bcdedit.exe -ErrorAction SilentlyContinue) {
        # Omit the optional identifier to avoid legacy PowerShell brace quoting.
        $commands += @{ Title = "Hypervisor boot configuration (requires administrator access)"; Command = "bcdedit.exe"; Arguments = @("/enum") }
    }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $commands += @(
            @{ Title = "Docker client/server"; Command = "docker"; Arguments = @("version") },
            @{ Title = "Docker Desktop status"; Command = "docker"; Arguments = @("desktop", "status") },
            @{ Title = "Docker Desktop errors from the current boot (last 60 lines)"; Command = "docker"; Arguments = @("desktop", "logs", "--priority", "2", "--boot", "0") }
        )
    }
    else { $report.Add("`n[Docker]`nDocker executable not found.") }
    foreach ($command in $commands) {
        try {
            $probe = if ($command.Title -like "WSL *") {
                Invoke-WslProbe -Command $command.Command -Arguments $command.Arguments
            }
            else { Invoke-NativeProbe -Command $command.Command -Arguments $command.Arguments }
            $lines = $probe.Output -split "\r?\n" | Select-Object -Last 60
            if ($command.Arguments -contains "logs") {
                $lines = $lines | ForEach-Object {
                    if ($_.Length -gt 2000) { $_.Substring(0, 2000) + " [truncated; run docker desktop logs --priority 2 --boot 0 for the full entry]" }
                    else { $_ }
                }
            }
            $text = $lines -join [Environment]::NewLine
            $report.Add("`n[$($command.Title)]`nCommand: $($command.Command) $($command.Arguments -join ' ')`nExit code: $($probe.ExitCode)`n$text")
        }
        catch { $report.Add("`n[$($command.Title)]`nUnavailable: $($_.Exception.Message)") }
    }
    $report.Add("`n[Next checks]`nHypervisorPresent must be True for the local WSL 2 Docker backend. If False, check BIOS/UEFI virtualization or nested virtualization, restart Windows after enabling features, and check hypervisorlaunchtype in the boot configuration.`nCompare the WSL version results for each executable path: Docker Desktop may invoke Windows System32 directly. A working package executable alone does not confirm that this entry point works. Check fresh Docker logs after restarting Docker Desktop following a WSL update.`nIf wslEngineEnabled is False, enable 'Use the WSL 2 based engine' in Docker Desktop settings.`nFor a fresh install, open Docker Desktop and complete its initial setup. Its current-boot error log above can identify further failures.")
    $report.Add("Processor virtualization flags can report False while HypervisorPresent is True. These flags alone do not establish that BIOS virtualization is disabled.`nSome services start on demand; a Stopped state alone does not establish a failure. Docker Desktop creates its own WSL environment, so no user distribution can be normal before its first successful startup.`nDocker log timestamps ending in Z use UTC. The selected Docker boot can predate WSL setup or repair; compare timestamps and collect again after restarting Docker Desktop.")
    return $report -join [Environment]::NewLine
}

function Save-WindowsDockerDiagnostics {
    param(
        [Parameter(Mandatory = $true)][string]$Report,
        [string]$OutputFile = ""
    )
    if (-not $OutputFile) {
        $root = Split-Path -Parent $PSScriptRoot
        $OutputFile = Join-Path $root "runtime\deploy-diagnostics\windows-docker-$([DateTime]::Now.ToString('yyyyMMdd-HHmmssfff')).log"
    }
    $OutputFile = [IO.Path]::GetFullPath($OutputFile)
    $directory = Split-Path -Parent $OutputFile
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    [IO.File]::WriteAllText($OutputFile, $Report, [Text.UTF8Encoding]::new($true))
    return $OutputFile
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
    if ($Details) {
        $errors = @($Details -split "\r?\n" | Where-Object { $_ -match "(?i)error|failed|unable|denied|cannot|not running|not found" } | Select-Object -Last 8)
        if ($errors.Count -eq 0) { $errors = @($Details -split "\r?\n" | Select-Object -Last 12) }
        $message += "`nDocker diagnostic output:`n$($errors -join [Environment]::NewLine)"
    }
    if ($env:OS -eq "Windows_NT") {
        try {
            $report = Get-WindowsDockerDiagnostics
            $path = Save-WindowsDockerDiagnostics -Report $report
            $message += "`nWindows/Docker diagnostic report: $path`nRun .\diagnose-windows.ps1 to display and save a fresh report."
        }
        catch { $message += "`nCould not save Windows diagnostics: $($_.Exception.Message)" }
    }
    return $message
}
