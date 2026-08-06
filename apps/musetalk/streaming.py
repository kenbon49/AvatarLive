"""PCM WebSocket input helpers for the MuseTalk WebRTC renderer."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


PCM_SAMPLE_RATE = 16_000
PCM_SAMPLE_WIDTH = 2
DEFAULT_MAX_AUDIO_SECONDS = 120


def pcm16le_to_float32(data: bytes) -> NDArray[np.float32]:
    """Decode mono signed 16-bit little-endian PCM into MuseTalk samples."""

    if not data:
        raise ValueError("PCM audio is empty")
    if len(data) % PCM_SAMPLE_WIDTH:
        raise ValueError("PCM s16le payload must contain complete 16-bit samples")
    samples = np.frombuffer(data, dtype="<i2")
    return samples.astype(np.float32) / 32768.0


class PcmInputBuffer:
    """Bounded utterance buffer used by one streaming WebSocket session."""

    def __init__(self, max_audio_seconds: int = DEFAULT_MAX_AUDIO_SECONDS) -> None:
        if max_audio_seconds <= 0:
            raise ValueError("max_audio_seconds must be positive")
        self.max_bytes = PCM_SAMPLE_RATE * PCM_SAMPLE_WIDTH * max_audio_seconds
        self._audio = bytearray()

    @property
    def byte_length(self) -> int:
        return len(self._audio)

    @property
    def duration_seconds(self) -> float:
        return len(self._audio) / (PCM_SAMPLE_RATE * PCM_SAMPLE_WIDTH)

    def append(self, chunk: bytes) -> None:
        if not chunk:
            return
        if len(self._audio) + len(chunk) > self.max_bytes:
            raise ValueError("one utterance exceeds the configured audio limit")
        self._audio.extend(chunk)

    def clear(self) -> None:
        self._audio.clear()

    def commit(self) -> NDArray[np.float32]:
        pcm = pcm16le_to_float32(bytes(self._audio))
        self.clear()
        return pcm
