'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { layerZIndex } from '@/lib/live-layer-order';
import type { LiveRoomLayerItem } from '@/lib/live-room-api';

export function StoryboardScenePreview({ layers, background, host, videoUrl, fonts }: {
  layers: LiveRoomLayerItem[];
  background: string;
  host: string;
  videoUrl?: string;
  fonts: Record<string, string>;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  return <span className="xlStoryboardScene" ref={root} aria-hidden="true">
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
          <img src={host} alt="" loading="lazy" decoding="async" />
          {visible && videoUrl && <video src={videoUrl} muted playsInline preload="auto" onLoadedData={event => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0); }} />}
        </span>;
        if (layer.kind === 'image') return <img style={{ ...style, objectFit: layer.sceneKey === 'templateBackground' ? 'cover' : 'contain' }} src={layer.preview || background} alt="" loading="lazy" decoding="async" key={layer.id} />;
        if (layer.kind !== 'text') return null;
        if (layer.preview) return <img style={{ ...style, objectFit: 'fill' }} src={layer.preview} alt="" loading="lazy" decoding="async" key={layer.id} />;
        return <span className="xlStoryboardSceneText" style={{
          ...style, color: layer.color ?? '#fff', fontFamily: fonts[layer.fontFamily ?? '默认字体'],
          fontSize: layer.fontSize ?? 16, fontWeight: layer.fontWeight, fontStyle: layer.fontStyle,
          textDecoration: layer.textDecoration, textAlign: layer.textAlign ?? 'center',
          justifyContent: layer.textAlign === 'left' ? 'flex-start' : layer.textAlign === 'right' ? 'flex-end' : 'center',
          lineHeight: layer.lineHeight ?? 1.2, letterSpacing: layer.letterSpacing ?? 0,
          background: layer.backgroundEnabled ? `color-mix(in srgb, ${layer.backgroundColor ?? '#111827'} ${layer.backgroundOpacity ?? 72}%, transparent)` : undefined,
          borderRadius: layer.backgroundRadius ?? 6,
          WebkitTextStroke: layer.strokeEnabled ? `1px ${layer.strokeColor ?? '#000'}` : undefined,
          textShadow: layer.shadowEnabled ? `${layer.shadowX ?? 4}px ${layer.shadowY ?? 4}px ${layer.shadowBlur ?? 8}px ${layer.shadowColor ?? '#000'}` : undefined,
        }} key={layer.id}>{layer.value}</span>;
      })}
    </span>
  </span>;
}
