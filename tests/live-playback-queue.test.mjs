import assert from 'node:assert/strict';
import test from 'node:test';
import { LivePlaybackQueue } from '../src/lib/live-playback-queue.ts';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, timeout = 500) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for queue');
    await wait(5);
  }
};

test('plays items in sequence and marks completion', async () => {
  const spoken = [];
  const states = [];
  const queue = new LivePlaybackQueue({
    speak: async (item) => { spoken.push(item.id); },
    onItemState: (id, state) => states.push(`${id}:${state}`),
  });
  await queue.start([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  assert.deepEqual(spoken, [1, 2]);
  assert.equal(queue.getStatus(), 'idle');
  assert.deepEqual(states, ['1:playing', '1:done', '2:playing', '2:done']);
});

test('supports pause and resume without starting a second item', async () => {
  const spoken = [];
  let release;
  const queue = new LivePlaybackQueue({
    speak: (item) => new Promise((resolve) => {
      spoken.push(item.id);
      release = resolve;
    }),
    cancel: () => release?.(),
  });
  const running = queue.start([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  await waitFor(() => spoken.length === 1);
  queue.pause();
  assert.equal(queue.getStatus(), 'paused');
  release();
  await wait(10);
  assert.deepEqual(spoken, [1]);
  queue.resume();
  await waitFor(() => spoken.length === 2);
  release();
  await running;
  assert.deepEqual(spoken, [1, 2]);
});

test('retries a failed item and continues after the retry budget', async () => {
  const attempts = [];
  const errors = [];
  const queue = new LivePlaybackQueue({
    retryCount: 1,
    speak: async (item) => {
      attempts.push(item.id);
      if (attempts.length === 1) throw new Error('temporary');
    },
    onError: (id, _error, attempt) => errors.push(`${id}:${attempt}`),
  });
  await queue.start([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  assert.deepEqual(attempts, [1, 1, 2]);
  assert.deepEqual(errors, ['1:1']);
});

test('skip cancels the current item and advances the queue', async () => {
  const spoken = [];
  const cancelled = [];
  let rejectCurrent;
  const queue = new LivePlaybackQueue({
    speak: (item) => new Promise((resolve, reject) => {
      spoken.push(item.id);
      if (item.id === 1) rejectCurrent = reject;
      else resolve();
    }),
    cancel: async () => { cancelled.push(true); rejectCurrent?.(new Error('cancelled')); },
  });
  const running = queue.start([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  await waitFor(() => spoken.length === 1);
  await queue.skip();
  await running;
  assert.deepEqual(spoken, [1, 2]);
  assert.equal(cancelled.length, 1);
});

test('does not retry a cancelled utterance while paused', async () => {
  let rejectCurrent;
  const spoken = [];
  const cancel = () => rejectCurrent?.(new Error('takeover'));
  const queue = new LivePlaybackQueue({
    retryCount: 2,
    speak: (item) => new Promise((_resolve, reject) => {
      spoken.push(item.id);
      rejectCurrent = reject;
    }),
    cancel,
  });
  const running = queue.start([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  await waitFor(() => spoken.length === 1);
  queue.pause();
  cancel();
  await wait(20);
  assert.deepEqual(spoken, [1]);
  await queue.stop();
  await running;
});

test('loop mode starts a fresh cycle until stopped', async () => {
  const spoken = [];
  let release;
  const queue = new LivePlaybackQueue({
    speak: (item) => new Promise((resolve) => {
      spoken.push(item.id);
      release = resolve;
    }),
    cancel: () => release?.(),
  });
  const running = queue.start([{ id: 1, text: 'one' }], { loop: true });
  await waitFor(() => spoken.length === 1);
  release();
  await waitFor(() => spoken.length === 2);
  assert.deepEqual(spoken, [1, 1]);
  await queue.stop();
  await running;
  assert.equal(queue.getStatus(), 'idle');
});
