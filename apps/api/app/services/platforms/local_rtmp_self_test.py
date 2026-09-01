"""Short, credential-free RTMP publish check against the configured SRS."""

from __future__ import annotations

import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Callable
from uuid import uuid4

from ...core.config import settings


class LocalRtmpSelfTestError(RuntimeError):
    """Raised when the local media gateway cannot accept a test publish."""


@dataclass(frozen=True)
class LocalRtmpSelfTestResult:
    message: str
    duration_ms: int


_SELF_TEST_LOCK = threading.Lock()


def run_local_rtmp_self_test(
    *,
    runner: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> LocalRtmpSelfTestResult:
    """Publish two seconds of generated H.264/AAC media to the internal SRS."""

    if not _SELF_TEST_LOCK.acquire(blocking=False):
        raise LocalRtmpSelfTestError("已有本机 RTMP 推流自检正在运行，请稍后重试")
    try:
        return _run_local_rtmp_self_test(runner)
    finally:
        _SELF_TEST_LOCK.release()


def _run_local_rtmp_self_test(
    runner: Callable[..., subprocess.CompletedProcess[bytes]],
) -> LocalRtmpSelfTestResult:

    output_url = f"{settings.srs_internal_rtmp_url.rstrip('/')}/diagnostic_{uuid4().hex}"
    command = (
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=25",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=48000",
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "50",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-f",
        "flv",
        output_url,
    )
    started_at = time.monotonic()
    try:
        completed = runner(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except FileNotFoundError as exc:
        raise LocalRtmpSelfTestError("服务器未安装 FFmpeg，无法执行推流自检") from exc
    except subprocess.TimeoutExpired as exc:
        raise LocalRtmpSelfTestError("本机 RTMP 推流自检超时，请检查 SRS 是否正常运行") from exc
    except OSError as exc:
        raise LocalRtmpSelfTestError("无法启动本机 RTMP 推流自检") from exc

    if completed.returncode != 0:
        raise LocalRtmpSelfTestError("测试画面未能推送到本机 SRS，请检查媒体服务和 RTMP 端口")

    duration_ms = max(1, round((time.monotonic() - started_at) * 1000))
    return LocalRtmpSelfTestResult(
        message="本机推流成功：FFmpeg 已将 H.264/AAC 测试画面发布到 SRS，全程未连接外部平台",
        duration_ms=duration_ms,
    )
