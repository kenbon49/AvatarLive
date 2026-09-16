'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const VISION_WASM_PATH = '/vendor/mediapipe/wasm';
const PERSON_SEGMENTATION_MODEL = '/vendor/mediapipe/models/selfie_segmenter.tflite';
const MAX_RENDER_EDGE = 640;
const MIN_FRAME_INTERVAL_MS = 70;

export type PersonSegmentationState = 'loading' | 'ready' | 'error';

type PersonSegmentedVideoPreviewProps = {
  src: string;
  className: string;
  style: CSSProperties;
  label: string;
  onStateChange?: (state: PersonSegmentationState) => void;
};

function smoothStep(value: number, edge0: number, edge1: number) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

export function PersonSegmentedVideoPreview({
  src,
  className,
  style,
  label,
  onStateChange,
}: PersonSegmentedVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const sourceCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true });
    const maskContext = maskCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    const outputContext = canvas.getContext('2d', { alpha: true });
    if (!sourceContext || !maskContext || !outputContext) {
      onStateChange?.('error');
      return;
    }

    let cancelled = false;
    let segmentationFailed = false;
    let segmenter: ImageSegmenter | null = null;
    let frameHandle: number | null = null;
    let animationHandle: number | null = null;
    let processing = false;
    let maskImage: ImageData | null = null;
    let previousAlpha: Uint8ClampedArray | null = null;
    let firstFrameRendered = false;
    let lastFrameAt = 0;
    const timedVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const configureCanvas = () => {
      if (!video.videoWidth || !video.videoHeight) return false;
      const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = sourceCanvas.width = width;
        canvas.height = sourceCanvas.height = height;
      }
      return true;
    };

    const fail = () => {
      if (segmentationFailed || cancelled) return;
      segmentationFailed = true;
      onStateChange?.('error');
    };

    const drawSegmentedFrame = (now: number) => {
      if (cancelled || segmentationFailed || !segmenter || processing || video.paused || video.ended) return;
      if (now - lastFrameAt < MIN_FRAME_INTERVAL_MS) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !configureCanvas()) return;
      lastFrameAt = now;
      processing = true;
      try {
        sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        sourceContext.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
        segmenter.segmentForVideo(sourceCanvas, now, (result) => {
          const mask = result.confidenceMasks?.[0];
          if (!mask || cancelled) return;
          const confidence = mask.getAsFloat32Array();
          if (!maskImage || maskImage.width !== mask.width || maskImage.height !== mask.height) {
            maskCanvas.width = mask.width;
            maskCanvas.height = mask.height;
            maskImage = maskContext.createImageData(mask.width, mask.height);
            previousAlpha = new Uint8ClampedArray(mask.width * mask.height);
          }

          const pixels = maskImage.data;
          for (let index = 0; index < confidence.length; index += 1) {
            const targetAlpha = Math.round(smoothStep(confidence[index], 0.12, 0.8) * 255);
            const alpha = firstFrameRendered && previousAlpha
              ? Math.round(targetAlpha * 0.76 + previousAlpha[index] * 0.24)
              : targetAlpha;
            if (previousAlpha) previousAlpha[index] = alpha;
            const offset = index * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = alpha;
          }
          maskContext.putImageData(maskImage, 0, 0);

          outputContext.clearRect(0, 0, canvas.width, canvas.height);
          outputContext.globalCompositeOperation = 'source-over';
          outputContext.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
          outputContext.globalCompositeOperation = 'destination-in';
          outputContext.imageSmoothingEnabled = true;
          outputContext.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
          outputContext.globalCompositeOperation = 'source-over';
          if (!firstFrameRendered) {
            firstFrameRendered = true;
            onStateChange?.('ready');
          }
        });
      } catch {
        fail();
      } finally {
        processing = false;
      }
    };

    const scheduleFrame = () => {
      if (cancelled || segmentationFailed || video.paused || video.ended || frameHandle !== null || animationHandle !== null) return;
      if (timedVideo.requestVideoFrameCallback) {
        frameHandle = timedVideo.requestVideoFrameCallback((now) => {
          frameHandle = null;
          drawSegmentedFrame(now);
          scheduleFrame();
        });
      } else {
        animationHandle = window.requestAnimationFrame((now) => {
          animationHandle = null;
          drawSegmentedFrame(now);
          scheduleFrame();
        });
      }
    };

    const beginPlayback = () => {
      if (!segmenter || !configureCanvas()) return;
      void video.play().then(scheduleFrame).catch(fail);
    };

    const createSegmenter = async () => {
      const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);
      const options = {
        baseOptions: { modelAssetPath: PERSON_SEGMENTATION_MODEL },
        runningMode: 'VIDEO' as const,
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      };
      try {
        return await ImageSegmenter.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        return ImageSegmenter.createFromOptions(vision, options);
      }
    };

    onStateChange?.('loading');
    video.addEventListener('loadeddata', beginPlayback);
    video.addEventListener('play', scheduleFrame);
    video.src = src;
    video.load();

    void createSegmenter().then((createdSegmenter) => {
      if (cancelled) {
        createdSegmenter.close();
        return;
      }
      segmenter = createdSegmenter;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) beginPlayback();
    }).catch(fail);

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', beginPlayback);
      video.removeEventListener('play', scheduleFrame);
      if (frameHandle !== null) timedVideo.cancelVideoFrameCallback?.(frameHandle);
      if (animationHandle !== null) window.cancelAnimationFrame(animationHandle);
      video.pause();
      video.removeAttribute('src');
      video.load();
      segmenter?.close();
    };
  }, [onStateChange, src]);

  return <>
    <video ref={videoRef} muted loop playsInline crossOrigin="anonymous" aria-hidden="true" className="xlSegmentationSourceVideo" />
    <canvas ref={canvasRef} className={className} style={style} role="img" aria-label={label} />
  </>;
}
