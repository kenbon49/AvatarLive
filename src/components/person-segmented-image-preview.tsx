'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const VISION_WASM_PATH = '/vendor/mediapipe/wasm';
const PERSON_SEGMENTATION_MODEL = '/vendor/mediapipe/models/selfie_segmenter.tflite';
const MAX_RENDER_EDGE = 960;

export type PersonImageSegmentationState = 'loading' | 'ready' | 'error';

type PersonSegmentedImagePreviewProps = {
  src: string;
  className: string;
  style: CSSProperties;
  label: string;
  onStateChange?: (state: PersonImageSegmentationState) => void;
};

let segmenterPromise: Promise<ImageSegmenter> | null = null;

function smoothStep(value: number, edge0: number, edge1: number) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

function getImageSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks(VISION_WASM_PATH).then(async (vision) => {
      const options = {
        baseOptions: { modelAssetPath: PERSON_SEGMENTATION_MODEL },
        runningMode: 'IMAGE' as const,
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
    }).catch((cause) => {
      segmenterPromise = null;
      throw cause;
    });
  }
  return segmenterPromise;
}

export function PersonSegmentedImagePreview({
  src,
  className,
  style,
  label,
  onStateChange,
}: PersonSegmentedImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sourceCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    const maskContext = maskCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    const outputContext = canvas.getContext('2d', { alpha: true });
    if (!sourceContext || !maskContext || !outputContext) {
      onStateChange?.('error');
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    const fail = () => {
      if (!cancelled) onStateChange?.('error');
    };

    image.onload = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.width = sourceCanvas.width = width;
      canvas.height = sourceCanvas.height = height;
      sourceContext.clearRect(0, 0, width, height);
      sourceContext.drawImage(image, 0, 0, width, height);

      const sourcePixels = sourceContext.getImageData(0, 0, width, height).data;
      let hasNativeTransparency = false;
      for (let index = 3; index < sourcePixels.length; index += 64) {
        if (sourcePixels[index] < 245) {
          hasNativeTransparency = true;
          break;
        }
      }
      if (hasNativeTransparency) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        outputContext.drawImage(image, 0, 0);
        onStateChange?.('ready');
        return;
      }

      void getImageSegmenter().then((segmenter) => {
        if (cancelled) return;
        segmenter.segment(sourceCanvas, (result) => {
          if (cancelled) return;
          const mask = result.confidenceMasks?.[0];
          if (!mask) {
            fail();
            return;
          }

          const confidence = mask.getAsFloat32Array();
          maskCanvas.width = mask.width;
          maskCanvas.height = mask.height;
          const maskImage = maskContext.createImageData(mask.width, mask.height);
          for (let index = 0; index < confidence.length; index += 1) {
            const offset = index * 4;
            maskImage.data[offset] = 255;
            maskImage.data[offset + 1] = 255;
            maskImage.data[offset + 2] = 255;
            maskImage.data[offset + 3] = Math.round(smoothStep(confidence[index], 0.1, 0.78) * 255);
          }
          maskContext.putImageData(maskImage, 0, 0);

          outputContext.clearRect(0, 0, width, height);
          outputContext.globalCompositeOperation = 'source-over';
          outputContext.drawImage(sourceCanvas, 0, 0);
          outputContext.globalCompositeOperation = 'destination-in';
          outputContext.imageSmoothingEnabled = true;
          outputContext.drawImage(maskCanvas, 0, 0, width, height);
          outputContext.globalCompositeOperation = 'source-over';
          onStateChange?.('ready');
        });
      }).catch(fail);
    };
    image.onerror = fail;

    onStateChange?.('loading');
    image.src = src;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [onStateChange, src]);

  return <canvas ref={canvasRef} className={className} style={style} role="img" aria-label={label} />;
}
