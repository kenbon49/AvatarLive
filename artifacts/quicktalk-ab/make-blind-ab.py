#!/usr/bin/env python3
"""Build deterministic A/B videos and mouth contact sheets without model names."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np


CONTACT_FRAMES = [4, 14, 24, 34, 44, 54, 64, 74, 84, 94]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_video(path: Path) -> list[np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(frame)
    capture.release()
    if len(frames) != 100:
        raise ValueError(f"{path} must decode to 100 frames, got {len(frames)}")
    return frames


def load_geometry(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with np.load(path, allow_pickle=False) as archive:
        boxes = np.asarray(archive["face_boxes"], dtype=np.float32)
        landmarks = np.asarray(archive["face_landmarks"], dtype=np.float32)
        frames = np.asarray(archive["frames"])
    if frames.shape[0] != 100 or boxes.shape != (100, 4) or landmarks.shape != (100, 6, 2):
        raise ValueError(f"{path} must contain 100-frame face geometry")
    height, width = frames.shape[1:3]
    if np.all((boxes >= 0.0) & (boxes <= 1.0)):
        boxes *= np.asarray([width, height, width, height], dtype=np.float32)
    if np.all((landmarks >= 0.0) & (landmarks <= 1.0)):
        landmarks *= np.asarray([width, height], dtype=np.float32)
    return boxes, landmarks


def mouth_tile(
    frame: np.ndarray,
    box: np.ndarray,
    landmarks: np.ndarray,
    label: str,
    frame_index: int,
) -> np.ndarray:
    x1, y1, x2, y2 = (float(value) for value in box)
    face_width = max(x2 - x1, 2.0)
    face_height = max(y2 - y1, 2.0)
    center_x, center_y = (float(value) for value in landmarks[3])
    center_y -= face_height * 0.02
    crop_width = max(8, round(face_width * 0.90))
    crop_height = max(8, round(face_height * 0.48))
    crop = cv2.getRectSubPix(frame, (crop_width, crop_height), (center_x, center_y))
    tile = cv2.resize(crop, (360, 180), interpolation=cv2.INTER_CUBIC)
    cv2.rectangle(tile, (0, 0), (104, 31), (15, 15, 15), thickness=-1)
    cv2.putText(
        tile,
        f"{label} | f{frame_index:03d}",
        (8, 23),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return tile


def write_contact_sheet(
    frames_a: list[np.ndarray],
    frames_b: list[np.ndarray],
    boxes: np.ndarray,
    landmarks: np.ndarray,
    output: Path,
) -> None:
    rows: list[np.ndarray] = []
    for start in (0, 5):
        selection = CONTACT_FRAMES[start : start + 5]
        for label, frames in (("A", frames_a), ("B", frames_b)):
            tiles = [
                mouth_tile(frames[index], boxes[index], landmarks[index], label, index)
                for index in selection
            ]
            rows.append(np.concatenate(tiles, axis=1))
    sheet = np.concatenate(rows, axis=0)
    output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output), sheet):
        raise RuntimeError(f"failed to write {output}")


def write_video(candidate_a: Path, candidate_b: Path, audio: Path, output: Path) -> None:
    font = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    if not font.is_file():
        raise FileNotFoundError(font)
    filter_graph = (
        f"[0:v]setpts=PTS-STARTPTS,drawbox=x=8:y=8:w=54:h=42:color=black@0.75:t=fill,"
        f"drawtext=fontfile={font}:text=A:x=23:y=11:fontsize=28:fontcolor=white[a];"
        f"[1:v]setpts=PTS-STARTPTS,drawbox=x=8:y=8:w=54:h=42:color=black@0.75:t=fill,"
        f"drawtext=fontfile={font}:text=B:x=23:y=11:fontsize=28:fontcolor=white[b];"
        "[a][b]hstack=inputs=2[v]"
    )
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(candidate_a),
        "-i",
        str(candidate_b),
        "-i",
        str(audio),
        "-filter_complex",
        filter_graph,
        "-map",
        "[v]",
        "-map",
        "2:a:0",
        "-r",
        "25",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "10",
        "-profile:v",
        "high",
        "-level:v",
        "3.1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        "4",
        "-movflags",
        "+faststart",
        str(output),
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--musetalk", required=True, type=Path)
    parser.add_argument("--quicktalk", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--geometry", required=True, type=Path)
    parser.add_argument("--output-prefix", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    musetalk = args.musetalk.expanduser().resolve(strict=True)
    quicktalk = args.quicktalk.expanduser().resolve(strict=True)
    audio = args.audio.expanduser().resolve(strict=True)
    geometry = args.geometry.expanduser().resolve(strict=True)
    output_prefix = args.output_prefix.expanduser().resolve()

    audio_hash = sha256_file(audio)
    # The immutable audio hash chooses the order, so model quality cannot influence it.
    if int(audio_hash[0], 16) % 2 == 0:
        candidates = {"A": musetalk, "B": quicktalk}
    else:
        candidates = {"A": quicktalk, "B": musetalk}

    frames_a = decode_video(candidates["A"])
    frames_b = decode_video(candidates["B"])
    boxes, landmarks = load_geometry(geometry)

    video_output = output_prefix.with_name(output_prefix.name + "-blind-ab.mp4")
    sheet_output = output_prefix.with_name(output_prefix.name + "-blind-mouth-contact-sheet.png")
    key_output = output_prefix.with_name(output_prefix.name + "-blind-key.json")
    write_video(candidates["A"], candidates["B"], audio, video_output)
    write_contact_sheet(frames_a, frames_b, boxes, landmarks, sheet_output)

    key = {
        "schema_version": 1,
        "selection_rule": "A is MuseTalk when the first audio SHA-256 hex nibble is even; otherwise A is QuickTalk",
        "audio": {"path": str(audio), "sha256": audio_hash},
        "geometry": {"path": str(geometry), "sha256": sha256_file(geometry)},
        "mapping": {
            label: {
                "model": "musetalk-1.5" if path == musetalk else "quicktalk-pth",
                "path": str(path),
                "sha256": sha256_file(path),
            }
            for label, path in candidates.items()
        },
        "contact_frames": CONTACT_FRAMES,
        "outputs": {
            "video": {"path": str(video_output), "sha256": sha256_file(video_output)},
            "mouth_contact_sheet": {"path": str(sheet_output), "sha256": sha256_file(sheet_output)},
        },
    }
    key_output.write_text(json.dumps(key, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(key_output)


if __name__ == "__main__":
    main()
