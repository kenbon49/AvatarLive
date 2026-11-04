"""Exercise deployment orchestration without touching Docker or running services."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ.get("AVATAR_TEST_PWSH") or shutil.which("pwsh")
FAKE_COMMAND = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

command = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["FAKE_DEPLOY_LOG"], "a") as output:
    output.write(json.dumps([command, *args]) + "\n")
if command == "docker":
    state = Path(os.environ["FAKE_DEPLOY_DB_STATE"])
    if args == ["info"]:
        counter = Path(os.environ["FAKE_DEPLOY_DOCKER_COUNTER"])
        count = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(count + 1))
        if os.environ.get("FAKE_DEPLOY_DOCKER_FAIL") or count < int(os.environ.get("FAKE_DEPLOY_DOCKER_FAILURES", "0")):
            print("ERROR: Error response from daemon: Docker Desktop is unable to start", file=sys.stderr)
            sys.exit(1)
    if args == ["compose", "version"] and os.environ.get("FAKE_DEPLOY_COMPOSE_FAIL"):
        print("docker: 'compose' is not a docker command", file=sys.stderr)
        sys.exit(1)
    if args == ["version"]:
        print("Client: Docker 29.9.2")
        if os.environ.get("FAKE_DEPLOY_DOCKER_FAIL"):
            print("Docker Desktop is unable to start", file=sys.stderr)
            sys.exit(1)
    if args == ["desktop", "status"]:
        print("Docker Desktop is not running" if os.environ.get("FAKE_DEPLOY_DOCKER_FAIL") else "Docker Desktop is running")
    if args[:2] == ["desktop", "logs"]:
        print(os.environ.get("FAKE_DEPLOY_DESKTOP_LOGS", "No error logs found"))
    if "pg_isready" in args:
        counter = Path(os.environ["FAKE_DEPLOY_DB_COUNTER"])
        count = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(count + 1))
        if not state.exists() or count < int(os.environ.get("FAKE_DEPLOY_DB_FAILURES", "0")):
            print("PostgreSQL is starting or unavailable", file=sys.stderr)
            sys.exit(1)
    if "up" in args and args[-1] == "postgres":
        state.touch()
elif command == "winget" and "Microsoft.WSL" in args:
    if os.environ.get("FAKE_DEPLOY_WSL_INSTALL_FAIL"):
        print("WSL package download failed", file=sys.stderr)
        sys.exit(1)
    wsl = Path(sys.argv[0]).with_name("wsl.exe")
    wsl.write_text(Path(sys.argv[0]).read_text())
    wsl.chmod(0o755)
elif command == "wsl.exe":
    state = Path(os.environ["FAKE_DEPLOY_WSL_STATE"])
    if args == ["--version"] and Path(sys.argv[0]).parent.name == "System32" and os.environ.get("FAKE_DEPLOY_OLD_SYSTEM_WSL"):
        print("Invalid command line option: --version", file=sys.stderr)
        sys.exit(1)
    if args[0] == "--update":
        if os.environ.get("FAKE_DEPLOY_WSL_UPDATE_FAIL") or (
            "--web-download" in args and os.environ.get("FAKE_DEPLOY_WSL_WEB_FAIL")
        ):
            print("WSL kernel update failed", file=sys.stderr)
            sys.exit(1)
        state.touch()
    elif not state.exists():
        print("WSL 2 kernel file is missing", file=sys.stderr)
        sys.exit(1)
    elif args == ["--version"]:
        print("WSL version: 3.0.1.0")
elif command == "bcdedit.exe":
    print("hypervisorlaunchtype    Auto")
elif command == "curl" and args[-1].endswith("/login"):
    if os.environ.get("FAKE_DEPLOY_WEB_FAIL"):
        sys.exit(22)
    counter = Path(os.environ["FAKE_DEPLOY_LOGIN_COUNTER"])
    count = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(count + 1))
    if count < int(os.environ.get("FAKE_DEPLOY_LOGIN_FAILURES", "0")):
        sys.exit(22)
'''
PWSH_WRAPPER = r'''
param([string]$Target, [string]$Mode, [string]$EnvFile)
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
# Reproduce Windows PowerShell 5.1's native stderr error records on PowerShell 7.
if ($env:FAKE_DEPLOY_WINDOWS_STDERR) {
    function docker {
        $output = & $env:FAKE_DEPLOY_DOCKER @args 2>&1
        $dockerExitCode = $LASTEXITCODE
        if ($dockerExitCode -ne 0) { Write-Error ($output -join "`n") }
        else { $output }
        $global:LASTEXITCODE = $dockerExitCode
    }
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [int]$TimeoutSec, [int]$MaximumRedirection)
    & $env:FAKE_DEPLOY_CURL $Uri
    if ($LASTEXITCODE -ne 0) { throw "Page is not ready" }
    return [pscustomobject]@{ StatusCode = 200 }
}
function Start-Sleep { param([int]$Seconds) }
if ($env:FAKE_DEPLOY_TEST_WSL) {
    if ($env:FAKE_DEPLOY_WSL_REBOOT_CODE) {
        function winget {
            & $env:FAKE_DEPLOY_WINGET @args
            if ("Microsoft.WSL" -in $args) { $global:LASTEXITCODE = [int]$env:FAKE_DEPLOY_WSL_REBOOT_CODE }
        }
    }
    function Get-CimInstance {
        param([string]$ClassName, [string]$Filter, [string]$ErrorAction)
        switch ($ClassName) {
            "Win32_OptionalFeature" {
                $state = if ($env:FAKE_DEPLOY_FEATURE_STATE -eq "Enabled") { 1 } else { 2 }
                return @(
                    [pscustomobject]@{ Name = "Microsoft-Windows-Subsystem-Linux"; InstallState = $state },
                    [pscustomobject]@{ Name = "VirtualMachinePlatform"; InstallState = $state }
                )
            }
            "Win32_ComputerSystem" {
                return [pscustomobject]@{ HypervisorPresent = -not [bool]$env:FAKE_DEPLOY_NO_HYPERVISOR; Manufacturer = "Test manufacturer"; Model = "Test computer" }
            }
            "Win32_Processor" {
                return [pscustomobject]@{ Name = "Test CPU"; VirtualizationFirmwareEnabled = -not [bool]$env:FAKE_DEPLOY_NO_HYPERVISOR; SecondLevelAddressTranslationExtensions = $true; VMMonitorModeExtensions = $true }
            }
            "Win32_OperatingSystem" {
                return [pscustomobject]@{ Caption = "Test Windows"; Version = "10.0.22631"; BuildNumber = "22631"; LastBootUpTime = [datetime]"2026-11-01" }
            }
            default { throw "Unexpected CIM class $ClassName" }
        }
    }
    function Get-Service {
        param([string[]]$Name, [string]$ErrorAction)
        return [pscustomobject]@{ Name = "vmcompute"; Status = "Running"; StartType = "Manual" }
    }
    function Get-WindowsOptionalFeature {
        param([switch]$Online, [string]$FeatureName, [string]$ErrorAction)
        return [pscustomobject]@{ State = $env:FAKE_DEPLOY_FEATURE_STATE }
    }
    function Enable-WindowsOptionalFeature {
        param([switch]$Online, [string]$FeatureName, [switch]$All, [switch]$NoRestart, [string]$ErrorAction)
        & $env:FAKE_DEPLOY_FEATURE_EVENT $FeatureName
        return [pscustomobject]@{ RestartNeeded = $true }
    }
    function Start-Process {
        param([string]$FilePath, [string]$Verb, [switch]$Wait, [switch]$PassThru, [string[]]$ArgumentList)
        if ($Verb -ne "RunAs" -or -not $Wait -or -not $PassThru) { throw "WSL setup was not elevated" }
        & $env:FAKE_DEPLOY_FEATURE_EVENT "elevate"
        if ($env:FAKE_DEPLOY_ELEVATION_FAIL) { throw "Elevation was cancelled" }
        $command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($ArgumentList[-1]))
        Invoke-Expression $command
    }
}
switch ($Mode) {
    "init" { & $Target -EnvFile $EnvFile -InitOnly }
    "first" { & $Target -EnvFile $EnvFile -WithPostgres }
    "install" { & $Target -EnvFile $EnvFile -Install }
    "check" { & $Target -EnvFile $EnvFile -Check; exit $LASTEXITCODE }
    "postgres" { & $Target -EnvFile $EnvFile }
    "diagnose" { & $Target -OutputFile $EnvFile }
    "core" { & $Target -EnvFile $EnvFile }
    default { throw "Unexpected test mode" }
}
if ($ErrorActionPreference -ne "Stop" -or -not $PSNativeCommandUseErrorActionPreference) {
    throw "Docker probes changed the caller's error preferences"
}
'''


@unittest.skipUnless(shutil.which("bash"), "Bash is unavailable")
class DeploymentScriptTests(unittest.TestCase):
    engine = "bash"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="avatarlive-deploy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.repo = self.directory / "repo with spaces"
        self.repo.mkdir()
        for name in ("deploy.sh", "deploy-postgres.sh", "deploy.ps1", "deploy-postgres.ps1", "diagnose-windows.ps1", ".env.example"):
            shutil.copy2(ROOT / name, self.repo / name)
        (self.repo / "scripts").mkdir()
        for name in ("windows-docker.ps1", "install-wsl.ps1"):
            shutil.copy2(ROOT / "scripts" / name, self.repo / "scripts" / name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        for name in ("docker", "curl", "sleep", "winget", "feature-event"):
            command = self.bin / name
            command.write_text(FAKE_COMMAND)
            command.chmod(0o755)
        self.log = self.directory / "commands.jsonl"
        self.state = self.directory / "database-running"
        self.env = dict(
            os.environ,
            PATH=str(self.bin) + os.pathsep + os.environ.get("PATH", ""),
            FAKE_DEPLOY_LOG=str(self.log),
            FAKE_DEPLOY_DB_STATE=str(self.state),
            FAKE_DEPLOY_DOCKER_COUNTER=str(self.directory / "docker-attempts"),
            FAKE_DEPLOY_DB_COUNTER=str(self.directory / "database-attempts"),
            FAKE_DEPLOY_LOGIN_COUNTER=str(self.directory / "login-attempts"),
            FAKE_DEPLOY_DOCKER=str(self.bin / "docker"),
            FAKE_DEPLOY_WINGET=str(self.bin / "winget"),
            FAKE_DEPLOY_WSL_STATE=str(self.directory / "wsl-kernel-ready"),
            FAKE_DEPLOY_FEATURE_EVENT=str(self.bin / "feature-event"),
            FAKE_DEPLOY_CURL=str(self.bin / "curl"),
            ProgramFiles=str(self.directory),
        )
        self.wrapper = self.directory / "run.ps1"
        self.wrapper.write_text(PWSH_WRAPPER)

    def deploy(self, mode: str, env_file: str = "") -> subprocess.CompletedProcess:
        if self.engine == "bash":
            options = {"init": ["--init-only"], "first": ["--with-postgres"], "core": []}[mode]
            command = ["bash", str(self.repo / "deploy.sh"), *options]
            if env_file:
                command += ["--env-file", env_file]
        else:
            target = {"postgres": "deploy-postgres.ps1", "diagnose": "diagnose-windows.ps1"}.get(mode, "deploy.ps1")
            command = [PWSH, "-NoProfile", "-File", str(self.wrapper),
                       "-Target", str(self.repo / target), "-Mode", mode, "-EnvFile", env_file]
        return subprocess.run(command, cwd=self.directory, env=self.env, capture_output=True, text=True, timeout=45)

    def commands(self) -> list[list[str]]:
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def assert_success(self, result: subprocess.CompletedProcess) -> None:
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_env_is_initialized_once(self) -> None:
        self.assert_success(self.deploy("init"))
        path = self.repo / ".env"
        content = path.read_bytes()
        values = dict(line.split("=", 1) for line in content.decode().splitlines()
                      if line and not line.startswith("#") and "=" in line)
        self.assertTrue(values["POSTGRES_PASSWORD"])
        self.assertIn(values["POSTGRES_PASSWORD"], values["DATABASE_URL"])
        self.assertEqual(len(base64.urlsafe_b64decode(values["PLATFORM_ENCRYPTION_KEY"])), 32)
        self.assertEqual(values["LLM_BASE_URL"], "https://api.deepseek.com")
        self.assertEqual(values["LLM_API_KEY"], "")
        self.assertEqual(values["ALIYUN_ACCESS_KEY_SECRET"], "")
        if self.engine == "bash":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assert_success(self.deploy("init"))
        self.assertEqual(path.read_bytes(), content)
        self.assertEqual(self.commands(), [])

    def test_first_deploy_starts_database_before_application(self) -> None:
        self.assert_success(self.deploy("first"))
        commands = self.commands()
        starts = [args for args in commands if args[0] == "docker" and "up" in args]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0][-1], "postgres")
        self.assertIn("--build", starts[1])
        self.assertTrue(any(args[-1].endswith("/health/ready") for args in commands))
        self.assertTrue(any(args[-1].endswith("/login") for args in commands))

    def test_core_deploy_requires_database(self) -> None:
        result = self.deploy("core")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PostgreSQL is not ready", result.stdout + result.stderr)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_core_update_leaves_database_lifecycle_alone(self) -> None:
        self.state.touch()
        self.assert_success(self.deploy("core"))
        starts = [args for args in self.commands() if args[0] == "docker" and "up" in args]
        self.assertEqual(len(starts), 1)
        self.assertNotEqual(starts[0][-1], "postgres")

    def test_relative_env_path_is_resolved_for_compose(self) -> None:
        self.assert_success(self.deploy("first", "custom config.env"))
        expected = str(self.directory / "custom config.env")
        for args in self.commands():
            if args[0] == "docker" and "--env-file" in args:
                self.assertEqual(args[args.index("--env-file") + 1], expected)

    def test_success_waits_for_login_page(self) -> None:
        self.env["FAKE_DEPLOY_LOGIN_FAILURES"] = "1"
        self.assert_success(self.deploy("first"))
        attempts = [args for args in self.commands() if args[0] == "curl" and args[-1].endswith("/login")]
        self.assertGreaterEqual(len(attempts), 2)

    def test_api_ready_with_broken_frontend_is_failure(self) -> None:
        self.env["FAKE_DEPLOY_WEB_FAIL"] = "1"
        result = self.deploy("first")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("AvatarLive is ready:", result.stdout)
        self.assertIn("did not become ready", result.stdout + result.stderr)


@unittest.skipUnless(PWSH, "PowerShell is unavailable")
class PowerShellDeploymentScriptTests(DeploymentScriptTests):
    engine = "powershell"

    def setUp(self) -> None:
        super().setUp()
        self.env["FAKE_DEPLOY_WINDOWS_STDERR"] = "1"

    def test_install_also_deploys_database(self) -> None:
        self.assert_success(self.deploy("install"))
        starts = [args for args in self.commands() if args[0] == "docker" and "up" in args]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0][-1], "postgres")

    def test_install_retries_docker_startup_errors(self) -> None:
        self.env["FAKE_DEPLOY_DOCKER_FAILURES"] = "2"
        self.assert_success(self.deploy("install"))
        probes = [args for args in self.commands() if args == ["docker", "info"]]
        self.assertGreaterEqual(len(probes), 3)

    def test_install_reports_persistent_docker_failure_before_starting_containers(self) -> None:
        self.env["FAKE_DEPLOY_DOCKER_FAIL"] = "1"
        result = self.deploy("install")
        self.assertNotEqual(result.returncode, 0)
        output = result.stdout + result.stderr
        self.assertIn("Docker Desktop did not become ready", output)
        self.assertIn("Docker Desktop is unable to start", output)
        self.assertIn("wsl --status", output)
        self.assertGreater(len([args for args in self.commands() if args == ["docker", "info"]]), 1)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_check_reports_docker_failure_without_retrying_or_deploying(self) -> None:
        self.env["FAKE_DEPLOY_DOCKER_FAIL"] = "1"
        result = self.deploy("check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Environment check found", result.stdout)
        self.assertIn("Docker Desktop is unable to start", result.stdout)
        self.assertEqual(len([args for args in self.commands() if args == ["docker", "info"]]), 1)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_check_reports_missing_compose(self) -> None:
        self.env["FAKE_DEPLOY_COMPOSE_FAIL"] = "1"
        result = self.deploy("check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker Compose v2 is unavailable", result.stdout)
        self.assertIn("'compose' is not a docker command", result.stdout)

    def test_postgres_deploy_retries_database_startup_errors(self) -> None:
        self.env["FAKE_DEPLOY_DB_FAILURES"] = "2"
        self.assert_success(self.deploy("postgres"))
        self.assertGreaterEqual(len([args for args in self.commands() if "pg_isready" in args]), 3)

    def test_postgres_deploy_reports_docker_startup_failure(self) -> None:
        self.env["FAKE_DEPLOY_DOCKER_FAIL"] = "1"
        result = self.deploy("postgres")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker Desktop is not ready", result.stdout + result.stderr)
        self.assertIn("Docker Desktop is unable to start", result.stdout + result.stderr)
        self.assertFalse(any("up" in args for args in self.commands()))

    def prepare_windows_wsl(self, *, installed: bool = True, ready: bool = False) -> None:
        self.env.update(OS="Windows_NT", FAKE_DEPLOY_TEST_WSL="1", FAKE_DEPLOY_FEATURE_STATE="Enabled")
        if installed:
            shutil.copy2(self.bin / "winget", self.bin / "wsl.exe")
        if ready:
            Path(self.env["FAKE_DEPLOY_WSL_STATE"]).touch()

    def test_install_reuses_healthy_wsl_without_elevation(self) -> None:
        self.prepare_windows_wsl(ready=True)
        self.assert_success(self.deploy("install"))
        self.assertFalse(any(args[0] == "feature-event" for args in self.commands()))
        self.assertFalse(any("Microsoft.WSL" in args for args in self.commands()))
        self.assertTrue(any("up" in args for args in self.commands()))

    def test_install_repairs_missing_wsl_kernel_and_continues(self) -> None:
        self.prepare_windows_wsl()
        self.assert_success(self.deploy("install"))
        self.assertIn(["feature-event", "elevate"], self.commands())
        self.assertIn(["wsl.exe", "--update", "--web-download"], self.commands())
        self.assertIn(["wsl.exe", "--set-default-version", "2"], self.commands())
        self.assertTrue(any("up" in args for args in self.commands()))

    def test_install_adds_missing_wsl_without_a_distribution(self) -> None:
        self.prepare_windows_wsl(installed=False)
        self.assert_success(self.deploy("install"))
        self.assertTrue(any(args[0] == "winget" and "Microsoft.WSL" in args for args in self.commands()))
        self.assertFalse(any("--install" in args for args in self.commands() if args[0] == "wsl.exe"))
        self.assertTrue(any("up" in args for args in self.commands()))

    def test_install_stops_for_reboot_after_enabling_wsl_features(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_FEATURE_STATE"] = "Disabled"
        result = self.deploy("install")
        self.assert_success(result)
        self.assertIn("Restart Windows", result.stdout)
        self.assertIn(["feature-event", "Microsoft-Windows-Subsystem-Linux"], self.commands())
        self.assertIn(["feature-event", "VirtualMachinePlatform"], self.commands())
        self.assertFalse(any("up" in args for args in self.commands()))
        self.assertFalse(any(args[0] == "docker" for args in self.commands()))

    def test_install_honors_pending_wsl_feature_reboot(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_FEATURE_STATE"] = "EnablePending"
        result = self.deploy("install")
        self.assert_success(result)
        self.assertIn("Restart Windows", result.stdout)
        self.assertFalse(any(args[0] == "feature-event" and args[-1] != "elevate" for args in self.commands()))
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_install_enables_features_even_when_wsl_kernel_is_healthy(self) -> None:
        self.prepare_windows_wsl(ready=True)
        self.env["FAKE_DEPLOY_FEATURE_STATE"] = "Disabled"
        result = self.deploy("install")
        self.assert_success(result)
        self.assertIn("Restart Windows", result.stdout)
        self.assertIn(["feature-event", "VirtualMachinePlatform"], self.commands())
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_install_honors_winget_reboot_result(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_WSL_REBOOT_CODE"] = str(0x8A150109 - 2**32)
        result = self.deploy("install")
        self.assert_success(result)
        self.assertIn("Restart Windows", result.stdout)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_wsl_elevation_preserves_quotes_and_non_ascii_paths(self) -> None:
        self.prepare_windows_wsl()
        renamed = self.directory / "repo with spaces '中文"
        self.repo.rename(renamed)
        self.repo = renamed
        self.assert_success(self.deploy("install"))
        self.assertTrue(any("up" in args for args in self.commands()))

    def test_install_falls_back_when_wsl_web_update_is_unsupported(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_WSL_WEB_FAIL"] = "1"
        self.assert_success(self.deploy("install"))
        self.assertIn(["wsl.exe", "--update"], self.commands())

    def test_install_reports_wsl_update_failure_without_deploying(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_WSL_UPDATE_FAIL"] = "1"
        result = self.deploy("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WSL kernel update failed", result.stdout + result.stderr)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_install_reports_wsl_package_failure_without_deploying(self) -> None:
        self.prepare_windows_wsl(installed=False)
        self.env["FAKE_DEPLOY_WSL_INSTALL_FAIL"] = "1"
        result = self.deploy("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WSL package download failed", result.stdout + result.stderr)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_install_stops_if_administrator_elevation_is_cancelled(self) -> None:
        self.prepare_windows_wsl()
        self.env["FAKE_DEPLOY_ELEVATION_FAIL"] = "1"
        result = self.deploy("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Elevation was cancelled", result.stdout + result.stderr)
        self.assertFalse(any("Microsoft.WSL" in args or "up" in args for args in self.commands()))

    def test_check_does_not_install_or_repair_wsl(self) -> None:
        self.prepare_windows_wsl(installed=False)
        self.env["FAKE_DEPLOY_DOCKER_FAIL"] = "1"
        result = self.deploy("check")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("Microsoft.WSL" in args or args[0] == "feature-event" for args in self.commands()))

    def test_diagnostics_collect_startup_errors_without_changing_system_state(self) -> None:
        self.prepare_windows_wsl()
        shutil.copy2(self.bin / "winget", self.bin / "bcdedit.exe")
        self.env.update(FAKE_DEPLOY_NO_HYPERVISOR="1", FAKE_DEPLOY_DOCKER_FAIL="1",
                        FAKE_DEPLOY_DESKTOP_LOGS="HCS_E_HYPERV_NOT_INSTALLED: virtualization unavailable")
        path = self.directory / "diagnostic report.log"
        result = self.deploy("diagnose", str(path))
        self.assert_success(result)
        report = path.read_text(encoding="utf-8-sig")
        for expected in ("Test Windows", "HypervisorPresent : False", "WSL 2 kernel file is missing",
                         "HCS_E_HYPERV_NOT_INSTALLED", "hypervisorlaunchtype    Auto"):
            self.assertIn(expected, report)
        self.assertFalse(any(args[0] in ("winget", "feature-event") or "up" in args or "--update" in args
                             or "--set-default-version" in args or "--shutdown" in args for args in self.commands()))
        self.assertIn(["docker", "desktop", "logs", "--priority", "2", "--boot", "0"], self.commands())

    def test_diagnostics_save_report_when_wsl_is_not_installed(self) -> None:
        self.prepare_windows_wsl(installed=False)
        result = self.deploy("diagnose")
        self.assert_success(result)
        self.assertIn("WSL executable not found", result.stdout)
        self.assertEqual(len(list((self.repo / "runtime/deploy-diagnostics").glob("*.log"))), 1)
        self.assertFalse(any("Microsoft.WSL" in args or "up" in args for args in self.commands()))

    def test_diagnostics_read_backend_setting_without_dumping_other_settings(self) -> None:
        self.prepare_windows_wsl(ready=True)
        appdata = self.directory / "appdata"
        (appdata / "Docker").mkdir(parents=True)
        settings = appdata / "Docker/settings-store.json"
        content = json.dumps({"wslEngineEnabled": False, "password": "private-setting-must-not-appear"})
        settings.write_text(content)
        self.env["APPDATA"] = str(appdata)
        result = self.deploy("diagnose")
        self.assert_success(result)
        self.assertIn("wslEngineEnabled: False", result.stdout)
        self.assertNotIn("private-setting-must-not-appear", result.stdout)
        self.assertEqual(settings.read_text(), content)

    def test_diagnostics_compare_package_system_and_path_wsl_versions(self) -> None:
        self.prepare_windows_wsl(ready=True)
        system_root = self.directory / "Windows"
        system_wsl = system_root / "System32/wsl.exe"
        package_wsl = self.directory / "WSL/wsl.exe"
        for path in (system_wsl, package_wsl):
            path.parent.mkdir(parents=True)
            shutil.copy2(self.bin / "wsl.exe", path)
        self.env.update(WINDIR=str(system_root), FAKE_DEPLOY_OLD_SYSTEM_WSL="1")
        report_path = self.directory / "wsl-entries.log"
        result = self.deploy("diagnose", str(report_path))
        self.assert_success(result)
        report = report_path.read_text(encoding="utf-8-sig")
        for path in (system_wsl, package_wsl, self.bin / "wsl.exe"):
            self.assertIn(f"Command: {path} --version", report)
        self.assertIn("WSL version: 3.0.1.0", report)
        self.assertIn("Exit code: 1\nInvalid command line option: --version", report)
        self.assertIn("Docker Desktop errors from the current boot", report)
        self.assertFalse(any("--update" in args or "--shutdown" in args or "--set-default-version" in args
                             or args[0] in ("winget", "feature-event") for args in self.commands()))

    def test_diagnostics_bound_desktop_log_output(self) -> None:
        self.prepare_windows_wsl(ready=True)
        self.env["FAKE_DEPLOY_DESKTOP_LOGS"] = "\n".join(f"desktop-error-{index:03d}" for index in range(150))
        result = self.deploy("diagnose")
        self.assert_success(result)
        self.assertIn("desktop-error-149", result.stdout)
        self.assertNotIn("desktop-error-000", result.stdout)

    def test_startup_failure_saves_windows_diagnostics(self) -> None:
        self.prepare_windows_wsl(ready=True)
        self.env.update(FAKE_DEPLOY_DOCKER_FAIL="1", FAKE_DEPLOY_DESKTOP_LOGS="Docker backend startup failure detail")
        result = self.deploy("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("diagnose-windows.ps1", result.stdout + result.stderr)
        reports = list((self.repo / "runtime/deploy-diagnostics").glob("*.log"))
        self.assertEqual(len(reports), 1)
        self.assertIn("Docker backend startup failure detail", reports[0].read_text(encoding="utf-8-sig"))
        self.assertFalse(any("up" in args for args in self.commands()))


if __name__ == "__main__":
    unittest.main()
