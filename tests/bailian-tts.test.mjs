import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBailianTtsClient } from '../src/lib/server/bailian-tts-client.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SAMPLE = Buffer.from('ID3official-voice-sample');
const AUDIO = Buffer.from('RIFF0000WAVEgenerated-audio');
const ASSET_URL = 'https://dashscope-result.oss-cn-beijing.aliyuncs.com/preview.wav?signature=test';

async function setup(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'avatarlive-bailian-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const publicDirectory = path.join(directory, 'public');
  const runtimeDirectory = path.join(directory, 'runtime');
  await mkdir(path.join(publicDirectory, 'assets', 'aliyun-voices'), { recursive: true });
  await writeFile(path.join(publicDirectory, 'assets', 'aliyun-voices', 'longbaizhi.mp3'), SAMPLE);
  const requests = [];
  const options = {
    apiKey: 'sk-test-bailian-key', publicDirectory, runtimeDirectory,
    voices: [{ id: 'longbaizhi', language: '中英文', sampleText: '这是官方试听文字' }],
    fetcher: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ url: String(url), init, body });
      if (body?.model === 'qwen-voice-enrollment') return Response.json({ output: { voice: 'qwen-tts-vc-test-voice' } });
      if (body?.model === 'qwen-voice-design') return Response.json({ output: {
        voice: 'qwen-tts-vd-test-voice', preview_audio: { data: AUDIO.toString('base64') },
      } });
      if (body) return Response.json({ output: { audio: { url: ASSET_URL } } });
      return new Response(AUDIO);
    },
    ...overrides,
  };
  return { client: createBailianTtsClient(options), options, requests, runtimeDirectory };
}

test('uses the project key for official enrollment and synthesis, then serves locally stored audio', async t => {
  const { client, requests, runtimeDirectory } = await setup(t);
  const result = await client.synthesize('你好，欢迎来到直播间', 'longbaizhi', OWNER);
  assert.equal(requests.length, 3);
  const [enrollment, synthesis, download] = requests;
  assert.equal(enrollment.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization');
  assert.equal(synthesis.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  for (const request of [enrollment, synthesis]) {
    assert.equal(request.init.headers.Authorization, 'Bearer sk-test-bailian-key');
    assert.equal(request.init.headers['X-API-Key'], undefined);
    assert.equal(request.init.redirect, 'error');
    assert.doesNotMatch(JSON.stringify(request.body), /sk-test-bailian-key/);
  }
  assert.equal(enrollment.body.input.audio.data, `data:audio/mpeg;base64,${SAMPLE.toString('base64')}`);
  assert.equal(enrollment.body.input.target_model, 'qwen3-tts-vc-2026-01-22');
  assert.deepEqual(synthesis.body, {
    model: 'qwen3-tts-vc-2026-01-22', input: { text: '你好，欢迎来到直播间', voice: 'qwen-tts-vc-test-voice' },
  });
  assert.equal(download.url, ASSET_URL);
  assert.equal(download.init.headers, undefined);
  const filename = result.audioUrl.split('/').at(-1);
  assert.match(filename, /^bailian_tts_.*\.wav$/);
  assert.deepEqual((await client.readAudio(filename, OWNER)).bytes, AUDIO);
  assert.equal((await client.readAudio(filename, OWNER)).mime, 'audio/wav');
  assert.doesNotMatch(JSON.stringify(result), /sk-test-bailian-key|aliyuncs/);
  for (const record of await readdir(path.join(runtimeDirectory, 'voices'))) {
    assert.doesNotMatch(await readFile(path.join(runtimeDirectory, 'voices', record), 'utf8'), /sk-test-bailian-key/);
  }
});

test('reuses registrations after a process restart and isolates registrations after a key change', async t => {
  const { client, options, requests } = await setup(t);
  await client.synthesize('第一段', 'longbaizhi', OWNER);
  await createBailianTtsClient(options).synthesize('重启后的第二段', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
  await createBailianTtsClient({ ...options, apiKey: 'sk-second-account' }).synthesize('更换账户', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 2);
});

test('deduplicates concurrent enrollment for the same official voice', async t => {
  const { client, requests } = await setup(t);
  await Promise.all([
    client.synthesize('第一段', 'longbaizhi', OWNER),
    client.synthesize('第二段', 'longbaizhi', OWNER),
  ]);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
  assert.equal(requests.filter(item => item.body?.model === 'qwen3-tts-vc-2026-01-22').length, 2);
});

test('an empty key keeps the client constructible and gives configuration guidance before any request', async t => {
  const { client, requests } = await setup(t, { apiKey: '' });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), { status: 503, message: /BAILIAN_TTS_API_KEY/ });
  await assert.rejects(client.designVoice('温柔的女声', '你好'), { status: 503 });
  assert.equal(requests.length, 0);
});

test('rejects invalid text, voice IDs, and identities before contacting the provider', async t => {
  const { client, requests } = await setup(t);
  await assert.rejects(client.synthesize('茶'.repeat(801), 'longbaizhi', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('  ', 'longbaizhi', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('测试', '../private', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', '../owner'), { status: 401 });
  assert.equal(requests.length, 0);
});

test('provider authentication failures expose guidance without returning keys or upstream error bodies', async t => {
  const { client } = await setup(t, { fetcher: async () => new Response('upstream leaked sk-test-bailian-key', { status: 401 }) });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), error => {
    assert.match(error.message, /API Key 无效/);
    assert.doesNotMatch(error.message, /sk-test-bailian-key|upstream leaked/);
    return true;
  });
});

test('failed enrollment can be retried without persisting or retaining a rejected task', async t => {
  const { options, requests } = await setup(t);
  let fail = true;
  const client = createBailianTtsClient({ ...options, fetcher: async (url, init) => {
    if (fail) { fail = false; return new Response('', { status: 429 }); }
    return options.fetcher(url, init);
  } });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), { status: 429 });
  await client.synthesize('重试', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
});

test('blocks unsafe asset URLs and does not follow provider redirects', async t => {
  const { options } = await setup(t);
  for (const asset of ['http://localhost/private', 'https://example.com/private', 'https://evilaliyuncs.com/private', 'https://user:pass@asset.aliyuncs.com/private']) {
    const client = createBailianTtsClient({ ...options, fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.model === 'qwen-voice-enrollment') return options.fetcher(url, init);
      return Response.json({ output: { audio: { url: asset } } });
    } });
    await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), /不受信任/);
  }
});

test('rejects oversized and invalid audio without making it available for playback', async t => {
  const { options, runtimeDirectory } = await setup(t);
  for (const response of [
    () => new Response('oversized', { headers: { 'content-length': String(21 * 1024 * 1024) } }),
    () => new Response('<html>not audio</html>'),
    () => new Response(new Uint8Array(21 * 1024 * 1024)),
  ]) {
    const client = createBailianTtsClient({ ...options, fetcher: async (url, init) => (
      String(url) === ASSET_URL ? response() : options.fetcher(url, init)
    ) });
    await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), /音频.*(超过|格式无效)/);
  }
  await assert.rejects(readdir(path.join(runtimeDirectory, 'audio')), { code: 'ENOENT' });
});

test('keeps each user’s preview audio private and rejects file traversal', async t => {
  const { client } = await setup(t);
  const result = await client.synthesize('测试', 'longbaizhi', OWNER);
  const filename = result.audioUrl.split('/').at(-1);
  await assert.rejects(client.readAudio(filename, OTHER), { status: 404 });
  await assert.rejects(client.readAudio('../voices/private.json', OWNER), { status: 404 });
});

test('voice design uses the same local key directly and preserves the preview response contract', async t => {
  const { client, requests } = await setup(t);
  const result = await client.designVoice('清澈、专业的女声', '欢迎来到直播间');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer sk-test-bailian-key');
  assert.equal(requests[0].body.model, 'qwen-voice-design');
  assert.equal(requests[0].body.input.target_model, 'qwen3-tts-vd-2026-01-26');
  assert.equal(result.voice, 'qwen-tts-vd-test-voice');
  assert.equal(result.audio_url, `data:audio/wav;base64,${AUDIO.toString('base64')}`);
  assert.doesNotMatch(JSON.stringify(result), /sk-test-bailian-key/);
});

test('malformed provider responses fail explicitly instead of caching an unusable voice', async t => {
  const { options } = await setup(t);
  for (const payload of [null, {}, { code: 'InvalidApiKey', message: 'sk-test-bailian-key' }, { output: { voice: '' } }]) {
    const client = createBailianTtsClient({ ...options, fetcher: async () => Response.json(payload) });
    await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), error => {
      assert.equal(error.providerAccepted, true);
      assert.doesNotMatch(error.message, /sk-test-bailian-key/);
      return true;
    });
  }
});
