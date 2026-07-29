#!/usr/bin/env python3
"""Prepare the internal FlashHead body-motion PoC from one source video."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from apps.flashhead.face_tracking import FaceGeometry, MediaPipeFaceDetector


DEFAULT_SOURCE = Path(
    "/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4"
)
ACTION_RANGES = {
    "idle": (14.0, 17.0, "pingpong"),
    "talk_subtle": (58.5, 61.5, "pingpong"),
    "welcome": (5.0, 9.0, "once"),
    "point": (41.8, 44.4, "once"),
    "thank": (35.7, 37.2, "once"),
}


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(os.environ.get("FLASHHEAD_BODY_SOURCE", DEFAULT_SOURCE)),
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=repo_root / "public/assets/flashhead-body/motion-host",
    )
    parser.add_argument(
        "--avatar-output",
        type=Path,
        default=repo_root / "public/assets/flashhead-avatars/motion-host.png",
    )
    parser.add_argument("--cyberverse-root", type=Path, default=Path(
        os.environ.get("FLASHHEAD_ROOT", "/data/llm_model/cyberverse")
    ))
    parser.add_argument("--fps", type=float, default=20.0)
    parser.add_argument("--width", type=int, default=360)
    parser.add_argument("--height", type=int, default=624)
    parser.add_argument("--reference-time", type=float, default=28.0)
    parser.add_argument(
        "--profile",
        default=os.environ.get("FLASHHEAD_BODY_PROFILE", "motion-host"),
    )
    parser.add_argument(
        "--ranges-json",
        type=Path,
        help="Optional action range/rate JSON used by MuseTalk profiles.",
    )
    return parser.parse_args()


def load_action_ranges(path: Path | None) -> dict[str, tuple[float, float, str, float]]:
    if path is None:
        return {
            name: (start, end, mode, 1.0)
            for name, (start, end, mode) in ACTION_RANGES.items()
        }
    payload = json.loads(path.expanduser().resolve(strict=True).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != set(ACTION_RANGES):
        raise ValueError("ranges JSON must define exactly idle/talk_subtle/welcome/point/thank")
    parsed: dict[str, tuple[float, float, str, float]] = {}
    for name in ACTION_RANGES:
        entry = payload[name]
        if not isinstance(entry, dict):
            raise ValueError(f"range {name!r} must be an object")
        start = float(entry["start"])
        end = float(entry["end"])
        mode = str(entry.get("mode", ACTION_RANGES[name][2]))
        rate = float(entry.get("playback_rate", 1.0))
        if start < 0 or end <= start or mode not in {"once", "loop", "pingpong"}:
            raise ValueError(f"range {name!r} is invalid")
        if not 0.0 < rate <= 1.0:
            raise ValueError(f"range {name!r} playback_rate must be in (0, 1]")
        parsed[name] = (start, end, mode, rate)
    return parsed


def make_detector(cyberverse_root: Path):
    # Keep the argument for CLI compatibility with earlier PoC tooling.
    del cyberverse_root
    return MediaPipeFaceDetector(model_selection=1, min_detection_confidence=0.25)


def read_frame(capture: cv2.VideoCapture, seconds: float) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000.0)
    ok, bgr = capture.read()
    if not ok or bgr is None:
        raise RuntimeError(f"could not decode source frame at {seconds:.3f}s")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def detect_face(detector, frame: np.ndarray) -> FaceGeometry:
    geometry = detector.detect(frame)
    if geometry is None:
        raise RuntimeError("face detector did not find a face")
    return geometry


def smooth_boxes(boxes: np.ndarray, radius: int = 2) -> np.ndarray:
    smoothed = np.empty_like(boxes, dtype=np.float32)
    for index in range(len(boxes)):
        start = max(0, index - radius)
        end = min(len(boxes), index + radius + 1)
        smoothed[index] = np.median(boxes[start:end], axis=0)
    return smoothed


def smooth_landmarks(
    landmarks: np.ndarray,
    valid: np.ndarray,
    radius: int = 2,
) -> np.ndarray:
    smoothed = landmarks.astype(np.float32, copy=True)
    for index in np.flatnonzero(valid):
        start = max(0, index - radius)
        end = min(len(landmarks), index + radius + 1)
        window = landmarks[start:end][valid[start:end]]
        if len(window):
            smoothed[index] = np.median(window, axis=0)
    return smoothed


def build_reference(
    capture: cv2.VideoCapture,
    detector,
    seconds: float,
    output_path: Path,
) -> tuple[list[float], list[list[float]]]:
    frame = read_frame(capture, seconds)
    geometry = detect_face(detector, frame)
    face_box = geometry.box
    height, width = frame.shape[:2]
    crop_size = min(width, height)
    center_x = float((face_box[0] + face_box[2]) / 2.0)
    center_y = float((face_box[1] + face_box[3]) / 2.0)
    left = int(round(center_x - crop_size / 2.0))
    top = int(round(center_y - crop_size * 0.55))
    left = min(max(0, left), width - crop_size)
    top = min(max(0, top), height - crop_size)
    crop = frame[top : top + crop_size, left : left + crop_size]
    avatar = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(avatar).save(output_path, format="PNG", optimize=True)

    relative_box = face_box - np.asarray([left, top, left, top], dtype=np.float32)
    relative_box /= float(crop_size)
    relative_box = np.clip(relative_box, 0.0, 1.0)
    relative_landmarks = geometry.keypoints - np.asarray(
        [left, top],
        dtype=np.float32,
    )
    relative_landmarks /= float(crop_size)
    relative_landmarks = np.clip(relative_landmarks, 0.0, 1.0)
    return (
        [round(float(value), 6) for value in relative_box],
        [
            [round(float(x), 6), round(float(y), 6)]
            for x, y in relative_landmarks
        ],
    )


def build_action(
    source: Path,
    detector,
    start: float,
    end: float,
    fps: float,
    width: int,
    height: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"could not open source video: {source}")
    frames: list[np.ndarray] = []
    boxes: list[np.ndarray] = []
    landmarks: list[np.ndarray] = []
    landmarks_valid: list[bool] = []
    previous_box: np.ndarray | None = None
    sample_count = max(1, int(round((end - start) * fps)))
    try:
        for sample_index in range(sample_count):
            seconds = start + sample_index / fps
            frame = read_frame(capture, seconds)
            try:
                geometry = detect_face(detector, frame)
                box = geometry.box
                previous_box = box
                frame_landmarks = geometry.keypoints
                frame_landmarks_valid = True
            except RuntimeError:
                if previous_box is None:
                    raise
                box = previous_box.copy()
                frame_landmarks = np.full((6, 2), np.nan, dtype=np.float32)
                frame_landmarks_valid = False
            source_height, source_width = frame.shape[:2]
            resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            scale = np.asarray(
                [
                    width / source_width,
                    height / source_height,
                    width / source_width,
                    height / source_height,
                ],
                dtype=np.float32,
            )
            frames.append(resized)
            boxes.append(box * scale)
            landmarks.append(
                frame_landmarks
                * np.asarray([width / source_width, height / source_height], dtype=np.float32)
            )
            landmarks_valid.append(frame_landmarks_valid)
    finally:
        capture.release()
    valid = np.asarray(landmarks_valid, dtype=np.bool_)
    stacked_landmarks = np.stack(landmarks).astype(np.float32)
    return (
        np.stack(frames).astype(np.uint8),
        smooth_boxes(np.stack(boxes)),
        smooth_landmarks(stacked_landmarks, valid),
        valid,
    )


def main() -> None:
    args = parse_args()
    source = args.source.expanduser().resolve(strict=True)
    if args.fps <= 0 or args.width <= 0 or args.height <= 0:
        raise ValueError("fps and output dimensions must be positive")
    if not args.profile or any(
        character not in "abcdefghijklmnopqrstuvwxyz0123456789-_"
        for character in args.profile
    ):
        raise ValueError("profile must be a lowercase ASCII slug")
    action_ranges = load_action_ranges(args.ranges_json)

    detector = make_detector(args.cyberverse_root.expanduser().resolve(strict=True))
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"could not open source video: {source}")
    try:
        source_face_box, source_face_landmarks = build_reference(
            capture,
            detector,
            args.reference_time,
            args.avatar_output,
        )
    finally:
        capture.release()

    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    actions: dict[str, dict[str, object]] = {}
    for action, (start, end, mode, playback_rate) in action_ranges.items():
        print(f"preparing {action}: {start:.1f}s..{end:.1f}s")
        frames, face_boxes, face_landmarks, face_landmarks_valid = build_action(
            source,
            detector,
            start,
            end,
            args.fps,
            args.width,
            args.height,
        )
        filename = f"{action}.npz"
        np.savez_compressed(
            output_root / filename,
            frames=frames,
            face_boxes=face_boxes,
            face_landmarks=face_landmarks,
            face_landmarks_valid=face_landmarks_valid,
        )
        actions[action] = {
            "file": filename,
            "mode": mode,
            "source_range_seconds": [start, end],
            "frames": int(len(frames)),
            "playback_rate": playback_rate,
        }

    manifest = {
        "version": 2,
        "profile": args.profile,
        "internal_poc_only": True,
        "source": str(source),
        "output_size": [args.width, args.height],
        "fps": args.fps,
        "source_face_box": source_face_box,
        "source_face_landmarks": source_face_landmarks,
        "landmark_schema": "mediapipe_face_detection_6",
        "crossfade_frames": 5,
        "transition_mode": "cut",
        "feather_ratio": 0.12,
        "color_match_strength": 0.65,
        "actions": actions,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    detector.close()
    print(f"avatar: {args.avatar_output}")
    print(f"body profile: {output_root}")


if __name__ == "__main__":
    main()
