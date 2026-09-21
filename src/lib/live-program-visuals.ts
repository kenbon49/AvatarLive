export type VisualLayerFit = 'contain' | 'cover' | 'fill';

type VisualLayer = {
  kind: 'text' | 'image' | 'video' | 'host';
  sceneKey?: string;
  preview?: string;
};

export function visualLayerFit(layer: VisualLayer): VisualLayerFit {
  if (layer.kind === 'text' && layer.preview) return 'fill';
  if (layer.sceneKey === 'templateElement') return 'fill';
  if (layer.sceneKey === 'custom') return 'cover';
  return 'contain';
}
