'use client';

import {
  MutableRefObject,
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  CircleAlert,
  Eye,
  Gauge,
  Move3d,
  Pause,
  Play,
  RefreshCw,
  ScanFace,
  Upload,
  Video,
} from 'lucide-react';
import {
  FaceLandmarker,
  PoseLandmarker,
  type Category,
  type Landmark,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import {
  getFaceLandmarker,
  getPoseLandmarker,
  scheduleLandmarkerRelease,
} from '@/lib/mediapipe-landmarkers';
import styles from './avatar-landmark-panel.module.css';

export type AvatarLandmarkMode = 'expression' | 'motion';
type OverlayDetail = 'points' | 'contour' | 'mesh';
type Connection = { start: number; end: number };
type MediaBox = { left: number; top: number; width: number; height: number };
type Detector = FaceLandmarker | PoseLandmarker;
type DetectorState = { mode: AvatarLandmarkMode; instance: Detector };
type GridMaterial = {
  depthTest: boolean;
  depthWrite: boolean;
  transparent: boolean;
  opacity: number;
  dispose: () => void;
};
type DetectionStatus = 'loading' | 'ready' | 'detected' | 'missing' | 'error';

type AvatarLandmarkPanelProps = {
  mode: AvatarLandmarkMode;
  avatarImage: string;
  avatarName: string;
  avatarVideo: string;
};

type DetectionStats = {
  fps: number;
  latency: number;
  points: number;
};

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const FACE_CONTOURS = FaceLandmarker.FACE_LANDMARKS_CONTOURS as Connection[];
const FACE_TESSELATION = FaceLandmarker.FACE_LANDMARKS_TESSELATION as Connection[];
const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS as Connection[];
const FACE_POINT_COUNT = 478;
const POSE_POINT_COUNT = 33;

function useMediaBox(
  viewportRef: MutableRefObject<HTMLDivElement | null>,
  naturalSize: { width: number; height: number } | null,
) {
  const [box, setBox] = useState<MediaBox | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !naturalSize?.width || !naturalSize.height) {
      setBox(null);
      return;
    }
    const scale = Math.min(
      viewport.clientWidth / naturalSize.width,
      viewport.clientHeight / naturalSize.height,
    );
    const width = naturalSize.width * scale;
    const height = naturalSize.height * scale;
    const next = {
      left: (viewport.clientWidth - width) / 2,
      top: (viewport.clientHeight - height) / 2,
      width,
      height,
    };
    setBox((current) => current
      && Math.abs(current.width - next.width) < 0.5
      && Math.abs(current.height - next.height) < 0.5
      ? current
      : next);
  }, [naturalSize, viewportRef]);

  useEffect(() => {
    measure();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measure, viewportRef]);

  return box;
}

function drawConnections(
  context: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  connections: Connection[],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
) {
  context.beginPath();
  for (const { start, end } of connections) {
    const from = points[start];
    const to = points[end];
    if (!from || !to) continue;
    if ((from.visibility ?? 1) < 0.25 || (to.visibility ?? 1) < 0.25) continue;
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
  }
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawLandmarkOverlay(
  canvas: HTMLCanvasElement,
  points: NormalizedLandmark[],
  mode: AvatarLandmarkMode,
  detail: OverlayDetail,
  width: number,
  height: number,
  showIndices: boolean,
) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (!points.length) return;

  const unit = Math.max(1, width / 720);
  if (mode === 'expression') {
    if (detail === 'mesh') {
      drawConnections(context, points, FACE_TESSELATION, width, height, 'rgba(91, 233, 255, .25)', unit * 0.55);
    }
    if (detail !== 'points') {
      drawConnections(context, points, FACE_CONTOURS, width, height, 'rgba(69, 225, 255, .92)', unit * 1.35);
    }
  } else if (detail !== 'points') {
    drawConnections(context, points, POSE_CONNECTIONS, width, height, 'rgba(76, 230, 255, .92)', unit * 2.2);
  }

  context.fillStyle = mode === 'expression' ? 'rgba(255, 210, 90, .94)' : 'rgba(255, 217, 102, .96)';
  const radius = mode === 'expression' ? unit * (detail === 'mesh' ? 1.2 : 1.7) : unit * 3.3;
  for (const point of points) {
    if ((point.visibility ?? 1) < 0.25) continue;
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
  }
  if (showIndices) {
    context.font = `${Math.max(6, unit * 5.5)}px ui-monospace, monospace`;
    context.fillStyle = 'rgba(255, 255, 255, .9)';
    context.strokeStyle = 'rgba(3, 13, 21, .9)';
    context.lineWidth = unit * 1.8;
    points.forEach((point, index) => {
      if ((point.visibility ?? 1) < 0.25) return;
      const x = point.x * width + radius * 1.5;
      const y = point.y * height - radius * 1.5;
      context.strokeText(String(index), x, y);
      context.fillText(String(index), x, y);
    });
  }
}

function normalizedScenePoints(points: Landmark[], mode: AvatarLandmarkMode, mediaAspect: number) {
  if (!points.length) return [];
  if (mode === 'motion') {
    const leftHip = points[23] ?? points[0];
    const rightHip = points[24] ?? leftHip;
    const centerX = (leftHip.x + rightHip.x) / 2;
    const centerY = (leftHip.y + rightHip.y) / 2;
    const centerZ = (leftHip.z + rightHip.z) / 2;
    const relative = points.map((point) => ({
      x: point.x - centerX,
      y: -(point.y - centerY),
      z: -(point.z - centerZ),
      visibility: point.visibility,
    }));
    const visible = relative.filter((point) => (point.visibility ?? 1) >= 0.35);
    const fitPoints = visible.length >= 4 ? visible : relative;
    const minX = Math.min(...fitPoints.map((point) => point.x));
    const maxX = Math.max(...fitPoints.map((point) => point.x));
    const minY = Math.min(...fitPoints.map((point) => point.y));
    const maxY = Math.max(...fitPoints.map((point) => point.y));
    const fitCenterX = (minX + maxX) / 2;
    const fitCenterY = (minY + maxY) / 2;
    const scale = Math.min(3, Math.max(0.65, 2.35 / Math.max(maxX - minX, maxY - minY, 0.001)));
    return relative.map((point) => ({
      x: (point.x - fitCenterX) * scale,
      y: (point.y - fitCenterY) * scale,
      z: point.z * scale,
      visibility: point.visibility,
    }));
  }

  const aspect = Math.min(2.5, Math.max(0.4, mediaAspect || 1));
  const corrected = points.map((point) => ({
    x: point.x * aspect,
    y: point.y,
    z: point.z * aspect,
    visibility: point.visibility,
  }));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of corrected) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const scale = 1.85 / Math.max(maxX - minX, maxY - minY, 0.001);
  return corrected.map((point) => ({
    x: (point.x - centerX) * scale,
    y: -(point.y - centerY) * scale,
    z: -(point.z - centerZ) * scale * 1.35,
    visibility: point.visibility,
  }));
}

function LandmarkScene({
  mode,
  landmarksRef,
  detail,
  mediaAspect,
  mirrored,
  revision,
}: {
  mode: AvatarLandmarkMode;
  landmarksRef: MutableRefObject<Landmark[]>;
  detail: OverlayDetail;
  mediaAspect: number;
  mirrored: boolean;
  revision: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: () => void = () => undefined;

    void import('three').then((THREE) => {
      if (disposed) return;
      try {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x07111d, 0);
        renderer.domElement.style.touchAction = 'none';
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
        camera.position.set(0, 0, mode === 'expression' ? 3.5 : 4.4);

        const group = new THREE.Group();
        scene.add(group);
        scene.add(new THREE.AmbientLight(0xffffff, 1));

        const pointCount = mode === 'expression' ? FACE_POINT_COUNT : POSE_POINT_COUNT;
        const connections = mode === 'expression'
          ? detail === 'contour' ? FACE_CONTOURS : FACE_TESSELATION
          : POSE_CONNECTIONS;
        const positions = new Float32Array(pointCount * 3);
        const pointGeometry = new THREE.BufferGeometry();
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({
          color: mode === 'expression' ? 0xffd96a : 0x6cecff,
          size: mode === 'expression' ? 0.022 : 0.065,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.96,
        }));
        group.add(points);

        const linePositions = new Float32Array(connections.length * 6);
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
          color: mode === 'expression' ? 0x34cbe6 : 0x35d6f2,
          transparent: true,
          opacity: mode === 'expression' ? 0.28 : 0.72,
        }));
        group.add(lines);

        const grid = new THREE.GridHelper(3.6, 18, 0x224b64, 0x173042);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.65;
        grid.renderOrder = -1;
        const rawGridMaterials = grid.material as GridMaterial | GridMaterial[];
        const gridMaterials = Array.isArray(rawGridMaterials) ? rawGridMaterials : [rawGridMaterials];
        for (const material of gridMaterials) {
          material.depthTest = false;
          material.depthWrite = false;
          material.transparent = true;
          material.opacity = 0.42;
        }
        scene.add(grid);

        let frame = 0;
        let dragging = false;
        let hasLandmarkFrame = false;
        let pointerX = 0;
        let pointerY = 0;
        const onPointerDown = (event: PointerEvent) => {
          dragging = true;
          pointerX = event.clientX;
          pointerY = event.clientY;
          renderer.domElement.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!dragging) return;
          group.rotation.y += (event.clientX - pointerX) * 0.008;
          group.rotation.x += (event.clientY - pointerY) * 0.008;
          group.rotation.x = Math.max(-1.1, Math.min(1.1, group.rotation.x));
          pointerX = event.clientX;
          pointerY = event.clientY;
        };
        const onPointerUp = () => { dragging = false; };
        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          camera.position.z = Math.max(2.2, Math.min(7, camera.position.z + event.deltaY * 0.002));
        };
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointermove', onPointerMove);
        renderer.domElement.addEventListener('pointerup', onPointerUp);
        renderer.domElement.addEventListener('pointercancel', onPointerUp);
        renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const render = () => {
          frame = window.requestAnimationFrame(render);
          const source = normalizedScenePoints(landmarksRef.current, mode, mediaAspect);
          group.visible = source.length > 0;
          lines.visible = detail !== 'points';
          if (source.length) {
            const smoothing = hasLandmarkFrame ? 0.38 : 1;
            for (let index = 0; index < pointCount; index += 1) {
              const point = source[index];
              const offset = index * 3;
              const targetX = (point?.x ?? 0) * (mirrored ? -1 : 1);
              const targetY = point?.y ?? 0;
              const targetZ = point?.z ?? 0;
              positions[offset] += (targetX - positions[offset]) * smoothing;
              positions[offset + 1] += (targetY - positions[offset + 1]) * smoothing;
              positions[offset + 2] += (targetZ - positions[offset + 2]) * smoothing;
            }
            hasLandmarkFrame = true;
            pointGeometry.attributes.position.needsUpdate = true;
            for (let index = 0; index < connections.length; index += 1) {
              const connection = connections[index];
              const fromOffset = connection.start * 3;
              const toOffset = connection.end * 3;
              const lineOffset = index * 6;
              linePositions[lineOffset] = positions[fromOffset];
              linePositions[lineOffset + 1] = positions[fromOffset + 1];
              linePositions[lineOffset + 2] = positions[fromOffset + 2];
              linePositions[lineOffset + 3] = positions[toOffset];
              linePositions[lineOffset + 4] = positions[toOffset + 1];
              linePositions[lineOffset + 5] = positions[toOffset + 2];
            }
            lineGeometry.attributes.position.needsUpdate = true;
          } else {
            hasLandmarkFrame = false;
          }
          renderer.render(scene, camera);
        };
        render();

        cleanup = () => {
          window.cancelAnimationFrame(frame);
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener('pointerdown', onPointerDown);
          renderer.domElement.removeEventListener('pointermove', onPointerMove);
          renderer.domElement.removeEventListener('pointerup', onPointerUp);
          renderer.domElement.removeEventListener('pointercancel', onPointerUp);
          renderer.domElement.removeEventListener('wheel', onWheel);
          pointGeometry.dispose();
          lineGeometry.dispose();
          points.material.dispose();
          lines.material.dispose();
          grid.geometry.dispose();
          gridMaterials.forEach((material) => material.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        setError('当前浏览器无法初始化 WebGL 3D 视图');
      }
    }).catch(() => setError('Three.js 加载失败'));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [detail, landmarksRef, mediaAspect, mirrored, mode, revision]);

  return <div className={styles.sceneHost} ref={hostRef}>{error && <span className={styles.sceneError}><CircleAlert size={16} />{error}</span>}</div>;
}

function topBlendshapes(categories: Category[]) {
  return [...categories]
    .filter((item) => item.categoryName !== '_neutral')
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function AvatarLandmarkPanel({
  mode,
  avatarImage,
  avatarName,
  avatarVideo,
}: AvatarLandmarkPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneLandmarksRef = useRef<Landmark[]>([]);
  const uploadedUrlRef = useRef('');
  const statusRef = useRef<DetectionStatus>('loading');
  const [uploadedVideo, setUploadedVideo] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [detectorState, setDetectorState] = useState<DetectorState | null>(null);
  const [status, setStatus] = useState<DetectionStatus>('loading');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(true);
  const [detail, setDetail] = useState<OverlayDetail>(mode === 'expression' ? 'mesh' : 'contour');
  const [mirrored, setMirrored] = useState(false);
  const [showIndices, setShowIndices] = useState(false);
  const [sceneRevision, setSceneRevision] = useState(0);
  const [stats, setStats] = useState<DetectionStats>({ fps: 0, latency: 0, points: 0 });
  const [blendshapes, setBlendshapes] = useState<Category[]>([]);
  const sourceVideo = uploadedVideo || avatarVideo;
  const mediaBox = useMediaBox(viewportRef, naturalSize);
  const mediaAspect = naturalSize?.width && naturalSize.height
    ? naturalSize.width / naturalSize.height
    : 1;
  const displayName = avatarName.trim() || '未命名形象';
  const config = useMemo(() => mode === 'expression'
    ? {
        title: '实时表情捕捉',
        subtitle: '478 点人脸检测与归一化 3D 坐标同步',
        sourceTitle: '数字人视频 · 人脸关键点',
        sceneTitle: '归一化 3D 人脸坐标',
        pointTarget: FACE_POINT_COUNT,
        targetFps: 24,
      }
    : {
        title: '实时动作捕捉',
        subtitle: '33 点姿态检测与世界坐标骨架同步',
        sourceTitle: '数字人视频 · 姿态关键点',
        sceneTitle: '3D 人体骨架坐标',
        pointTarget: POSE_POINT_COUNT,
        targetFps: 18,
      }, [mode]);

  const updateStatus = useCallback((next: DetectionStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    setDetail(mode === 'expression' ? 'mesh' : 'contour');
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setDetectorState(null);
    setError('');
    updateStatus('loading');
    const load = mode === 'expression' ? getFaceLandmarker() : getPoseLandmarker();
    void load.then((next) => {
      if (cancelled) return;
      setDetectorState({ mode, instance: next });
      updateStatus('ready');
    }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : '关键点模型加载失败');
      updateStatus('error');
    });
    return () => { cancelled = true; };
  }, [mode, updateStatus]);

  useEffect(() => () => {
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    scheduleLandmarkerRelease();
  }, []);

  useEffect(() => {
    sceneLandmarksRef.current = [];
    setBlendshapes([]);
    setStats({ fps: 0, latency: 0, points: 0 });
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [mode]);

  useEffect(() => {
    setNaturalSize(null);
  }, [sourceVideo, avatarImage]);

  useEffect(() => {
    if (!detectorState || detectorState.mode !== mode || !mediaRevision) return;
    const detector = detectorState.instance;
    const video = sourceVideo ? videoRef.current as VideoWithFrameCallback | null : null;
    const image = !sourceVideo ? imageRef.current : null;
    const canvas = canvasRef.current;
    if ((!video && !image) || !canvas || !naturalSize) return;

    let cancelled = false;
    let frameHandle = 0;
    let animationHandle = 0;
    let previousVideoTime = -1;
    let lastInferenceAt = 0;
    let windowStartedAt = performance.now();
    let framesInWindow = 0;
    let lastLatency = 0;
    const interval = 1000 / config.targetFps;

    const detect = (media: HTMLVideoElement | HTMLImageElement, timestamp: number) => {
      if (cancelled || timestamp - lastInferenceAt < interval) return;
      lastInferenceAt = timestamp;
      const startedAt = performance.now();
      try {
        let overlayPoints: NormalizedLandmark[] = [];
        let scenePoints: Landmark[] = [];
        if (mode === 'expression') {
          const result = (detector as FaceLandmarker).detectForVideo(media, timestamp);
          overlayPoints = result.faceLandmarks[0] ?? [];
          scenePoints = overlayPoints;
          if (!sourceVideo || timestamp - windowStartedAt >= 500) {
            setBlendshapes(topBlendshapes(result.faceBlendshapes[0]?.categories ?? []));
          }
        } else {
          const result = (detector as PoseLandmarker).detectForVideo(media, timestamp);
          overlayPoints = result.landmarks[0] ?? [];
          scenePoints = result.worldLandmarks[0] ?? [];
        }
        sceneLandmarksRef.current = scenePoints;
        drawLandmarkOverlay(canvas, overlayPoints, mode, detail, naturalSize.width, naturalSize.height, showIndices);
        updateStatus(overlayPoints.length ? 'detected' : 'missing');
        lastLatency = performance.now() - startedAt;
        framesInWindow += 1;
        if (!sourceVideo) {
          setStats({
            fps: 0,
            latency: Math.round(lastLatency * 10) / 10,
            points: overlayPoints.length,
          });
        }
        if (timestamp - windowStartedAt >= 500) {
          const elapsed = Math.max(1, timestamp - windowStartedAt);
          setStats({
            fps: Math.round((framesInWindow * 1000) / elapsed),
            latency: Math.round(lastLatency * 10) / 10,
            points: overlayPoints.length,
          });
          framesInWindow = 0;
          windowStartedAt = timestamp;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '视频帧检测失败');
        updateStatus('error');
        cancelled = true;
      }
    };

    if (video) {
      const scheduleVideoFrame = () => {
        if (cancelled) return;
        if (video.requestVideoFrameCallback) {
          frameHandle = video.requestVideoFrameCallback((now) => {
            if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) detect(video, now);
            scheduleVideoFrame();
          });
          return;
        }
        const fallback = (now: number) => {
          if (cancelled) return;
          if (!video.paused && video.currentTime !== previousVideoTime) {
            previousVideoTime = video.currentTime;
            detect(video, now);
          }
          animationHandle = window.requestAnimationFrame(fallback);
        };
        animationHandle = window.requestAnimationFrame(fallback);
      };
      scheduleVideoFrame();
    } else if (image?.complete) {
      detect(image, performance.now());
    }

    return () => {
      cancelled = true;
      if (frameHandle && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      if (animationHandle) window.cancelAnimationFrame(animationHandle);
    };
  }, [config.targetFps, detail, detectorState, mediaRevision, mode, naturalSize, showIndices, sourceVideo, updateStatus]);

  const onVideoReady = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setNaturalSize({ width: video.videoWidth, height: video.videoHeight });
    setMediaRevision((value) => value + 1);
    void video.play().catch(() => setPlaying(false));
  };

  const onImageReady = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    setMediaRevision((value) => value + 1);
  };

  const uploadVideo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('请选择 MP4 或 WebM 视频文件');
      return;
    }
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    const url = URL.createObjectURL(file);
    uploadedUrlRef.current = url;
    setUploadedVideo(url);
    setError('');
    setPlaying(true);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const resetView = () => {
    setUploadedVideo('');
    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
      uploadedUrlRef.current = '';
    }
    const video = videoRef.current;
    if (video) video.currentTime = 0;
  };

  const statusText = {
    loading: '正在加载本地检测模型',
    ready: '模型已就绪，等待画面',
    detected: `检测到 ${stats.points || config.pointTarget} 个关键点`,
    missing: mode === 'expression' ? '当前帧未检测到完整人脸' : '当前帧未检测到人体姿态',
    error: '检测暂不可用',
  }[status];

  return (
    <section className={styles.panel} data-mode={mode}>
      <header className={styles.header}>
        <span className={styles.headerIcon}>{mode === 'expression' ? <ScanFace size={21} /> : <Move3d size={21} />}</span>
        <div><strong>{config.title}</strong><small>{config.subtitle}</small></div>
        <span className={`${styles.statusPill} ${styles[status]}`}><i />{statusText}</span>
      </header>

      <div className={styles.workspace}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span>{mode === 'expression' ? <Eye size={15} /> : <Activity size={15} />}{displayName} · {config.sourceTitle}</span>
            <nav aria-label="关键点显示方式">
              {([['points', '关键点'], ['contour', mode === 'expression' ? '轮廓' : '骨架'], ['mesh', '完整网格']] as const)
                .filter(([id]) => mode === 'expression' || id !== 'mesh')
                .map(([id, label]) => <button className={detail === id ? styles.active : ''} key={id} type="button" onClick={() => setDetail(id)}>{label}</button>)}
            </nav>
          </header>
          <div className={styles.videoViewport} ref={viewportRef}>
            <div className={styles.videoGrid} />
            {(sourceVideo || avatarImage) && (
              <div
                className={styles.registeredMedia}
                style={{
                  ...(mediaBox ?? { left: 0, top: 0, width: '100%', height: '100%', opacity: 0 }),
                  transform: mirrored ? 'scaleX(-1)' : undefined,
                }}
              >
                {sourceVideo
                  ? <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="auto"
                      ref={videoRef}
                      src={sourceVideo}
                      onLoadedData={onVideoReady}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  : avatarImage
                    ? <img ref={imageRef} src={avatarImage} alt={`${displayName}静态关键点检测`} onLoad={onImageReady} />
                    : null}
                <canvas ref={canvasRef} aria-label={mode === 'expression' ? '人脸关键点覆盖层' : '动作关键点覆盖层'} />
              </div>
            )}
            {!naturalSize && <div className={styles.mediaPlaceholder}><Video size={28} /><strong>{avatarImage || sourceVideo ? '正在准备画面' : '暂无数字人画面'}</strong><span>可上传 MP4 / WebM 视频进行实时检测</span></div>}
            <span className={styles.liveBadge}><i />{sourceVideo ? playing ? 'LIVE' : 'PAUSED' : 'STATIC'}</span>
            {status === 'missing' && <span className={styles.noDetection}>{statusText}</span>}
          </div>
          <footer className={styles.controls}>
            <button type="button" onClick={togglePlayback} disabled={!sourceVideo}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '播放'}</button>
            <label><Upload size={14} />上传预览视频<input type="file" accept="video/mp4,video/webm" hidden onChange={(event) => uploadVideo(event.target.files?.[0])} /></label>
            <button type="button" onClick={() => setMirrored((value) => !value)}>{mirrored ? '取消镜像' : '镜像画面'}</button>
            <button type="button" onClick={() => setShowIndices((value) => !value)}>{showIndices ? '隐藏编号' : '显示编号'}</button>
            {uploadedVideo && <button type="button" onClick={resetView}><RefreshCw size={14} />恢复默认视频</button>}
            <span>{sourceVideo ? '视频帧实时检测' : '当前为静态检测'}</span>
          </footer>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span><Move3d size={15} />{config.sceneTitle}</span>
            <em>拖动旋转 · 滚轮缩放</em>
          </header>
          <div className={styles.sceneViewport}>
            <div className={styles.sceneGlow} />
            <LandmarkScene detail={detail} landmarksRef={sceneLandmarksRef} mediaAspect={mediaAspect} mirrored={mirrored} mode={mode} revision={sceneRevision} />
            <span className={styles.coordinateNote}>{mode === 'expression' ? '比例校正 · 相对深度' : '自动取景 · 相对世界坐标'}</span>
          </div>
          <footer className={styles.controls}>
            <span><i className={styles.yellowDot} />关键点</span>
            <span><i className={styles.blueDot} />拓扑连接</span>
            <button type="button" onClick={() => setSceneRevision((value) => value + 1)}><RefreshCw size={13} />回正视图</button>
            <span>视图与左侧视频帧同步</span>
          </footer>
        </article>
      </div>

      <div className={styles.telemetry}>
        <section><Gauge size={18} /><span><small>实时帧率</small><strong>{stats.fps || '--'} <em>FPS</em></strong></span></section>
        <section><Activity size={18} /><span><small>单帧推理</small><strong>{stats.latency || '--'} <em>ms</em></strong></span></section>
        <section><ScanFace size={18} /><span><small>有效关键点</small><strong>{stats.points || '--'} <em>/ {config.pointTarget}</em></strong></span></section>
        {mode === 'expression' ? (
          <div className={styles.blendshapes}>
            <span>实时表情系数</span>
            {blendshapes.length ? blendshapes.map((item) => <div key={item.categoryName}><small>{item.categoryName}</small><i><b style={{ width: `${Math.round(item.score * 100)}%` }} /></i><em>{Math.round(item.score * 100)}%</em></div>) : <p>检测到表情后显示最活跃的 5 个 blendshape</p>}
          </div>
        ) : (
          <div className={styles.motionInfo}><strong>33 点姿态模型</strong><span>右侧优先使用 MediaPipe worldLandmarks；低可见度关节不会绘制到视频覆盖层。</span></div>
        )}
      </div>

      {error && <div className={styles.errorBanner}><CircleAlert size={15} />{error}</div>}
    </section>
  );
}
