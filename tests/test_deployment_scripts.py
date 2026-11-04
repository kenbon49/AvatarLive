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
    if "pg_isready" in args:
        sys.exit(0 if state.exists() else 1)
    if "up" in args and args[-1] == "postgres":
        state.touch()
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
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [int]$TimeoutSec, [int]$MaximumRedirection)
    & $env:FAKE_DEPLOY_CURL $Uri
    if ($LASTEXITCODE -ne 0) { throw "Page is not ready" }
    return [pscustomobject]@{ StatusCode = 200 }
}
function Start-Sleep { param([int]$Seconds) }
switch ($Mode) {
    "init" { & $Target -EnvFile $EnvFile -InitOnly }
    "first" { & $Target -EnvFile $EnvFile -WithPostgres }
    "install" { & $Target -EnvFile $EnvFile -Install }
    "core" { & $Target -EnvFile $EnvFile }
    default { throw "Unexpected test mode" }
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
        for name in ("deploy.sh", "deploy-postgres.sh", "deploy.ps1", "deploy-postgres.ps1", ".env.example"):
            shutil.copy2(ROOT / name, self.repo / name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        for name in ("docker", "curl", "sleep", "winget"):
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
            FAKE_DEPLOY_LOGIN_COUNTER=str(self.directory / "login-attempts"),
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
            command = [PWSH, "-NoProfile", "-File", str(self.wrapper),
                       "-Target", str(self.repo / "deploy.ps1"), "-Mode", mode, "-EnvFile", env_file]
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

    def test_install_also_deploys_database(self) -> None:
        self.assert_success(self.deploy("install"))
        starts = [args for args in self.commands() if args[0] == "docker" and "up" in args]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0][-1], "postgres")


if __name__ == "__main__":
    unittest.main()
