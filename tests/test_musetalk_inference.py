from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

import numpy as np

from apps.musetalk.inference import MuseTalkEngine


class _FakeTensor:
    def __init__(self, values: np.ndarray) -> None:
        self.values = np.asarray(values)

    def numpy(self) -> np.ndarray:
        return self.values


class _FakeTorch:
    @staticmethod
    def from_numpy(values: np.ndarray) -> _FakeTensor:
        return _FakeTensor(values.copy())


def _lightweight_engine(cache_path: Path) -> MuseTalkEngine:
    engine = object.__new__(MuseTalkEngine)
    engine.cache_path = cache_path
    engine.batch_size = 2
    engine.extra_margin = 10
    engine.parsing_mode = "jaw"
    engine.upper_boundary_ratio = 0.55
    engine.left_cheek_width = 90
    engine.right_cheek_width = 90
    engine._prepared = {}
    engine._neutral_frames = {}
    engine._lock = threading.RLock()
    engine.torch = _FakeTorch()
    return engine


def _frame(profile_id: str | None, value: int) -> SimpleNamespace:
    values: dict[str, object] = {
        "action": "idle",
        "frame_index": 0,
        "frame": np.full((4, 6, 3), value, dtype=np.uint8),
        "face_box": np.asarray((1, 1, 5, 4), dtype=np.float32),
    }
    if profile_id is not None:
        values["profile_id"] = profile_id
    return SimpleNamespace(**values)


def _write_cache(
    engine: MuseTalkEngine,
    cache_path: Path,
    frames: list[SimpleNamespace],
    cache_key: str,
    latent_value: int,
) -> None:
    metadata = engine._cache_metadata(
        cache_key,
        len(frames),
        frames[0].frame.shape[:2],
    )
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        metadata=np.asarray(json.dumps(metadata, sort_keys=True)),
        actions=np.asarray([frame.action for frame in frames]),
        indices=np.asarray([frame.frame_index for frame in frames], dtype=np.int32),
        boxes=np.asarray([frame.face_box for frame in frames], dtype=np.int32),
        latents=np.full((len(frames), 2, 2, 2), latent_value, dtype=np.float16),
        masks=np.full(
            (len(frames), *frames[0].frame.shape[:2]),
            latent_value,
            dtype=np.uint8,
        ),
    )


class MuseTalkBlendFaceTests(unittest.TestCase):
    def test_generated_bgr_is_returned_as_rgb_inside_face_box(self) -> None:
        source_rgb = np.full((4, 5, 3), (11, 22, 33), dtype=np.uint8)
        generated_bgr = np.full((2, 3, 3), (7, 31, 211), dtype=np.uint8)
        mask = np.zeros(source_rgb.shape[:2], dtype=np.uint8)
        mask[1:3, 1:4] = 255

        result = MuseTalkEngine.blend_face(
            source_rgb,
            generated_bgr,
            (1, 1, 4, 3),
            mask,
        )

        self.assertEqual(result.dtype, np.uint8)
        self.assertTrue(result.flags.c_contiguous)
        expected_face = np.empty((2, 3, 3), dtype=np.uint8)
        expected_face[...] = (211, 31, 7)
        np.testing.assert_array_equal(result[1:3, 1:4], expected_face)
        np.testing.assert_array_equal(result[0, 0], (11, 22, 33))

    def test_every_zero_mask_pixel_remains_bit_identical(self) -> None:
        rng = np.random.default_rng(20260721)
        source_rgb = rng.integers(0, 256, size=(7, 8, 3), dtype=np.uint8)
        generated_bgr = rng.integers(0, 256, size=(3, 4, 3), dtype=np.uint8)
        mask = np.zeros(source_rgb.shape[:2], dtype=np.uint8)
        mask[2, 3] = 255
        mask[3, 4] = 128

        result = MuseTalkEngine.blend_face(
            source_rgb,
            generated_bgr,
            (2, 1, 6, 4),
            mask,
        )

        np.testing.assert_array_equal(result[mask == 0], source_rgb[mask == 0])
        self.assertFalse(np.array_equal(result[2, 3], source_rgb[2, 3]))

    def test_face_box_limits_overlay_even_when_mask_is_active_everywhere(self) -> None:
        source_rgb = np.zeros((6, 7, 3), dtype=np.uint8)
        source_rgb[..., 0] = 10
        source_rgb[..., 1] = 20
        source_rgb[..., 2] = 30
        generated_bgr = np.full((1, 1, 3), (90, 80, 70), dtype=np.uint8)
        mask = np.full(source_rgb.shape[:2], 255, dtype=np.uint8)

        result = MuseTalkEngine.blend_face(
            source_rgb,
            generated_bgr,
            (2, 2, 5, 5),
            mask,
        )

        expected = source_rgb.copy()
        expected[2:5, 2:5] = (70, 80, 90)
        np.testing.assert_array_equal(result, expected)

    def test_partial_alpha_blend_rounds_in_bgr_then_returns_rgb(self) -> None:
        source_rgb = np.full((2, 2, 3), (10, 20, 30), dtype=np.uint8)
        generated_bgr = np.full((1, 1, 3), (210, 100, 50), dtype=np.uint8)
        mask = np.zeros((2, 2), dtype=np.uint8)
        mask[0, 0] = 128

        result = MuseTalkEngine.blend_face(
            source_rgb,
            generated_bgr,
            (0, 0, 1, 1),
            mask,
        )

        alpha = 128.0 / 255.0
        source_bgr = np.asarray((30, 20, 10), dtype=np.float32)
        generated = np.asarray((210, 100, 50), dtype=np.float32)
        expected_rgb = np.rint(
            generated * alpha + source_bgr * (1.0 - alpha)
        ).astype(np.uint8)[::-1]
        np.testing.assert_array_equal(result[0, 0], expected_rgb)
        np.testing.assert_array_equal(result[1, 1], source_rgb[1, 1])


class MuseTalkProfileCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.engine = _lightweight_engine(self.root / "default.npz")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_two_profiles_with_same_action_and_index_do_not_collide(self) -> None:
        first_frame = _frame("host-a", 11)
        second_frame = _frame("host-b", 22)
        first_cache = self.root / "host-a.npz"
        second_cache = self.root / "host-b.npz"
        _write_cache(self.engine, first_cache, [first_frame], "cache-a", 31)
        _write_cache(self.engine, second_cache, [second_frame], "cache-b", 47)

        self.engine.prepare_frames(
            [first_frame],
            cache_key="cache-a",
            cache_path=first_cache,
        )
        first_prepared = self.engine.get_prepared(first_frame)
        self.engine.prepare_frames(
            [second_frame],
            cache_key="cache-b",
            cache_path=second_cache,
        )

        self.assertIs(self.engine.get_prepared(first_frame), first_prepared)
        self.assertEqual(self.engine.get_prepared(first_frame).profile_id, "host-a")
        self.assertEqual(self.engine.get_prepared(second_frame).profile_id, "host-b")
        self.assertEqual(
            set(self.engine._prepared),
            {
                ("host-a", "idle", 0),
                ("host-b", "idle", 0),
            },
        )
        self.assertTrue(
            np.all(self.engine.get_prepared(first_frame).latent.numpy() == 31)
        )
        self.assertTrue(
            np.all(self.engine.get_prepared(second_frame).latent.numpy() == 47)
        )

    def test_default_cache_path_and_legacy_frame_remain_supported(self) -> None:
        legacy_frame = _frame(None, 17)
        _write_cache(
            self.engine,
            self.engine.cache_path,
            [legacy_frame],
            "legacy-cache",
            23,
        )

        self.engine.prepare_frames([legacy_frame], cache_key="legacy-cache")

        prepared = self.engine.get_prepared(legacy_frame)
        self.assertEqual(prepared.profile_id, "__legacy__")
        self.assertIn(("__legacy__", "idle", 0), self.engine._prepared)

    def test_neutral_frames_merge_across_profiles(self) -> None:
        first_frame = _frame("host-a", 11)
        second_frame = _frame("host-b", 22)

        self.engine.extract_audio_features = lambda pcm, fps: np.zeros(
            (1, 1), dtype=np.float32
        )
        self.engine.render_batch = lambda prompts, frames: np.stack(
            [
                np.full_like(
                    frame.frame,
                    71 if frame.profile_id == "host-a" else 93,
                )
                for frame in frames
            ]
        )

        self.engine.prepare_neutral_frames([first_frame], 25.0)
        first_neutral = self.engine.neutral_frame(first_frame)
        self.engine.prepare_neutral_frames([second_frame], 25.0)

        self.assertIs(self.engine.neutral_frame(first_frame), first_neutral)
        np.testing.assert_array_equal(first_neutral, np.full_like(first_frame.frame, 71))
        np.testing.assert_array_equal(
            self.engine.neutral_frame(second_frame),
            np.full_like(second_frame.frame, 93),
        )
        self.assertEqual(
            set(self.engine._neutral_frames),
            {
                ("host-a", "idle", 0),
                ("host-b", "idle", 0),
            },
        )


if __name__ == "__main__":
    unittest.main()
