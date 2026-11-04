import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chromaKeyAlpha,
  normalizeChromaKeySettings,
} from '../src/lib/chroma-key.ts';

test('normalizes persisted chroma-key settings', () => {
  assert.deepEqual(normalizeChromaKeySettings({
    enabled: true,
    color: '#F8F8F8',
    tolerance: 99,
    softness: -2,
  }), {
    enabled: true,
    color: '#f8f8f8',
    tolerance: 40,
    softness: 0,
  });
});

test('makes the selected color transparent and preserves distant colors', () => {
  const settings = { enabled: true, color: '#ffffff', tolerance: 4, softness: 6 };
  assert.equal(chromaKeyAlpha(255, 255, 255, settings), 0);
  assert.equal(chromaKeyAlpha(20, 80, 140, settings), 1);
  assert.ok(chromaKeyAlpha(240, 240, 240, settings) > 0);
  assert.ok(chromaKeyAlpha(240, 240, 240, settings) < 1);
  assert.equal(chromaKeyAlpha(255, 255, 255, { ...settings, enabled: false }), 1);
});
