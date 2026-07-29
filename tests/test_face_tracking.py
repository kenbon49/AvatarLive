from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

import cv2
import numpy as np

from apps.flashhead.face_tracking import (
    FaceGeometry,
    MediaPipeFaceDetector,
    SourceFaceTracker,
    estimate_similarity_transform,
    transform_box,
)


def _geometry(offset: tuple[float, float] = (0.0, 0.0)) -> FaceGeometry:
    keypoints = np.asarray(
        [
            [30.0, 35.0],
            [60.0, 35.0],
            [45.0, 48.0],
            [45.0, 62.0],
            [20.0, 44.0],
            [70.0, 44.0],
        ],
        dtype=np.float32,
    )
    delta = np.asarray(offset, dtype=np.float32)
    return FaceGeometry(
        np.asarray([15.0, 20.0, 75.0, 80.0], dtype=np.float32)
        + np.asarray([delta[0], delta[1], delta[0], delta[1]], dtype=np.float32),
        keypoints + delta,
        0.95,
    )


class _ScriptedDetector:
    def __init__(self, results: list[FaceGeometry | None]) -> None:
        self.results = list(results)
        self.closed = False

    def detect(self, frame, preferred_box=None):
        del frame, preferred_box
        return self.results.pop(0) if self.results else None

    def close(self) -> None:
        self.closed = True


class FaceTrackingTests(unittest.TestCase):
    def test_detector_clips_edge_keypoints_to_loader_bounds(self) -> None:
        points = [
            (-0.02, 0.35),
            (0.32, 0.35),
            (0.20, 0.50),
            (0.20, 1.03),
            (0.05, 0.48),
            (0.38, 0.48),
        ]
        detection = SimpleNamespace(
            location_data=SimpleNamespace(
                relative_bounding_box=SimpleNamespace(
                    xmin=0.0,
                    ymin=0.2,
                    width=0.45,
                    height=0.7,
                ),
                relative_keypoints=[
                    SimpleNamespace(x=x, y=y) for x, y in points
                ],
            ),
            score=[0.9],
        )
        backend = SimpleNamespace(
            process=lambda frame: SimpleNamespace(detections=[detection]),
            close=lambda: None,
        )
        detector = MediaPipeFaceDetector.__new__(MediaPipeFaceDetector)
        detector._detector = backend

        geometry = detector.detect(np.zeros((100, 200, 3), dtype=np.uint8))

        self.assertIsNotNone(geometry)
        self.assertGreaterEqual(float(geometry.keypoints.min()), 0.0)
        self.assertLessEqual(float(geometry.keypoints[:, 0].max()), 200.0)
        self.assertLessEqual(float(geometry.keypoints[:, 1].max()), 100.0)

    def test_similarity_transform_recovers_known_rotation_scale_and_translation(self) -> None:
        source = _geometry()
        angle = np.deg2rad(12.0)
        scale = 0.72
        matrix = np.asarray(
            [
                [scale * np.cos(angle), -scale * np.sin(angle), 18.0],
                [scale * np.sin(angle), scale * np.cos(angle), 24.0],
            ],
            dtype=np.float32,
        )
        target_points = cv2.transform(
            source.keypoints.reshape(1, -1, 2),
            matrix,
        ).reshape(-1, 2)
        target_box = transform_box(source.box, matrix)

        estimated = estimate_similarity_transform(
            source.keypoints,
            target_points,
            target_box=target_box,
        )

        self.assertIsNotNone(estimated)
        projected = cv2.transform(
            source.keypoints.reshape(1, -1, 2),
            estimated,
        ).reshape(-1, 2)
        self.assertLess(float(np.max(np.linalg.norm(projected - target_points, axis=1))), 0.05)

    def test_similarity_transform_rejects_excessive_roll(self) -> None:
        source = _geometry()
        matrix = cv2.getRotationMatrix2D((45.0, 45.0), 50.0, 0.8).astype(np.float32)
        target_points = cv2.transform(
            source.keypoints.reshape(1, -1, 2),
            matrix,
        ).reshape(-1, 2)

        self.assertIsNone(
            estimate_similarity_transform(
                source.keypoints,
                target_points,
                target_box=transform_box(source.box, matrix),
            )
        )

    def test_similarity_transform_uses_eye_fallback_when_full_fit_fails(self) -> None:
        source = _geometry()
        angle = np.deg2rad(-8.0)
        scale = 0.8
        matrix = np.asarray(
            [
                [scale * np.cos(angle), -scale * np.sin(angle), 12.0],
                [scale * np.sin(angle), scale * np.cos(angle), 18.0],
            ],
            dtype=np.float32,
        )
        target_points = cv2.transform(
            source.keypoints.reshape(1, -1, 2),
            matrix,
        ).reshape(-1, 2)

        with mock.patch(
            "apps.flashhead.face_tracking.cv2.estimateAffinePartial2D",
            return_value=(None, None),
        ):
            estimated = estimate_similarity_transform(
                source.keypoints,
                target_points,
                target_box=transform_box(source.box, matrix),
            )

        self.assertIsNotNone(estimated)
        projected = cv2.transform(
            source.keypoints.reshape(1, -1, 2),
            estimated,
        ).reshape(-1, 2)
        self.assertLess(
            float(np.max(np.linalg.norm(projected - target_points, axis=1))),
            0.05,
        )

    def test_tracker_uses_detection_then_optical_flow(self) -> None:
        geometry = _geometry()
        detector = _ScriptedDetector([geometry])
        tracker = SourceFaceTracker(detector, detection_interval=3)
        first = np.zeros((96, 96, 3), dtype=np.uint8)
        for x, y in geometry.keypoints.astype(int):
            cv2.circle(first, (x, y), 4, (255, 255, 255), -1)
        transform = np.float32([[1.0, 0.0, 2.0], [0.0, 1.0, 1.0]])
        second = cv2.warpAffine(first, transform, (96, 96))

        detected = tracker.track(first)
        tracked = tracker.track(second)

        self.assertIsNotNone(detected)
        self.assertIsNotNone(tracked)
        self.assertEqual(tracked.origin, "flow")
        np.testing.assert_allclose(
            tracked.keypoints,
            geometry.keypoints + np.asarray([2.0, 1.0], dtype=np.float32),
            atol=0.35,
        )

    def test_tracker_falls_back_to_none_without_first_detection(self) -> None:
        tracker = SourceFaceTracker(
            _ScriptedDetector([None, None]),
            detection_interval=1,
        )
        frame = np.zeros((32, 32, 3), dtype=np.uint8)

        self.assertIsNone(tracker.track(frame))
        self.assertIsNone(tracker.track(frame))

    def test_tracker_stops_flow_after_detection_staleness_limit(self) -> None:
        geometry = _geometry()
        tracker = SourceFaceTracker(
            _ScriptedDetector([geometry, None, None, None]),
            detection_interval=1,
            max_stale_frames=2,
        )
        frame = np.zeros((96, 96, 3), dtype=np.uint8)
        for x, y in geometry.keypoints.astype(int):
            cv2.circle(frame, (x, y), 4, (255, 255, 255), -1)

        results = [tracker.track(frame) for _ in range(4)]

        self.assertEqual(results[0].origin, "detected")
        self.assertEqual((results[1].origin, results[1].stale_frames), ("flow", 1))
        self.assertEqual((results[2].origin, results[2].stale_frames), ("flow", 2))
        self.assertIsNone(results[3])

    def test_large_stream_jump_uses_fresh_detection_without_flow_blend(self) -> None:
        first_geometry = _geometry()
        second_geometry = _geometry((60.0, 0.0))
        tracker = SourceFaceTracker(
            _ScriptedDetector([first_geometry, second_geometry]),
            detection_interval=3,
        )
        first = np.zeros((160, 160, 3), dtype=np.uint8)
        for x, y in first_geometry.keypoints.astype(int):
            cv2.circle(first, (x, y), 4, (255, 255, 255), -1)
        second = cv2.warpAffine(
            first,
            np.float32([[1.0, 0.0, 60.0], [0.0, 1.0, 0.0]]),
            (160, 160),
        )

        tracker.track(first)
        recovered = tracker.track(second)

        self.assertEqual(recovered.origin, "detected")
        np.testing.assert_array_equal(recovered.keypoints, second_geometry.keypoints)


if __name__ == "__main__":
    unittest.main()
