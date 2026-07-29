from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from apps.musetalk.action_runtime import (
    ActionManifestError,
    BodyActionRuntime,
    UnknownActionError,
)


_COLORS = {
    "idle": 10,
    "talk_subtle": 40,
    "welcome": 80,
    "point": 120,
    "thank": 160,
}


def _write_clip(directory: Path, name: str, frame_count: int) -> str:
    frames = np.empty((frame_count, 6, 8, 3), dtype=np.uint8)
    for index in range(frame_count):
        frames[index] = (_COLORS[name] + index, 20 + index, 30 + index)
    boxes = np.tile(
        np.asarray([1.0, 1.0, 7.0, 5.0], dtype=np.float32),
        (frame_count, 1),
    )
    landmarks = np.tile(
        np.asarray(
            [
                [2.0, 2.0],
                [6.0, 2.0],
                [4.0, 3.0],
                [4.0, 4.0],
                [1.5, 3.0],
                [6.5, 3.0],
            ],
            dtype=np.float32,
        ),
        (frame_count, 1, 1),
    )
    landmarks_valid = np.ones(frame_count, dtype=np.bool_)
    filename = f"{name}.npz"
    np.savez(
        directory / filename,
        frames=frames,
        face_boxes=boxes,
        face_landmarks=landmarks,
        face_landmarks_valid=landmarks_valid,
    )
    return filename


def _make_manifest(directory: Path, *, idle_mode: str = "loop") -> Path:
    counts = {
        "idle": 3,
        "talk_subtle": 3,
        "welcome": 2,
        "point": 2,
        "thank": 1,
    }
    actions = {}
    for name, count in counts.items():
        actions[name] = {
            "file": _write_clip(directory, name, count),
            "mode": (
                idle_mode
                if name == "idle"
                else "ping-pong"
                if name == "talk_subtle"
                else "once"
            ),
            "frames": count,
        }
    manifest_path = directory / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "version": 2,
                "profile": "test-host",
                "output_size": [8, 6],
                "fps": 25.0,
                "actions": actions,
            }
        ),
        encoding="utf-8",
    )
    return manifest_path


def _read_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_manifest(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


class BodyActionRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.manifest_path = _make_manifest(self.root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_metadata_direct_access_and_stable_iteration(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)

        self.assertEqual(runtime.fps, 25.0)
        self.assertEqual(runtime.profile_id, "test-host")
        self.assertEqual(runtime.output_size, (8, 6))
        self.assertEqual(
            runtime.actions,
            ("auto", "idle", "talk_subtle", "welcome", "point", "thank"),
        )
        self.assertEqual(runtime.frame_counts["welcome"], 2)

        frame = runtime.get_frame("welcome", 1)
        self.assertEqual(
            (frame.profile_id, frame.action, frame.frame_index),
            ("test-host", "welcome", 1),
        )
        self.assertEqual(frame.frame.shape, (6, 8, 3))
        self.assertEqual(frame.frame.dtype, np.uint8)
        np.testing.assert_array_equal(frame.frame[0, 0], (81, 21, 31))
        np.testing.assert_array_equal(frame.face_box, (1.0, 1.0, 7.0, 5.0))
        self.assertEqual(frame.face_landmarks.shape, (6, 2))
        self.assertFalse(frame.frame.flags.writeable)
        self.assertFalse(frame.face_box.flags.writeable)
        self.assertFalse(frame.face_landmarks.flags.writeable)

        identities = [
            (item.action, item.frame_index) for item in runtime.iter_frames("point")
        ]
        self.assertEqual(identities, [("point", 0), ("point", 1)])
        self.assertEqual(len(list(runtime.iter_frames())), 11)

    def test_loop_and_pingpong_modes_have_no_duplicate_turnaround_frame(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        idle = runtime.create_plan("idle", total_frames=7)
        talk = runtime.create_plan("talk_subtle", total_frames=7)

        idle_indices = [idle.next_frame(False).frame_index for _ in range(7)]
        talk_indices = [talk.next_frame(True).frame_index for _ in range(7)]

        self.assertEqual(idle_indices, [0, 1, 2, 0, 1, 2, 0])
        self.assertEqual(talk_indices, [0, 1, 2, 1, 0, 1, 2])
        self.assertIsNone(idle.next_frame(False))
        self.assertFalse(idle.state.active)

    def test_single_frame_pingpong_is_stable(self) -> None:
        payload = _read_manifest(self.manifest_path)
        payload["actions"]["idle"]["file"] = _write_clip(self.root, "idle", 1)
        payload["actions"]["idle"]["frames"] = 1
        payload["actions"]["idle"]["mode"] = "pingpong"
        _write_manifest(self.manifest_path, payload)
        runtime = BodyActionRuntime(self.manifest_path)
        plan = runtime.create_plan("idle", total_frames=3)

        self.assertEqual(
            [plan.next_frame(False).frame_index for _ in range(3)],
            [0, 0, 0],
        )

    def test_fractional_playback_rates_are_deterministic(self) -> None:
        payload = _read_manifest(self.manifest_path)
        payload["actions"]["idle"]["playback_rate"] = 0.6
        payload["actions"]["talk_subtle"]["playback_rate"] = 0.6
        _write_manifest(self.manifest_path, payload)
        runtime = BodyActionRuntime(self.manifest_path)

        idle = runtime.create_plan("idle", total_frames=8)
        talk = runtime.create_plan("talk_subtle", total_frames=10)

        self.assertEqual(
            [idle.next_frame(False).frame_index for _ in range(8)],
            [0, 0, 1, 1, 2, 0, 0, 1],
        )
        self.assertEqual(
            [talk.next_frame(True).frame_index for _ in range(10)],
            [0, 0, 1, 1, 2, 1, 1, 0, 0, 1],
        )

    def test_fractional_once_holds_last_frame_before_fallback(self) -> None:
        payload = _read_manifest(self.manifest_path)
        payload["actions"]["welcome"]["playback_rate"] = 0.5
        payload["actions"]["talk_subtle"]["playback_rate"] = 0.5
        _write_manifest(self.manifest_path, payload)
        runtime = BodyActionRuntime(self.manifest_path)
        plan = runtime.create_plan("welcome")

        frames = [plan.next_frame(True) for _ in range(7)]

        self.assertEqual(
            [(frame.action, frame.frame_index) for frame in frames],
            [
                ("welcome", 0),
                ("welcome", 0),
                ("welcome", 1),
                ("welcome", 1),
                ("talk_subtle", 0),
                ("talk_subtle", 0),
                ("talk_subtle", 1),
            ],
        )

    def test_preview_frame_budget_tracks_mode_and_playback_rate(self) -> None:
        payload = _read_manifest(self.manifest_path)
        payload["actions"]["idle"]["playback_rate"] = 0.6
        payload["actions"]["talk_subtle"]["playback_rate"] = 0.6
        payload["actions"]["welcome"]["playback_rate"] = 0.5
        _write_manifest(self.manifest_path, payload)
        runtime = BodyActionRuntime(self.manifest_path)

        self.assertEqual(runtime.preview_frame_count("idle"), 5)
        self.assertEqual(runtime.preview_frame_count("talk_subtle"), 7)
        self.assertEqual(runtime.preview_frame_count("welcome"), 4)
        with self.assertRaises(UnknownActionError):
            runtime.preview_frame_count("auto")

    def test_profile_defaults_to_safe_namespace(self) -> None:
        payload = _read_manifest(self.manifest_path)
        del payload["profile"]
        _write_manifest(self.manifest_path, payload)

        runtime = BodyActionRuntime(self.manifest_path)

        self.assertEqual(runtime.profile_id, "default")
        self.assertEqual(runtime.get_frame("idle", 0).profile_id, "default")

    def test_once_speech_falls_back_to_independent_talk_cursor(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        generation, plan = runtime.begin_speech("welcome")

        frames = [plan.next_frame(True) for _ in range(5)]

        self.assertEqual(
            [(frame.action, frame.frame_index) for frame in frames],
            [
                ("welcome", 0),
                ("welcome", 1),
                ("talk_subtle", 0),
                ("talk_subtle", 1),
                ("talk_subtle", 2),
            ],
        )
        self.assertEqual(runtime.state.action, "talk_subtle")
        self.assertTrue(runtime.state.speaking)
        self.assertEqual(runtime.state.active_generation, generation)

    def test_silent_once_preview_falls_back_to_idle(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        generation, plan = runtime.begin_preview("point")

        frames = [plan.next_frame(False) for _ in range(4)]

        self.assertEqual(
            [(frame.action, frame.frame_index) for frame in frames],
            [("point", 0), ("point", 1), ("idle", 0), ("idle", 1)],
        )
        self.assertEqual(runtime.state.action, "idle")
        self.assertFalse(runtime.state.speaking)
        self.assertEqual(runtime.state.active_generation, generation)

    def test_speech_preview_and_idle_cursors_never_share_progress(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        first_idle = runtime.next_idle_frame()
        _, speech = runtime.begin_speech("welcome")
        speech_frames = [speech.next_frame(True) for _ in range(3)]
        second_idle = runtime.next_idle_frame()
        first_plan = runtime.create_plan("talk_subtle")
        second_plan = runtime.create_plan("talk_subtle")

        self.assertEqual(first_idle.frame_index, 0)
        self.assertEqual(second_idle.frame_index, 1)
        self.assertEqual(speech_frames[-1].action, "talk_subtle")
        self.assertEqual(speech_frames[-1].frame_index, 0)
        self.assertEqual(first_plan.next_frame().frame_index, 0)
        self.assertEqual(second_plan.next_frame().frame_index, 0)

    def test_new_generation_and_interrupt_make_old_plans_stale(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        first_generation, first = runtime.begin_speech("welcome")
        self.assertIsNotNone(first.next_frame())
        second_generation, second = runtime.begin_preview("point")

        self.assertIsNone(first.next_frame())
        self.assertFalse(first.state.active)
        self.assertEqual(runtime.interrupt(first_generation), second_generation)
        self.assertIsNotNone(second.next_frame(False))
        interrupted_generation = runtime.interrupt(second_generation)

        self.assertEqual(interrupted_generation, second_generation + 1)
        self.assertIsNone(second.next_frame(False))
        self.assertEqual(runtime.state.action, "idle")
        self.assertFalse(runtime.state.speaking)
        self.assertIsNone(runtime.state.active_generation)
        # Offline plans are deliberately not tied to service cancellation.
        self.assertIsNotNone(runtime.create_plan("thank").next_frame(False))

    def test_finish_is_generation_guarded(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)
        generation, planner = runtime.begin_speech("auto", text="普通讲解")

        self.assertFalse(runtime.finish(generation + 1))
        self.assertTrue(planner.state.active)
        self.assertTrue(runtime.finish(generation))
        self.assertFalse(planner.state.active)
        self.assertIsNone(planner.next_frame())

    def test_auto_action_uses_keyword_boundaries(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)

        self.assertEqual(runtime.resolve_action("auto", text="您好，欢迎光临"), "welcome")
        self.assertEqual(runtime.resolve_action("auto", text="请看这里的参数"), "point")
        self.assertEqual(runtime.resolve_action("auto", text="谢谢，下次再见"), "thank")
        self.assertEqual(runtime.resolve_action("auto", text="this product"), "talk_subtle")
        self.assertEqual(runtime.resolve_action("auto", text="shipping today"), "talk_subtle")
        with self.assertRaises(UnknownActionError):
            runtime.resolve_action("dance")
        with self.assertRaises(UnknownActionError):
            runtime.get_frame("auto", 0)

    def test_normalized_face_boxes_are_converted_to_pixels(self) -> None:
        with np.load(self.root / "idle.npz") as archive:
            frames = archive["frames"]
            landmarks = archive["face_landmarks"]
            valid = archive["face_landmarks_valid"]
        boxes = np.tile(
            np.asarray([0.125, 1 / 6, 0.875, 5 / 6], dtype=np.float32),
            (len(frames), 1),
        )
        np.savez(
            self.root / "idle.npz",
            frames=frames,
            face_boxes=boxes,
            face_landmarks=landmarks,
            face_landmarks_valid=valid,
        )

        frame = BodyActionRuntime(self.manifest_path).get_frame("idle", 0)

        np.testing.assert_allclose(frame.face_box, (1.0, 1.0, 7.0, 5.0))

    def test_invalid_landmark_frame_returns_none_without_exposing_bad_values(self) -> None:
        with np.load(self.root / "idle.npz") as archive:
            frames = archive["frames"]
            boxes = archive["face_boxes"]
            landmarks = archive["face_landmarks"]
            valid = archive["face_landmarks_valid"]
        landmarks[-1] = np.nan
        valid[-1] = False
        np.savez(
            self.root / "idle.npz",
            frames=frames,
            face_boxes=boxes,
            face_landmarks=landmarks,
            face_landmarks_valid=valid,
        )

        runtime = BodyActionRuntime(self.manifest_path)

        self.assertIsNotNone(runtime.get_frame("idle", 0).face_landmarks)
        self.assertIsNone(runtime.get_frame("idle", 2).face_landmarks)

    def test_manifest_rejects_unknown_action_path_escape_and_mode_mismatch(self) -> None:
        for mutation, message in (
            (
                lambda payload: payload["actions"].update(
                    {"dance": payload["actions"]["idle"]}
                ),
                "non-whitelisted",
            ),
            (
                lambda payload: payload["actions"]["idle"].update(
                    {"file": "../outside.npz"}
                ),
                "manifest directory",
            ),
            (
                lambda payload: payload["actions"]["welcome"].update(
                    {"mode": "loop"}
                ),
                "must use mode 'once'",
            ),
        ):
            with self.subTest(message=message):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    manifest = _make_manifest(root)
                    payload = _read_manifest(manifest)
                    mutation(payload)
                    _write_manifest(manifest, payload)
                    with self.assertRaisesRegex(ActionManifestError, message):
                        BodyActionRuntime(manifest)

    def test_manifest_rejects_missing_base_clip_and_metadata_mismatch(self) -> None:
        payload = _read_manifest(self.manifest_path)
        del payload["actions"]["talk_subtle"]
        _write_manifest(self.manifest_path, payload)
        with self.assertRaisesRegex(ActionManifestError, "talk_subtle"):
            BodyActionRuntime(self.manifest_path)

        self.manifest_path = _make_manifest(self.root)
        payload = _read_manifest(self.manifest_path)
        payload["actions"]["idle"]["frames"] = 99
        _write_manifest(self.manifest_path, payload)
        with self.assertRaisesRegex(ActionManifestError, "declares 99 frames"):
            BodyActionRuntime(self.manifest_path)

    def test_manifest_rejects_invalid_playback_rates_and_profiles(self) -> None:
        invalid_rates = (True, "0.5", 0, -0.1, 1.01, float("nan"), float("inf"))
        for playback_rate in invalid_rates:
            with self.subTest(playback_rate=playback_rate):
                payload = _read_manifest(self.manifest_path)
                payload["actions"]["idle"]["playback_rate"] = playback_rate
                _write_manifest(self.manifest_path, payload)
                with self.assertRaisesRegex(ActionManifestError, "playback_rate"):
                    BodyActionRuntime(self.manifest_path)

        for profile in (None, "", "Motion Host", "../motion-host", "a" * 65):
            with self.subTest(profile=profile):
                payload = _read_manifest(self.manifest_path)
                payload["profile"] = profile
                _write_manifest(self.manifest_path, payload)
                with self.assertRaisesRegex(ActionManifestError, "profile"):
                    BodyActionRuntime(self.manifest_path)

    def test_clip_rejects_wrong_shape_box_and_landmark_pair(self) -> None:
        cases = ("shape", "box", "landmarks")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                manifest = _make_manifest(root)
                with np.load(root / "idle.npz") as archive:
                    frames = archive["frames"]
                    boxes = archive["face_boxes"]
                    landmarks = archive["face_landmarks"]
                    valid = archive["face_landmarks_valid"]
                if case == "shape":
                    frames = frames[:, :-1]
                elif case == "box":
                    boxes[0] = (-1.0, 1.0, 7.0, 5.0)
                if case == "landmarks":
                    np.savez(
                        root / "idle.npz",
                        frames=frames,
                        face_boxes=boxes,
                        face_landmarks=landmarks,
                    )
                else:
                    np.savez(
                        root / "idle.npz",
                        frames=frames,
                        face_boxes=boxes,
                        face_landmarks=landmarks,
                        face_landmarks_valid=valid,
                    )
                with self.assertRaises(ActionManifestError):
                    BodyActionRuntime(manifest)

    def test_frame_index_and_total_frame_inputs_are_bounded(self) -> None:
        runtime = BodyActionRuntime(self.manifest_path)

        with self.assertRaises(IndexError):
            runtime.get_frame("idle", -1)
        with self.assertRaises(IndexError):
            runtime.get_frame("idle", 3)
        with self.assertRaises(TypeError):
            runtime.get_frame("idle", 1.5)
        with self.assertRaises(ValueError):
            runtime.create_plan("idle", total_frames=-1)
        empty = runtime.create_plan("idle", total_frames=0)
        self.assertIsNone(empty.next_frame(False))


if __name__ == "__main__":
    unittest.main()
