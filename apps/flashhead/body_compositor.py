"""Preloaded body-action playback and face compositing for FlashHead.

The compositor deliberately performs all disk I/O and clip resizing in its
constructor. ``composite`` is then cheap enough to call from a real-time video
track: it selects an already-decoded body frame, crossfades action changes and
blends the generated face into the frame.

Manifest coordinates use ``[x1, y1, x2, y2]``. Coordinates whose four values
are all in the 0..1 range are interpreted as normalized values; other values
are pixels. ``output_size`` is ``[width, height]``.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import re
import threading
from typing import Any, Mapping, Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

from .face_tracking import (
    FACE_KEYPOINT_COUNT,
    FaceDetector,
    FaceGeometry,
    MediaPipeFaceDetector,
    SourceFaceTracker,
    estimate_similarity_transform,
    transform_box,
)


ALLOWED_ACTIONS = ("idle", "talk_subtle", "welcome", "point", "thank")
ACTION_MODES: Mapping[str, str] = {
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

RGBFrame = NDArray[np.uint8]
log = logging.getLogger(__name__)


class ActionManifestError(ValueError):
    """Raised when a body-action manifest or clip is invalid."""


class UnknownActionError(ValueError):
    """Raised when an action is outside the whitelist or is not installed."""


@dataclass(frozen=True)
class BodyCompositorState:
    """A serializable snapshot of the playback state."""

    action: str
    speaking: bool
    generation: int
    active_generation: int
    frame_index: int
    direction: int
    queued_actions: tuple[str, ...]
    crossfade_remaining: int
    tracking_enabled: bool
    fallback_frames: int


@dataclass(frozen=True)
class _ActionClip:
    name: str
    mode: str
    frames: RGBFrame
    face_boxes: NDArray[np.float32]
    face_landmarks: NDArray[np.float32] | None
    face_landmarks_valid: NDArray[np.bool_] | None


@dataclass(frozen=True)
class _QueuedAction:
    name: str
    generation: int


class BodyCompositor:
    """Play body clips and blend FlashHead face frames into them.

    Args:
        manifest_path: JSON manifest describing the output and action clips.
        source_face_box: Optional source-face override in normalized or pixel
            ``xyxy`` coordinates. When omitted, the manifest value is used.

    The supported manifest shape is::

        {
          "output_size": [360, 624],
          "source_face_box": [0.2, 0.16, 0.8, 0.78],
          "crossfade_frames": 5,
          "feather_ratio": 0.14,
          "transition_mode": "cut",
          "landmark_schema": "mediapipe_face_detection_6",
          "source_face_landmarks": [[...], ...],
          "actions": {
            "idle": {"file": "idle.npz", "mode": "pingpong"},
            "talk_subtle": {"file": "talk.npz", "mode": "pingpong"},
            "welcome": {"file": "welcome.npz", "mode": "once"}
          }
        }

    Each NPZ must contain RGB ``uint8 frames[N,H,W,3]`` and float-compatible
    ``face_boxes[N,4]`` arrays. Version-two clips can additionally include
    ``face_landmarks[N,6,2]`` and ``face_landmarks_valid[N]``. Clips are
    immutable after construction, so one compositor instance should be owned
    by one WebRTC playback session.
    """

    def __init__(
        self,
        manifest_path: str | Path,
        *,
        source_face_box: Sequence[float] | None = None,
        face_detector: FaceDetector | None = None,
    ) -> None:
        self._manifest_path = Path(manifest_path).expanduser().resolve()
        manifest = self._read_manifest(self._manifest_path)

        self._output_width, self._output_height = self._parse_output_size(
            manifest.get("output_size")
        )
        self._crossfade_frames = self._parse_crossfade_frames(
            manifest.get("crossfade_frames", 5)
        )
        self._feather_ratio = self._parse_feather_ratio(
            manifest.get("feather_ratio", 0.14)
        )
        self._transition_mode = self._parse_transition_mode(
            manifest.get("transition_mode", "crossfade")
        )
        self._landmark_schema = manifest.get("landmark_schema")
        if self._landmark_schema not in {None, "mediapipe_face_detection_6"}:
            raise ActionManifestError(
                "landmark_schema must be 'mediapipe_face_detection_6'"
            )
        self._color_match_strength = self._parse_unit_ratio(
            manifest.get("color_match_strength", 0.0),
            label="color_match_strength",
        )

        raw_source_box = (
            source_face_box
            if source_face_box is not None
            else manifest.get("source_face_box")
        )
        if raw_source_box is None:
            raise ActionManifestError("manifest must define source_face_box")
        self._source_face_box = self._parse_box(
            raw_source_box, label="source_face_box"
        )
        raw_source_landmarks = manifest.get("source_face_landmarks")
        self._source_face_landmarks = (
            self._parse_landmarks(
                raw_source_landmarks,
                label="source_face_landmarks",
            )
            if raw_source_landmarks is not None
            else None
        )
        if self._landmark_schema is not None:
            if self._source_face_landmarks is None:
                raise ActionManifestError(
                    "landmark_schema requires source_face_landmarks"
                )
            if not np.all(
                (self._source_face_landmarks >= 0.0)
                & (self._source_face_landmarks <= 1.0)
            ):
                raise ActionManifestError(
                    "source_face_landmarks must use normalized 0..1 coordinates"
                )

        self._clips = self._load_clips(manifest.get("actions"))
        if "idle" not in self._clips:
            raise ActionManifestError("manifest actions must include idle")

        self._face_tracker: SourceFaceTracker | None = None
        if self._landmark_schema is not None:
            detector = face_detector
            if detector is None:
                try:
                    detector = MediaPipeFaceDetector(
                        model_selection=0,
                        min_detection_confidence=0.25,
                    )
                except Exception as exc:
                    raise ActionManifestError(
                        "could not initialize dynamic face tracking"
                    ) from exc
            if detector is not None:
                self._face_tracker = SourceFaceTracker(
                    detector,
                    detection_interval=2,
                    max_stale_frames=3,
                )

        self._lock = threading.RLock()
        self._speaking = False
        self._generation = 0
        self._active_generation = 0
        self._current_action = "idle"
        self._frame_index = 0
        self._direction = 1
        self._action_finished = False
        self._queue: deque[_QueuedAction] = deque()

        self._last_body_frame: RGBFrame | None = None
        self._last_face_box: NDArray[np.float32] | None = None
        self._transition_frame: RGBFrame | None = None
        self._transition_box: NDArray[np.float32] | None = None
        self._transition_landmarks: NDArray[np.float32] | None = None
        self._transition_step = self._crossfade_frames
        self._last_face_landmarks: NDArray[np.float32] | None = None
        self._color_offset = np.zeros(3, dtype=np.float32)
        self._color_offset_valid = False
        self._tracker_warning_emitted = False
        self._landmark_warp_warning_emitted = False
        self._bbox_warp_warning_emitted = False
        self._fallback_frames = 0

    @property
    def output_size(self) -> tuple[int, int]:
        """Return the fixed ``(width, height)`` of every composed frame."""

        return self._output_width, self._output_height

    @property
    def actions(self) -> tuple[str, ...]:
        """Return API-safe actions, including the automatic keyword mode."""

        installed = tuple(name for name in ALLOWED_ACTIONS if name in self._clips)
        return ("auto", *installed)

    def close(self) -> None:
        """Release the runtime face detector after frame production stops."""

        with self._lock:
            tracker = self._face_tracker
            self._face_tracker = None
            if tracker is not None:
                tracker.close()

    @property
    def state(self) -> BodyCompositorState:
        """Return a consistent playback-state snapshot."""

        with self._lock:
            remaining = max(0, self._crossfade_frames - self._transition_step)
            return BodyCompositorState(
                action=self._current_action,
                speaking=self._speaking,
                generation=self._generation,
                active_generation=self._active_generation,
                frame_index=self._frame_index,
                direction=self._direction,
                queued_actions=tuple(item.name for item in self._queue),
                crossfade_remaining=remaining,
                tracking_enabled=self._face_tracker is not None,
                fallback_frames=self._fallback_frames,
            )

    def resolve_action(self, action: str = "auto", *, text: str = "") -> str:
        """Validate an action and resolve ``auto`` using lightweight keywords."""

        normalized = action.strip().lower()
        if normalized == "auto":
            lowered_text = text.casefold()
            for candidate, keywords in _AUTO_KEYWORDS:
                if candidate in self._clips and any(
                    self._contains_keyword(lowered_text, keyword)
                    for keyword in keywords
                ):
                    return candidate
            return "talk_subtle" if "talk_subtle" in self._clips else "idle"

        if normalized not in ALLOWED_ACTIONS:
            raise UnknownActionError(
                f"unsupported action {action!r}; allowed: {', '.join(self.actions)}"
            )
        if normalized not in self._clips:
            raise UnknownActionError(f"action {normalized!r} has no configured clip")
        return normalized

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

    def request_action(
        self,
        action: str = "auto",
        *,
        text: str = "",
        interrupt: bool = True,
    ) -> int:
        """Start or queue an action and return its monotonically increasing token.

        With ``interrupt=False``, a request made while a one-shot action is
        active is queued. All other requests switch immediately. The returned
        generation can later be passed to :meth:`interrupt` to avoid cancelling
        a newer request by accident.
        """

        resolved = self.resolve_action(action, text=text)
        with self._lock:
            self._generation += 1
            requested_generation = self._generation
            current_is_once = self._clips[self._current_action].mode == "once"
            if not interrupt and current_is_once and not self._action_finished:
                self._queue.append(_QueuedAction(resolved, requested_generation))
            else:
                if interrupt:
                    self._queue.clear()
                self._switch_to(resolved, generation=requested_generation)
            return requested_generation

    def interrupt(self, generation: int | None = None) -> int:
        """Cancel body actions and return the current generation.

        If ``generation`` is supplied and is stale, this is a no-op. This makes
        late cancellation from an older speech request harmless.
        """

        with self._lock:
            if generation is not None and generation != self._generation:
                return self._generation
            self._generation += 1
            self._queue.clear()
            if self._face_tracker is not None:
                self._face_tracker.reset()
            self._switch_to(self._base_action(), generation=self._generation)
            return self._generation

    def composite(self, face_frame: NDArray[Any], speaking: bool) -> RGBFrame:
        """Return one fixed-size RGB body frame containing ``face_frame``."""

        face = self._validate_face_frame(face_frame)
        with self._lock:
            next_speaking = bool(speaking)
            if next_speaking != self._speaking and self._face_tracker is not None:
                self._face_tracker.reset()
            self._speaking = next_speaking
            self._reconcile_action()
            body, target_box, target_landmarks = self._next_body_frame()
            source_geometry = None
            if self._face_tracker is not None:
                try:
                    source_geometry = self._face_tracker.track(face)
                except Exception:
                    self._face_tracker.reset()
                    if not self._tracker_warning_emitted:
                        log.exception(
                            "dynamic face tracking failed; using fixed-box fallback"
                        )
                        self._tracker_warning_emitted = True
            output = self._blend_face(
                body,
                target_box,
                face,
                source_geometry=source_geometry,
                target_landmarks=target_landmarks,
            )
            return np.ascontiguousarray(output, dtype=np.uint8)

    def _base_action(self) -> str:
        if self._speaking and "talk_subtle" in self._clips:
            return "talk_subtle"
        return "idle"

    def _reconcile_action(self) -> None:
        if self._action_finished:
            if self._queue:
                queued = self._queue.popleft()
                self._switch_to(queued.name, generation=queued.generation)
            else:
                self._switch_to(self._base_action(), generation=self._generation)
            return

        current_clip = self._clips[self._current_action]
        if current_clip.mode != "once":
            base = self._base_action()
            if base != self._current_action:
                self._switch_to(base, generation=self._generation)

    def _switch_to(self, action: str, *, generation: int) -> None:
        if action == self._current_action and not self._action_finished:
            self._active_generation = generation
            return

        if self._transition_mode == "crossfade" and self._last_body_frame is not None:
            self._transition_frame = self._last_body_frame.copy()
            if self._last_face_box is not None:
                self._transition_box = self._last_face_box.copy()
            if self._last_face_landmarks is not None:
                self._transition_landmarks = self._last_face_landmarks.copy()
            self._transition_step = 0
        else:
            self._transition_frame = None
            self._transition_box = None
            self._transition_landmarks = None
            self._transition_step = self._crossfade_frames

        self._current_action = action
        self._active_generation = generation
        self._frame_index = 0
        self._direction = 1
        self._action_finished = False
        self._color_offset_valid = False

    def _next_body_frame(
        self,
    ) -> tuple[
        RGBFrame,
        NDArray[np.float32],
        NDArray[np.float32] | None,
    ]:
        clip = self._clips[self._current_action]
        target_frame = clip.frames[self._frame_index]
        target_box = clip.face_boxes[self._frame_index]
        target_landmarks = None
        if (
            clip.face_landmarks is not None
            and clip.face_landmarks_valid is not None
            and bool(clip.face_landmarks_valid[self._frame_index])
        ):
            target_landmarks = clip.face_landmarks[self._frame_index]

        if (
            self._transition_frame is not None
            and self._transition_box is not None
            and self._transition_step < self._crossfade_frames
        ):
            alpha = (self._transition_step + 1) / self._crossfade_frames
            body = self._crossfade(self._transition_frame, target_frame, alpha)
            face_box = (
                self._transition_box * (1.0 - alpha) + target_box * alpha
            ).astype(np.float32)
            if self._transition_landmarks is not None and target_landmarks is not None:
                face_landmarks = (
                    self._transition_landmarks * (1.0 - alpha)
                    + target_landmarks * alpha
                ).astype(np.float32)
            else:
                face_landmarks = target_landmarks
            self._transition_step += 1
            if self._transition_step >= self._crossfade_frames:
                self._transition_frame = None
                self._transition_box = None
                self._transition_landmarks = None
        else:
            body = target_frame.copy()
            face_box = target_box.copy()
            face_landmarks = (
                target_landmarks.copy() if target_landmarks is not None else None
            )

        self._last_body_frame = body.copy()
        self._last_face_box = face_box.copy()
        self._last_face_landmarks = (
            face_landmarks.copy() if face_landmarks is not None else None
        )
        self._advance_cursor(clip)
        return body, face_box, face_landmarks

    def _advance_cursor(self, clip: _ActionClip) -> None:
        frame_count = len(clip.frames)
        if clip.mode == "once":
            if self._frame_index >= frame_count - 1:
                self._action_finished = True
            else:
                self._frame_index += 1
            return

        if frame_count == 1:
            self._frame_index = 0
            return

        next_index = self._frame_index + self._direction
        if next_index >= frame_count:
            self._direction = -1
            next_index = frame_count - 2
        elif next_index < 0:
            self._direction = 1
            next_index = 1
        self._frame_index = next_index

    def _blend_face(
        self,
        body: RGBFrame,
        target_box: NDArray[np.float32],
        face: RGBFrame,
        *,
        source_geometry: FaceGeometry | None,
        target_landmarks: NDArray[np.float32] | None,
    ) -> RGBFrame:
        source_box = self._box_to_pixels(
            self._source_face_box,
            face.shape[1],
            face.shape[0],
        )
        if self._landmark_schema is None:
            return self._resize_blend_face(body, target_box, face, source_box)

        used_fallback = source_geometry is None or target_landmarks is None
        if source_geometry is not None:
            source_box = self._stabilized_source_box(
                source_geometry,
                source_box,
                face.shape[1],
                face.shape[0],
            )
            if target_landmarks is not None:
                matrix = estimate_similarity_transform(
                    source_geometry.keypoints,
                    target_landmarks,
                    target_box=target_box,
                )
                if matrix is not None:
                    try:
                        return self._warp_blend_face(
                            body,
                            face,
                            source_box,
                            target_box,
                            matrix,
                        )
                    except (cv2.error, FloatingPointError, ValueError):
                        used_fallback = True
                        if not self._landmark_warp_warning_emitted:
                            log.exception(
                                "landmark face warp failed; using bbox fallback"
                            )
                            self._landmark_warp_warning_emitted = True
                else:
                    used_fallback = True

        if used_fallback:
            self._fallback_frames += 1
        try:
            return self._warp_blend_face(
                body,
                face,
                source_box,
                target_box,
                self._box_affine(source_box, target_box),
            )
        except (cv2.error, FloatingPointError, ValueError):
            if not used_fallback:
                self._fallback_frames += 1
            if not self._bbox_warp_warning_emitted:
                log.exception("bbox face warp failed; using legacy resize fallback")
                self._bbox_warp_warning_emitted = True
            return self._resize_blend_face(body, target_box, face, source_box)

    @staticmethod
    def _box_affine(
        source_box: NDArray[np.float32],
        target_box: NDArray[np.float32],
    ) -> NDArray[np.float32]:
        source_width = float(source_box[2] - source_box[0])
        source_height = float(source_box[3] - source_box[1])
        if source_width <= 0.0 or source_height <= 0.0:
            raise ValueError("source face box must have positive dimensions")
        scale_x = float(target_box[2] - target_box[0]) / source_width
        scale_y = float(target_box[3] - target_box[1]) / source_height
        return np.asarray(
            [
                [scale_x, 0.0, target_box[0] - source_box[0] * scale_x],
                [0.0, scale_y, target_box[1] - source_box[1] * scale_y],
            ],
            dtype=np.float32,
        )

    def _stabilized_source_box(
        self,
        geometry: FaceGeometry,
        fallback_box: NDArray[np.float32],
        width: int,
        height: int,
    ) -> NDArray[np.float32]:
        if self._source_face_landmarks is None:
            return geometry.box
        reference_landmarks = self._landmarks_to_pixels(
            self._source_face_landmarks,
            width,
            height,
        )
        matrix = estimate_similarity_transform(
            reference_landmarks,
            geometry.keypoints,
            target_box=geometry.box,
        )
        if matrix is None:
            return geometry.box
        transformed = transform_box(fallback_box, matrix)
        transformed[[0, 2]] = np.clip(transformed[[0, 2]], 0.0, float(width))
        transformed[[1, 3]] = np.clip(transformed[[1, 3]], 0.0, float(height))
        if transformed[2] - transformed[0] < 8.0 or transformed[3] - transformed[1] < 8.0:
            return geometry.box
        return transformed.astype(np.float32)

    def _resize_blend_face(
        self,
        body: RGBFrame,
        target_box: NDArray[np.float32],
        face: RGBFrame,
        source_box: NDArray[np.float32],
    ) -> RGBFrame:
        sx1, sy1, sx2, sy2 = self._integer_box(source_box, face.shape[1], face.shape[0])
        source_crop = face[sy1:sy2, sx1:sx2]

        tx1, ty1, tx2, ty2 = self._integer_box(
            target_box, self._output_width, self._output_height
        )
        target_width = tx2 - tx1
        target_height = ty2 - ty1
        resized = cv2.resize(
            source_crop,
            (target_width, target_height),
            interpolation=cv2.INTER_LINEAR,
        )

        yy, xx = np.ogrid[:target_height, :target_width]
        center_x = (target_width - 1) / 2.0
        center_y = (target_height - 1) / 2.0
        radius_x = max(target_width / 2.0, 0.5)
        radius_y = max(target_height / 2.0, 0.5)
        radial_distance = np.sqrt(
            ((xx - center_x) / radius_x) ** 2
            + ((yy - center_y) / radius_y) ** 2
        )
        mask = np.clip(
            (1.0 - radial_distance) / self._feather_ratio,
            0.0,
            1.0,
        ).astype(np.float32)[..., None]

        output = body.copy()
        body_region = output[ty1:ty2, tx1:tx2].astype(np.float32)
        blended = resized.astype(np.float32) * mask + body_region * (1.0 - mask)
        output[ty1:ty2, tx1:tx2] = np.rint(blended).astype(np.uint8)
        return output

    def _warp_blend_face(
        self,
        body: RGBFrame,
        face: RGBFrame,
        source_box: NDArray[np.float32],
        target_box: NDArray[np.float32],
        matrix: NDArray[np.float32],
    ) -> RGBFrame:
        target_width = float(target_box[2] - target_box[0])
        target_height = float(target_box[3] - target_box[1])
        expanded = np.asarray(
            [
                target_box[0] - target_width * 0.12,
                target_box[1] + target_height * 0.02,
                target_box[2] + target_width * 0.12,
                target_box[3] + target_height * 0.08,
            ],
            dtype=np.float32,
        )
        ex1, ey1, ex2, ey2 = self._integer_box(
            expanded,
            self._output_width,
            self._output_height,
        )
        roi_width = ex2 - ex1
        roi_height = ey2 - ey1
        roi_matrix = matrix.copy()
        roi_matrix[0, 2] -= ex1
        roi_matrix[1, 2] -= ey1
        warped_face = cv2.warpAffine(
            face,
            roi_matrix,
            (roi_width, roi_height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0),
        )
        source_points = self._face_polygon_points(
            face.shape[0],
            face.shape[1],
            source_box,
        )
        target_points = cv2.transform(
            source_points.reshape(1, -1, 2),
            roi_matrix,
        ).reshape(-1, 2)
        alpha = np.zeros((roi_height, roi_width), dtype=np.float32)
        cv2.fillPoly(alpha, [np.rint(target_points).astype(np.int32)], 1.0)
        blur_sigma = max(
            1.0,
            min(target_width, target_height) * self._feather_ratio * 0.45,
        )
        alpha = cv2.GaussianBlur(
            alpha,
            (0, 0),
            sigmaX=blur_sigma,
            sigmaY=blur_sigma,
            borderType=cv2.BORDER_CONSTANT,
        )
        alpha = np.clip(alpha, 0.0, 1.0)
        if float(alpha.max()) < 0.5:
            raise ValueError("warped face mask does not overlap the target ROI")

        body_region = body[ey1:ey2, ex1:ex2]
        adjusted_face = self._match_boundary_color(warped_face, body_region, alpha)
        alpha_rgb = alpha[..., None]
        blended = (
            adjusted_face.astype(np.float32) * alpha_rgb
            + body_region.astype(np.float32) * (1.0 - alpha_rgb)
        )
        output = body.copy()
        output[ey1:ey2, ex1:ex2] = np.rint(blended).astype(np.uint8)
        return output

    def _face_polygon_mask(
        self,
        height: int,
        width: int,
        box: NDArray[np.float32],
    ) -> NDArray[np.float32]:
        points = self._face_polygon_points(height, width, box)
        mask = np.zeros((height, width), dtype=np.float32)
        cv2.fillPoly(mask, [np.rint(points).astype(np.int32)], 1.0)
        box_width = float(box[2] - box[0])
        box_height = float(box[3] - box[1])
        blur_sigma = max(1.0, min(box_width, box_height) * self._feather_ratio * 0.45)
        return cv2.GaussianBlur(
            mask,
            (0, 0),
            sigmaX=blur_sigma,
            sigmaY=blur_sigma,
            borderType=cv2.BORDER_CONSTANT,
        )

    @staticmethod
    def _face_polygon_points(
        height: int,
        width: int,
        box: NDArray[np.float32],
    ) -> NDArray[np.float32]:
        x1, y1, x2, y2 = box
        box_width = float(x2 - x1)
        box_height = float(y2 - y1)
        # The upper edge stays below the hairline so the body clip retains hair
        # and hat pixels; the lower contour follows the generated jaw.
        normalized = np.asarray(
            [
                [0.12, 0.28],
                [0.30, 0.17],
                [0.50, 0.14],
                [0.70, 0.17],
                [0.88, 0.28],
                [0.96, 0.50],
                [0.88, 0.75],
                [0.70, 0.95],
                [0.50, 1.02],
                [0.30, 0.95],
                [0.12, 0.75],
                [0.04, 0.50],
            ],
            dtype=np.float32,
        )
        points = normalized * np.asarray([box_width, box_height], dtype=np.float32)
        points += np.asarray([x1, y1], dtype=np.float32)
        points[:, 0] = np.clip(points[:, 0], 0.0, width - 1.0)
        points[:, 1] = np.clip(points[:, 1], 0.0, height - 1.0)
        return points

    def _match_boundary_color(
        self,
        source: RGBFrame,
        target: RGBFrame,
        alpha: NDArray[np.float32],
    ) -> RGBFrame:
        if self._color_match_strength <= 0.0:
            return source
        if not self._color_offset_valid:
            ring = (alpha >= 0.15) & (alpha <= 0.75)
            source_luma = source.astype(np.float32).mean(axis=2)
            target_luma = target.astype(np.float32).mean(axis=2)
            skin_like = ring & (source_luma > 35.0) & (target_luma > 35.0)
            if int(skin_like.sum()) >= 32:
                delta = np.median(
                    target[skin_like].astype(np.float32)
                    - source[skin_like].astype(np.float32),
                    axis=0,
                )
                self._color_offset = (
                    np.clip(delta, -18.0, 18.0) * self._color_match_strength
                ).astype(np.float32)
            else:
                self._color_offset.fill(0.0)
            self._color_offset_valid = True
        if not np.any(np.abs(self._color_offset) >= 0.5):
            return source
        adjusted = source.astype(np.int16) + np.rint(self._color_offset).astype(np.int16)
        return np.clip(adjusted, 0, 255).astype(np.uint8)

    @staticmethod
    def _crossfade(first: RGBFrame, second: RGBFrame, alpha: float) -> RGBFrame:
        blended = (
            first.astype(np.float32) * (1.0 - alpha)
            + second.astype(np.float32) * alpha
        )
        return np.rint(blended).astype(np.uint8)

    def _load_clips(self, raw_actions: Any) -> dict[str, _ActionClip]:
        if not isinstance(raw_actions, Mapping) or not raw_actions:
            raise ActionManifestError("manifest actions must be a non-empty object")

        unknown = sorted(set(raw_actions) - set(ALLOWED_ACTIONS))
        if unknown:
            raise ActionManifestError(
                f"manifest contains non-whitelisted actions: {', '.join(unknown)}"
            )

        clips: dict[str, _ActionClip] = {}
        for name in ALLOWED_ACTIONS:
            if name not in raw_actions:
                continue
            config = raw_actions[name]
            if not isinstance(config, Mapping):
                raise ActionManifestError(f"action {name!r} must be an object")
            configured_mode = config.get("mode", ACTION_MODES[name])
            if configured_mode != ACTION_MODES[name]:
                raise ActionManifestError(
                    f"action {name!r} must use mode {ACTION_MODES[name]!r}"
                )
            raw_file = config.get("file")
            if not isinstance(raw_file, str) or not raw_file:
                raise ActionManifestError(f"action {name!r} must define file")
            clip_path = (self._manifest_path.parent / raw_file).resolve()
            clips[name] = self._load_clip(name, configured_mode, clip_path)
        return clips

    def _load_clip(self, name: str, mode: str, path: Path) -> _ActionClip:
        try:
            with np.load(path, allow_pickle=False) as archive:
                frames = archive["frames"]
                boxes = archive["face_boxes"]
                landmarks = (
                    archive["face_landmarks"]
                    if "face_landmarks" in archive.files
                    else None
                )
                landmarks_valid = (
                    archive["face_landmarks_valid"]
                    if "face_landmarks_valid" in archive.files
                    else None
                )
        except (OSError, KeyError, ValueError) as exc:
            raise ActionManifestError(
                f"could not load action {name!r} from {path}: {exc}"
            ) from exc

        if frames.dtype != np.uint8 or frames.ndim != 4 or frames.shape[-1] != 3:
            raise ActionManifestError(
                f"action {name!r} frames must be uint8 [N,H,W,3] RGB"
            )
        if len(frames) == 0:
            raise ActionManifestError(f"action {name!r} must contain a frame")
        if boxes.shape != (len(frames), 4) or not np.issubdtype(
            boxes.dtype, np.number
        ):
            raise ActionManifestError(
                f"action {name!r} face_boxes must have shape [N,4]"
            )
        if not np.isfinite(boxes).all():
            raise ActionManifestError(f"action {name!r} face_boxes must be finite")
        if (landmarks is None) != (landmarks_valid is None):
            raise ActionManifestError(
                f"action {name!r} must define both face_landmarks and "
                "face_landmarks_valid"
            )
        if landmarks is not None:
            if landmarks.shape != (len(frames), FACE_KEYPOINT_COUNT, 2) or not np.issubdtype(
                landmarks.dtype,
                np.number,
            ):
                raise ActionManifestError(
                    f"action {name!r} face_landmarks must have shape [N,6,2]"
                )
            if landmarks_valid.shape != (len(frames),) or landmarks_valid.dtype != np.bool_:
                raise ActionManifestError(
                    f"action {name!r} face_landmarks_valid must be bool [N]"
                )
            if not np.isfinite(landmarks[landmarks_valid]).all():
                raise ActionManifestError(
                    f"action {name!r} valid face_landmarks must be finite"
                )

        source_height, source_width = frames.shape[1:3]
        if landmarks is not None and landmarks_valid is not None:
            valid_points = landmarks[landmarks_valid]
            if (
                np.any(valid_points[..., 0] < 0.0)
                or np.any(valid_points[..., 0] > source_width)
                or np.any(valid_points[..., 1] < 0.0)
                or np.any(valid_points[..., 1] > source_height)
            ):
                raise ActionManifestError(
                    f"action {name!r} valid face_landmarks are outside "
                    f"{source_width}x{source_height}"
                )
        resized_frames = np.empty(
            (len(frames), self._output_height, self._output_width, 3),
            dtype=np.uint8,
        )
        resized_boxes = np.empty((len(frames), 4), dtype=np.float32)
        resized_landmarks = (
            np.empty((len(frames), FACE_KEYPOINT_COUNT, 2), dtype=np.float32)
            if landmarks is not None
            else None
        )
        box_scale = np.asarray(
            [
                self._output_width / source_width,
                self._output_height / source_height,
                self._output_width / source_width,
                self._output_height / source_height,
            ],
            dtype=np.float32,
        )
        point_scale = np.asarray(
            [
                self._output_width / source_width,
                self._output_height / source_height,
            ],
            dtype=np.float32,
        )
        for index, (frame, raw_box) in enumerate(zip(frames, boxes, strict=True)):
            resized_frames[index] = cv2.resize(
                frame,
                (self._output_width, self._output_height),
                interpolation=cv2.INTER_AREA
                if source_width > self._output_width or source_height > self._output_height
                else cv2.INTER_LINEAR,
            )
            pixel_box = self._box_to_pixels(raw_box, source_width, source_height)
            scaled_box = pixel_box * box_scale
            self._validate_pixel_box(
                scaled_box,
                self._output_width,
                self._output_height,
                label=f"action {name!r} frame {index} face_box",
            )
            resized_boxes[index] = scaled_box
            if resized_landmarks is not None and landmarks is not None:
                resized_landmarks[index] = np.asarray(
                    landmarks[index],
                    dtype=np.float32,
                ) * point_scale

        resized_frames.setflags(write=False)
        resized_boxes.setflags(write=False)
        if resized_landmarks is not None:
            resized_landmarks.setflags(write=False)
        readonly_valid = None
        if landmarks_valid is not None:
            readonly_valid = np.asarray(landmarks_valid, dtype=np.bool_).copy()
            readonly_valid.setflags(write=False)
        return _ActionClip(
            name,
            mode,
            resized_frames,
            resized_boxes,
            resized_landmarks,
            readonly_valid,
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
        if width <= 0 or height <= 0:
            raise ActionManifestError("output_size values must be positive")
        return width, height

    @staticmethod
    def _parse_crossfade_frames(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or not 4 <= value <= 6:
            raise ActionManifestError("crossfade_frames must be an integer from 4 to 6")
        return value

    @staticmethod
    def _parse_feather_ratio(value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ActionManifestError("feather_ratio must be a number")
        ratio = float(value)
        if not 0.01 <= ratio <= 0.5:
            raise ActionManifestError("feather_ratio must be between 0.01 and 0.5")
        return ratio

    @staticmethod
    def _parse_transition_mode(value: Any) -> str:
        if value not in {"crossfade", "cut"}:
            raise ActionManifestError("transition_mode must be 'crossfade' or 'cut'")
        return str(value)

    @staticmethod
    def _parse_unit_ratio(value: Any, *, label: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ActionManifestError(f"{label} must be a number")
        ratio = float(value)
        if not 0.0 <= ratio <= 1.0:
            raise ActionManifestError(f"{label} must be between 0 and 1")
        return ratio

    @staticmethod
    def _parse_box(value: Any, *, label: str) -> NDArray[np.float32]:
        try:
            box = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError) as exc:
            raise ActionManifestError(f"{label} must be four numbers") from exc
        if box.shape != (4,) or not np.isfinite(box).all():
            raise ActionManifestError(f"{label} must be four finite numbers")
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ActionManifestError(f"{label} must have positive width and height")
        return box

    @staticmethod
    def _parse_landmarks(value: Any, *, label: str) -> NDArray[np.float32]:
        try:
            landmarks = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError) as exc:
            raise ActionManifestError(f"{label} must be a [6,2] number array") from exc
        if landmarks.shape != (FACE_KEYPOINT_COUNT, 2) or not np.isfinite(
            landmarks
        ).all():
            raise ActionManifestError(f"{label} must be a finite [6,2] number array")
        return landmarks

    @classmethod
    def _landmarks_to_pixels(
        cls,
        value: Any,
        width: int,
        height: int,
    ) -> NDArray[np.float32]:
        landmarks = cls._parse_landmarks(value, label="face_landmarks")
        if np.all((landmarks >= 0.0) & (landmarks <= 1.0)):
            landmarks = landmarks * np.asarray([width, height], dtype=np.float32)
        if (
            np.any(landmarks[:, 0] < 0.0)
            or np.any(landmarks[:, 0] > width)
            or np.any(landmarks[:, 1] < 0.0)
            or np.any(landmarks[:, 1] > height)
        ):
            raise ActionManifestError(
                f"face_landmarks are outside {width}x{height}"
            )
        return landmarks.astype(np.float32, copy=False)

    @classmethod
    def _box_to_pixels(
        cls, value: Any, width: int, height: int
    ) -> NDArray[np.float32]:
        box = cls._parse_box(value, label="face_box")
        if np.all((box >= 0.0) & (box <= 1.0)):
            box = box * np.array([width, height, width, height], dtype=np.float32)
        cls._validate_pixel_box(box, width, height, label="face_box")
        return box.astype(np.float32, copy=False)

    @staticmethod
    def _validate_pixel_box(
        box: NDArray[np.float32], width: int, height: int, *, label: str
    ) -> None:
        if (
            box[0] < 0
            or box[1] < 0
            or box[2] > width
            or box[3] > height
            or box[2] <= box[0]
            or box[3] <= box[1]
        ):
            raise ActionManifestError(
                f"{label} {box.tolist()} is outside {width}x{height}"
            )

    @staticmethod
    def _integer_box(
        box: NDArray[np.float32], width: int, height: int
    ) -> tuple[int, int, int, int]:
        x1 = max(0, min(width - 1, int(np.floor(box[0]))))
        y1 = max(0, min(height - 1, int(np.floor(box[1]))))
        x2 = max(x1 + 1, min(width, int(np.ceil(box[2]))))
        y2 = max(y1 + 1, min(height, int(np.ceil(box[3]))))
        return x1, y1, x2, y2

    @staticmethod
    def _validate_face_frame(face_frame: NDArray[Any]) -> RGBFrame:
        frame = np.asarray(face_frame)
        if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("face_frame must be uint8 RGB with shape [H,W,3]")
        if frame.shape[0] == 0 or frame.shape[1] == 0:
            raise ValueError("face_frame dimensions must be non-zero")
        return np.ascontiguousarray(frame)
