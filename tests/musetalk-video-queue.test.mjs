import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodedVideoFrameLimit,
  hasVideoDecodeCapacity,
  selectVideoFrameForDecode,
  selectVideoFramesToDrop,
} from '../src/lib/musetalk-video-queue.ts';

test('bounds decoded video to about two seconds at the negotiated frame rate', () => {
  assert.equal(decodedVideoFrameLimit(15), 30);
  assert.equal(decodedVideoFrameLimit(25), 50);
  assert.equal(decodedVideoFrameLimit(14.5), 29);
});

test('counts in-flight decodes against the decoded video bound', () => {
  assert.equal(hasVideoDecodeCapacity(28, 1, 15), true);
  assert.equal(hasVideoDecodeCapacity(28, 2, 15), false);
  assert.equal(hasVideoDecodeCapacity(30, 0, 15), false);
});

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
