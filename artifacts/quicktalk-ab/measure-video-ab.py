#!/usr/bin/env python3
"""Measure a rendered lip-sync clip against a fixed template sequence.

The evaluator intentionally uses only OpenCV plus the face boxes and six-point
geometry stored in the action NPZ. This keeps the regions identical across
MuseTalk and QuickTalk and avoids detector/version drift during the A/B test.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import wave

import av
import cv2
import numpy as np


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summary(values: list[float] | np.ndarray) -> dict[str, float | int | None]:
    array = np.asarray(values, dtype=np.float64)
    array = array[np.isfinite(array)]
    if not len(array):
        return {
            "count": 0,
            "mean": None,
            "std": None,
            "min": None,
            "p05": None,
            "median": None,
            "p95": None,
            "max": None,
        }
    percentiles = np.percentile(array, [5, 50, 95])
    return {
        "count": int(len(array)),
        "mean": float(array.mean()),
        "std": float(array.std()),
        "min": float(array.min()),
        "p05": float(percentiles[0]),
        "median": float(percentiles[1]),
        "p95": float(percentiles[2]),
        "max": float(array.max()),
    }


def decode_video(path: Path) -> tuple[np.ndarray, list[float], dict[str, object]]:
    frames: list[np.ndarray] = []
    timestamps: list[float] = []
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        for frame in container.decode(stream):
            frames.append(frame.to_ndarray(format="rgb24"))
            timestamps.append(float(frame.time) if frame.time is not None else math.nan)
        average_rate = float(stream.average_rate) if stream.average_rate else None
        base_rate = float(stream.base_rate) if stream.base_rate else None
        metadata: dict[str, object] = {
            "codec": stream.codec_context.name,
            "width": int(stream.codec_context.width),
            "height": int(stream.codec_context.height),
            "frame_count": len(frames),
            "average_rate_fps": average_rate,
            "base_rate_fps": base_rate,
            "stream_duration_seconds": (
                float(stream.duration * stream.time_base)
                if stream.duration is not None and stream.time_base is not None
                else None
            ),
            "container_duration_seconds": (
                float(container.duration / av.time_base)
                if container.duration is not None
                else None
            ),
        }
    if not frames:
        raise ValueError(f"video has no decodable frames: {path}")
    return np.stack(frames), timestamps, metadata


def load_action_geometry(
    path: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    with np.load(path, allow_pickle=False) as archive:
        frames = np.asarray(archive["frames"])
        boxes = np.asarray(archive["face_boxes"], dtype=np.float32)
        landmarks = np.asarray(archive["face_landmarks"], dtype=np.float32)
        valid = np.asarray(archive["face_landmarks_valid"], dtype=np.bool_)
    if frames.dtype != np.uint8 or frames.ndim != 4 or frames.shape[-1] != 3:
        raise ValueError("NPZ frames must be uint8 [N,H,W,3] RGB")
    if boxes.shape != (len(frames), 4):
        raise ValueError("NPZ face_boxes must be [N,4]")
    if landmarks.shape != (len(frames), 6, 2) or valid.shape != (len(frames),):
        raise ValueError("NPZ must contain six-point face landmarks and validity")
    height, width = frames.shape[1:3]
    if np.all((boxes >= 0.0) & (boxes <= 1.0)):
        boxes = boxes * np.asarray([width, height, width, height], dtype=np.float32)
    if np.all((landmarks[valid] >= 0.0) & (landmarks[valid] <= 1.0)):
        landmarks = landmarks * np.asarray([width, height], dtype=np.float32)
    if not bool(valid.all()):
        raise ValueError("all A/B source frames must have valid six-point landmarks")
    return frames, boxes, landmarks, valid


def ellipse_mask(
    shape: tuple[int, int],
    center: tuple[float, float],
    axes: tuple[float, float],
) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.ellipse(
        mask,
        (round(center[0]), round(center[1])),
        (max(1, round(axes[0])), max(1, round(axes[1]))),
        0.0,
        0.0,
        360.0,
        1,
        thickness=-1,
    )
    return mask.astype(bool)


def build_regions(
    boxes: np.ndarray,
    landmarks: np.ndarray,
    shape: tuple[int, int],
) -> dict[str, np.ndarray]:
    """Build model-independent regions from the immutable target geometry."""

    height, width = shape
    mouth_masks: list[np.ndarray] = []
    cheek_chin_masks: list[np.ndarray] = []
    outside_masks: list[np.ndarray] = []
    upper_face_masks: list[np.ndarray] = []

    yy = np.arange(height)[:, None]
    for box, points in zip(boxes, landmarks):
        x1, y1, x2, y2 = (float(value) for value in box)
        face_width = max(x2 - x1, 2.0)
        face_height = max(y2 - y1, 2.0)
        face_center = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
        mouth_center = (float(points[3, 0]), float(points[3, 1]))
        nose_y = float(points[2, 1])

        # The ellipse deliberately includes lips plus a small surrounding ring.
        mouth = ellipse_mask(
            shape,
            mouth_center,
            (face_width * 0.23, face_height * 0.135),
        )
        face = ellipse_mask(
            shape,
            face_center,
            (face_width * 0.49, face_height * 0.52),
        )
        lower_boundary = nose_y + 0.12 * (mouth_center[1] - nose_y)
        lower_face = face & (yy >= lower_boundary)
        cheek_chin = lower_face & ~mouth
        upper_face = face & (yy < lower_boundary)

        margin_x = face_width * 0.12
        margin_y = face_height * 0.10
        ex1 = max(0, int(math.floor(x1 - margin_x)))
        ey1 = max(0, int(math.floor(y1 - margin_y)))
        ex2 = min(width, int(math.ceil(x2 + margin_x)))
        ey2 = min(height, int(math.ceil(y2 + margin_y)))
        outside = np.ones(shape, dtype=bool)
        outside[ey1:ey2, ex1:ex2] = False

        mouth_masks.append(mouth)
        cheek_chin_masks.append(cheek_chin)
        outside_masks.append(outside)
        upper_face_masks.append(upper_face)

    return {
        "mouth": np.stack(mouth_masks),
        "cheek_chin": np.stack(cheek_chin_masks),
        "outside_face": np.stack(outside_masks),
        "upper_face_control": np.stack(upper_face_masks),
    }


def region_pair_metrics(
    candidate: np.ndarray,
    template: np.ndarray,
    masks: np.ndarray,
    changed_threshold: float,
) -> dict[str, object]:
    frame_mae: list[float] = []
    frame_changed: list[float] = []
    total_abs = 0.0
    total_squared = 0.0
    total_channel_values = 0
    changed_pixels = 0
    total_pixels = 0

    candidate_lab_means: list[np.ndarray] = []
    residual_lab_means: list[np.ndarray] = []

    for output_frame, source_frame, mask in zip(candidate, template, masks):
        if not bool(mask.any()):
            continue
        output_float = output_frame.astype(np.float32)
        source_float = source_frame.astype(np.float32)
        difference = output_float - source_float
        absolute = np.abs(difference)
        pixel_mae = absolute.mean(axis=2)
        selected = absolute[mask]
        frame_mae.append(float(selected.mean()))
        frame_changed.append(float((pixel_mae[mask] > changed_threshold).mean()))
        total_abs += float(selected.sum())
        total_squared += float(np.square(difference[mask]).sum())
        total_channel_values += int(selected.size)
        changed_pixels += int((pixel_mae[mask] > changed_threshold).sum())
        total_pixels += int(mask.sum())

        output_lab = cv2.cvtColor(output_float / 255.0, cv2.COLOR_RGB2LAB)
        source_lab = cv2.cvtColor(source_float / 255.0, cv2.COLOR_RGB2LAB)
        candidate_lab_means.append(output_lab[mask].mean(axis=0))
        residual_lab_means.append((output_lab - source_lab)[mask].mean(axis=0))

    if not total_channel_values or not total_pixels:
        raise ValueError("evaluation region is empty")
    mae = total_abs / total_channel_values
    mse = total_squared / total_channel_values
    psnr = math.inf if mse == 0.0 else 10.0 * math.log10(255.0**2 / mse)
    residual_lab = np.stack(residual_lab_means)
    candidate_lab = np.stack(candidate_lab_means)
    residual_lab_std = residual_lab.std(axis=0)
    residual_lab_peak = np.ptp(residual_lab, axis=0)

    return {
        "pixel_samples": total_pixels,
        "mae_rgb_0_255": mae,
        "mae_rgb_per_frame": summary(frame_mae),
        "changed_pixel_threshold_mae_rgb": changed_threshold,
        "changed_pixel_ratio": changed_pixels / total_pixels,
        "changed_pixel_ratio_per_frame": summary(frame_changed),
        "psnr_db": psnr,
        "candidate_mean_lab_per_frame": {
            "L": summary(candidate_lab[:, 0]),
            "a": summary(candidate_lab[:, 1]),
            "b": summary(candidate_lab[:, 2]),
        },
        "color_pumping": {
            "definition": "stddev and peak-to-peak of per-frame mean candidate-minus-template Lab",
            "residual_mean_lab_std": [float(value) for value in residual_lab_std],
            "residual_mean_lab_peak_to_peak": [
                float(value) for value in residual_lab_peak
            ],
            "residual_mean_lab_std_l2": float(np.linalg.norm(residual_lab_std)),
        },
    }


def temporal_metrics(
    candidate: np.ndarray,
    template: np.ndarray,
    masks: np.ndarray,
) -> dict[str, object]:
    candidate_delta: list[float] = []
    template_delta: list[float] = []
    residual_delta: list[float] = []
    residual = candidate.astype(np.float32) - template.astype(np.float32)

    for index in range(1, len(candidate)):
        shared = masks[index - 1] & masks[index]
        if not bool(shared.any()):
            continue
        candidate_delta.append(
            float(
                np.abs(
                    candidate[index].astype(np.float32)
                    - candidate[index - 1].astype(np.float32)
                )[shared].mean()
            )
        )
        template_delta.append(
            float(
                np.abs(
                    template[index].astype(np.float32)
                    - template[index - 1].astype(np.float32)
                )[shared].mean()
            )
        )
        residual_delta.append(
            float(np.abs(residual[index] - residual[index - 1])[shared].mean())
        )

    candidate_summary = summary(candidate_delta)
    template_summary = summary(template_delta)
    candidate_mean = candidate_summary["mean"]
    template_mean = template_summary["mean"]
    return {
        "candidate_adjacent_mae_rgb": candidate_summary,
        "template_adjacent_mae_rgb": template_summary,
        "candidate_minus_template_adjacent_mae": (
            float(candidate_mean - template_mean)
            if isinstance(candidate_mean, float) and isinstance(template_mean, float)
            else None
        ),
        "residual_temporal_mad_rgb": summary(residual_delta),
        "residual_definition": "abs((candidate-template)[t] - (candidate-template)[t-1])",
    }


def normalized_mouth_activity(
    frames: np.ndarray,
    boxes: np.ndarray,
    landmarks: np.ndarray,
) -> dict[str, object]:
    crops: list[np.ndarray] = []
    for frame, box, points in zip(frames, boxes, landmarks):
        x1, y1, x2, y2 = (float(value) for value in box)
        face_width = max(x2 - x1, 2.0)
        face_height = max(y2 - y1, 2.0)
        center_x, center_y = (float(value) for value in points[3])
        crop_width = max(4, round(face_width * 0.50))
        crop_height = max(4, round(face_height * 0.30))
        crop = cv2.getRectSubPix(
            frame,
            (crop_width, crop_height),
            (center_x, center_y),
        )
        crop = cv2.resize(crop, (96, 48), interpolation=cv2.INTER_AREA)
        crops.append(cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32))
    values = [
        float(np.abs(crops[index] - crops[index - 1]).mean())
        for index in range(1, len(crops))
    ]
    stats = summary(values)
    if isinstance(stats["p95"], float) and isinstance(stats["p05"], float):
        stats["p95_minus_p05"] = float(stats["p95"] - stats["p05"])
    else:
        stats["p95_minus_p05"] = None
    return {
        "definition": "adjacent grayscale MAE after geometry-normalized 96x48 mouth crop",
        "adjacent_mae_gray_0_255": stats,
    }


def source_match_metrics(
    candidate: np.ndarray,
    source: np.ndarray,
    outside_masks: np.ndarray,
) -> dict[str, object]:
    target_width = max(1, source.shape[2] // 4)
    target_height = max(1, source.shape[1] // 4)
    source_small = np.stack(
        [
            cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
            for frame in source
        ]
    ).astype(np.int16)
    candidate_small = np.stack(
        [
            cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
            for frame in candidate
        ]
    ).astype(np.int16)
    masks_small = np.stack(
        [
            cv2.resize(
                mask.astype(np.uint8),
                (target_width, target_height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
            for mask in outside_masks
        ]
    )

    nearest: list[int] = []
    nearest_cost: list[float] = []
    for position, frame in enumerate(candidate_small):
        mask = masks_small[position]
        costs = np.abs(source_small - frame).mean(axis=3)[:, mask].mean(axis=1)
        nearest.append(int(costs.argmin()))
        nearest_cost.append(float(costs.min()))

    frame_hashes = [hashlib.sha256(frame.tobytes()).hexdigest() for frame in source]
    equivalent_hits = 0
    for expected, actual in enumerate(nearest):
        if frame_hashes[expected] == frame_hashes[actual]:
            equivalent_hits += 1
    exact_hits = sum(index == actual for index, actual in enumerate(nearest))
    duplicate_indices = [
        index
        for index in range(1, len(source))
        if frame_hashes[index] == frame_hashes[index - 1]
    ]
    return {
        "nearest_source_indices": nearest,
        "nearest_match_cost_mae_rgb_downsampled": summary(nearest_cost),
        "exact_index_accuracy": exact_hits / len(source),
        "duplicate_equivalent_accuracy": equivalent_hits / len(source),
        "source_exact_duplicate_indices": duplicate_indices,
        "source_adjacent_freeze_ratio": len(duplicate_indices) / max(1, len(source) - 1),
    }


def read_wav(path: Path) -> dict[str, object]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        sample_count = handle.getnframes()
        sample_width = handle.getsampwidth()
    return {
        "channels": channels,
        "sample_rate": sample_rate,
        "samples_per_channel": sample_count,
        "sample_width_bytes": sample_width,
        "duration_seconds": sample_count / sample_rate,
    }


def timeline_metrics(timestamps: list[float], frame_count: int) -> dict[str, object]:
    finite = np.asarray([value for value in timestamps if math.isfinite(value)])
    if len(finite) < 2:
        return {
            "first_pts_seconds": None,
            "last_pts_seconds": None,
            "median_frame_interval_seconds": None,
            "timeline_duration_seconds": None,
            "timeline_fps": None,
        }
    intervals = np.diff(finite)
    median_interval = float(np.median(intervals))
    duration = float(finite[-1] - finite[0] + median_interval)
    return {
        "first_pts_seconds": float(finite[0]),
        "last_pts_seconds": float(finite[-1]),
        "frame_interval_seconds": summary(intervals),
        "median_frame_interval_seconds": median_interval,
        "timeline_duration_seconds": duration,
        "timeline_fps": frame_count / duration if duration > 0 else None,
    }


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    fixture_root = repo_root / "artifacts/quicktalk-ab/welcome"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidate",
        type=Path,
        default=fixture_root / "welcome-musetalk-100f.mp4",
    )
    parser.add_argument(
        "--template",
        type=Path,
        default=fixture_root / "welcome-template-100f.mp4",
    )
    parser.add_argument(
        "--source-npz",
        type=Path,
        default=repo_root / "public/assets/musetalk-body/motion-host/welcome.npz",
    )
    parser.add_argument(
        "--audio",
        type=Path,
        default=fixture_root / "welcome-audio.wav",
    )
    parser.add_argument("--label", default="musetalk-1.5")
    parser.add_argument(
        "--output-json",
        type=Path,
        default=fixture_root / "musetalk-baseline-metrics.json",
    )
    parser.add_argument("--changed-threshold", type=float, default=8.0)
    parser.add_argument(
        "--render-wall-seconds",
        type=float,
        default=None,
        help="Optional measured generation wall time; never inferred from media duration.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    candidate_path = args.candidate.expanduser().resolve(strict=True)
    template_path = args.template.expanduser().resolve(strict=True)
    source_path = args.source_npz.expanduser().resolve(strict=True)
    audio_path = args.audio.expanduser().resolve(strict=True)

    candidate, candidate_timestamps, candidate_media = decode_video(candidate_path)
    template, template_timestamps, template_media = decode_video(template_path)
    source, boxes, landmarks, _ = load_action_geometry(source_path)
    if candidate.shape != template.shape or candidate.shape != source.shape:
        raise ValueError(
            "candidate, template, and NPZ frames must have the same [N,H,W,3] shape; "
            f"got {candidate.shape}, {template.shape}, and {source.shape}"
        )

    regions = build_regions(boxes, landmarks, source.shape[1:3])
    region_results: dict[str, object] = {}
    for name, masks in regions.items():
        region_results[name] = {
            "output_vs_template": region_pair_metrics(
                candidate,
                template,
                masks,
                args.changed_threshold,
            ),
            "temporal": temporal_metrics(candidate, template, masks),
        }

    render_wall = args.render_wall_seconds
    if render_wall is not None and render_wall <= 0.0:
        raise ValueError("--render-wall-seconds must be positive")
    result = {
        "schema_version": 1,
        "label": args.label,
        "inputs": {
            "candidate": {
                "path": str(candidate_path),
                "sha256": sha256_file(candidate_path),
            },
            "template": {
                "path": str(template_path),
                "sha256": sha256_file(template_path),
            },
            "source_npz": {
                "path": str(source_path),
                "sha256": sha256_file(source_path),
            },
            "audio": {
                "path": str(audio_path),
                "sha256": sha256_file(audio_path),
                **read_wav(audio_path),
            },
        },
        "media": {
            "candidate": candidate_media,
            "candidate_timeline": timeline_metrics(
                candidate_timestamps, len(candidate)
            ),
            "template": template_media,
            "template_timeline": timeline_metrics(template_timestamps, len(template)),
        },
        "render_performance": {
            "wall_seconds": render_wall,
            "render_fps": len(candidate) / render_wall if render_wall else None,
            "availability_note": (
                "supplied by --render-wall-seconds"
                if render_wall
                else "unavailable from encoded media; do not substitute playback duration"
            ),
        },
        "alignment": source_match_metrics(
            candidate,
            source,
            regions["outside_face"],
        ),
        "roi_definition": {
            "geometry": "per-frame NPZ face_box plus mediapipe_face_detection_6 points",
            "mouth": "ellipse at landmark 3; radii 0.23 face width and 0.135 face height",
            "cheek_chin": "elliptical lower face below nose-to-mouth boundary, excluding mouth",
            "outside_face": "outside face box expanded by 0.12 width and 0.10 height",
            "changed_pixel": (
                "mean absolute RGB difference per pixel greater than "
                f"{args.changed_threshold:g} on the 0..255 scale"
            ),
        },
        "regions": region_results,
        "mouth_pixel_activity": {
            "candidate": normalized_mouth_activity(candidate, boxes, landmarks),
            "template": normalized_mouth_activity(template, boxes, landmarks),
        },
        "limitations": [
            "This evaluator measures fixed-region pixel activity, not phoneme-level lip aperture.",
            "SyncNet/LSE and identity embeddings are not available in the installed environment.",
            "Candidate and template must use the same capture and encoding path for a fair codec floor.",
        ],
    }

    output_path = args.output_json.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, ensure_ascii=True, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(output_path)


if __name__ == "__main__":
    main()
