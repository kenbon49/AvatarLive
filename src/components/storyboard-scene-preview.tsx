'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { layerZIndex } from '@/lib/live-layer-order';
import type { LiveRoomLayerItem } from '@/lib/live-room-api';
import { PersonSegmentedImagePreview } from '@/components/person-segmented-image-preview';

function SceneHost({ src, visible }: { src: string; visible: boolean }) {
  const [segmented, setSegmented] = useState(false);
  const onStateChange = useCallback((state: 'loading' | 'ready' | 'error') => setSegmented(state === 'ready'), []);
  return <>
    {!segmented && <img src={src} alt="" loading="lazy" decoding="async" />}
    {visible && <PersonSegmentedImagePreview
      src={src}
      className="xlStoryboardSegmentedHost"
      style={{ opacity: segmented ? 1 : 0 }}
      label="数字人静态预览"
      onStateChange={onStateChange}
    />}
  </>;
}

export function StoryboardScenePreview({ layers, background, host, videoUrl, fonts, roomCover = false }: {
  layers: LiveRoomLayerItem[];
  background: string;
  host: string;
  videoUrl?: string;
  fonts: Record<string, string>;
  roomCover?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  return <span className={`xlStoryboardScene ${roomCover ? 'roomCover' : ''}`} ref={root} aria-hidden="true">
    <span className="xlStoryboardSceneCanvas">
      {!layers.some(layer => layer.sceneKey === 'templateBackground') && <img className="xlStoryboardSceneBackground" src={background} alt="" loading="lazy" decoding="async" />}
      {layers.map(layer => {
        const style: CSSProperties = {
          position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`,
          width: `${layer.width}%`, height: `${layer.height}%`,
          transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
          opacity: layer.opacity / 100, zIndex: layerZIndex(layers, layer.id),
        };
        if (layer.sceneKey === 'host') return <span className="xlStoryboardSceneHost" style={style} key={layer.id}>
          {roomCover ? <SceneHost src={host} visible={visible} /> : <img src={host} alt="" loading="lazy" decoding="async" />}
          {visible && videoUrl && <video src={videoUrl} muted playsInline preload="metadata" onLoadedData={event => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0); }} />}
        </span>;
        if (layer.kind === 'image') return <img style={{ ...style, objectFit: layer.sceneKey === 'templateBackground' || layer.sceneKey === 'custom' ? 'cover' : 'fill' }} src={layer.preview || background} alt="" loading="lazy" decoding="async" key={layer.id} />;
        if (layer.kind !== 'text') return null;
        if (layer.preview) return <img style={{ ...style, objectFit: 'fill' }} src={layer.preview} alt="" loading="lazy" decoding="async" key={layer.id} />;
        return <span className={`xlStoryboardSceneText ${roomCover ? layer.sceneKey ?? '' : ''}`} style={{
          ...style, color: layer.color ?? '#fff', fontFamily: fonts[layer.fontFamily ?? '默认字体'],
          fontSize: roomCover ? `${Math.round((layer.fontSize ?? 16) / 3.78 * 10) / 10}cqw` : layer.fontSize ?? 16,
          fontWeight: layer.fontWeight, fontStyle: layer.fontStyle,
          textDecoration: layer.textDecoration, textAlign: layer.textAlign ?? 'center',
          justifyContent: layer.textAlign === 'left' ? 'flex-start' : layer.textAlign === 'right' ? 'flex-end' : 'center',
          lineHeight: layer.lineHeight ?? 1.2,
          letterSpacing: roomCover ? `${Math.round((layer.letterSpacing ?? 0) / 3.78 * 10) / 10}cqw` : layer.letterSpacing ?? 0,
          background: layer.backgroundEnabled ? `color-mix(in srgb, ${layer.backgroundColor ?? '#111827'} ${layer.backgroundOpacity ?? 72}%, transparent)` : undefined,
          borderRadius: layer.backgroundRadius ?? 6,
          WebkitTextStroke: layer.strokeEnabled ? `${roomCover ? `${(layer.strokeWidth ?? 1) / 3.78}cqw` : '1px'} ${layer.strokeColor ?? '#000'}` : undefined,
          textShadow: layer.shadowEnabled ? `${layer.shadowX ?? 4}px ${layer.shadowY ?? 4}px ${layer.shadowBlur ?? 8}px ${layer.shadowColor ?? '#000'}` : undefined,
        }} key={layer.id}>{layer.value}</span>;
      })}
    </span>
  </span>;
}
