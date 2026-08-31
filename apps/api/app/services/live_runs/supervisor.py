"""Small, process-isolated media supervisor for live runs.

The first media source is deliberately a server-side test pattern. It proves
the SRS/FFmpeg lifecycle without pretending that a browser canvas is a
production ingest source. Each external RTMP target gets its own FFmpeg
process so one platform can fail without taking down the source or siblings.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from loguru import logger

from ...core.config import settings
from ...db.session import SessionLocal
from ...models.live_room import utc_now
from ...models.live_run import LiveRun
from ...repositories.live_runs import list_live_run_targets
from ...security import SecretDecryptionError, SecretConfigurationError, decrypt_secret


TERMINAL_TARGET_STATUSES = {"stopped", "failed"}
TERMINAL_RUN_STATUSES = {"stopped", "failed"}


@dataclass
class _ManagedTarget:
    target_id: str
    process: subprocess.Popen[bytes]
    command: tuple[str, ...]
    next_retry_at: float = 0.0


@dataclass
class _ManagedRun:
    run_id: str
    source: subprocess.Popen[bytes]
    source_command: tuple[str, ...]
    targets: dict[str, _ManagedTarget] = field(default_factory=dict)
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


def _output_dimensions(config: dict) -> tuple[int, int]:
    resolution = str(config.get("outputConfig", {}).get("resolution", "1080p")).lower()
    return (1920, 1080) if resolution in {"1080p", "1080"} else (1280, 720)


def _source_command(output_url: str, config: dict) -> tuple[str, ...]:
    width, height = _output_dimensions(config)
    frame_rate = str(config.get("outputConfig", {}).get("frameRate", "25 fps"))
    rate = frame_rate.split()[0] if frame_rate.split() else "25"
    # lavfi keeps the smoke source self-contained; no user-controlled shell is
    # involved and the output URL never contains a credential.
    return (
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={width}x{height}:rate={rate}",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=48000",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        str(max(2, int(float(rate) * 2))),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "flv",
        output_url,
    )


def _target_command(source_url: str, server_url: str, stream_key: str) -> tuple[str, ...]:
    target_url = f"{server_url.rstrip('/')}/{stream_key}"
    return (
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-rw_timeout",
        "15000000",
        "-i",
        source_url,
        "-c",
        "copy",
        "-f",
        "flv",
        target_url,
    )


def _terminate(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        # FFmpeg is started in its own session so child processes cannot leak
        # after an emergency stop.
        os.killpg(process.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            process.terminate()
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=4)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                process.kill()
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass


class MediaSupervisor:
    """Own FFmpeg processes and persist truthful run/target state."""

    def __init__(
        self,
        *,
        popen: Callable[..., subprocess.Popen[bytes]] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._popen = popen or subprocess.Popen
        self._sleep = sleep
        self._lock = threading.RLock()
        self._runs: dict[str, _ManagedRun] = {}

    @property
    def active_run_ids(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._runs)

    def start(self, run_id: str) -> LiveRun:
        if not settings.media_supervisor_enabled:
            raise RuntimeError("媒体 supervisor 已由服务端配置禁用")
        with self._lock:
            if run_id in self._runs:
                return self._load_run(run_id)
            with SessionLocal() as db:
                run = db.get(LiveRun, run_id)
                if run is None:
                    raise LookupError("live run not found")
                if run.status in {"live", "starting"}:
                    return run
                if run.status in TERMINAL_RUN_STATUSES or run.status == "stopping":
                    raise RuntimeError(f"live run cannot be started from {run.status}")
                if run.media_source_kind != "test_pattern":
                    self._fail_run(db, run, "media_source_unavailable", "当前媒体源尚未接入服务端媒体网关")
                    return run
                if not settings.live_run_allow_test_pattern:
                    self._fail_run(db, run, "test_pattern_disabled", "服务端未启用测试画面源")
                    return run

                targets = list_live_run_targets(db, run.id)
                if not targets:
                    self._fail_run(db, run, "no_targets", "没有可启动的推流目标")
                    return run
                run.status = "starting"
                run.error_code = None
                run.error_message = None
                now = utc_now()
                for target in targets:
                    target.status = "starting"
                    target.error_code = None
                    target.error_message = None
                    target.updated_at = now
                run.updated_at = now
                db.commit()
                db.refresh(run)

                source_url = f"{settings.srs_internal_rtmp_url.rstrip('/')}/{run.id}"
                source_command = _source_command(source_url, run.config_snapshot)
                try:
                    source = self._spawn(source_command)
                except (OSError, ValueError) as exc:
                    self._fail_run(db, run, "source_start_failed", "内部媒体源启动失败")
                    logger.error("live run {} source start failed: {}", run.id, type(exc).__name__)
                    return run
                run.source_process_pid = source.pid
                run.status = "live"
                run.started_at = now
                run.heartbeat_at = now
                managed = _ManagedRun(run.id, source, source_command)
                for target in targets:
                    try:
                        stream_key = decrypt_secret(target.stream_key_ciphertext, target.platform_connection_id)
                        command = _target_command(source_url, target.server_url, stream_key)
                        process = self._spawn(command)
                    except (SecretConfigurationError, SecretDecryptionError):
                        target.status = "failed"
                        target.error_code = "credential_unavailable"
                        target.error_message = "推流凭据无法安全读取"
                        target.stopped_at = now
                        target.updated_at = now
                        continue
                    except (OSError, ValueError) as exc:
                        target.status = "failed"
                        target.error_code = "target_start_failed"
                        target.error_message = "推流进程启动失败"
                        target.stopped_at = now
                        target.updated_at = now
                        logger.error("live run {} target {} start failed: {}", run.id, target.id, type(exc).__name__)
                        continue
                    target.status = "live"
                    target.process_pid = process.pid
                    target.started_at = now
                    target.updated_at = now
                    managed.targets[target.id] = _ManagedTarget(target.id, process, command)
                if not managed.targets:
                    _terminate(source)
                    run.source_process_pid = None
                    self._fail_run(db, run, "all_targets_failed", "所有推流目标均未能启动")
                    return run
                db.commit()
                db.refresh(run)
            managed.thread = threading.Thread(target=self._monitor, args=(managed,), name=f"live-run-{run_id}", daemon=True)
            self._runs[run_id] = managed
            managed.thread.start()
            return self._load_run(run_id)

    def stop(self, run_id: str) -> LiveRun:
        with self._lock:
            managed = self._runs.get(run_id)
            if managed:
                managed.stop_event.set()
                # Marking the database first makes a concurrent monitor loop
                # converge on the same terminal state.
                with SessionLocal() as db:
                    run = db.get(LiveRun, run_id)
                    if run and run.status not in TERMINAL_RUN_STATUSES:
                        run.status = "stopping"
                        now = utc_now()
                        for target in list_live_run_targets(db, run_id):
                            if target.status not in TERMINAL_TARGET_STATUSES:
                                target.status = "stopping"
                                target.updated_at = now
                        run.updated_at = now
                        db.commit()
                return self._load_run(run_id)
        # If the API restarted between the stop request and supervisor
        # registration there are no child PIDs left to reap; close the row
        # instead of leaving it permanently in `stopping`.
        with SessionLocal() as db:
            run = db.get(LiveRun, run_id)
            if run is None:
                raise LookupError("live run not found")
            if run.status == "stopping":
                now = utc_now()
                run.status = "stopped"
                run.stopped_at = now
                run.heartbeat_at = now
                run.updated_at = now
                for target in list_live_run_targets(db, run_id):
                    if target.status not in TERMINAL_TARGET_STATUSES:
                        target.status = "stopped"
                    target.process_pid = None
                    target.stopped_at = now
                    target.updated_at = now
                db.commit()
                db.refresh(run)
            return run

    def shutdown(self) -> None:
        with self._lock:
            managed_runs = list(self._runs.values())
        for managed in managed_runs:
            try:
                managed.stop_event.set()
                _terminate(managed.source)
                for item in managed.targets.values():
                    _terminate(item.process)
                if managed.thread and managed.thread is not threading.current_thread():
                    managed.thread.join(timeout=6)
            except Exception:  # pragma: no cover - defensive shutdown path
                logger.exception("failed to stop live run {} during shutdown", managed.run_id)

    def recover_orphaned_runs(self) -> int:
        """Mark active rows from a previous API process as failed."""
        count = 0
        with SessionLocal() as db:
            rows = list(db.query(LiveRun).filter(LiveRun.status.in_(('starting', 'live', 'stopping'))))
            now = utc_now()
            for run in rows:
                run.status = "failed"
                run.error_code = "supervisor_restarted"
                run.error_message = "媒体 supervisor 重启，原运行已安全终止"
                run.stopped_at = now
                run.source_process_pid = None
                for target in list_live_run_targets(db, run.id):
                    if target.status not in TERMINAL_TARGET_STATUSES:
                        target.status = "failed"
                        target.error_code = "supervisor_restarted"
                        target.error_message = "媒体 supervisor 重启，原推流已终止"
                        target.process_pid = None
                        target.stopped_at = now
                    target.updated_at = now
                run.updated_at = now
                count += 1
            if count:
                db.commit()
        return count

    def _spawn(self, command: tuple[str, ...]) -> subprocess.Popen[bytes]:
        return self._popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    def _load_run(self, run_id: str) -> LiveRun:
        with SessionLocal() as db:
            run = db.get(LiveRun, run_id)
            if run is None:
                raise LookupError("live run not found")
            return run

    @staticmethod
    def _fail_run(db, run: LiveRun, code: str, message: str) -> None:
        now = utc_now()
        run.status = "failed"
        run.error_code = code
        run.error_message = message
        run.stopped_at = now
        run.updated_at = now
        for target in list_live_run_targets(db, run.id):
            if target.status not in TERMINAL_TARGET_STATUSES:
                target.status = "failed"
                target.error_code = code
                target.error_message = message
                target.stopped_at = now
                target.updated_at = now
        db.commit()
        db.refresh(run)

    def _monitor(self, managed: _ManagedRun) -> None:
        try:
            while True:
                with SessionLocal() as db:
                    run = db.get(LiveRun, managed.run_id)
                    if run is None:
                        break
                    targets = {target.id: target for target in list_live_run_targets(db, managed.run_id)}
                    stopping = managed.stop_event.is_set() or run.status == "stopping"
                    now = utc_now()

                    if stopping:
                        _terminate(managed.source)
                        for item in list(managed.targets.values()):
                            _terminate(item.process)
                        run.source_process_pid = None
                        run.status = "stopped"
                        run.stopped_at = now
                        run.heartbeat_at = now
                        for target in targets.values():
                            if target.status not in TERMINAL_TARGET_STATUSES:
                                target.status = "stopped"
                            target.process_pid = None
                            target.stopped_at = now
                            target.updated_at = now
                        run.updated_at = now
                        db.commit()
                        break

                    if managed.source.poll() is not None:
                        for item in list(managed.targets.values()):
                            _terminate(item.process)
                        run.source_process_pid = None
                        run.status = "failed"
                        run.error_code = "source_exited"
                        run.error_message = "内部媒体源意外退出"
                        run.stopped_at = now
                        for target in targets.values():
                            if target.status not in TERMINAL_TARGET_STATUSES:
                                target.status = "failed"
                                target.error_code = "source_exited"
                                target.error_message = "内部媒体源意外退出"
                                target.stopped_at = now
                            target.process_pid = None
                            target.updated_at = now
                        run.updated_at = now
                        db.commit()
                        break

                    for target_id, item in list(managed.targets.items()):
                        target = targets.get(target_id)
                        if target is None:
                            _terminate(item.process)
                            managed.targets.pop(target_id, None)
                            continue
                        if target.status == "starting":
                            # The previous process exited and is waiting for
                            # its scheduled reconnect; do not count it again.
                            continue
                        if item.process.poll() is None:
                            continue
                        target.process_pid = None
                        if target.retry_count < settings.media_max_retries:
                            target.retry_count += 1
                            target.status = "starting"
                            item.next_retry_at = time.monotonic() + settings.media_retry_backoff_seconds * (2 ** (target.retry_count - 1))
                            target.error_code = "target_reconnecting"
                            target.error_message = "推流连接中断，正在按退避策略重连"
                            target.updated_at = now
                            continue
                        target.status = "failed"
                        target.error_code = "target_exited"
                        target.error_message = "推流进程意外退出，已达到最大重试次数"
                        target.stopped_at = now
                        target.updated_at = now
                        managed.targets.pop(target_id, None)

                    # Launch due retries using the encrypted snapshot only.
                    for target in targets.values():
                        item = managed.targets.get(target.id)
                        if not item or target.status != "starting" or item.next_retry_at > time.monotonic():
                            continue
                        try:
                            stream_key = decrypt_secret(target.stream_key_ciphertext, target.platform_connection_id)
                            source_url = f"{settings.srs_internal_rtmp_url.rstrip('/')}/{run.id}"
                            command = _target_command(source_url, target.server_url, stream_key)
                            process = self._spawn(command)
                        except (SecretConfigurationError, SecretDecryptionError):
                            target.status = "failed"
                            target.error_code = "credential_unavailable"
                            target.error_message = "推流凭据无法安全读取"
                            target.stopped_at = now
                            target.updated_at = now
                            managed.targets.pop(target.id, None)
                            continue
                        except (OSError, ValueError):
                            item.next_retry_at = time.monotonic() + settings.media_retry_backoff_seconds
                            continue
                        item.process = process
                        item.command = command
                        target.status = "live"
                        target.process_pid = process.pid
                        target.started_at = target.started_at or now
                        target.error_code = None
                        target.error_message = None
                        target.updated_at = now

                    if not managed.targets:
                        run.status = "failed"
                        run.error_code = "all_targets_failed"
                        run.error_message = "所有推流目标均已失败"
                        run.source_process_pid = None
                        run.stopped_at = now
                        run.updated_at = now
                        _terminate(managed.source)
                        db.commit()
                        break
                    run.status = "live"
                    run.heartbeat_at = now
                    run.updated_at = now
                    db.commit()
                self._sleep(max(0.2, settings.media_heartbeat_interval))
        except Exception:
            logger.exception("media supervisor monitor crashed for live run {}", managed.run_id)
            with SessionLocal() as db:
                run = db.get(LiveRun, managed.run_id)
                if run and run.status not in TERMINAL_RUN_STATUSES:
                    self._fail_run(db, run, "supervisor_crashed", "媒体 supervisor 异常退出")
        finally:
            with self._lock:
                self._runs.pop(managed.run_id, None)


media_supervisor = MediaSupervisor()


__all__ = [
    "MediaSupervisor",
    "media_supervisor",
    "_source_command",
    "_target_command",
]
