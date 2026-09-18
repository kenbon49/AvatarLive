type SceneLayer = {
  id?: string;
  kind?: string;
  sceneKey?: string;
  value?: string;
  preview?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  chromaKeyEnabled?: boolean;
  chromaKeyColor?: string;
  chromaKeyTolerance?: number;
  chromaKeySoftness?: number;
};

export function createDefaultHostLayer<T extends SceneLayer>(hostName: string): T {
  return {
    id: 'host',
    kind: 'host',
    sceneKey: 'host',
    value: hostName,
    x: 50,
    y: 64,
    width: 76,
    height: 70,
    rotation: 0,
    opacity: 100,
    chromaKeyEnabled: false,
    chromaKeyColor: '#ffffff',
    chromaKeyTolerance: 4,
    chromaKeySoftness: 6,
  } as T;
}

export function repairLegacyTemplateBackground<T extends SceneLayer>(
  templateLayers: readonly T[],
  currentLayers: readonly T[],
  legacyPreviews: readonly string[],
): T[] {
  const templateBackground = templateLayers.find((layer) => layer.sceneKey === 'templateBackground');
  const currentBackground = currentLayers.find((layer) => layer.sceneKey === 'templateBackground');
  if (
    !templateBackground?.preview
    || !currentBackground?.preview
    || templateBackground.preview === currentBackground.preview
    || !legacyPreviews.includes(currentBackground.preview)
  ) return currentLayers.slice() as T[];

  return currentLayers.map((layer) => layer === currentBackground ? {
    ...layer,
    preview: templateBackground.preview,
  } : layer) as T[];
}

export function applyTemplateLayersPreservingHost<T extends SceneLayer>(
  templateLayers: readonly T[],
  currentLayers: readonly T[],
  currentHostName?: string,
): T[] {
  const currentHost = currentLayers.find((layer) => layer.sceneKey === 'host');
  const nextLayers = templateLayers.map((layer) => layer.sceneKey === 'host' && (currentHost || currentHostName !== undefined) ? {
    ...layer,
    value: currentHostName ?? currentHost?.value ?? layer.value,
    chromaKeyEnabled: currentHost?.chromaKeyEnabled ?? layer.chromaKeyEnabled,
    chromaKeyColor: currentHost?.chromaKeyColor ?? layer.chromaKeyColor,
    chromaKeyTolerance: currentHost?.chromaKeyTolerance ?? layer.chromaKeyTolerance,
    chromaKeySoftness: currentHost?.chromaKeySoftness ?? layer.chromaKeySoftness,
  } : layer) as T[];

  if (nextLayers.some((layer) => layer.sceneKey === 'host')) return nextLayers;

  const preservedHost = currentHost ? {
    ...currentHost,
    value: currentHostName ?? currentHost.value,
  } : currentHostName !== undefined ? createDefaultHostLayer<T>(currentHostName) : null;
  if (!preservedHost) return nextLayers;

  const backgroundIndex = nextLayers.findIndex((layer) => layer.sceneKey === 'templateBackground');
  const insertionIndex = backgroundIndex < 0 ? nextLayers.length : backgroundIndex;
  nextLayers.splice(insertionIndex, 0, preservedHost as T);
  return nextLayers;
}
