"""Immutable action assets and per-request playback plans for MuseTalk.

The runtime preloads RGB frames and face geometry once.  Each speech or
preview request gets its own planner, so generating a response never advances
the idle track (or another response's cursor).
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import json
import math
from pathlib import Path
import re
import threading
from types import MappingProxyType
from typing import Any, Iterator, Mapping, Sequence

import numpy as np
from numpy.typing import NDArray


ALLOWED_ACTIONS = ("idle", "talk_subtle", "welcome", "point", "thank")
_DEFAULT_ACTION_MODES: Mapping[str, str] = {
    "idle": "pingpong",
    "talk_subtle": "pingpong",
    "welcome": "once",
    "point": "once",
    "thank": "once",
}
_AUTO_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("welcome", ("欢迎", "你好", "您好", "hello", "hi")),
    ("point", ("看这里", "这里", "参数", "这款", "重点", "feature", "look")),
    ("thank", ("谢谢", "感谢", "下单", "再见", "thank", "bye", "order")),
)
_LOOPING_MODES = frozenset({"loop", "pingpong"})
_MAX_OUTPUT_PIXELS = 4096 * 2160
_MAX_CLIP_FRAMES = 10_000
_MAX_ARCHIVE_BYTES = 2 * 1024**3
_FACE_LANDMARK_COUNT = 6
_DEFAULT_PROFILE_ID = "default"
_PROFILE_ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")

RGBFrame = NDArray[np.uint8]


class ActionManifestError(ValueError):
    """Raised when an action manifest or one of its NPZ clips is invalid."""


class UnknownActionError(ValueError):
    """Raised when an action is not API-safe or has no installed clip."""


@dataclass(frozen=True)
class BodyActionFrame:
    """One immutable RGB target frame and its face geometry."""

    profile_id: str
    action: str
    frame_index: int
    frame: RGBFrame
    face_box: NDArray[np.float32]
    face_landmarks: NDArray[np.float32] | None


@dataclass(frozen=True)
class BodyActionRuntimeState:
    """Generation and currently requested playback state."""

    action: str
    speaking: bool
    generation: int
    active_generation: int | None


@dataclass(frozen=True)
class BodyActionPlannerState:
    """Snapshot of an independent planner cursor."""

    action: str
    frame_index: int
    direction: int
    generation: int | None
    emitted_frames: int
    remaining_frames: int | None
    active: bool


@dataclass(frozen=True)
class _ActionClip:
    profile_id: str
    name: str
    mode: str
    playback_rate: float
    frames: RGBFrame
    face_boxes: NDArray[np.float32]
    face_landmarks: NDArray[np.float32] | None
    face_landmarks_valid: NDArray[np.bool_] | None


class _PlaybackCursor:
    def __init__(self, clip: _ActionClip) -> None:
        self.clip = clip
        self.frame_index = 0
        self.direction = 1
        self.finished = False
        rate = Fraction(str(clip.playback_rate))
        self._rate_numerator = rate.numerator
        self._rate_denominator = rate.denominator
        self._phase_numerator = 0

    def advance(self) -> None:
        self._phase_numerator += self._rate_numerator
        if self._phase_numerator < self._rate_denominator:
            return
        self._phase_numerator -= self._rate_denominator

        frame_count = len(self.clip.frames)
        if self.clip.mode == "once":
            if self.frame_index >= frame_count - 1:
                self.finished = True
            else:
                self.frame_index += 1
            return

        if frame_count == 1:
            return
        if self.clip.mode == "loop":
            self.frame_index = (self.frame_index + 1) % frame_count
            return

        next_index = self.frame_index + self.direction
        if next_index >= frame_count:
            self.direction = -1
            next_index = frame_count - 2
        elif next_index < 0:
            self.direction = 1
            next_index = 1
        self.frame_index = next_index


class BodyActionPlanner:
    """A cursor owned by exactly one speech, preview, or offline job."""

    def __init__(
        self,
        runtime: BodyActionRuntime,
        action: str,
        *,
        total_frames: int | None,
        generation: int | None,
    ) -> None:
        self._runtime = runtime
        self._requested_action = action
        self._cursor = _PlaybackCursor(runtime._clips[action])
        self._total_frames = total_frames
        self._generation = generation
        self._emitted_frames = 0
        self._using_base_action = False
        self._lock = threading.RLock()

    @property
    def generation(self) -> int | None:
        return self._generation

    @property
    def requested_action(self) -> str:
        return self._requested_action

    @property
    def state(self) -> BodyActionPlannerState:
        with self._lock:
            remaining = (
                None
                if self._total_frames is None
                else max(0, self._total_frames - self._emitted_frames)
            )
            within_budget = remaining is None or remaining > 0
            active = within_budget and self._runtime._is_plan_active(self._generation)
            return BodyActionPlannerState(
                action=self._cursor.clip.name,
                frame_index=self._cursor.frame_index,
                direction=self._cursor.direction,
                generation=self._generation,
                emitted_frames=self._emitted_frames,
                remaining_frames=remaining,
                active=active,
            )

    def next_frame(self, speaking: bool = True) -> BodyActionFrame | None:
        """Return the next frame, or ``None`` when stale or budget-exhausted.

        A completed one-shot falls back to ``talk_subtle`` while speaking and
        to ``idle`` during a silent preview.  Once in that base state, changing
        ``speaking`` switches between the two base clips on the next call.
        """

        speaking = bool(speaking)
        with self._lock:
            if (
                self._total_frames is not None
                and self._emitted_frames >= self._total_frames
            ):
                return None

            if self._cursor.finished:
                self._switch_to_base(speaking)
            elif self._using_base_action:
                expected = self._runtime._base_action(speaking)
                if self._cursor.clip.name != expected:
                    self._cursor = _PlaybackCursor(self._runtime._clips[expected])

            action = self._cursor.clip.name
            if not self._runtime._record_plan_frame(
                self._generation,
                action=action,
                speaking=speaking,
            ):
                return None

            frame = self._runtime._frame_from_clip(
                self._cursor.clip,
                self._cursor.frame_index,
            )
            self._cursor.advance()
            self._emitted_frames += 1
            return frame

    def _switch_to_base(self, speaking: bool) -> None:
        action = self._runtime._base_action(speaking)
        self._cursor = _PlaybackCursor(self._runtime._clips[action])
        self._using_base_action = True


class BodyActionRuntime:
    """Preloaded action clips plus generation-safe planner factories."""

    def __init__(self, manifest_path: str | Path) -> None:
        self._manifest_path = Path(manifest_path).expanduser().resolve()
        manifest = self._read_manifest(self._manifest_path)
        self._profile_id = self._parse_profile_id(
            manifest.get("profile", _DEFAULT_PROFILE_ID)
        )
        self._output_size = self._parse_output_size(manifest.get("output_size"))
        self._fps = self._parse_fps(manifest.get("fps"))
        self._clips = self._load_clips(manifest.get("actions"))
        for required in ("idle", "talk_subtle"):
            if required not in self._clips:
                raise ActionManifestError(
                    f"manifest actions must include {required!r}"
                )

        self._frame_counts = MappingProxyType(
            {name: len(clip.frames) for name, clip in self._clips.items()}
        )
        self._lock = threading.RLock()
        self._generation = 0
        self._active_generation: int | None = None
        self._active_action = "idle"
        self._speaking = False
        self._idle_planner = BodyActionPlanner(
            self,
            "idle",
            total_frames=None,
            generation=None,
        )

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def profile_id(self) -> str:
        return self._profile_id

    @property
    def output_size(self) -> tuple[int, int]:
        """Return ``(width, height)`` for all frames."""

        return self._output_size

    @property
    def actions(self) -> tuple[str, ...]:
        installed = tuple(name for name in ALLOWED_ACTIONS if name in self._clips)
        return ("auto", *installed)

    @property
    def frame_counts(self) -> Mapping[str, int]:
        return self._frame_counts

    def preview_frame_count(self, action: str) -> int:
        """Return an exact output-frame budget for one visual action pass."""

        clip = self._get_clip(action)
        frame_count = len(clip.frames)
        if clip.mode == "pingpong" and frame_count > 1:
            source_advances = frame_count * 2 - 2
        else:
            # A once clip needs one final advance to mark its last held frame
            # complete; a loop needs the same count to return to its start.
            source_advances = frame_count
        rate = Fraction(str(clip.playback_rate))
        return max(1, math.ceil(Fraction(source_advances, 1) / rate))

    @property
    def state(self) -> BodyActionRuntimeState:
        with self._lock:
            return BodyActionRuntimeState(
                action=self._active_action,
                speaking=self._speaking,
                generation=self._generation,
                active_generation=self._active_generation,
            )

    def resolve_action(self, action: str = "auto", *, text: str = "") -> str:
        """Validate an action and resolve ``auto`` with bounded keywords."""

        if not isinstance(action, str):
            raise UnknownActionError("action must be a string")
        normalized = action.strip().lower()
        if normalized == "auto":
            lowered_text = str(text).casefold()
            for candidate, keywords in _AUTO_KEYWORDS:
                if candidate in self._clips and any(
                    self._contains_keyword(lowered_text, keyword)
                    for keyword in keywords
                ):
                    return candidate
            return "talk_subtle"
        if normalized not in ALLOWED_ACTIONS:
            raise UnknownActionError(
                f"unsupported action {action!r}; allowed: {', '.join(self.actions)}"
            )
        if normalized not in self._clips:
            raise UnknownActionError(f"action {normalized!r} has no configured clip")
        return normalized

    def get_frame(self, action: str, index: int) -> BodyActionFrame:
        """Return a read-only frame by stable ``(action, index)`` identity."""

        clip = self._get_clip(action)
        if isinstance(index, bool) or not isinstance(index, int):
            raise TypeError("frame index must be an integer")
        if index < 0 or index >= len(clip.frames):
            raise IndexError(
                f"frame index {index} is outside action {action!r} "
                f"(0..{len(clip.frames) - 1})"
            )
        return self._frame_from_clip(clip, index)

    def iter_frames(self, action: str | None = None) -> Iterator[BodyActionFrame]:
        """Iterate installed frames in stable action/index order."""

        if action is not None:
            clip = self._get_clip(action)
            for index in range(len(clip.frames)):
                yield self._frame_from_clip(clip, index)
            return

        for name in ALLOWED_ACTIONS:
            clip = self._clips.get(name)
            if clip is None:
                continue
            for index in range(len(clip.frames)):
                yield self._frame_from_clip(clip, index)

    def create_plan(
        self,
        action: str = "auto",
        *,
        text: str = "",
        total_frames: int | None = None,
        generation: int | None = None,
    ) -> BodyActionPlanner:
        """Create an independent plan without changing runtime state.

        Plans with ``generation=None`` are standalone and useful for offline
        preprocessing.  Supplying a generation binds the plan to an active
        speech/preview generation, so stale work returns ``None`` immediately.
        """

        resolved = self.resolve_action(action, text=text)
        frame_budget = self._parse_total_frames(total_frames)
        if generation is not None and (
            isinstance(generation, bool)
            or not isinstance(generation, int)
            or generation <= 0
        ):
            raise ValueError("generation must be a positive integer or None")
        return BodyActionPlanner(
            self,
            resolved,
            total_frames=frame_budget,
            generation=generation,
        )

    def begin_speech(
        self,
        action: str = "auto",
        *,
        text: str = "",
        total_frames: int | None = None,
    ) -> tuple[int, BodyActionPlanner]:
        """Activate and return a generation-bound speech plan."""

        return self._begin(
            action,
            text=text,
            total_frames=total_frames,
            speaking=True,
        )

    def begin_preview(
        self,
        action: str,
        *,
        total_frames: int | None = None,
    ) -> tuple[int, BodyActionPlanner]:
        """Activate a silent action preview; one-shots fall back to idle."""

        return self._begin(
            action,
            text="",
            total_frames=total_frames,
            speaking=False,
        )

    def begin_action(
        self,
        action: str,
        *,
        total_frames: int | None = None,
    ) -> tuple[int, BodyActionPlanner]:
        """Alias for :meth:`begin_preview` used by the HTTP action endpoint."""

        return self.begin_preview(action, total_frames=total_frames)

    def next_idle_frame(self) -> BodyActionFrame:
        """Advance only the dedicated idle cursor."""

        frame = self._idle_planner.next_frame(speaking=False)
        if frame is None:  # The unbound, unlimited idle plan cannot exhaust.
            raise RuntimeError("idle action planner unexpectedly exhausted")
        return frame

    def interrupt(self, generation: int | None = None) -> int:
        """Invalidate current work; a stale generation is a harmless no-op."""

        with self._lock:
            if (
                generation is not None
                and generation != self._active_generation
            ):
                return self._generation
            self._generation += 1
            self._active_generation = None
            self._active_action = "idle"
            self._speaking = False
            return self._generation

    def finish(self, generation: int) -> bool:
        """Mark a current plan complete without cancelling a newer plan."""

        with self._lock:
            if generation != self._active_generation:
                return False
            self._active_generation = None
            self._active_action = "idle"
            self._speaking = False
            return True

    def is_generation_active(self, generation: int) -> bool:
        with self._lock:
            return generation == self._active_generation

    def _begin(
        self,
        action: str,
        *,
        text: str,
        total_frames: int | None,
        speaking: bool,
    ) -> tuple[int, BodyActionPlanner]:
        resolved = self.resolve_action(action, text=text)
        frame_budget = self._parse_total_frames(total_frames)
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._active_generation = generation
            self._active_action = resolved
            self._speaking = speaking
        planner = BodyActionPlanner(
            self,
            resolved,
            total_frames=frame_budget,
            generation=generation,
        )
        return generation, planner

    def _base_action(self, speaking: bool) -> str:
        return "talk_subtle" if speaking else "idle"

    def _is_plan_active(self, generation: int | None) -> bool:
        if generation is None:
            return True
        with self._lock:
            return generation == self._active_generation

    def _record_plan_frame(
        self,
        generation: int | None,
        *,
        action: str,
        speaking: bool,
    ) -> bool:
        if generation is None:
            return True
        with self._lock:
            if generation != self._active_generation:
                return False
            self._active_action = action
            self._speaking = speaking
            return True

    def _get_clip(self, action: str) -> _ActionClip:
        if not isinstance(action, str):
            raise UnknownActionError("action must be a string")
        normalized = action.strip().lower()
        if normalized == "auto":
            raise UnknownActionError("'auto' has no directly addressable frames")
        if normalized not in ALLOWED_ACTIONS:
            raise UnknownActionError(f"unsupported action {action!r}")
        try:
            return self._clips[normalized]
        except KeyError as exc:
            raise UnknownActionError(
                f"action {normalized!r} has no configured clip"
            ) from exc

    @staticmethod
    def _frame_from_clip(clip: _ActionClip, index: int) -> BodyActionFrame:
        landmarks = None
        if (
            clip.face_landmarks is not None
            and clip.face_landmarks_valid is not None
            and bool(clip.face_landmarks_valid[index])
        ):
            landmarks = clip.face_landmarks[index]
        return BodyActionFrame(
            profile_id=clip.profile_id,
            action=clip.name,
            frame_index=index,
            frame=clip.frames[index],
            face_box=clip.face_boxes[index],
            face_landmarks=landmarks,
        )

    def _load_clips(self, raw_actions: Any) -> dict[str, _ActionClip]:
        if not isinstance(raw_actions, Mapping) or not raw_actions:
            raise ActionManifestError("manifest actions must be a non-empty object")
        if any(not isinstance(name, str) for name in raw_actions):
            raise ActionManifestError("manifest action names must be strings")
        unknown = [name for name in raw_actions if name not in ALLOWED_ACTIONS]
        if unknown:
            raise ActionManifestError(
                "manifest contains non-whitelisted actions: "
                + ", ".join(sorted(unknown))
            )

        clips: dict[str, _ActionClip] = {}
        for name in ALLOWED_ACTIONS:
            if name not in raw_actions:
                continue
            config = raw_actions[name]
            if not isinstance(config, Mapping):
                raise ActionManifestError(f"action {name!r} must be an object")
            mode = self._parse_mode(name, config.get("mode", _DEFAULT_ACTION_MODES[name]))
            playback_rate = self._parse_playback_rate(
                name,
                config.get("playback_rate", 1.0),
            )
            raw_file = config.get("file")
            clip_path = self._resolve_clip_path(name, raw_file)
            clip = self._load_clip(name, mode, playback_rate, clip_path)
            expected_frames = config.get("frames")
            if expected_frames is not None:
                if (
                    isinstance(expected_frames, bool)
                    or not isinstance(expected_frames, int)
                    or expected_frames <= 0
                ):
                    raise ActionManifestError(
                        f"action {name!r} frames metadata must be a positive integer"
                    )
                if expected_frames != len(clip.frames):
                    raise ActionManifestError(
                        f"action {name!r} declares {expected_frames} frames but "
                        f"the clip contains {len(clip.frames)}"
                    )
            clips[name] = clip
        return clips

    def _resolve_clip_path(self, action: str, raw_file: Any) -> Path:
        if not isinstance(raw_file, str) or not raw_file.strip():
            raise ActionManifestError(f"action {action!r} must define file")
        relative = Path(raw_file)
        if relative.is_absolute():
            raise ActionManifestError(f"action {action!r} file must be relative")
        root = self._manifest_path.parent
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ActionManifestError(
                f"action {action!r} file must stay inside the manifest directory"
            ) from exc
        if path.suffix.lower() != ".npz":
            raise ActionManifestError(f"action {action!r} file must be an NPZ archive")
        try:
            archive_bytes = path.stat().st_size
        except OSError as exc:
            raise ActionManifestError(
                f"could not access action {action!r} clip {path}: {exc}"
            ) from exc
        if archive_bytes > _MAX_ARCHIVE_BYTES:
            raise ActionManifestError(f"action {action!r} archive is too large")
        return path

    def _load_clip(
        self,
        name: str,
        mode: str,
        playback_rate: float,
        path: Path,
    ) -> _ActionClip:
        try:
            with np.load(path, allow_pickle=False) as archive:
                frames = np.array(archive["frames"], copy=True, order="C")
                boxes = np.array(archive["face_boxes"], copy=True, order="C")
                landmarks = (
                    np.array(archive["face_landmarks"], copy=True, order="C")
                    if "face_landmarks" in archive.files
                    else None
                )
                landmarks_valid = (
                    np.array(
                        archive["face_landmarks_valid"],
                        copy=True,
                        order="C",
                    )
                    if "face_landmarks_valid" in archive.files
                    else None
                )
        except (OSError, KeyError, ValueError) as exc:
            raise ActionManifestError(
                f"could not load action {name!r} from {path}: {exc}"
            ) from exc

        width, height = self._output_size
        if frames.dtype != np.uint8 or frames.ndim != 4 or frames.shape[-1] != 3:
            raise ActionManifestError(
                f"action {name!r} frames must be uint8 [N,H,W,3] RGB"
            )
        if len(frames) == 0 or len(frames) > _MAX_CLIP_FRAMES:
            raise ActionManifestError(
                f"action {name!r} must contain 1..{_MAX_CLIP_FRAMES} frames"
            )
        if frames.shape[1:3] != (height, width):
            raise ActionManifestError(
                f"action {name!r} frames are {frames.shape[2]}x{frames.shape[1]}; "
                f"expected {width}x{height}"
            )
        if boxes.shape != (len(frames), 4) or not np.issubdtype(
            boxes.dtype,
            np.number,
        ):
            raise ActionManifestError(
                f"action {name!r} face_boxes must be numeric [N,4]"
            )

        converted_boxes = np.empty((len(frames), 4), dtype=np.float32)
        for index, raw_box in enumerate(boxes):
            box = np.asarray(raw_box, dtype=np.float64)
            if not np.isfinite(box).all():
                raise ActionManifestError(
                    f"action {name!r} frame {index} face_box must be finite"
                )
            if np.all((box >= 0.0) & (box <= 1.0)):
                box = box * np.asarray([width, height, width, height])
            x1, y1, x2, y2 = box
            if (
                x1 < 0.0
                or y1 < 0.0
                or x2 > width
                or y2 > height
                or x2 <= x1
                or y2 <= y1
            ):
                raise ActionManifestError(
                    f"action {name!r} frame {index} face_box is outside "
                    f"{width}x{height} or has no area"
                )
            converted_boxes[index] = box

        if (landmarks is None) != (landmarks_valid is None):
            raise ActionManifestError(
                f"action {name!r} must define both face_landmarks and "
                "face_landmarks_valid"
            )
        converted_landmarks = None
        converted_valid = None
        if landmarks is not None and landmarks_valid is not None:
            if landmarks.shape != (len(frames), _FACE_LANDMARK_COUNT, 2) or not np.issubdtype(
                landmarks.dtype,
                np.number,
            ):
                raise ActionManifestError(
                    f"action {name!r} face_landmarks must be numeric [N,6,2]"
                )
            if landmarks_valid.shape != (len(frames),) or landmarks_valid.dtype != np.bool_:
                raise ActionManifestError(
                    f"action {name!r} face_landmarks_valid must be bool [N]"
                )
            valid_points = landmarks[landmarks_valid]
            if not np.isfinite(valid_points).all():
                raise ActionManifestError(
                    f"action {name!r} valid face_landmarks must be finite"
                )
            if (
                np.any(valid_points[..., 0] < 0.0)
                or np.any(valid_points[..., 0] > width)
                or np.any(valid_points[..., 1] < 0.0)
                or np.any(valid_points[..., 1] > height)
            ):
                raise ActionManifestError(
                    f"action {name!r} valid face_landmarks are outside "
                    f"{width}x{height}"
                )
            converted_valid = landmarks_valid.astype(np.bool_, copy=True)
            converted_landmarks = np.zeros(
                (len(frames), _FACE_LANDMARK_COUNT, 2),
                dtype=np.float32,
            )
            converted_landmarks[converted_valid] = landmarks[converted_valid]

        frames.setflags(write=False)
        converted_boxes.setflags(write=False)
        if converted_landmarks is not None:
            converted_landmarks.setflags(write=False)
        if converted_valid is not None:
            converted_valid.setflags(write=False)
        return _ActionClip(
            profile_id=self._profile_id,
            name=name,
            mode=mode,
            playback_rate=playback_rate,
            frames=frames,
            face_boxes=converted_boxes,
            face_landmarks=converted_landmarks,
            face_landmarks_valid=converted_valid,
        )

    @staticmethod
    def _read_manifest(path: Path) -> Mapping[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ActionManifestError(f"could not read manifest {path}: {exc}") from exc
        if not isinstance(payload, Mapping):
            raise ActionManifestError("manifest root must be an object")
        return payload

    @staticmethod
    def _parse_output_size(value: Any) -> tuple[int, int]:
        if (
            not isinstance(value, Sequence)
            or isinstance(value, (str, bytes))
            or len(value) != 2
            or any(isinstance(item, bool) or not isinstance(item, int) for item in value)
        ):
            raise ActionManifestError("output_size must be [width, height] integers")
        width, height = value
        if width <= 0 or height <= 0 or width * height > _MAX_OUTPUT_PIXELS:
            raise ActionManifestError("output_size must be positive and no larger than 4K")
        return width, height

    @staticmethod
    def _parse_fps(value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ActionManifestError("fps must be a number")
        fps = float(value)
        if not math.isfinite(fps) or not 1.0 <= fps <= 120.0:
            raise ActionManifestError("fps must be finite and between 1 and 120")
        return fps

    @staticmethod
    def _parse_profile_id(value: Any) -> str:
        if not isinstance(value, str) or _PROFILE_ID_PATTERN.fullmatch(value) is None:
            raise ActionManifestError(
                "profile must be a lowercase ASCII identifier containing only "
                "letters, numbers, hyphens, or underscores (maximum 64 characters)"
            )
        return value

    @staticmethod
    def _parse_playback_rate(action: str, value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ActionManifestError(
                f"action {action!r} playback_rate must be a number"
            )
        playback_rate = float(value)
        if not math.isfinite(playback_rate) or not 0.0 < playback_rate <= 1.0:
            raise ActionManifestError(
                f"action {action!r} playback_rate must be finite and greater "
                "than 0 and no greater than 1"
            )
        return playback_rate

    @staticmethod
    def _parse_mode(action: str, value: Any) -> str:
        if not isinstance(value, str):
            raise ActionManifestError(f"action {action!r} mode must be a string")
        normalized = value.strip().lower().replace("-", "").replace("_", "")
        if normalized == "pingpong":
            mode = "pingpong"
        elif normalized in {"loop", "once"}:
            mode = normalized
        else:
            raise ActionManifestError(
                f"action {action!r} mode must be loop, pingpong, or once"
            )
        if action in {"idle", "talk_subtle"} and mode not in _LOOPING_MODES:
            raise ActionManifestError(f"action {action!r} must use a looping mode")
        if action in {"welcome", "point", "thank"} and mode != "once":
            raise ActionManifestError(f"action {action!r} must use mode 'once'")
        return mode

    @staticmethod
    def _parse_total_frames(value: int | None) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("total_frames must be a non-negative integer or None")
        return value

    @staticmethod
    def _contains_keyword(lowered_text: str, keyword: str) -> bool:
        folded_keyword = keyword.casefold()
        if folded_keyword.isascii():
            return (
                re.search(
                    rf"(?<![a-z0-9_]){re.escape(folded_keyword)}(?![a-z0-9_])",
                    lowered_text,
                )
                is not None
            )
        return folded_keyword in lowered_text


__all__ = [
    "ALLOWED_ACTIONS",
    "ActionManifestError",
    "BodyActionFrame",
    "BodyActionPlanner",
    "BodyActionPlannerState",
    "BodyActionRuntime",
    "BodyActionRuntimeState",
    "UnknownActionError",
]
