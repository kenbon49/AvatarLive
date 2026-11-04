import assert from 'node:assert/strict';
import test from 'node:test';

import {
  componentBounds,
  instantiateComponentLayers,
  moveComponentLayers,
  resizeComponentLayers,
  rotateComponentLayers,
} from '../src/lib/live-component-layers.ts';

const sourceLayers = [
  { id: 'background', x: 20, y: 30, width: 20, height: 10, rotation: 0 },
  { id: 'title', x: 20, y: 30, width: 10, height: 4, rotation: 0 },
];

test('instantiates component layers as one persistent group', () => {
  const layers = instantiateComponentLayers(sourceLayers, { id: 'component-9-1', sourceId: '9', name: '测试组件' });

  assert.deepEqual(layers.map(layer => layer.id), ['component-9-1-0', 'component-9-1-1']);
  assert.ok(layers.every(layer => layer.componentInstanceId === 'component-9-1'));
  assert.ok(layers.every(layer => layer.componentSourceId === '9'));
  assert.deepEqual(layers.map(layer => layer.componentLayerId), ['background', 'title']);
});

test('moves and resizes every child around the component bounds', () => {
  const start = componentBounds(sourceLayers);
  assert.deepEqual(start, { x: 20, y: 30, width: 20, height: 10 });

  const moved = moveComponentLayers(sourceLayers, 5, -3);
  assert.deepEqual(componentBounds(moved), { x: 25, y: 27, width: 20, height: 10 });

  const resized = resizeComponentLayers(sourceLayers, start, { x: 30, y: 40, width: 40, height: 20 });
  assert.deepEqual(componentBounds(resized), { x: 30, y: 40, width: 40, height: 20 });
  assert.deepEqual(
    resized.map(layer => ({ x: layer.x, y: layer.y, width: layer.width, height: layer.height })),
    [
      { x: 30, y: 40, width: 40, height: 20 },
      { x: 30, y: 40, width: 20, height: 8 },
    ],
  );
});

test('rotates the child positions and their own angles as one component', () => {
  const layers = [
    { id: 'left', x: 10, y: 20, width: 4, height: 2, rotation: 0 },
    { id: 'right', x: 30, y: 20, width: 4, height: 2, rotation: 15 },
  ];
  const rotated = rotateComponentLayers(layers, { x: 20, y: 20 }, 90);

  assert.deepEqual(rotated.map(layer => ({ x: layer.x, y: layer.y, rotation: layer.rotation })), [
    { x: 20, y: 10, rotation: 90 },
    { x: 20, y: 30, rotation: 105 },
  ]);
});
