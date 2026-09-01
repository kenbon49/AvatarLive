"""Outbound platform connection services."""

from .local_rtmp_self_test import (
    LocalRtmpSelfTestError,
    LocalRtmpSelfTestResult,
    run_local_rtmp_self_test,
)
from .rtmp_probe import RtmpProbeError, probe_rtmp_endpoint

__all__ = [
    "LocalRtmpSelfTestError",
    "LocalRtmpSelfTestResult",
    "RtmpProbeError",
    "probe_rtmp_endpoint",
    "run_local_rtmp_self_test",
]
