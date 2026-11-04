export type ComponentLayerGeometry = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  componentInstanceId?: string;
  componentSourceId?: string;
  componentName?: string;
  componentLayerId?: string;
};

export type ComponentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const normalizeRotation = (value: number) => {
  const rotation = value % 360;
  return round(rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation);
};

export function componentBounds(layers: readonly ComponentLayerGeometry[]): ComponentBounds | null {
  if (!layers.length) return null;
  const points = layers.flatMap((layer) => {
    const radians = layer.rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const halfWidth = layer.width / 2;
    const halfHeight = layer.height / 2;
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ].map(([offsetX, offsetY]) => ({
      x: layer.x + offsetX * cosine - offsetY * sine,
      y: layer.y + offsetX * sine + offsetY * cosine,
    }));
  });
  const left = Math.min(...points.map(point => point.x));
  const right = Math.max(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const bottom = Math.max(...points.map(point => point.y));
  return {
    x: round((left + right) / 2),
    y: round((top + bottom) / 2),
    width: round(right - left),
    height: round(bottom - top),
  };
}

export function instantiateComponentLayers<T extends ComponentLayerGeometry>(
  layers: readonly T[],
  instance: { id: string; sourceId: string; name: string },
): T[] {
  return layers.map((layer, index) => ({
    ...layer,
    id: `${instance.id}-${index}`,
    componentInstanceId: instance.id,
    componentSourceId: instance.sourceId,
    componentName: instance.name,
    componentLayerId: layer.id,
  }));
}

export function moveComponentLayers<T extends ComponentLayerGeometry>(
  layers: readonly T[],
  deltaX: number,
  deltaY: number,
): T[] {
  return layers.map(layer => ({ ...layer, x: round(layer.x + deltaX), y: round(layer.y + deltaY) }));
}

export function resizeComponentLayers<T extends ComponentLayerGeometry>(
  layers: readonly T[],
  start: ComponentBounds,
  next: ComponentBounds,
): T[] {
  const scaleX = next.width / Math.max(start.width, 0.001);
  const scaleY = next.height / Math.max(start.height, 0.001);
  return layers.map(layer => ({
    ...layer,
    x: round(next.x + (layer.x - start.x) * scaleX),
    y: round(next.y + (layer.y - start.y) * scaleY),
    width: round(Math.max(0.1, layer.width * scaleX)),
    height: round(Math.max(0.1, layer.height * scaleY)),
  }));
}

export function rotateComponentLayers<T extends ComponentLayerGeometry>(
  layers: readonly T[],
  center: Pick<ComponentBounds, 'x' | 'y'>,
  deltaDegrees: number,
): T[] {
  const radians = deltaDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return layers.map((layer) => {
    const offsetX = layer.x - center.x;
    const offsetY = layer.y - center.y;
    return {
      ...layer,
      x: round(center.x + offsetX * cosine - offsetY * sine),
      y: round(center.y + offsetX * sine + offsetY * cosine),
      rotation: normalizeRotation(layer.rotation + deltaDegrees),
    };
  });
}
