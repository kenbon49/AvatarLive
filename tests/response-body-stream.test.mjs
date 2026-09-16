import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { responseBodyStream } from '../src/lib/server/response-body-stream.ts';

test('streams media bytes into a response without changing their order', async () => {
  const source = Readable.from([Buffer.from('first'), Buffer.from('second')]);
  const response = new Response(responseBodyStream(source));
  assert.equal(await response.text(), 'firstsecond');
  assert.equal(source.destroyed, true);
});

test('cancelling a media response releases its underlying file stream', async () => {
  const source = Readable.from([Buffer.alloc(65536), Buffer.alloc(65536)]);
  const reader = responseBodyStream(source).getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(source.destroyed, true);
});

test('concurrent read and cancellation do not close the response controller twice', async () => {
  for (let i = 0; i < 100; i++) {
    const source = Readable.from([Buffer.from('frame')]);
    const reader = responseBodyStream(source).getReader();
    await Promise.all([reader.read(), reader.cancel()]);
    assert.equal(source.destroyed, true);
  }
});

test('source read errors reject the response instead of escaping as uncaught errors', async () => {
  const source = Readable.from((async function* () { throw new Error('media read failed'); })());
  await assert.rejects(new Response(responseBodyStream(source)).arrayBuffer(), /media read failed/);
});
