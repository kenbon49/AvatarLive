import assert from 'node:assert/strict';
import test from 'node:test';
import { visualLayerFit } from '../src/lib/live-program-visuals.ts';

test('program compositor matches the editor image fitting rules', () => {
  assert.equal(visualLayerFit({ kind: 'image', sceneKey: 'custom', preview: '/custom.png' }), 'cover');
  assert.equal(visualLayerFit({ kind: 'image', sceneKey: 'templateElement', preview: '/element.png' }), 'fill');
  assert.equal(visualLayerFit({ kind: 'text', sceneKey: 'templateTitle', preview: 'data:image/png;base64,dGV4dA==' }), 'fill');
  assert.equal(visualLayerFit({ kind: 'host', sceneKey: 'host' }), 'contain');
});
