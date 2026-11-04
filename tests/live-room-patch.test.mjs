import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLiveRoomConfigChanges } from '../src/lib/live-room-patch.ts';

const largePreview = `data:image/png;base64,${'A'.repeat(2048)}`;

function config() {
  return {
    schemaVersion: 1,
    avatarId: 'chinese',
    voice: { voiceId: 'professional', speed: 1, pitch: 0 },
    playbackMode: 'sequence',
    goods: [{ id: 1, name: '商品', source: '测试' }],
    activeGoodsId: 1,
    scripts: [{ id: 1, title: '开场', category: '开场', duration: '00:03', text: '欢迎', state: 'ready' }],
    editorDraft: '草稿',
    qaItems: [],
    selectedTemplateId: 'default',
    selectedTemplatePage: 0,
    layers: [
      { id: 'background', kind: 'image', value: '背景', preview: largePreview, x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 },
      { id: 'title', kind: 'text', value: '标题', x: 50, y: 10, width: 40, height: 10, rotation: 0, opacity: 100, color: '#ffffff' },
    ],
    liveOptions: { qa: true, dynamic: true, ambience: false, product: false, replyLimit: 5, replyMode: 'hybrid' },
    outputConfig: { resolution: '1080p', frameRate: '25 fps', codec: 'H.264', protocol: 'RTMP' },
    selectedPlatforms: [],
    selectedPlatformConnectionIds: [],
    assets: { image: [{ id: 'asset-1', kind: 'image', name: '素材', preview: largePreview }], video: [] },
    importedMaterialImages: [{ name: '参考图', dataUrl: largePreview }],
  };
}

test('script-only changes exclude unchanged layers and image payloads', () => {
  const previous = config();
  const next = { ...previous, scripts: [{ ...previous.scripts[0], text: '新的口播文案' }] };
  const changes = buildLiveRoomConfigChanges(previous, next);

  assert.deepEqual(changes, { scripts: next.scripts });
  assert.equal(JSON.stringify(changes).includes(largePreview), false);
});

test('layer movement sends only changed coordinates and not its preview', () => {
  const previous = config();
  const next = {
    ...previous,
    layers: previous.layers.map((layer) => layer.id === 'background' ? { ...layer, x: 45, y: 30 } : layer),
  };

  assert.deepEqual(buildLiveRoomConfigChanges(previous, next), {
    layers: { patches: [{ id: 'background', changes: { x: 45, y: 30 } }] },
  });
});

test('layer additions, deletions, and ordering are encoded independently', () => {
  const previous = config();
  const added = { id: 'badge', kind: 'text', value: '新品', x: 80, y: 8, width: 15, height: 8, rotation: 0, opacity: 100 };
  const next = { ...previous, layers: [previous.layers[1], added] };

  assert.deepEqual(buildLiveRoomConfigChanges(previous, next), {
    layers: { upsert: [added], deleteIds: ['background'], order: ['title', 'badge'] },
  });
});

test('clearing optional config and layer fields sends explicit null values', () => {
  const previous = config();
  const title = { ...previous.layers[1] };
  delete title.color;
  const next = { ...previous, layers: [previous.layers[0], title] };
  delete next.editorDraft;

  assert.deepEqual(buildLiveRoomConfigChanges(previous, next), {
    editorDraft: null,
    layers: { patches: [{ id: 'title', changes: { color: null } }] },
  });
});

test('semantically identical cloned configs do not create a patch', () => {
  const previous = config();
  assert.equal(buildLiveRoomConfigChanges(previous, structuredClone(previous)), null);
});
