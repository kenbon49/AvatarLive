import type {
  LiveRoomConfig,
  LiveRoomConfigChanges,
  LiveRoomLayerChanges,
  LiveRoomLayerFieldPatch,
  LiveRoomLayerItem,
} from '@/lib/live-room-api';

const CONFIG_FIELDS = [
  'schemaVersion',
  'avatarId',
  'voice',
  'playbackMode',
  'goods',
  'activeGoodsId',
  'scripts',
  'editorDraft',
  'qaItems',
  'selectedTemplateId',
  'selectedTemplatePage',
  'liveOptions',
  'outputConfig',
  'selectedPlatforms',
  'selectedPlatformConnectionIds',
  'assets',
  'importedMaterialImages',
] as const satisfies readonly Exclude<keyof LiveRoomConfig, 'layers'>[];

function valuesEqual(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (previous === null || next === null || typeof previous !== 'object' || typeof next !== 'object') return false;
  return JSON.stringify(previous) === JSON.stringify(next);
}

function buildLayerChanges(previous: LiveRoomLayerItem[], next: LiveRoomLayerItem[]): LiveRoomLayerChanges | null {
  if (previous === next) return null;
  const previousById = new Map(previous.map((layer) => [layer.id, layer]));
  const nextById = new Map(next.map((layer) => [layer.id, layer]));
  const upsert = next.filter((layer) => !previousById.has(layer.id));
  const deleteIds = previous.filter((layer) => !nextById.has(layer.id)).map((layer) => layer.id);
  const patches: LiveRoomLayerFieldPatch[] = [];

  for (const nextLayer of next) {
    const previousLayer = previousById.get(nextLayer.id);
    if (!previousLayer) continue;
    const changes: Record<string, unknown> = {};
    const fields = new Set([...Object.keys(previousLayer), ...Object.keys(nextLayer)]);
    fields.delete('id');
    for (const field of fields) {
      const previousValue = previousLayer[field as keyof LiveRoomLayerItem];
      const nextValue = nextLayer[field as keyof LiveRoomLayerItem];
      if (!valuesEqual(previousValue, nextValue)) changes[field] = nextValue === undefined ? null : nextValue;
    }
    if (Object.keys(changes).length) {
      patches.push({ id: nextLayer.id, changes: changes as LiveRoomLayerFieldPatch['changes'] });
    }
  }

  const previousOrder = previous.map((layer) => layer.id);
  const nextOrder = next.map((layer) => layer.id);
  const orderChanged = !valuesEqual(previousOrder, nextOrder);
  if (!upsert.length && !deleteIds.length && !patches.length && !orderChanged) return null;
  return {
    ...(upsert.length ? { upsert } : {}),
    ...(patches.length ? { patches } : {}),
    ...(deleteIds.length ? { deleteIds } : {}),
    ...(orderChanged ? { order: nextOrder } : {}),
  };
}

export function buildLiveRoomConfigChanges(
  previous: LiveRoomConfig,
  next: LiveRoomConfig,
): LiveRoomConfigChanges | null {
  if (previous === next) return null;
  const changes: Record<string, unknown> = {};
  for (const field of CONFIG_FIELDS) {
    const previousValue = previous[field];
    const nextValue = next[field];
    if (!valuesEqual(previousValue, nextValue)) changes[field] = nextValue === undefined ? null : nextValue;
  }
  const layerChanges = buildLayerChanges(previous.layers, next.layers);
  if (layerChanges) changes.layers = layerChanges;
  return Object.keys(changes).length ? changes as LiveRoomConfigChanges : null;
}
