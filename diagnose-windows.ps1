[CmdletBinding()]
param([string]$OutputFile = "")

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "This diagnostic script must run on Windows." }
. (Join-Path $PSScriptRoot "scripts\windows-docker.ps1")

Write-Host "Collecting Windows, WSL, and Docker Desktop diagnostics (read-only)..." -ForegroundColor Cyan
$report = Get-WindowsDockerDiagnostics
$path = Save-WindowsDockerDiagnostics -Report $report -OutputFile $OutputFile
Write-Output $report
Write-Host "`nDiagnostic report saved to: $path" -ForegroundColor Green
