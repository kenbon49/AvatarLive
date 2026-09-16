import assert from 'node:assert/strict';
import test from 'node:test';
import { readLiveAiText } from '../src/lib/live-ai-stream.ts';

test('reveals streamed AI content incrementally', async () => {
  const frames = [];
  const response = new Response([
    'event: meta\ndata: {"type":"meta","model":"test"}\n\n',
    'event: content\ndata: {"type":"content","text":"你好"}\n\n',
    'event: content\ndata: {"type":"content","text":"，直播间"}\n\n',
    'event: done\ndata: {"type":"done"}\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } });

  const content = await readLiveAiText(response, {
    onText: (value) => frames.push(value),
    charactersPerTick: 1,
    tickMilliseconds: 0,
  });

  assert.equal(content, '你好，直播间');
  assert.deepEqual(frames, ['你', '你好', '你好，', '你好，直', '你好，直播', '你好，直播间']);
});

test('surfaces errors received inside a successful event stream', async () => {
  const response = new Response('event: error\ndata: {"type":"error","message":"模型繁忙"}\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
  await assert.rejects(readLiveAiText(response, { onText: () => undefined, tickMilliseconds: 0 }), /模型繁忙/);
});

test('keeps JSON responses compatible for non-streaming callers', async () => {
  const frames = [];
  const content = await readLiveAiText(Response.json({ content: '完整文案' }), {
    onText: (value) => frames.push(value),
    charactersPerTick: 2,
    tickMilliseconds: 0,
  });
  assert.equal(content, '完整文案');
  assert.deepEqual(frames, ['完整', '完整文案']);
});
