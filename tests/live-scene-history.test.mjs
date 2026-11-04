import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRedoLiveScene,
  canUndoLiveScene,
  createLiveSceneHistory,
  recordLiveSceneSnapshot,
  redoLiveScene,
  undoLiveScene,
} from '../src/lib/live-scene-history.ts';

const equals = (left, right) => JSON.stringify(left) === JSON.stringify(right);

test('undo and redo expose the expected disabled states', () => {
  let history = createLiveSceneHistory();
  assert.equal(canUndoLiveScene(history), false);
  assert.equal(canRedoLiveScene(history), false);

  history = recordLiveSceneSnapshot(history, { layers: ['start'] }, { now: 1 });
  assert.equal(canUndoLiveScene(history), true);

  const undone = undoLiveScene(history, { layers: ['edited'] }, equals);
  assert.deepEqual(undone.snapshot, { layers: ['start'] });
  assert.equal(canUndoLiveScene(undone.history), false);
  assert.equal(canRedoLiveScene(undone.history), true);

  const redone = redoLiveScene(undone.history, undone.snapshot, equals);
  assert.deepEqual(redone.snapshot, { layers: ['edited'] });
  assert.equal(canUndoLiveScene(redone.history), true);
  assert.equal(canRedoLiveScene(redone.history), false);
});

test('consecutive edits with the same key coalesce into one undo step', () => {
  let history = createLiveSceneHistory();
  history = recordLiveSceneSnapshot(history, { text: '' }, { coalesceKey: 'text:title', now: 100 });
  history = recordLiveSceneSnapshot(history, { text: '好' }, { coalesceKey: 'text:title', now: 300 });
  history = recordLiveSceneSnapshot(history, { text: '好物' }, { coalesceKey: 'text:title', now: 500 });

  assert.equal(history.past.length, 1);
  assert.deepEqual(undoLiveScene(history, { text: '好物推荐' }, equals).snapshot, { text: '' });
});

test('one recorded gesture stays one step regardless of transient frames', () => {
  const start = { x: 10, y: 20 };
  const transientFrames = [{ x: 11, y: 21 }, { x: 16, y: 28 }, { x: 25, y: 30 }];
  let history = createLiveSceneHistory();
  history = recordLiveSceneSnapshot(history, start, { now: 1 });

  assert.equal(history.past.length, 1);
  assert.deepEqual(undoLiveScene(history, transientFrames.at(-1), equals).snapshot, start);
});

test('a new edit after undo clears the redo branch and history is capped', () => {
  let history = createLiveSceneHistory();
  history = recordLiveSceneSnapshot(history, 0, { limit: 2, now: 1 });
  history = recordLiveSceneSnapshot(history, 1, { limit: 2, now: 2 });
  history = recordLiveSceneSnapshot(history, 2, { limit: 2, now: 3 });
  assert.deepEqual(history.past, [1, 2]);

  const undone = undoLiveScene(history, 3);
  assert.equal(canRedoLiveScene(undone.history), true);
  const branched = recordLiveSceneSnapshot(undone.history, undone.snapshot, { now: 4 });
  assert.equal(canRedoLiveScene(branched), false);
});
