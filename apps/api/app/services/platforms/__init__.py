"""Outbound platform connection services."""

from .rtmp_probe import RtmpProbeError, probe_rtmp_endpoint

__all__ = ["RtmpProbeError", "probe_rtmp_endpoint"]
