from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

import numpy as np
from aiohttp.test_utils import AioHTTPTestCase

from apps.musetalk.action_runtime import BodyActionRuntime
from apps.musetalk.avatar_catalog import AvatarProfile
from apps.musetalk.server import (
    AvatarAudioTrack,
    AvatarVideoTrack,
    MuseTalkService,
    ServiceConfig,
    SpeechController,
    _resample_for_webrtc,
    create_app,
)


def _config(root: Path, manifest_path: Path | None = None) -> ServiceConfig:
    return ServiceConfig(
        repo_root=root,
        model_root=root / "models",
        manifest_path=manifest_path or root / "manifest.json",
        cache_path=root / "cache.npz",
        batch_size=2,
        start_buffer_seconds=0.0,
    )


def _write_runtime(root: Path, profile_id: str = "default") -> BodyActionRuntime:
    root.mkdir(parents=True, exist_ok=True)
    frames = np.empty((2, 4, 6, 3), dtype=np.uint8)
    frames[0] = (10, 20, 30)
    frames[1] = (40, 50, 60)
    boxes = np.tile(np.asarray((1, 1, 5, 4), dtype=np.float32), (2, 1))
    actions: dict[str, dict[str, object]] = {}
    for name in ("idle", "talk_subtle"):
        filename = f"{name}.npz"
        np.savez(root / filename, frames=frames, face_boxes=boxes)
        actions[name] = {"file": filename, "mode": "pingpong", "frames": 2}
    manifest_path = root / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "profile": profile_id,
                "output_size": [6, 4],
                "fps": 25,
                "actions": actions,
            }
        ),
        encoding="utf-8",
    )
    return BodyActionRuntime(manifest_path)


class _TrackStub:
    def __init__(self) -> None:
        self.speech_clears = 0
        self.preview_clears = 0
        self.runtime_resets: list[BodyActionRuntime] = []

    def clear_speech(self, speech_id: int | None = None) -> None:
        del speech_id
        self.speech_clears += 1

    def clear_preview(self) -> None:
        self.preview_clears += 1

    def reset_to_runtime(self, runtime: BodyActionRuntime) -> None:
        self.runtime_resets.append(runtime)


class ServiceConfigTests(unittest.TestCase):
    def test_environment_ranges_are_validated(self) -> None:
        invalid = (
            ({"MUSETALK_PORT": "0"}, "MUSETALK_PORT"),
            ({"MUSETALK_PORT": "65536"}, "MUSETALK_PORT"),
            ({"MUSETALK_BATCH_SIZE": "0"}, "MUSETALK_BATCH_SIZE"),
            ({"MUSETALK_BATCH_SIZE": "33"}, "MUSETALK_BATCH_SIZE"),
            ({"MUSETALK_START_BUFFER_SECONDS": "-0.01"}, "START_BUFFER"),
            ({"MUSETALK_START_BUFFER_SECONDS": "5.01"}, "START_BUFFER"),
        )
        for environment, expected_message in invalid:
            with self.subTest(environment=environment):
                with mock.patch.dict(os.environ, environment, clear=True):
                    with self.assertRaisesRegex(ValueError, expected_message):
                        ServiceConfig.from_env()

    def test_empty_audio_resample_has_stable_shape_and_dtype(self) -> None:
        result = _resample_for_webrtc(np.asarray([], dtype=np.float64))

        self.assertEqual(result.shape, (0,))
        self.assertEqual(result.dtype, np.float32)

    def test_initialize_sync_preloads_catalog_profiles_with_one_engine(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            first = _write_runtime(assets / "first-host", "first-host")
            second = _write_runtime(assets / "second-host", "second-host")
            catalog_path = assets / "manifest.json"
            catalog_path.write_text(
                json.dumps(
                    {
                        "default": "first-host",
                        "avatars": [
                            {
                                "id": "first-host",
                                "label": "First",
                                "thumbnail": "/assets/musetalk-body/first-host/reference.png",
                            },
                            {
                                "id": "second-host",
                                "label": "Second",
                                "thumbnail": "/assets/musetalk-body/second-host/reference.png",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            class FakeEngine:
                instances = 0

                def __init__(self, *_args, **_kwargs) -> None:
                    type(self).instances += 1
                    self.prepared: list[tuple[str, Path]] = []
                    self.neutral: list[str] = []

                def prepare_frames(self, frames, *, cache_key, cache_path) -> None:
                    del cache_key
                    material = list(frames)
                    self.prepared.append((material[0].profile_id, Path(cache_path)))

                def warm_up(self, frames) -> None:
                    self.warm_profile = frames[0].profile_id

                def prepare_neutral_frames(self, frames, fps) -> None:
                    del fps
                    material = list(frames)
                    self.neutral.append(material[0].profile_id)

            config = _config(root, first._manifest_path)
            config = ServiceConfig(
                **{
                    **config.__dict__,
                    "avatar_catalog_path": catalog_path,
                }
            )
            service = MuseTalkService(config)
            try:
                with mock.patch("apps.musetalk.server.MuseTalkEngine", FakeEngine), mock.patch(
                    "apps.musetalk.server.build_cache_key",
                    side_effect=lambda manifest, _root: Path(manifest).stem,
                ):
                    service.initialize_sync()

                self.assertEqual(FakeEngine.instances, 1)
                self.assertEqual(service.active_avatar_id, "first-host")
                self.assertIs(service.runtime, service.runtimes["first-host"])
                self.assertEqual(service.runtime.profile_id, "first-host")
                self.assertEqual(set(service.runtimes), {"first-host", "second-host"})
                self.assertEqual(
                    [profile for profile, _ in service.engine.prepared],
                    ["first-host", "second-host"],
                )
                self.assertEqual(service.engine.neutral, ["first-host", "second-host"])
                self.assertEqual(service.engine.warm_profile, "first-host")
                self.assertEqual(second.profile_id, "second-host")
            finally:
                asyncio.run(service.shutdown())


class UnreadyMuseTalkAPITests(AioHTTPTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        await super().asyncSetUp()

    async def asyncTearDown(self) -> None:
        try:
            await super().asyncTearDown()
        finally:
            self.temp_dir.cleanup()

    async def get_application(self):
        self.service = MuseTalkService(_config(self.root))

        async def skip_real_initialization() -> None:
            return None

        self.service.initialize = skip_real_initialization  # type: ignore[method-assign]
        return create_app(self.service)

    async def test_health_actions_and_human_report_not_ready(self) -> None:
        health_response = await self.client.get("/health")
        actions_response = await self.client.get("/actions")
        human_response = await self.client.post(
            "/human",
            json={"type": "echo", "text": "hello"},
        )

        self.assertEqual(health_response.status, 200)
        health = await health_response.json()
        self.assertEqual(health["status"], "degraded")
        self.assertFalse(health["ready"])
        self.assertEqual(health["resolution"], {"width": 0, "height": 0})

        self.assertEqual(actions_response.status, 200)
        actions = await actions_response.json()
        self.assertFalse(actions["available"])
        self.assertFalse(actions["enabled"])
        self.assertEqual(actions["actions"], [])

        self.assertEqual(human_response.status, 503)
        self.assertEqual((await human_response.json())["code"], 1)


class ReadyMuseTalkAPITests(AioHTTPTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        await super().asyncSetUp()

    async def asyncTearDown(self) -> None:
        try:
            await super().asyncTearDown()
        finally:
            self.temp_dir.cleanup()

    async def get_application(self):
        runtime = _write_runtime(self.root)
        self.service = MuseTalkService(
            _config(self.root, self.root / "manifest.json"),
            runtime=runtime,
            engine=object(),  # Readiness and API validation do not invoke inference.
        )
        self.service.video = _TrackStub()  # type: ignore[assignment]
        self.service.audio = _TrackStub()  # type: ignore[assignment]
        return create_app(self.service)

    async def test_human_rejects_empty_text_and_invalid_action(self) -> None:
        empty_response = await self.client.post(
            "/human",
            json={"type": "echo", "text": "   "},
        )
        invalid_response = await self.client.post(
            "/human",
            json={"type": "echo", "text": "hello", "action": "dance"},
        )

        self.assertEqual(empty_response.status, 400)
        self.assertEqual((await empty_response.json())["msg"], "text is required")
        self.assertEqual(invalid_response.status, 400)
        invalid = await invalid_response.json()
        self.assertEqual(invalid["code"], 1)
        self.assertIn("unsupported action", invalid["msg"])

    async def test_health_and_actions_expose_ready_runtime(self) -> None:
        health_response = await self.client.get("/health")
        actions_response = await self.client.get("/actions")

        self.assertEqual(health_response.status, 200)
        health = await health_response.json()
        self.assertEqual(health["status"], "ok")
        self.assertTrue(health["ready"])
        self.assertEqual(health["resolution"], {"width": 6, "height": 4})

        self.assertEqual(actions_response.status, 200)
        actions = await actions_response.json()
        self.assertTrue(actions["available"])
        self.assertEqual(
            [item["id"] for item in actions["actions"]],
            ["auto", "idle", "talk_subtle"],
        )

    async def test_avatar_switch_reuses_tracks_and_updates_action_profile(self) -> None:
        before = await (await self.client.get("/avatars")).json()
        second_root = self.root / "second-host"
        second = _write_runtime(second_root, "second-host")
        self.service.runtimes[second.profile_id] = second
        self.service.avatar_profiles[second.profile_id] = AvatarProfile(
            id=second.profile_id,
            label="第二位主播",
            thumbnail="/assets/musetalk-body/second-host/reference.png",
            manifest_path=second_root / "manifest.json",
            cache_path=second_root / "cache.npz",
        )
        video = self.service.video

        response = await self.client.post(
            "/avatar",
            json={"avatar_id": "second-host"},
        )
        after = await response.json()

        self.assertEqual(response.status, 200)
        self.assertFalse(before["multi_avatar_enabled"])
        self.assertTrue(after["multi_avatar_enabled"])
        self.assertEqual(after["active_avatar"], "second-host")
        self.assertIs(self.service.video, video)
        self.assertEqual(video.runtime_resets, [second])
        actions = await (await self.client.get("/actions")).json()
        self.assertEqual(actions["profile_avatar"], "second-host")

    async def test_avatar_endpoint_rejects_unknown_and_malformed_ids(self) -> None:
        missing = await self.client.post("/avatar", json={"avatar_id": "missing"})
        malformed = await self.client.post("/avatar", json={"avatar_id": 42})

        self.assertEqual(missing.status, 404)
        self.assertEqual((await missing.json())["error"], "avatar_not_found")
        self.assertEqual(malformed.status, 400)
        self.assertEqual((await malformed.json())["error"], "avatar_id_required")

    async def test_action_endpoint_rejects_non_whitelisted_action(self) -> None:
        response = await self.client.post("/action", json={"action": "dance"})

        self.assertEqual(response.status, 400)
        payload = await response.json()
        self.assertEqual(payload["error"], "invalid_action")
        self.assertIn("unsupported action", payload["detail"])


class _FakeTrackRuntime:
    def __init__(self) -> None:
        self.idle_index = 0
        self.finished: list[int] = []

    def next_idle_frame(self):
        value = self.idle_index
        self.idle_index += 1
        return SimpleNamespace(
            frame=np.full((3, 4, 3), value, dtype=np.uint8),
        )

    def finish(self, generation: int) -> bool:
        self.finished.append(generation)
        return True


class _FakePlanner:
    def __init__(self, values: list[int]) -> None:
        self.values = iter(values)

    def next_frame(self, speaking: bool):
        del speaking
        try:
            value = next(self.values)
        except StopIteration:
            return None
        return SimpleNamespace(frame=np.full((3, 4, 3), value, dtype=np.uint8))


class TrackLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_video_track_replaces_speech_without_stale_cleanup(self) -> None:
        runtime = _FakeTrackRuntime()
        service = SimpleNamespace(fps=25.0, runtime=runtime)
        track = AvatarVideoTrack(service)
        old_frames = np.full((2, 3, 4, 3), 10, dtype=np.uint8)
        new_frames = np.full((1, 3, 4, 3), 20, dtype=np.uint8)

        old_done = track.start_speech(1, old_frames, total_frames=2, start_at=0.0)
        new_done = track.start_speech(2, new_frames, total_frames=1, start_at=0.0)

        self.assertTrue(old_done.is_set())
        track.clear_speech(1)
        self.assertFalse(new_done.is_set())
        selected = track._next_speech_frame(asyncio.get_running_loop().time())
        np.testing.assert_array_equal(selected, new_frames[0])
        self.assertTrue(new_done.is_set())
        self.assertIsNone(track._speech_id)

    async def test_video_preview_finishes_each_generation_once(self) -> None:
        runtime = _FakeTrackRuntime()
        service = SimpleNamespace(fps=25.0, runtime=runtime)
        track = AvatarVideoTrack(service)

        track.set_preview(7, _FakePlanner([70]))
        track.set_preview(8, _FakePlanner([80]))
        preview = track._next_idle_or_preview()
        fallback = track._next_idle_or_preview()

        np.testing.assert_array_equal(preview, np.full((3, 4, 3), 80, np.uint8))
        np.testing.assert_array_equal(fallback, np.full((3, 4, 3), 1, np.uint8))
        self.assertEqual(runtime.finished, [7, 8])

    async def test_preview_finishes_on_owner_runtime_after_service_switch(self) -> None:
        first = _FakeTrackRuntime()
        second = _FakeTrackRuntime()
        service = SimpleNamespace(fps=25.0, runtime=first)
        track = AvatarVideoTrack(service)

        track.set_preview(11, _FakePlanner([70]), first)  # type: ignore[arg-type]
        service.runtime = second
        track.clear_preview()

        self.assertEqual(first.finished, [11])
        self.assertEqual(second.finished, [])

    async def test_audio_track_ignores_stale_clear_and_completes_current_audio(self) -> None:
        track = AvatarAudioTrack()
        old_done = track.start_speech(
            1,
            np.full(1000, 0.25, dtype=np.float32),
            start_at=0.0,
        )
        new_done = track.start_speech(
            2,
            np.full(100, 0.5, dtype=np.float32),
            start_at=0.0,
        )

        self.assertTrue(old_done.is_set())
        track.clear_speech(1)
        self.assertFalse(new_done.is_set())
        frame = await track.recv()

        self.assertTrue(new_done.is_set())
        self.assertIsNone(track._speech_id)
        samples = frame.to_ndarray().reshape(-1)
        self.assertGreater(samples[0], 0)
        self.assertTrue(np.all(samples[100:] == 0))

    async def test_empty_audio_completes_immediately(self) -> None:
        track = AvatarAudioTrack()

        done = track.start_speech(
            3,
            np.asarray([], dtype=np.float32),
            start_at=0.0,
        )

        self.assertTrue(done.is_set())
        self.assertIsNone(track._speech_id)


class _ControllerService:
    def __init__(self) -> None:
        self.peers: set[object] = set()
        self.video = None
        self.audio = None
        self.runtime = None
        self.calls: list[tuple[str, int, str]] = []
        self.fail_first = True

    async def speak_into_tracks(
        self,
        text: str,
        speech_id: int,
        cancel_event: asyncio.Event,
        action: str,
    ) -> None:
        del cancel_event
        self.calls.append((text, speech_id, action))
        if self.fail_first:
            self.fail_first = False
            raise RuntimeError("synthetic inference failure")


class _ToggleEngine:
    def __init__(self) -> None:
        self.fail_render = True

    def extract_audio_features(self, pcm16k: np.ndarray, fps: float) -> np.ndarray:
        del pcm16k, fps
        return np.zeros((1, 50, 384), dtype=np.float32)

    def render_batch(self, features: np.ndarray, frames: list[object]) -> np.ndarray:
        del features
        if self.fail_render:
            raise RuntimeError("synthetic GPU inference failure")
        return np.stack([frame.frame for frame in frames])


class SpeechControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_inference_failure_does_not_break_following_request(self) -> None:
        service = _ControllerService()
        controller = SpeechController(service)  # type: ignore[arg-type]
        self.addAsyncCleanup(controller.shutdown)

        with mock.patch.object(logging.Logger, "exception") as log_exception:
            first_id, _ = await controller.submit("first", "auto", interrupt=False)
            await asyncio.wait_for(controller.queue.join(), timeout=1.0)
            second_id, _ = await controller.submit("second", "point", interrupt=False)
            await asyncio.wait_for(controller.queue.join(), timeout=1.0)

        self.assertEqual((first_id, second_id), (1, 2))
        self.assertEqual(
            service.calls,
            [("first", 1, "auto"), ("second", 2, "point")],
        )
        self.assertIsNotNone(controller.worker)
        self.assertFalse(controller.worker.done())
        self.assertIsNone(controller.active_id)
        log_exception.assert_called_once()

    async def test_render_failure_cleans_generation_and_next_render_succeeds(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        root = Path(temp_dir.name)
        runtime = _write_runtime(root)
        engine = _ToggleEngine()
        service = MuseTalkService(
            _config(root, root / "manifest.json"),
            runtime=runtime,
            engine=engine,  # type: ignore[arg-type]
            tts=lambda _: np.ones(640, dtype=np.float32),
        )
        service.video = AvatarVideoTrack(service)
        service.audio = AvatarAudioTrack()
        try:
            with mock.patch(
                "apps.musetalk.server._resample_for_webrtc",
                return_value=np.ones(1920, dtype=np.float32),
            ):
                with self.assertRaisesRegex(RuntimeError, "GPU inference failure"):
                    await service.speak_into_tracks(
                        "first",
                        speech_id=1,
                        cancel_event=asyncio.Event(),
                        action="talk_subtle",
                    )

            self.assertEqual(service.last_timing["state"], "failed")
            self.assertEqual(service.last_timing["error"], "RuntimeError")
            self.assertEqual(runtime.state.action, "idle")
            self.assertIsNone(runtime.state.active_generation)

            engine.fail_render = False
            generation, planner = runtime.begin_speech(
                "talk_subtle",
                total_frames=1,
            )
            rendered = service._render_batch_sync(
                np.zeros((1, 50, 384), dtype=np.float32),
                planner,
            )
            self.assertEqual(rendered.shape, (1, 4, 6, 3))
            self.assertTrue(runtime.finish(generation))
        finally:
            await service.shutdown()
            temp_dir.cleanup()


if __name__ == "__main__":
    unittest.main()
