import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectVideoFrameForDecode,
  selectVideoFramesToDrop,
} from '../src/lib/musetalk-video-queue.ts';

test('decodes future buffered frames in presentation order', () => {
  assert.deepEqual(
    selectVideoFrameForDecode([0.2, 0, 0.1], -0.12),
    { nextPts: 0, stalePts: [] },
  );
});

test('collapses only frames that are already late', () => {
  assert.deepEqual(
    selectVideoFrameForDecode([0, 0.1, 0.2, 0.3], 0.25),
    { nextPts: 0.2, stalePts: [0, 0.1] },
  );
});

test('handles an empty decode queue', () => {
  assert.deepEqual(
    selectVideoFrameForDecode([], 1),
    { nextPts: null, stalePts: [] },
  );
});

test('drops the oldest frames when the decode queue exceeds its bound', () => {
  assert.deepEqual(
    selectVideoFramesToDrop([0.3, 0, 0.2, 0.1], 2),
    [0, 0.1],
  );
});
