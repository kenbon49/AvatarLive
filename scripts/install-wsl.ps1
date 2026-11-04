[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ResultFile)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-docker.ps1")
$result = [ordered]@{ Ready = $false; RebootRequired = $false; Error = ""; Details = "" }
$details = [System.Collections.Generic.List[string]]::new()
try {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is unavailable in the administrator session. Install App Installer for that account, then rerun .\deploy.ps1 -Install."
    }
    foreach ($name in @("Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform")) {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction Stop
        if ($feature.State -eq "EnablePending") {
            $result.RebootRequired = $true
        }
        elseif ($feature.State -ne "Enabled") {
            Write-Host "Enabling $name..." -ForegroundColor Cyan
            $change = Enable-WindowsOptionalFeature -Online -FeatureName $name -All -NoRestart -ErrorAction Stop
            if ($change.RestartNeeded) { $result.RebootRequired = $true }
        }
    }

    # The WSL package includes its kernel and installs no Linux distribution.
    # This also upgrades older inbox WSL versions that lack --web-download.
    Write-Host "Installing/updating Microsoft WSL with winget..." -ForegroundColor Cyan
    $install = Invoke-NativeProbe -Command "winget" -Arguments @(
        "install", "--id", "Microsoft.WSL", "--exact", "--source", "winget",
        "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"
    )
    $details.Add("WSL package installation:`n$($install.Output)")
    # winget maps MSI reboot results to its own HRESULTs.
    if ($install.ExitCode -in @(3010, 1641, 0x8A150109, 0x8A15010A, 0x8A15010B)) {
        $result.RebootRequired = $true
    }
    $wsl = Get-WslCommand
    if (-not $wsl) {
        if (-not $result.RebootRequired) { throw "WSL installation failed (winget exit code $($install.ExitCode))." }
    }
    else {
        Write-Host "Updating the WSL kernel..." -ForegroundColor Cyan
        # Prefer a direct download so paused Windows Update does not block repair.
        $update = Invoke-NativeProbe -Command $wsl -Arguments @("--update", "--web-download")
        $details.Add("WSL direct update:`n$($update.Output)")
        if ($update.ExitCode -ne 0) {
            $update = Invoke-NativeProbe -Command $wsl -Arguments @("--update")
            $details.Add("WSL update fallback:`n$($update.Output)")
        }
        if ($update.ExitCode -ne 0 -and -not $result.RebootRequired) {
            throw "WSL kernel update failed (exit code $($update.ExitCode))."
        }

        $default = Invoke-NativeProbe -Command $wsl -Arguments @("--set-default-version", "2")
        $details.Add("WSL default version:`n$($default.Output)")
        $status = Invoke-NativeProbe -Command $wsl -Arguments @("--status")
        $details.Add("WSL status:`n$($status.Output)")
        if (($default.ExitCode -ne 0 -or $status.ExitCode -ne 0) -and -not $result.RebootRequired) {
            throw "WSL 2 is still unavailable. Check BIOS/UEFI hardware virtualization and the WSL diagnostic output."
        }
        $result.Ready = (-not $result.RebootRequired -and $default.ExitCode -eq 0 -and $status.ExitCode -eq 0)
    }
}
catch { $result.Error = $_.Exception.Message }
finally {
    $result.Details = $details -join "`n"
    [IO.File]::WriteAllText($ResultFile, ($result | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
}
