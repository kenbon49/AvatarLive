"""Lightweight face geometry detection and tracking for FlashHead frames.

MediaPipe Face Detection exposes six stable keypoints in addition to its face
box.  Those points are sufficient for a similarity transform and, unlike Face
Mesh, work in the Cyberverse runtime without adding another model or package.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray


RGBFrame = NDArray[np.uint8]
FloatArray = NDArray[np.float32]
GeometryOrigin = Literal["detected", "flow", "last_good"]

FACE_KEYPOINT_COUNT = 6
STABLE_KEYPOINT_INDICES = np.asarray([0, 1, 2, 4, 5], dtype=np.int32)


@dataclass(frozen=True)
class FaceGeometry:
    """One face box and MediaPipe's six keypoints in pixel coordinates."""

    box: FloatArray
    keypoints: FloatArray
    confidence: float
    origin: GeometryOrigin = "detected"
    stale_frames: int = 0


class FaceDetector(Protocol):
    """Small adapter boundary used by the tracker and unit tests."""

    def detect(
        self,
        frame: RGBFrame,
        preferred_box: FloatArray | None = None,
    ) -> FaceGeometry | None: ...

    def close(self) -> None: ...


class MediaPipeFaceDetector:
    """Return MediaPipe face boxes and its six built-in keypoints."""

    def __init__(
        self,
        *,
        model_selection: int = 0,
        min_detection_confidence: float = 0.25,
    ) -> None:
        try:
            import mediapipe as mp
        except ImportError as exc:  # pragma: no cover - production dependency guard
            raise RuntimeError("mediapipe is required for dynamic face tracking") from exc
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=model_selection,
            min_detection_confidence=min_detection_confidence,
        )

    def detect(
        self,
        frame: RGBFrame,
        preferred_box: FloatArray | None = None,
    ) -> FaceGeometry | None:
        height, width = frame.shape[:2]
        result = self._detector.process(frame)
        detections = result.detections or ()
        candidates: list[tuple[float, FaceGeometry]] = []
        for detection in detections:
            location = detection.location_data
            relative_box = location.relative_bounding_box
            box = np.asarray(
                [
                    relative_box.xmin * width,
                    relative_box.ymin * height,
                    (relative_box.xmin + relative_box.width) * width,
                    (relative_box.ymin + relative_box.height) * height,
                ],
                dtype=np.float32,
            )
            box[[0, 2]] = np.clip(box[[0, 2]], 0.0, float(width))
            box[[1, 3]] = np.clip(box[[1, 3]], 0.0, float(height))
            keypoints = np.asarray(
                [[point.x * width, point.y * height] for point in location.relative_keypoints],
                dtype=np.float32,
            )
            if not _valid_geometry_arrays(box, keypoints, width, height):
                continue
            keypoints[:, 0] = np.clip(keypoints[:, 0], 0.0, float(width))
            keypoints[:, 1] = np.clip(keypoints[:, 1], 0.0, float(height))
            confidence = float(detection.score[0]) if detection.score else 0.0
            geometry = FaceGeometry(box, keypoints, confidence)
            continuity = _box_iou(box, preferred_box) if preferred_box is not None else 0.0
            candidates.append((confidence + continuity, geometry))
        if not candidates:
            return None
        return max(candidates, key=lambda item: item[0])[1]

    def close(self) -> None:
        self._detector.close()


class SourceFaceTracker:
    """Track generated face geometry with periodic detection and LK flow."""

    def __init__(
        self,
        detector: FaceDetector,
        *,
        detection_interval: int = 2,
        max_stale_frames: int = 3,
    ) -> None:
        if detection_interval < 1:
            raise ValueError("detection_interval must be positive")
        if max_stale_frames < 0:
            raise ValueError("max_stale_frames must be non-negative")
        self._detector = detector
        self._detection_interval = detection_interval
        self._max_stale_frames = max_stale_frames
        self.reset()

    def reset(self) -> None:
        self._previous_gray: NDArray[np.uint8] | None = None
        self._last_geometry: FaceGeometry | None = None
        self._frames_since_detection = self._detection_interval
        self._failure_streak = 0

    def close(self) -> None:
        self._detector.close()

    def track(self, frame: RGBFrame) -> FaceGeometry | None:
        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
        predicted = self._track_with_flow(gray)
        should_detect = (
            self._last_geometry is None
            or predicted is None
            or self._frames_since_detection >= self._detection_interval - 1
            or self._failure_streak > 0
        )

        geometry: FaceGeometry | None = None
        if should_detect:
            preferred_box = predicted.box if predicted is not None else (
                self._last_geometry.box if self._last_geometry is not None else None
            )
            detected = self._detector.detect(frame, preferred_box)
            if detected is not None:
                geometry = self._merge_detection(detected, predicted)
                self._frames_since_detection = 0
                self._failure_streak = 0
            else:
                self._failure_streak += 1

        if geometry is None and predicted is not None:
            stale = self._frames_since_detection + 1
            if stale <= self._max_stale_frames:
                geometry = FaceGeometry(
                    predicted.box.copy(),
                    predicted.keypoints.copy(),
                    predicted.confidence,
                    origin="flow",
                    stale_frames=stale,
                )
                self._frames_since_detection = stale
        elif geometry is None and self._last_geometry is not None:
            stale = self._last_geometry.stale_frames + 1
            if stale <= self._max_stale_frames:
                geometry = FaceGeometry(
                    self._last_geometry.box.copy(),
                    self._last_geometry.keypoints.copy(),
                    self._last_geometry.confidence,
                    origin="last_good",
                    stale_frames=stale,
                )
                self._frames_since_detection += 1
                self._failure_streak += 1

        self._previous_gray = gray
        self._last_geometry = geometry
        return geometry

    def _track_with_flow(self, gray: NDArray[np.uint8]) -> FaceGeometry | None:
        if self._previous_gray is None or self._last_geometry is None:
            return None
        previous_points = self._last_geometry.keypoints.reshape(-1, 1, 2)
        current_points, forward_status, _ = cv2.calcOpticalFlowPyrLK(
            self._previous_gray,
            gray,
            previous_points,
            None,
            winSize=(21, 21),
            maxLevel=2,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.01),
        )
        if current_points is None or forward_status is None:
            return None
        backward_points, backward_status, _ = cv2.calcOpticalFlowPyrLK(
            gray,
            self._previous_gray,
            current_points,
            None,
            winSize=(21, 21),
            maxLevel=2,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.01),
        )
        if backward_points is None or backward_status is None:
            return None

        current = current_points.reshape(-1, 2)
        backward = backward_points.reshape(-1, 2)
        status = forward_status.reshape(-1).astype(bool) & backward_status.reshape(-1).astype(bool)
        round_trip_error = np.linalg.norm(
            backward - self._last_geometry.keypoints,
            axis=1,
        )
        stable = status & (round_trip_error <= 1.5)
        stable_mask = np.zeros(FACE_KEYPOINT_COUNT, dtype=np.bool_)
        stable_mask[STABLE_KEYPOINT_INDICES] = True
        stable &= stable_mask
        if stable.sum() < 3:
            return None

        source = self._last_geometry.keypoints[stable]
        target = current[stable]
        matrix, _ = cv2.estimateAffinePartial2D(
            source,
            target,
            method=cv2.LMEDS,
        )
        if matrix is None or not np.isfinite(matrix).all():
            return None
        linear = matrix[:, :2]
        determinant = float(np.linalg.det(linear))
        scale = float(np.sqrt(max(determinant, 0.0)))
        roll = abs(float(np.degrees(np.arctan2(linear[1, 0], linear[0, 0]))))
        if determinant <= 0.0 or not 0.85 <= scale <= 1.18 or roll > 12.0:
            return None
        transformed_points = cv2.transform(
            self._last_geometry.keypoints.reshape(1, -1, 2),
            matrix,
        ).reshape(-1, 2)
        tracked_points = current.copy()
        tracked_points[~stable] = transformed_points[~stable]
        box = transform_box(self._last_geometry.box, matrix)
        previous_center = np.asarray(
            [
                (self._last_geometry.box[0] + self._last_geometry.box[2]) / 2.0,
                (self._last_geometry.box[1] + self._last_geometry.box[3]) / 2.0,
            ],
            dtype=np.float32,
        )
        current_center = np.asarray(
            [(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0],
            dtype=np.float32,
        )
        previous_width = max(
            float(self._last_geometry.box[2] - self._last_geometry.box[0]),
            1.0,
        )
        if float(np.linalg.norm(current_center - previous_center)) > previous_width * 0.18:
            return None
        height, width = gray.shape
        if not _valid_geometry_arrays(box, tracked_points, width, height):
            return None
        return FaceGeometry(
            box.astype(np.float32),
            tracked_points.astype(np.float32),
            self._last_geometry.confidence,
            origin="flow",
        )

    @staticmethod
    def _merge_detection(
        detected: FaceGeometry,
        predicted: FaceGeometry | None,
    ) -> FaceGeometry:
        if predicted is None:
            return detected
        detected_width = max(float(detected.box[2] - detected.box[0]), 1.0)
        predicted_width = max(float(predicted.box[2] - predicted.box[0]), 1.0)
        detected_center = np.asarray(
            [
                (detected.box[0] + detected.box[2]) / 2.0,
                (detected.box[1] + detected.box[3]) / 2.0,
            ],
            dtype=np.float32,
        )
        predicted_center = np.asarray(
            [
                (predicted.box[0] + predicted.box[2]) / 2.0,
                (predicted.box[1] + predicted.box[3]) / 2.0,
            ],
            dtype=np.float32,
        )
        keypoint_error = float(
            np.median(np.linalg.norm(detected.keypoints - predicted.keypoints, axis=1))
        )
        if (
            float(np.linalg.norm(detected_center - predicted_center)) > detected_width * 0.12
            or not 0.85 <= predicted_width / detected_width <= 1.18
            or keypoint_error > detected_width * 0.10
        ):
            return detected
        # The flow estimate damps detector jitter without allowing long-term drift.
        detection_weight = 0.75
        box = (
            detected.box * detection_weight
            + predicted.box * (1.0 - detection_weight)
        ).astype(np.float32)
        keypoints = (
            detected.keypoints * detection_weight
            + predicted.keypoints * (1.0 - detection_weight)
        ).astype(np.float32)
        return FaceGeometry(box, keypoints, detected.confidence)


def estimate_similarity_transform(
    source_keypoints: FloatArray,
    target_keypoints: FloatArray,
    *,
    target_box: FloatArray,
) -> FloatArray | None:
    """Estimate and validate a face similarity transform."""

    if source_keypoints.shape != (FACE_KEYPOINT_COUNT, 2) or target_keypoints.shape != (
        FACE_KEYPOINT_COUNT,
        2,
    ):
        return None
    source = source_keypoints[STABLE_KEYPOINT_INDICES]
    target = target_keypoints[STABLE_KEYPOINT_INDICES]
    if not np.isfinite(source).all() or not np.isfinite(target).all():
        return None
    matrix, inliers = cv2.estimateAffinePartial2D(
        source,
        target,
        method=cv2.LMEDS,
    )
    if matrix is not None and np.isfinite(matrix).all():
        projected = cv2.transform(source.reshape(1, -1, 2), matrix).reshape(-1, 2)
        errors = np.linalg.norm(projected - target, axis=1)
        target_width = max(float(target_box[2] - target_box[0]), 1.0)
        enough_inliers = inliers is None or int(np.asarray(inliers).sum()) >= 3
        if (
            _valid_similarity_matrix(matrix)
            and enough_inliers
            and float(np.median(errors)) <= max(3.0, target_width * 0.06)
        ):
            return matrix.astype(np.float32)

    # Large yaw changes ear/nose geometry in a way a 2D similarity cannot fit.
    # Eye alignment remains stable and avoids switching back to a plain bbox.
    source_eye_vector = source_keypoints[1] - source_keypoints[0]
    target_eye_vector = target_keypoints[1] - target_keypoints[0]
    source_eye_distance = float(np.linalg.norm(source_eye_vector))
    target_eye_distance = float(np.linalg.norm(target_eye_vector))
    if source_eye_distance < 1.0 or target_eye_distance < 1.0:
        return None
    scale = target_eye_distance / source_eye_distance
    cosine = float(np.dot(source_eye_vector, target_eye_vector)) / (
        source_eye_distance * target_eye_distance
    )
    sine = float(
        source_eye_vector[0] * target_eye_vector[1]
        - source_eye_vector[1] * target_eye_vector[0]
    ) / (source_eye_distance * target_eye_distance)
    linear = scale * np.asarray([[cosine, -sine], [sine, cosine]], dtype=np.float32)
    source_midpoint = (source_keypoints[0] + source_keypoints[1]) / 2.0
    target_midpoint = (target_keypoints[0] + target_keypoints[1]) / 2.0
    translation = target_midpoint - linear @ source_midpoint
    eye_matrix = np.column_stack((linear, translation)).astype(np.float32)
    if not _valid_similarity_matrix(eye_matrix):
        return None
    projected_nose = cv2.transform(
        source_keypoints[2].reshape(1, 1, 2),
        eye_matrix,
    ).reshape(2)
    target_width = max(float(target_box[2] - target_box[0]), 1.0)
    if float(np.linalg.norm(projected_nose - target_keypoints[2])) > max(
        8.0,
        target_width * 0.18,
    ):
        return None
    return eye_matrix


def _valid_similarity_matrix(matrix: NDArray[Any]) -> bool:
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all():
        return False
    linear = matrix[:, :2]
    determinant = float(np.linalg.det(linear))
    scale = float(np.sqrt(max(determinant, 0.0)))
    if determinant <= 0.0 or not 0.15 <= scale <= 2.5:
        return False
    roll_degrees = abs(float(np.degrees(np.arctan2(linear[1, 0], linear[0, 0]))))
    return roll_degrees <= 35.0


def transform_box(box: FloatArray, matrix: NDArray[Any]) -> FloatArray:
    """Transform all four box corners and return their enclosing xyxy box."""

    corners = np.asarray(
        [
            [box[0], box[1]],
            [box[2], box[1]],
            [box[2], box[3]],
            [box[0], box[3]],
        ],
        dtype=np.float32,
    )
    transformed = cv2.transform(corners.reshape(1, -1, 2), np.asarray(matrix)).reshape(-1, 2)
    return np.asarray(
        [
            transformed[:, 0].min(),
            transformed[:, 1].min(),
            transformed[:, 0].max(),
            transformed[:, 1].max(),
        ],
        dtype=np.float32,
    )


def _valid_geometry_arrays(
    box: FloatArray,
    keypoints: FloatArray,
    width: int,
    height: int,
) -> bool:
    if box.shape != (4,) or keypoints.shape != (FACE_KEYPOINT_COUNT, 2):
        return False
    if not np.isfinite(box).all() or not np.isfinite(keypoints).all():
        return False
    if box[2] - box[0] < 8.0 or box[3] - box[1] < 8.0:
        return False
    margin_x = width * 0.1
    margin_y = height * 0.1
    return bool(
        np.all(keypoints[:, 0] >= -margin_x)
        and np.all(keypoints[:, 0] <= width + margin_x)
        and np.all(keypoints[:, 1] >= -margin_y)
        and np.all(keypoints[:, 1] <= height + margin_y)
    )


def _box_iou(first: FloatArray, second: FloatArray) -> float:
    x1 = max(float(first[0]), float(second[0]))
    y1 = max(float(first[1]), float(second[1]))
    x2 = min(float(first[2]), float(second[2]))
    y2 = min(float(first[3]), float(second[3]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, float(first[2] - first[0])) * max(
        0.0, float(first[3] - first[1])
    )
    second_area = max(0.0, float(second[2] - second[0])) * max(
        0.0, float(second[3] - second[1])
    )
    union = first_area + second_area - intersection
    return intersection / union if union > 0.0 else 0.0
