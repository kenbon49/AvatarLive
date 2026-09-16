import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScriptPreviewAudio } from '../src/lib/live-script-preview.ts';

const input = () => ({ text: '六堡茶', voiceId: 'longbaizhi', speed: 1.1, signal: new AbortController().signal, decode: async bytes => bytes.byteLength });

test('prepares every segment before returning playable preview audio', async () => {
  const requests = [];
  let segment = 0;
  const buffers = await loadScriptPreviewAudio({
    ...input(), text: '茶'.repeat(1601),
    fetcher: async (url, options) => {
      requests.push(url);
      if (url === '/live-voice-api/synthesize') {
        const body = JSON.parse(options.body);
        assert.equal(body.voiceId, 'longbaizhi');
        assert.equal(body.speed, 1.1);
        assert.equal(body.text.length, segment < 2 ? 800 : 1);
        segment += 1;
        return Response.json({ audioUrl: `/audio/${segment}` });
      }
      return new Response(new Uint8Array(segment));
    },
  });
  assert.deepEqual(buffers, [1, 2, 3]);
  assert.deepEqual(requests, ['/live-voice-api/synthesize', '/audio/1', '/live-voice-api/synthesize', '/audio/2', '/live-voice-api/synthesize', '/audio/3']);
});

test('reports synthesis failures without exposing a playable result', async () => {
  await assert.rejects(loadScriptPreviewAudio({ ...input(), fetcher: async () => Response.json({ message: '声音合成失败' }, { status: 502 }) }), /声音合成失败/);
  await assert.rejects(loadScriptPreviewAudio({ ...input(), fetcher: async () => Response.json({ audioUrl: '' }) }), /语音合成失败/);
});

test('requires successful audio download and decoding', async () => {
  const fetcher = async url => url === '/live-voice-api/synthesize' ? Response.json({ audioUrl: '/audio/1' }) : new Response(new Uint8Array(1));
  await assert.rejects(loadScriptPreviewAudio({ ...input(), fetcher, decode: async () => { throw new Error('音频解码失败'); } }), /音频解码失败/);
  await assert.rejects(loadScriptPreviewAudio({ ...input(), fetcher: async url => url === '/live-voice-api/synthesize' ? Response.json({ audioUrl: '/audio/1' }) : new Response('', { status: 404 }) }), /语音读取失败/);
});

test('cancels a pending preview before returning decoded audio', async () => {
  const controller = new AbortController();
  await assert.rejects(loadScriptPreviewAudio({
    ...input(), signal: controller.signal,
    fetcher: async url => url === '/live-voice-api/synthesize' ? Response.json({ audioUrl: '/audio/1' }) : new Response(new Uint8Array(1)),
    decode: async () => { controller.abort(); return 1; },
  }), { name: 'AbortError' });
});
