from __future__ import annotations

import unittest

import numpy as np

from apps.musetalk.streaming import PcmInputBuffer, pcm16le_to_float32


class PcmStreamingTests(unittest.TestCase):
    def test_pcm16le_conversion_preserves_signed_range(self) -> None:
        payload = np.asarray((-32768, 0, 32767), dtype="<i2").tobytes()

        converted = pcm16le_to_float32(payload)

        np.testing.assert_allclose(converted, (-1.0, 0.0, 32767 / 32768))

    def test_commit_clears_the_utterance(self) -> None:
        buffer = PcmInputBuffer(max_audio_seconds=1)
        buffer.append(np.zeros(1600, dtype="<i2").tobytes())

        pcm = buffer.commit()

        self.assertEqual(len(pcm), 1600)
        self.assertEqual(buffer.byte_length, 0)

    def test_buffer_rejects_oversized_audio(self) -> None:
        buffer = PcmInputBuffer(max_audio_seconds=1)

        with self.assertRaisesRegex(ValueError, "audio limit"):
            buffer.append(bytes(32_002))

    def test_commit_rejects_partial_sample(self) -> None:
        buffer = PcmInputBuffer(max_audio_seconds=1)
        buffer.append(b"\x00")

        with self.assertRaisesRegex(ValueError, "complete 16-bit"):
            buffer.commit()


if __name__ == "__main__":
    unittest.main()
