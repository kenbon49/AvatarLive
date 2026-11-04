type OrderedLayer = {
  id: string;
};

export function layerZIndex(
  layers: readonly OrderedLayer[],
  layerId: string,
  base = 10,
): number {
  const index = layers.findIndex((layer) => layer.id === layerId);
  return index < 0 ? base : base + layers.length - index;
}

export function layersBackToFront<T>(layers: readonly T[]): T[] {
  return [...layers].reverse();
}
