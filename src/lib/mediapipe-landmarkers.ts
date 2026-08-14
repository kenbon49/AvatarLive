import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';

const WASM_ROOT = '/vendor/mediapipe/wasm';
const FACE_MODEL = '/vendor/mediapipe/models/face_landmarker.task';
const POSE_MODEL = '/vendor/mediapipe/models/pose_landmarker_lite.task';

let visionFilesPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelLandmarkerRelease() {
  if (!releaseTimer) return;
  clearTimeout(releaseTimer);
  releaseTimer = null;
}

function visionFiles() {
  visionFilesPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT);
  return visionFilesPromise;
}

async function createFaceLandmarker(delegate: 'GPU' | 'CPU') {
  return FaceLandmarker.createFromOptions(await visionFiles(), {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

async function createPoseLandmarker(delegate: 'GPU' | 'CPU') {
  return PoseLandmarker.createFromOptions(await visionFiles(), {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

export function getFaceLandmarker() {
  cancelLandmarkerRelease();
  faceLandmarkerPromise ??= createFaceLandmarker('GPU').catch(() => createFaceLandmarker('CPU'));
  return faceLandmarkerPromise;
}

export function getPoseLandmarker() {
  cancelLandmarkerRelease();
  poseLandmarkerPromise ??= createPoseLandmarker('GPU').catch(() => createPoseLandmarker('CPU'));
  return poseLandmarkerPromise;
}

export async function releaseLandmarkers() {
  cancelLandmarkerRelease();
  const pending: Array<Promise<FaceLandmarker | PoseLandmarker>> = [];
  if (faceLandmarkerPromise) pending.push(faceLandmarkerPromise);
  if (poseLandmarkerPromise) pending.push(poseLandmarkerPromise);
  faceLandmarkerPromise = null;
  poseLandmarkerPromise = null;
  visionFilesPromise = null;

  const settled = await Promise.allSettled(pending);
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    try {
      result.value.close();
    } catch {
      // The browser may already have released the underlying WebGL context.
    }
  }
}

export function scheduleLandmarkerRelease(delayMs = 60_000) {
  cancelLandmarkerRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    void releaseLandmarkers();
  }, delayMs);
}
