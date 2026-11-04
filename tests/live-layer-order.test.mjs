import assert from 'node:assert/strict';
import test from 'node:test';

import { layersBackToFront, layerZIndex } from '../src/lib/live-layer-order.ts';

test('uses the layer list order as front-to-back stacking order', () => {
  const layers = [
    { id: 'custom-image' },
    { id: 'host' },
    { id: 'background' },
  ];

  assert.deepEqual(
    layersBackToFront(layers).map((layer) => layer.id),
    ['background', 'host', 'custom-image'],
  );
  assert.ok(layerZIndex(layers, 'custom-image') > layerZIndex(layers, 'host'));
});

test('moving the host to index zero puts it in front of custom images', () => {
  const layers = [
    { id: 'host' },
    { id: 'custom-image' },
    { id: 'background' },
  ];

  assert.deepEqual(
    layersBackToFront(layers).map((layer) => layer.id),
    ['background', 'custom-image', 'host'],
  );
  assert.ok(layerZIndex(layers, 'host') > layerZIndex(layers, 'custom-image'));
});
