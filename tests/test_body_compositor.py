from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import numpy as np

from apps.flashhead import (
    ActionManifestError,
    BodyCompositor,
    UnknownActionError,
)
from apps.flashhead.face_tracking import FaceGeometry


class _FixedFaceDetector:
    def __init__(self, geometry: FaceGeometry) -> None:
        self.geometry = geometry
        self.closed = False

    def detect(self, frame, preferred_box=None):
        del frame, preferred_box
        return self.geometry

    def close(self) -> None:
        self.closed = True


class _FailingFaceDetector:
    def detect(self, frame, preferred_box=None):
        del frame, preferred_box
        raise RuntimeError("synthetic detector failure")

    def close(self) -> None:
        pass


def _write_clip(
    directory: Path,
    name: str,
    colors: list[tuple[int, int, int]],
    *,
    face_box: tuple[float, float, float, float] = (2, 2, 6, 6),
) -> str:
    frames = np.empty((len(colors), 8, 8, 3), dtype=np.uint8)
    for index, color in enumerate(colors):
        frames[index] = color
    boxes = np.tile(np.asarray(face_box, dtype=np.float32), (len(colors), 1))
    filename = f"{name}.npz"
    np.savez(directory / filename, frames=frames, face_boxes=boxes)
    return filename


def _make_manifest(directory: Path) -> Path:
    clips = {
        "idle": _write_clip(directory, "idle", [(10, 20, 30), (20, 30, 40)]),
        "talk_subtle": _write_clip(
            directory, "talk_subtle", [(60, 70, 80), (70, 80, 90)]
        ),
        "welcome": _write_clip(
            directory, "welcome", [(100, 110, 120), (110, 120, 130)]
        ),
        "point": _write_clip(directory, "point", [(140, 150, 160)]),
        "thank": _write_clip(directory, "thank", [(180, 190, 200)]),
    }
    actions = {
        name: {
            "file": filename,
            "mode": "pingpong" if name in {"idle", "talk_subtle"} else "once",
        }
        for name, filename in clips.items()
    }
    manifest_path = directory / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "output_size": [8, 8],
                "source_face_box": [0, 0, 1, 1],
                "crossfade_frames": 4,
                "feather_ratio": 0.1,
                "actions": actions,
            }
        ),
        encoding="utf-8",
    )
    return manifest_path


def _normalized_source_landmarks() -> list[list[float]]:
    return [
        [0.375, 0.4375],
        [0.6875, 0.4375],
        [0.53125, 0.59375],
        [0.53125, 0.75],
        [0.21875, 0.546875],
        [0.84375, 0.546875],
    ]


class BodyCompositorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.manifest_path = _make_manifest(self.root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_actions_are_whitelisted_and_auto_uses_keywords(self) -> None:
        compositor = BodyCompositor(self.manifest_path)

        self.assertEqual(
            compositor.actions,
            ("auto", "idle", "talk_subtle", "welcome", "point", "thank"),
        )
        self.assertEqual(compositor.resolve_action("auto", text="您好，欢迎光临"), "welcome")
        self.assertEqual(compositor.resolve_action("auto", text="请看这里的参数"), "point")
        self.assertEqual(compositor.resolve_action("auto", text="感谢您的下单"), "thank")
        self.assertEqual(compositor.resolve_action("auto", text="普通讲解"), "talk_subtle")
        self.assertEqual(compositor.resolve_action("auto", text="this product"), "talk_subtle")
        with self.assertRaises(UnknownActionError):
            compositor.resolve_action("dance")

    def test_composite_has_fixed_shape_and_feathered_ellipse(self) -> None:
        compositor = BodyCompositor(self.manifest_path)
        red_face = np.full((5, 7, 3), (240, 0, 0), dtype=np.uint8)

        output = compositor.composite(red_face, speaking=False)

        self.assertEqual(output.shape, (8, 8, 3))
        self.assertEqual(output.dtype, np.uint8)
        np.testing.assert_array_equal(output[4, 4], (240, 0, 0))
        np.testing.assert_array_equal(output[2, 2], (10, 20, 30))
        np.testing.assert_array_equal(output[0, 0], (10, 20, 30))

    def test_speaking_switches_base_clip_with_four_frame_crossfade(self) -> None:
        compositor = BodyCompositor(self.manifest_path)
        transparent_face = np.zeros((8, 8, 3), dtype=np.uint8)
        compositor.composite(transparent_face, speaking=False)

        first = compositor.composite(transparent_face, speaking=True)
        self.assertEqual(compositor.state.action, "talk_subtle")
        self.assertEqual(compositor.state.crossfade_remaining, 3)
        # Outside the face ellipse, the first switch frame is 25% of the new clip.
        np.testing.assert_array_equal(first[0, 0], (22, 32, 42))

        for _ in range(3):
            compositor.composite(transparent_face, speaking=True)
        self.assertEqual(compositor.state.crossfade_remaining, 0)
        self.assertTrue(compositor.state.speaking)

    def test_cut_transition_avoids_double_exposed_body_frames(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["transition_mode"] = "cut"
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
        compositor = BodyCompositor(self.manifest_path)
        face = np.zeros((8, 8, 3), dtype=np.uint8)
        compositor.composite(face, speaking=False)

        switched = compositor.composite(face, speaking=True)

        np.testing.assert_array_equal(switched[0, 0], (60, 70, 80))
        self.assertEqual(compositor.state.crossfade_remaining, 0)

    def test_landmarks_warp_generated_face_to_target_geometry(self) -> None:
        source_keypoints = np.asarray(
            [
                [24.0, 28.0],
                [44.0, 28.0],
                [34.0, 38.0],
                [34.0, 48.0],
                [14.0, 35.0],
                [54.0, 35.0],
            ],
            dtype=np.float32,
        )
        target_keypoints = source_keypoints + np.asarray([16.0, 12.0], dtype=np.float32)
        source_geometry = FaceGeometry(
            np.asarray([8.0, 8.0, 60.0, 60.0], dtype=np.float32),
            source_keypoints,
            0.99,
        )
        body = np.full((1, 96, 96, 3), (20, 30, 40), dtype=np.uint8)
        boxes = np.asarray([[24.0, 20.0, 76.0, 72.0]], dtype=np.float32)
        np.savez(
            self.root / "aligned.npz",
            frames=body,
            face_boxes=boxes,
            face_landmarks=target_keypoints[None, ...],
            face_landmarks_valid=np.asarray([True], dtype=np.bool_),
        )
        manifest = {
            "output_size": [96, 96],
            "source_face_box": [8, 8, 60, 60],
            "source_face_landmarks": (source_keypoints / 64.0).tolist(),
            "landmark_schema": "mediapipe_face_detection_6",
            "transition_mode": "cut",
            "crossfade_frames": 4,
            "feather_ratio": 0.1,
            "actions": {"idle": {"file": "aligned.npz", "mode": "pingpong"}},
        }
        manifest_path = self.root / "aligned.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        compositor = BodyCompositor(
            manifest_path,
            face_detector=_FixedFaceDetector(source_geometry),
        )
        face = np.zeros((64, 64, 3), dtype=np.uint8)
        face[..., 0] = np.arange(64, dtype=np.uint8)[None, :] * 3
        face[..., 1] = np.arange(64, dtype=np.uint8)[:, None] * 3

        output = compositor.composite(face, speaking=False)

        np.testing.assert_array_equal(output[0, 0], (20, 30, 40))
        self.assertGreater(int(output[60, 50, 0]), 80)
        self.assertGreater(int(output[60, 50, 1]), 80)

    def test_tracking_failure_falls_back_without_dropping_frame(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["landmark_schema"] = "mediapipe_face_detection_6"
        payload["source_face_landmarks"] = _normalized_source_landmarks()
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
        compositor = BodyCompositor(
            self.manifest_path,
            face_detector=_FailingFaceDetector(),
        )
        red_face = np.full((8, 8, 3), (240, 0, 0), dtype=np.uint8)

        with self.assertLogs("apps.flashhead.body_compositor", level="ERROR"):
            output = compositor.composite(red_face, speaking=False)

        self.assertGreater(int(output[4, 4, 0]), 200)
        self.assertLess(int(output[4, 4, 1]), 10)
        self.assertLess(int(output[4, 4, 2]), 10)
        self.assertTrue(compositor.state.tracking_enabled)
        self.assertEqual(compositor.state.fallback_frames, 1)

    def test_v2_alignment_failure_keeps_polygon_warp_path(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["landmark_schema"] = "mediapipe_face_detection_6"
        payload["source_face_landmarks"] = _normalized_source_landmarks()
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
        with np.load(self.root / "idle.npz") as archive:
            frames = archive["frames"]
            boxes = archive["face_boxes"]
        target_landmarks = np.tile(
            np.asarray(_normalized_source_landmarks(), dtype=np.float32) * 8.0,
            (len(frames), 1, 1),
        )
        np.savez(
            self.root / "idle.npz",
            frames=frames,
            face_boxes=boxes,
            face_landmarks=target_landmarks,
            face_landmarks_valid=np.ones(len(frames), dtype=np.bool_),
        )
        source_geometry = FaceGeometry(
            np.asarray([1.0, 1.0, 7.0, 7.0], dtype=np.float32),
            np.asarray(_normalized_source_landmarks(), dtype=np.float32) * 8.0,
            0.99,
        )
        compositor = BodyCompositor(
            self.manifest_path,
            face_detector=_FixedFaceDetector(source_geometry),
        )
        face = np.full((8, 8, 3), (240, 0, 0), dtype=np.uint8)

        with (
            mock.patch(
                "apps.flashhead.body_compositor.estimate_similarity_transform",
                return_value=None,
            ) as estimate,
            mock.patch.object(
                compositor,
                "_warp_blend_face",
                wraps=compositor._warp_blend_face,
            ) as warp,
            mock.patch.object(
                compositor,
                "_resize_blend_face",
                wraps=compositor._resize_blend_face,
            ) as resize,
        ):
            output = compositor.composite(face, speaking=False)

        self.assertEqual(output.shape, (8, 8, 3))
        self.assertEqual(estimate.call_count, 2)
        warp.assert_called_once()
        resize.assert_not_called()
        self.assertEqual(compositor.state.fallback_frames, 1)

    def test_v2_double_warp_failure_counts_once_and_uses_legacy_resize(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["landmark_schema"] = "mediapipe_face_detection_6"
        payload["source_face_landmarks"] = _normalized_source_landmarks()
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
        keypoints = np.asarray(_normalized_source_landmarks(), dtype=np.float32) * 8.0
        source_geometry = FaceGeometry(
            np.asarray([1.0, 1.0, 7.0, 7.0], dtype=np.float32),
            keypoints,
            0.99,
        )
        compositor = BodyCompositor(
            self.manifest_path,
            face_detector=_FixedFaceDetector(source_geometry),
        )
        body = np.full((8, 8, 3), (10, 20, 30), dtype=np.uint8)
        face = np.full((8, 8, 3), (240, 0, 0), dtype=np.uint8)
        target_box = np.asarray([1.0, 1.0, 7.0, 7.0], dtype=np.float32)

        with (
            mock.patch.object(
                compositor,
                "_warp_blend_face",
                side_effect=[ValueError("landmark warp"), ValueError("bbox warp")],
            ) as warp,
            mock.patch.object(
                compositor,
                "_resize_blend_face",
                return_value=body.copy(),
            ) as resize,
            self.assertLogs("apps.flashhead.body_compositor", level="ERROR") as logs,
        ):
            output = compositor._blend_face(
                body,
                target_box,
                face,
                source_geometry=source_geometry,
                target_landmarks=keypoints,
            )

        np.testing.assert_array_equal(output, body)
        self.assertEqual(warp.call_count, 2)
        resize.assert_called_once()
        self.assertEqual(len(logs.output), 2)
        self.assertEqual(compositor.state.fallback_frames, 1)

    def test_out_of_range_source_landmarks_are_rejected_at_startup(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["landmark_schema"] = "mediapipe_face_detection_6"
        landmarks = _normalized_source_landmarks()
        landmarks[0][0] = 1.01
        payload["source_face_landmarks"] = landmarks
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")

        with self.assertRaisesRegex(
            ActionManifestError,
            "source_face_landmarks must use normalized 0..1 coordinates",
        ):
            BodyCompositor(
                self.manifest_path,
                face_detector=_FixedFaceDetector(
                    FaceGeometry(
                        np.asarray([1.0, 1.0, 7.0, 7.0], dtype=np.float32),
                        np.asarray(_normalized_source_landmarks(), dtype=np.float32) * 8.0,
                        0.99,
                    )
                ),
            )

    def test_close_releases_runtime_face_detector(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["landmark_schema"] = "mediapipe_face_detection_6"
        payload["source_face_landmarks"] = _normalized_source_landmarks()
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
        detector = _FixedFaceDetector(
            FaceGeometry(
                np.asarray([1.0, 1.0, 7.0, 7.0], dtype=np.float32),
                np.asarray(_normalized_source_landmarks(), dtype=np.float32) * 8.0,
                0.99,
            )
        )
        compositor = BodyCompositor(self.manifest_path, face_detector=detector)

        compositor.close()

        self.assertTrue(detector.closed)
        self.assertFalse(compositor.state.tracking_enabled)

    def test_out_of_bounds_valid_landmarks_are_rejected(self) -> None:
        with np.load(self.root / "idle.npz") as archive:
            frames = archive["frames"]
            boxes = archive["face_boxes"]
        landmarks = np.full((len(frames), 6, 2), 99.0, dtype=np.float32)
        np.savez(
            self.root / "idle.npz",
            frames=frames,
            face_boxes=boxes,
            face_landmarks=landmarks,
            face_landmarks_valid=np.ones(len(frames), dtype=np.bool_),
        )

        with self.assertRaises(ActionManifestError):
            BodyCompositor(self.manifest_path)

    def test_once_action_returns_to_speaking_base(self) -> None:
        compositor = BodyCompositor(self.manifest_path)
        face = np.zeros((8, 8, 3), dtype=np.uint8)
        compositor.composite(face, speaking=True)
        generation = compositor.request_action("welcome")

        compositor.composite(face, speaking=True)
        self.assertEqual(compositor.state.action, "welcome")
        self.assertEqual(compositor.state.active_generation, generation)
        compositor.composite(face, speaking=True)
        compositor.composite(face, speaking=True)
        self.assertEqual(compositor.state.action, "talk_subtle")

    def test_queue_and_generation_guarded_interrupt(self) -> None:
        compositor = BodyCompositor(self.manifest_path)
        face = np.zeros((8, 8, 3), dtype=np.uint8)
        first_generation = compositor.request_action("welcome")
        second_generation = compositor.request_action("point", interrupt=False)

        self.assertEqual(compositor.state.queued_actions, ("point",))
        self.assertEqual(compositor.interrupt(first_generation), second_generation)
        self.assertEqual(compositor.state.action, "welcome")
        next_generation = compositor.interrupt(second_generation)
        self.assertEqual(next_generation, second_generation + 1)
        self.assertEqual(compositor.state.action, "idle")
        self.assertEqual(compositor.state.queued_actions, ())

        compositor.request_action("welcome")
        compositor.composite(face, speaking=False)
        compositor.composite(face, speaking=False)
        compositor.composite(face, speaking=False)
        self.assertEqual(compositor.state.action, "idle")

    def test_invalid_manifest_rejects_unknown_action(self) -> None:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        payload["actions"]["dance"] = payload["actions"]["idle"]
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")

        with self.assertRaises(ActionManifestError):
            BodyCompositor(self.manifest_path)


if __name__ == "__main__":
    unittest.main()
