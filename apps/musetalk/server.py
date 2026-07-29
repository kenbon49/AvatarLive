"""Standalone MuseTalk 1.5 action-avatar WebRTC service."""

from __future__ import annotations

import asyncio
import contextlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
import fractions
import io
import json
import logging
import math
import os
from pathlib import Path
import time
from typing import Any, Callable
from xml.sax.saxutils import escape as xml_escape

import av
import librosa
import numpy as np
import requests
import soundfile as sf
from aiohttp import web
from aiortc import (
    AudioStreamTrack,
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)

from .action_runtime import BodyActionRuntime, UnknownActionError
from .avatar_catalog import AvatarProfile, load_avatar_catalog
from .inference import MuseTalkEngine, build_cache_key


logging.basicConfig(
    level=os.environ.get("MUSETALK_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("synlive.musetalk")
logging.getLogger("aioice").setLevel(logging.WARNING)

VIDEO_CLOCK_RATE = 90_000
VIDEO_TIME_BASE = fractions.Fraction(1, VIDEO_CLOCK_RATE)
ACTION_LABELS = {
    "auto": "自动匹配",
    "idle": "待机",
    "talk_subtle": "自然讲解",
    "welcome": "欢迎",
    "point": "指向",
    "thank": "感谢",
}


@dataclass(frozen=True)
class ServiceConfig:
    repo_root: Path
    model_root: Path
    manifest_path: Path
    cache_path: Path
    port: int = 8031
    batch_size: int = 8
    start_buffer_seconds: float = 0.12
    tts_region: str = "eastasia"
    tts_voice: str = "zh-CN-XiaoxiaoNeural"
    tts_key: str = ""
    avatar_catalog_path: Path | None = None

    @classmethod
    def from_env(cls) -> ServiceConfig:
        repo_root = Path(
            os.environ.get(
                "SYNLIVE_ROOT",
                Path(__file__).resolve().parents[2],
            )
        ).expanduser().resolve()
        model_root = Path(
            os.environ.get("MUSETALK_ROOT", "/data/MuseTalk")
        ).expanduser().resolve()
        manifest = Path(
            os.environ.get(
                "MUSETALK_BODY_MANIFEST",
                repo_root / "public/assets/musetalk-body/motion-host/manifest.json",
            )
        ).expanduser().resolve()
        cache = Path(
            os.environ.get(
                "MUSETALK_CACHE_PATH",
                model_root / "results/synlive-cache/motion-host-v15.npz",
            )
        ).expanduser().resolve()
        catalog_value = os.environ.get(
            "MUSETALK_AVATAR_CATALOG",
            str(repo_root / "public/assets/musetalk-body/manifest.json"),
        ).strip()
        avatar_catalog = (
            Path(catalog_value).expanduser().resolve() if catalog_value else None
        )
        port = int(os.environ.get("MUSETALK_PORT", os.environ.get("LT_PORT", "8031")))
        batch_size = int(os.environ.get("MUSETALK_BATCH_SIZE", "8"))
        start_buffer = float(os.environ.get("MUSETALK_START_BUFFER_SECONDS", "0.12"))
        if not 1 <= port <= 65535:
            raise ValueError("MUSETALK_PORT must be between 1 and 65535")
        if not 1 <= batch_size <= 32:
            raise ValueError("MUSETALK_BATCH_SIZE must be between 1 and 32")
        if not 0.0 <= start_buffer <= 5.0:
            raise ValueError("MUSETALK_START_BUFFER_SECONDS must be between 0 and 5")
        return cls(
            repo_root=repo_root,
            model_root=model_root,
            manifest_path=manifest,
            cache_path=cache,
            port=port,
            batch_size=batch_size,
            start_buffer_seconds=start_buffer,
            tts_region=os.environ.get(
                "AZURE_TTS_REGION",
                os.environ.get("AZURE_SERVICE_REGION", "eastasia"),
            ),
            tts_voice=os.environ.get("AZURE_TTS_VOICE", "zh-CN-XiaoxiaoNeural"),
            tts_key=os.environ.get("AZURE_SERVICE_KEY")
            or os.environ.get("AZURE_SPEECH_KEY", ""),
            avatar_catalog_path=avatar_catalog,
        )


class SpeechInterrupted(Exception):
    """Internal control-flow signal for generation-safe barge-in."""


def azure_tts(config: ServiceConfig, text: str) -> np.ndarray:
    if not config.tts_key:
        raise RuntimeError("AZURE_SERVICE_KEY or AZURE_SPEECH_KEY is not configured")
    ssml = (
        "<speak version='1.0' xml:lang='zh-CN'><voice name='"
        + xml_escape(config.tts_voice)
        + "'><prosody volume='50'>"
        + xml_escape(text)
        + "</prosody></voice></speak>"
    )
    response = requests.post(
        f"https://{config.tts_region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": config.tts_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
            "User-Agent": "synlive-musetalk",
        },
        timeout=30,
    )
    response.raise_for_status()
    audio, sample_rate = sf.read(io.BytesIO(response.content), always_2d=False)
    pcm = np.asarray(audio, dtype=np.float32)
    if pcm.ndim == 2:
        pcm = pcm.mean(axis=1)
    if sample_rate != 16_000:
        pcm = librosa.resample(pcm, orig_sr=sample_rate, target_sr=16_000)
    return np.clip(pcm.astype(np.float32, copy=False), -1.0, 1.0)


def _resample_for_webrtc(pcm16k: np.ndarray) -> np.ndarray:
    if not len(pcm16k):
        return np.zeros((0,), dtype=np.float32)
    return librosa.resample(
        np.asarray(pcm16k, dtype=np.float32),
        orig_sr=16_000,
        target_sr=48_000,
    ).astype(np.float32, copy=False)


class AvatarVideoTrack(VideoStreamTrack):
    def __init__(self, service: MuseTalkService) -> None:
        super().__init__()
        self.service = service
        self.queue: asyncio.Queue[tuple[int, np.ndarray]] = asyncio.Queue(
            maxsize=max(1, round(service.fps * 30))
        )
        first = self._neutral_frame(service.runtime.next_idle_frame())
        self.last = np.ascontiguousarray(first)
        self._clock_start: float | None = None
        self._clock_frame = 0
        self._speech_id: int | None = None
        self._speech_start_at: float | None = None
        self._speech_total = 0
        self._speech_sent = 0
        self._speech_done: asyncio.Event | None = None
        self.last_speech_id: int | None = None
        self.last_speech_first_at: float | None = None
        self._preview_generation: int | None = None
        self._preview_planner: Any | None = None
        self._preview_runtime: BodyActionRuntime | None = None

    def _neutral_frame(self, frame: Any) -> np.ndarray:
        neutralizer = getattr(self.service, "neutral_frame", None)
        return neutralizer(frame) if callable(neutralizer) else frame.frame

    async def _next_timestamp(self) -> tuple[int, fractions.Fraction]:
        loop = asyncio.get_running_loop()
        if self._clock_start is None:
            self._clock_start = loop.time()
            self._clock_frame = 0
        else:
            self._clock_frame += 1
            due = self._clock_start + self._clock_frame / self.service.fps
            await asyncio.sleep(max(0.0, due - loop.time()))
        pts = round(self._clock_frame * VIDEO_CLOCK_RATE / self.service.fps)
        return pts, VIDEO_TIME_BASE

    def start_speech(
        self,
        speech_id: int,
        frames: np.ndarray,
        total_frames: int,
        start_at: float,
    ) -> asyncio.Event:
        self.clear_preview()
        self.clear_speech()
        self._speech_id = speech_id
        self._speech_start_at = start_at
        self._speech_total = total_frames
        self._speech_sent = 0
        self._speech_done = asyncio.Event()
        self.last_speech_id = speech_id
        self.last_speech_first_at = None
        for frame in frames:
            self.queue.put_nowait((speech_id, frame))
        return self._speech_done

    async def append_speech(self, speech_id: int, frames: np.ndarray) -> bool:
        for frame in frames:
            if self._speech_id != speech_id:
                return False
            await self.queue.put((speech_id, frame))
            if self._speech_id != speech_id:
                return False
        return True

    def clear_speech(self, speech_id: int | None = None) -> None:
        if speech_id is not None and self._speech_id != speech_id:
            return
        if self._speech_done is not None:
            self._speech_done.set()
        self._speech_id = None
        self._speech_start_at = None
        self._speech_total = 0
        self._speech_sent = 0
        self._speech_done = None
        while not self.queue.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()

    def set_preview(
        self,
        generation: int,
        planner: Any,
        runtime: BodyActionRuntime | None = None,
    ) -> None:
        self.clear_preview()
        self._preview_generation = generation
        self._preview_planner = planner
        self._preview_runtime = runtime or self.service.runtime

    def clear_preview(self) -> None:
        generation = self._preview_generation
        runtime = self._preview_runtime
        self._preview_generation = None
        self._preview_planner = None
        self._preview_runtime = None
        if generation is not None:
            if runtime is not None:
                runtime.finish(generation)

    def reset_to_runtime(self, runtime: BodyActionRuntime) -> None:
        """Publish the new avatar on the existing RTP track immediately."""

        self.clear_speech()
        self.clear_preview()
        self.last = np.ascontiguousarray(
            self._neutral_frame(runtime.next_idle_frame())
        )

    def _next_speech_frame(self, now: float) -> np.ndarray | None:
        if self._speech_id is None or now < (self._speech_start_at or 0.0):
            return None
        while not self.queue.empty():
            try:
                speech_id, frame = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                return None
            if speech_id != self._speech_id:
                continue
            if self.last_speech_first_at is None:
                self.last_speech_first_at = now
            self._speech_sent += 1
            if self._speech_sent >= self._speech_total:
                done = self._speech_done
                self._speech_id = None
                self._speech_start_at = None
                self._speech_done = None
                if done is not None:
                    done.set()
            return frame
        return None

    def _next_idle_or_preview(self) -> np.ndarray:
        if self._preview_planner is not None:
            frame = self._preview_planner.next_frame(speaking=False)
            if frame is not None:
                return self._neutral_frame(frame)
            self.clear_preview()
        return self._neutral_frame(self.service.runtime.next_idle_frame())

    async def recv(self):
        pts, time_base = await self._next_timestamp()
        now = asyncio.get_running_loop().time()
        speech_frame = self._next_speech_frame(now)
        if speech_frame is not None:
            self.last = speech_frame
        elif self._speech_id is None:
            self.last = self._next_idle_or_preview()
        frame = av.VideoFrame.from_ndarray(
            np.ascontiguousarray(self.last),
            format="rgb24",
        )
        frame.pts = pts
        frame.time_base = time_base
        return frame


class AvatarAudioTrack(AudioStreamTrack):
    sample_rate = 48_000
    samples_per_frame = 960

    def __init__(self) -> None:
        super().__init__()
        self._buffer = np.zeros((0,), dtype=np.float32)
        self._index = 0
        self._pts = 0
        self._next_send_at: float | None = None
        self._speech_id: int | None = None
        self._speech_start_at: float | None = None
        self._speech_done: asyncio.Event | None = None
        self.last_speech_id: int | None = None
        self.last_speech_first_at: float | None = None

    def start_speech(
        self,
        speech_id: int,
        pcm48k: np.ndarray,
        start_at: float,
    ) -> asyncio.Event:
        self.clear_speech()
        self._buffer = np.asarray(pcm48k, dtype=np.float32).reshape(-1)
        self._index = 0
        self._speech_id = speech_id
        self._speech_start_at = start_at
        self._speech_done = asyncio.Event()
        done = self._speech_done
        self.last_speech_id = speech_id
        self.last_speech_first_at = None
        if not len(self._buffer):
            self._finish_speech()
        return done

    def _finish_speech(self) -> None:
        done = self._speech_done
        self._speech_id = None
        self._speech_start_at = None
        self._speech_done = None
        self._buffer = np.zeros((0,), dtype=np.float32)
        self._index = 0
        if done is not None:
            done.set()

    def clear_speech(self, speech_id: int | None = None) -> None:
        if speech_id is not None and self._speech_id != speech_id:
            return
        self._finish_speech()

    async def recv(self):
        loop = asyncio.get_running_loop()
        now = loop.time()
        if self._next_send_at is None:
            self._next_send_at = now
        else:
            self._next_send_at += self.samples_per_frame / self.sample_rate
            await asyncio.sleep(max(0.0, self._next_send_at - now))
        now = loop.time()
        ready = (
            self._speech_id is not None
            and now >= (self._speech_start_at or 0.0)
            and self._index < len(self._buffer)
        )
        if not ready:
            chunk = np.zeros(self.samples_per_frame, dtype=np.float32)
        else:
            if self.last_speech_first_at is None:
                self.last_speech_first_at = now
            chunk = self._buffer[
                self._index : self._index + self.samples_per_frame
            ]
            self._index += len(chunk)
            if len(chunk) < self.samples_per_frame:
                chunk = np.pad(chunk, (0, self.samples_per_frame - len(chunk)))
            if self._index >= len(self._buffer):
                self._finish_speech()
        packed = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(packed, layout="mono", format="s16")
        frame.sample_rate = self.sample_rate
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, self.sample_rate)
        self._pts += self.samples_per_frame
        return frame


async def _wait_for_playback(
    video_done: asyncio.Event,
    audio_done: asyncio.Event,
    cancel_event: asyncio.Event,
    timeout: float,
) -> None:
    async def playback_finished() -> None:
        await asyncio.gather(video_done.wait(), audio_done.wait())

    playback_task = asyncio.create_task(playback_finished())
    cancel_task = asyncio.create_task(cancel_event.wait())
    try:
        done, _ = await asyncio.wait(
            {playback_task, cancel_task},
            timeout=timeout,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancel_task in done and cancel_event.is_set():
            raise SpeechInterrupted
        if playback_task not in done:
            raise TimeoutError(f"playback did not finish in {timeout:.1f}s")
        await playback_task
    finally:
        for task in (playback_task, cancel_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(playback_task, cancel_task, return_exceptions=True)


class SpeechController:
    def __init__(self, service: MuseTalkService) -> None:
        self.service = service
        self.queue: asyncio.Queue[tuple[int, str, str]] = asyncio.Queue()
        self.worker: asyncio.Task | None = None
        self.active_task: asyncio.Task | None = None
        self.active_id: int | None = None
        self._active_cancel: asyncio.Event | None = None
        self._next_id = 1
        self._closing = False

    def _ensure_worker(self) -> None:
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._run(), name="musetalk-speech-worker")

    async def submit(
        self,
        text: str,
        action: str,
        *,
        interrupt: bool,
    ) -> tuple[int, int]:
        if self._closing:
            raise RuntimeError("speech controller is shutting down")
        if interrupt:
            await self.interrupt()
        speech_id = self._next_id
        self._next_id += 1
        await self.queue.put((speech_id, text, action))
        self._ensure_worker()
        return speech_id, self.queue.qsize()

    async def interrupt(self) -> dict[str, int | bool | None]:
        active_id = self.active_id
        if self._active_cancel is not None:
            self._active_cancel.set()
        active_task = self.active_task
        if active_task is not None and not active_task.done():
            active_task.cancel()
        dropped = 0
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
                self.queue.task_done()
                dropped += 1
            except asyncio.QueueEmpty:
                break
        if self.service.video is not None:
            self.service.video.clear_speech()
            self.service.video.clear_preview()
        if self.service.audio is not None:
            self.service.audio.clear_speech()
        if self.service.runtime is not None:
            self.service.runtime.interrupt()
        if active_task is not None and not active_task.done():
            await asyncio.sleep(0)
        return {
            "interrupted": active_id is not None,
            "active_id": active_id,
            "dropped": dropped,
        }

    async def _run(self) -> None:
        while True:
            speech_id, text, action = await self.queue.get()
            cancel_event = asyncio.Event()
            self.active_id = speech_id
            self._active_cancel = cancel_event
            task = asyncio.create_task(
                self.service.speak_into_tracks(text, speech_id, cancel_event, action),
                name=f"musetalk-speech-{speech_id}",
            )
            self.active_task = task
            try:
                await task
            except SpeechInterrupted:
                log.info("speech %s interrupted", speech_id)
            except asyncio.CancelledError:
                if self._closing:
                    raise
                log.info("speech %s cancelled for barge-in", speech_id)
            except Exception:
                log.exception("speech %s failed", speech_id)
            finally:
                if self.active_task is task:
                    self.active_task = None
                self.active_id = None
                self._active_cancel = None
                self.queue.task_done()

    def status(self) -> dict[str, Any]:
        return {
            "active_id": self.active_id,
            "queued": self.queue.qsize(),
            "connected": any(
                pc.connectionState == "connected" for pc in self.service.peers
            ),
            "peers": len(self.service.peers),
        }

    async def shutdown(self) -> None:
        self._closing = True
        await self.interrupt()
        if self.worker is not None and not self.worker.done():
            self.worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.worker


class MuseTalkService:
    def __init__(
        self,
        config: ServiceConfig,
        *,
        runtime: BodyActionRuntime | None = None,
        engine: MuseTalkEngine | None = None,
        tts: Callable[[str], np.ndarray] | None = None,
    ) -> None:
        self.config = config
        self.runtime = runtime
        self.runtimes: dict[str, BodyActionRuntime] = {}
        self.avatar_profiles: dict[str, AvatarProfile] = {}
        self.active_avatar_id: str | None = None
        if runtime is not None:
            profile_id = runtime.profile_id
            self.runtimes[profile_id] = runtime
            self.avatar_profiles[profile_id] = AvatarProfile(
                id=profile_id,
                label="动作主播 PoC",
                thumbnail=f"/assets/musetalk-body/{profile_id}/reference.png",
                manifest_path=config.manifest_path,
                cache_path=config.cache_path,
            )
            self.active_avatar_id = profile_id
        self.engine = engine
        self.tts = tts or (lambda text: azure_tts(config, text))
        self.ready = runtime is not None and engine is not None
        self.init_error: str | None = None
        self.init_started_at: float | None = None
        self.init_ms: float | None = 0.0 if self.ready else None
        self.init_task: asyncio.Task | None = None
        self.inference_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="musetalk-gpu",
        )
        self.tts_executor = ThreadPoolExecutor(
            max_workers=2,
            thread_name_prefix="musetalk-tts",
        )
        self.video: AvatarVideoTrack | None = None
        self.audio: AvatarAudioTrack | None = None
        self.peers: set[RTCPeerConnection] = set()
        self.offer_lock = asyncio.Lock()
        self.avatar_switching = False
        self.avatar_error: str | None = None
        self.last_timing: dict[str, Any] | None = None
        self.speech = SpeechController(self)

    @property
    def fps(self) -> float:
        if self.runtime is None:
            return 25.0
        return self.runtime.fps

    @property
    def output_size(self) -> tuple[int, int]:
        if self.runtime is None:
            return 0, 0
        return self.runtime.output_size

    def initialize_sync(self) -> None:
        catalog = load_avatar_catalog(
            self.config.avatar_catalog_path,
            fallback_manifest_path=self.config.manifest_path,
            fallback_cache_path=self.config.cache_path,
        )
        profiles = catalog.by_id()
        runtimes: dict[str, BodyActionRuntime] = {}
        expected_fps: float | None = None
        expected_size: tuple[int, int] | None = None
        for profile in catalog.profiles:
            runtime = BodyActionRuntime(profile.manifest_path)
            if runtime.profile_id != profile.id:
                raise ValueError(
                    f"avatar {profile.id!r} manifest profile is {runtime.profile_id!r}"
                )
            if expected_fps is None:
                expected_fps = runtime.fps
                expected_size = runtime.output_size
            elif runtime.fps != expected_fps or runtime.output_size != expected_size:
                raise ValueError(
                    "all MuseTalk avatars must use the same fps and output_size"
                )
            runtimes[profile.id] = runtime

        engine = MuseTalkEngine(
            self.config.model_root,
            cache_path=self.config.cache_path,
            batch_size=self.config.batch_size,
        )
        for profile in catalog.profiles:
            runtime = runtimes[profile.id]
            cache_key = build_cache_key(profile.manifest_path, self.config.model_root)
            engine.prepare_frames(
                runtime.iter_frames(),
                cache_key=cache_key,
                cache_path=profile.cache_path,
            )

        runtime = runtimes[catalog.default]
        warm_frames = []
        for frame in runtime.iter_frames("talk_subtle"):
            warm_frames.append(frame)
            if len(warm_frames) >= self.config.batch_size:
                break
        engine.warm_up(warm_frames)
        for profile in catalog.profiles:
            profile_runtime = runtimes[profile.id]
            engine.prepare_neutral_frames(
                profile_runtime.iter_frames(),
                profile_runtime.fps,
            )
        self.runtimes = runtimes
        self.avatar_profiles = profiles
        self.active_avatar_id = catalog.default
        self.runtime = runtime
        self.engine = engine

    async def initialize(self) -> None:
        if self.ready or self.init_task is not None:
            return
        self.init_started_at = time.monotonic()

        async def load() -> None:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(self.inference_executor, self.initialize_sync)
                self.ready = True
                self.init_error = None
                log.info(
                    "MuseTalk ready: fps=%s resolution=%sx%s avatars=%s frames=%s",
                    self.fps,
                    *self.output_size,
                    len(self.runtimes),
                    sum(
                        sum(runtime.frame_counts.values())
                        for runtime in self.runtimes.values()
                    ),
                )
            except Exception as exc:
                self.init_error = f"{type(exc).__name__}: {exc}"
                log.exception("MuseTalk initialization failed")
            finally:
                if self.init_started_at is not None:
                    self.init_ms = round((time.monotonic() - self.init_started_at) * 1000, 1)

        self.init_task = asyncio.create_task(load(), name="musetalk-initialize")

    def action_state(self) -> dict[str, Any]:
        if self.runtime is None:
            return {
                "available": False,
                "enabled": False,
                "profile_avatar": self.active_avatar_id or "motion-host",
                "actions": [],
                "state": None,
                "config_error": self.init_error,
            }
        return {
            "available": self.ready,
            "enabled": self.ready,
            "profile_avatar": self.active_avatar_id or self.runtime.profile_id,
            "actions": [
                {"id": action, "label": ACTION_LABELS.get(action, action)}
                for action in self.runtime.actions
            ],
            "state": asdict(self.runtime.state),
            "config_error": self.init_error,
        }

    def avatar_state(self) -> dict[str, Any]:
        return {
            "avatars": [
                {
                    "id": profile.id,
                    "label": profile.label,
                    "thumbnail": profile.thumbnail,
                }
                for profile in self.avatar_profiles.values()
            ],
            "active_avatar": self.active_avatar_id or "",
            "switching": self.avatar_switching,
            "multi_avatar_enabled": len(self.avatar_profiles) > 1,
            "avatar_config_error": self.init_error,
            "avatar_error": self.avatar_error,
        }

    async def switch_avatar(self, avatar_id: str) -> dict[str, Any]:
        if not self.ready or self.runtime is None:
            raise RuntimeError("MuseTalk is not ready")
        if avatar_id not in self.runtimes:
            raise KeyError(avatar_id)
        if avatar_id == self.active_avatar_id:
            return self.avatar_state()

        async with self.offer_lock:
            if avatar_id == self.active_avatar_id:
                return self.avatar_state()
            self.avatar_switching = True
            self.avatar_error = None
            previous_runtime = self.runtime
            previous_avatar_id = self.active_avatar_id
            try:
                await self.speech.interrupt()
                runtime = self.runtimes[avatar_id]
                self.runtime = runtime
                self.active_avatar_id = avatar_id
                if self.video is not None:
                    self.video.reset_to_runtime(runtime)
            except BaseException as exc:
                self.runtime = previous_runtime
                self.active_avatar_id = previous_avatar_id
                if self.video is not None and previous_runtime is not None:
                    self.video.reset_to_runtime(previous_runtime)
                self.avatar_error = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                self.avatar_switching = False
        return self.avatar_state()

    def neutral_frame(self, frame: Any) -> np.ndarray:
        neutralizer = getattr(self.engine, "neutral_frame", None)
        if not callable(neutralizer):
            return frame.frame
        return neutralizer(frame)

    def health(self) -> dict[str, Any]:
        width, height = self.output_size
        return {
            "status": "ok" if self.ready else "degraded",
            "ready": self.ready,
            "renderer": "musetalk",
            "model_version": MuseTalkEngine.model_version,
            "fps": self.fps,
            "resolution": {"width": width, "height": height},
            "batch_size": self.config.batch_size,
            "neutral_idle": self.ready,
            "start_buffer_ms": round(self.config.start_buffer_seconds * 1000, 1),
            "initialization_ms": self.init_ms,
            "initialization_error": self.init_error,
            **self.speech.status(),
            "avatar": self.avatar_state(),
            "actions": self.action_state(),
            "last_timing": self.last_timing,
        }

    def _record_failure(
        self,
        timing: dict[str, Any],
        started: float,
        exc: BaseException,
    ) -> None:
        interrupted = isinstance(exc, (SpeechInterrupted, asyncio.CancelledError))
        timing["state"] = "interrupted" if interrupted else "failed"
        timing["error"] = type(exc).__name__
        timing["total_ms"] = round(
            (asyncio.get_running_loop().time() - started) * 1000,
            1,
        )

    def _render_batch_sync(self, features: Any, planner: Any) -> np.ndarray:
        if self.engine is None:
            raise RuntimeError("MuseTalk is not ready")
        frames = []
        for _ in range(len(features)):
            frame = planner.next_frame(speaking=True)
            if frame is None:
                raise SpeechInterrupted
            frames.append(frame)
        return self.engine.render_batch(features, frames)

    async def speak_into_tracks(
        self,
        text: str,
        speech_id: int,
        cancel_event: asyncio.Event,
        action: str,
    ) -> None:
        if not self.ready or self.runtime is None or self.engine is None:
            raise RuntimeError("MuseTalk is not ready")
        runtime = self.runtime
        engine = self.engine
        avatar_id = self.active_avatar_id
        loop = asyncio.get_running_loop()
        request_started = loop.time()
        timing: dict[str, Any] = {"request_id": speech_id, "state": "tts"}
        self.last_timing = timing
        video, audio = self.video, self.audio
        if video is None or audio is None:
            exc = RuntimeError("connect WebRTC with /offer before speaking")
            self._record_failure(timing, request_started, exc)
            raise exc

        generation: int | None = None
        completed = False
        try:
            phase = loop.time()
            pcm = await loop.run_in_executor(self.tts_executor, self.tts, text)
            timing["tts_ms"] = round((loop.time() - phase) * 1000, 1)
            if cancel_event.is_set():
                raise SpeechInterrupted
            if not len(pcm):
                timing.update(
                    state="completed",
                    audio_seconds=0.0,
                    frames=0,
                    total_ms=round((loop.time() - request_started) * 1000, 1),
                )
                return

            phase = loop.time()
            pcm48k_future = loop.run_in_executor(None, _resample_for_webrtc, pcm)
            features_future = loop.run_in_executor(
                self.inference_executor,
                engine.extract_audio_features,
                pcm,
                self.fps,
            )
            pcm48k, features = await asyncio.gather(pcm48k_future, features_future)
            timing["audio_features_ms"] = round((loop.time() - phase) * 1000, 1)
            if cancel_event.is_set():
                raise SpeechInterrupted
            total_frames = len(features)
            if total_frames == 0:
                timing.update(
                    state="completed",
                    audio_seconds=round(len(pcm) / 16_000, 3),
                    frames=0,
                    total_ms=round((loop.time() - request_started) * 1000, 1),
                )
                return

            generation, planner = runtime.begin_speech(
                action,
                text=text,
                total_frames=total_frames,
            )
            first_count = min(self.config.batch_size, total_frames)
            timing["state"] = "first_video_batch"
            phase = loop.time()
            first_frames = await loop.run_in_executor(
                self.inference_executor,
                self._render_batch_sync,
                features[:first_count],
                planner,
            )
            timing["first_video_batch_ms"] = round((loop.time() - phase) * 1000, 1)
            timing["generation_ms"] = timing["first_video_batch_ms"]
            if (
                cancel_event.is_set()
                or avatar_id != self.active_avatar_id
                or not runtime.is_generation_active(generation)
            ):
                raise SpeechInterrupted

            start_at = loop.time() + self.config.start_buffer_seconds
            video_done = video.start_speech(
                speech_id,
                first_frames,
                total_frames,
                start_at,
            )
            audio_done = audio.start_speech(speech_id, pcm48k, start_at)
            timing.update(
                state="generating",
                action=runtime.resolve_action(action, text=text),
                avatar=avatar_id,
                audio_seconds=round(len(pcm) / 16_000, 3),
                frames=total_frames,
                media_ready_ms=round((loop.time() - request_started) * 1000, 1),
            )

            generation_seconds = float(timing["first_video_batch_ms"]) / 1000.0
            for start in range(first_count, total_frames, self.config.batch_size):
                if cancel_event.is_set():
                    raise SpeechInterrupted
                stop = min(total_frames, start + self.config.batch_size)
                phase = loop.time()
                rendered = await loop.run_in_executor(
                    self.inference_executor,
                    self._render_batch_sync,
                    features[start:stop],
                    planner,
                )
                generation_seconds += loop.time() - phase
                timing["generation_ms"] = round(generation_seconds * 1000, 1)
                if cancel_event.is_set():
                    raise SpeechInterrupted
                if not await video.append_speech(speech_id, rendered):
                    raise SpeechInterrupted

            timing["state"] = "playing"
            await _wait_for_playback(
                video_done,
                audio_done,
                cancel_event,
                timeout=len(pcm) / 16_000 + self.config.start_buffer_seconds + 15.0,
            )
            first_video_at = (
                video.last_speech_first_at
                if video.last_speech_id == speech_id
                else None
            )
            first_audio_at = (
                audio.last_speech_first_at
                if audio.last_speech_id == speech_id
                else None
            )
            if first_video_at is not None and first_audio_at is not None:
                timing["first_video_ms"] = round(
                    (first_video_at - request_started) * 1000,
                    1,
                )
                timing["first_audio_ms"] = round(
                    (first_audio_at - request_started) * 1000,
                    1,
                )
                timing["av_start_skew_ms"] = round(
                    abs(first_video_at - first_audio_at) * 1000,
                    1,
                )
            timing["state"] = "completed"
            timing["playback_ms"] = round((loop.time() - start_at) * 1000, 1)
            timing["total_ms"] = round((loop.time() - request_started) * 1000, 1)
            completed = True
            log.info(
                "speech %s complete: action=%s frames=%s audio=%.2fs",
                speech_id,
                timing["action"],
                total_frames,
                len(pcm) / 16_000,
            )
        except BaseException as exc:
            self._record_failure(timing, request_started, exc)
            video.clear_speech(speech_id)
            audio.clear_speech(speech_id)
            raise
        finally:
            if generation is not None:
                if completed:
                    runtime.finish(generation)
                else:
                    runtime.interrupt(generation)

    async def close_all_peers(self) -> None:
        peers = list(self.peers)
        self.peers.difference_update(peers)
        results = await asyncio.gather(
            *(peer.close() for peer in peers),
            return_exceptions=True,
        )
        for peer, result in zip(peers, results):
            if isinstance(result, BaseException):
                log.error("failed to close peer %r: %r", peer, result)

    async def clear_tracks_if_current(
        self,
        video: AvatarVideoTrack,
        audio: AvatarAudioTrack,
    ) -> None:
        if self.video is not video or self.audio is not audio:
            return
        await self.speech.interrupt()
        if self.video is video and self.audio is audio:
            self.video = None
            self.audio = None

    async def shutdown(self) -> None:
        await self.speech.shutdown()
        self.video = None
        self.audio = None
        await self.close_all_peers()
        if self.init_task is not None and not self.init_task.done():
            self.init_task.cancel()
            await asyncio.gather(self.init_task, return_exceptions=True)
        self.tts_executor.shutdown(wait=False, cancel_futures=True)
        self.inference_executor.shutdown(wait=False, cancel_futures=True)


def create_app(service: MuseTalkService) -> web.Application:
    @web.middleware
    async def cors(request: web.Request, handler):
        if request.method == "OPTIONS":
            response = web.Response(status=204)
        else:
            try:
                response = await handler(request)
            except web.HTTPException as exc:
                response = exc
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

    app = web.Application(middlewares=[cors])

    async def index(_: web.Request) -> web.Response:
        return web.Response(
            text=(
                "<!doctype html><meta charset=utf-8><title>MuseTalk</title>"
                "<body style='background:#111;color:#eee;font-family:sans-serif'>"
                "<h2>SynLive MuseTalk 1.5 action-avatar service</h2>"
                "<p>Use GET /health and WebRTC POST /offer.</p></body>"
            ),
            content_type="text/html",
        )

    async def health(_: web.Request) -> web.Response:
        return web.json_response(service.health())

    async def status(_: web.Request) -> web.Response:
        return web.json_response(service.speech.status())

    async def actions(_: web.Request) -> web.Response:
        return web.json_response(service.action_state())

    async def avatars(_: web.Request) -> web.Response:
        return web.json_response(service.avatar_state())

    async def select_avatar(request: web.Request) -> web.Response:
        if not service.ready:
            return web.json_response(
                {"error": "renderer_not_ready", **service.avatar_state()},
                status=503,
            )
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)
        if not isinstance(data, dict) or not isinstance(data.get("avatar_id"), str):
            return web.json_response({"error": "avatar_id_required"}, status=400)
        avatar_id = data["avatar_id"].strip()
        if not avatar_id:
            return web.json_response({"error": "invalid_avatar_id"}, status=400)
        try:
            state = await service.switch_avatar(avatar_id)
        except KeyError:
            return web.json_response(
                {"error": "avatar_not_found", **service.avatar_state()},
                status=404,
            )
        except Exception as exc:
            log.exception("MuseTalk avatar switch failed")
            return web.json_response(
                {
                    "error": "avatar_switch_failed",
                    "detail": str(exc),
                    **service.avatar_state(),
                },
                status=500,
            )
        return web.json_response(state)

    async def trigger_action(request: web.Request) -> web.Response:
        if not service.ready or service.runtime is None:
            return web.json_response(
                {"error": "renderer_not_ready", **service.action_state()},
                status=503,
            )
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)
        if not isinstance(data, dict) or not isinstance(data.get("action"), str):
            return web.json_response({"error": "action_required"}, status=400)
        async with service.offer_lock:
            if service.video is None:
                return web.json_response(
                    {"error": "connect_webrtc_first", **service.action_state()},
                    status=409,
                )
            runtime = service.runtime
            if runtime is None:
                return web.json_response({"error": "renderer_not_ready"}, status=503)
            try:
                resolved = runtime.resolve_action(data["action"])
                if data.get("interrupt") is not False:
                    await service.speech.interrupt()
                mode_frames = runtime.preview_frame_count(resolved)
                generation, planner = runtime.begin_preview(
                    resolved,
                    total_frames=mode_frames,
                )
                service.video.set_preview(generation, planner, runtime)
            except UnknownActionError as exc:
                return web.json_response(
                    {"error": "invalid_action", "detail": str(exc), **service.action_state()},
                    status=400,
                )
        return web.json_response({"generation": generation, **service.action_state()})

    async def offer(request: web.Request) -> web.Response:
        if not service.ready or service.runtime is None:
            return web.json_response(
                {"error": "renderer_not_ready", **service.health()},
                status=503,
            )
        try:
            params = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)
        if (
            not isinstance(params, dict)
            or not isinstance(params.get("sdp"), str)
            or not isinstance(params.get("type"), str)
        ):
            return web.json_response({"error": "invalid_offer"}, status=400)

        async with service.offer_lock:
            await service.speech.interrupt()
            service.video = None
            service.audio = None
            await service.close_all_peers()
            peer = RTCPeerConnection()
            video = AvatarVideoTrack(service)
            audio = AvatarAudioTrack()
            service.peers.add(peer)

            @peer.on("connectionstatechange")
            async def on_connection_state_change() -> None:
                log.info("peer state=%s", peer.connectionState)
                if peer.connectionState in {"closed", "failed"}:
                    service.peers.discard(peer)
                    await service.clear_tracks_if_current(video, audio)

            try:
                peer.addTrack(video)
                peer.addTrack(audio)
                description = RTCSessionDescription(
                    sdp=params["sdp"],
                    type=params["type"],
                )
                await peer.setRemoteDescription(description)
                answer = await peer.createAnswer()
                await peer.setLocalDescription(answer)
                if peer.connectionState in {"closed", "failed"}:
                    raise RuntimeError("WebRTC peer closed during offer negotiation")
                service.video = video
                service.audio = audio
            except BaseException:
                service.peers.discard(peer)
                await peer.close()
                await service.clear_tracks_if_current(video, audio)
                raise
        return web.json_response(
            {"sdp": peer.localDescription.sdp, "type": peer.localDescription.type}
        )

    async def human(request: web.Request) -> web.Response:
        if not service.ready or service.runtime is None:
            return web.json_response(
                {"code": 1, "msg": "MuseTalk renderer is not ready"},
                status=503,
            )
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"code": 1, "msg": "invalid JSON"}, status=400)
        if not isinstance(data, dict):
            return web.json_response({"code": 1, "msg": "JSON object required"}, status=400)
        request_type = str(data.get("type") or "").strip().lower()
        text = str(data.get("text") or "").strip()
        if request_type in {"interrupt", "stop", "cancel", "clear"} and not text:
            result = await service.speech.interrupt()
            return web.json_response({"code": 0, **result})
        if not text:
            return web.json_response({"code": 1, "msg": "text is required"}, status=400)
        if len(text) > 5000:
            return web.json_response(
                {"code": 1, "msg": "text exceeds 5000 characters"},
                status=400,
            )
        if service.video is None or service.audio is None:
            return web.json_response(
                {"code": 1, "msg": "connect WebRTC with /offer before speaking"},
                status=409,
            )
        action = data.get("action", "auto")
        if not isinstance(action, str):
            return web.json_response({"code": 1, "msg": "action must be a string"}, status=400)
        async with service.offer_lock:
            runtime = service.runtime
            if runtime is None:
                return web.json_response(
                    {"code": 1, "msg": "MuseTalk renderer is not ready"},
                    status=503,
                )
            try:
                resolved = runtime.resolve_action(action, text=text)
            except UnknownActionError as exc:
                return web.json_response(
                    {"code": 1, "msg": str(exc), **service.action_state()},
                    status=400,
                )
            speech_id, queued = await service.speech.submit(
                text,
                action,
                interrupt=data.get("interrupt") is True,
            )
        return web.json_response(
            {
                "code": 0,
                "request_id": speech_id,
                "queued": queued,
                "action": resolved,
            }
        )

    async def on_startup(_: web.Application) -> None:
        await service.initialize()

    async def on_shutdown(_: web.Application) -> None:
        await service.shutdown()

    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_get("/actions", actions)
    app.router.add_get("/avatars", avatars)
    app.router.add_post("/avatar", select_avatar)
    app.router.add_post("/action", trigger_action)
    app.router.add_post("/offer", offer)
    app.router.add_post("/human", human)
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    return app


def main() -> None:
    config = ServiceConfig.from_env()
    service = MuseTalkService(config)
    web.run_app(
        create_app(service),
        host="0.0.0.0",
        port=config.port,
        access_log=log,
    )


if __name__ == "__main__":
    main()
