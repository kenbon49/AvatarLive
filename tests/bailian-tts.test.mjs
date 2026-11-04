import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BailianTtsError, createBailianTtsClient } from '../src/lib/server/bailian-tts-client.ts';
import { createExternalApiLogger } from '../src/lib/server/external-api-log.ts';

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
    credentialId: 'test-account-one', publicDirectory, runtimeDirectory,
    voices: [{ id: 'longbaizhi', language: '中英文', sampleText: '这是官方试听文字' }],
    providerRequest: async body => {
      requests.push({ body });
      if (body.model === 'qwen-voice-enrollment') return { voice: 'qwen-tts-vc-test-voice' };
      if (body.model === 'qwen-voice-design') return {
        voice: 'qwen-tts-vd-test-voice', preview_audio: { data: AUDIO.toString('base64') },
      };
      return { audio: { url: ASSET_URL } };
    },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(AUDIO);
    },
    ...overrides,
  };
  return { client: createBailianTtsClient(options), options, requests, runtimeDirectory };
}

test('uses the backend transport for enrollment and synthesis, then serves locally stored audio', async t => {
  const { client, requests, runtimeDirectory } = await setup(t);
  const result = await client.synthesize('你好，欢迎来到直播间', 'longbaizhi', OWNER);
  assert.equal(requests.length, 3);
  const [enrollment, synthesis, download] = requests;
  assert.equal(enrollment.body.input.audio.data, `data:audio/mpeg;base64,${SAMPLE.toString('base64')}`);
  assert.equal(enrollment.body.input.target_model, 'qwen-audio-3.1-tts-plus');
  assert.deepEqual(synthesis.body, {
    model: 'qwen-audio-3.1-tts-plus', input: { text: '你好，欢迎来到直播间', voice: 'qwen-tts-vc-test-voice' },
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
  await createBailianTtsClient({ ...options, credentialId: 'test-account-two' }).synthesize('更换账户', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 2);
});

test('deduplicates concurrent enrollment for the same official voice', async t => {
  const { client, requests } = await setup(t);
  await Promise.all([
    client.synthesize('第一段', 'longbaizhi', OWNER),
    client.synthesize('第二段', 'longbaizhi', OWNER),
  ]);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-audio-3.1-tts-plus').length, 2);
});

test('uses admin-backed transport without a local key and isolates refreshed credentials and request sessions', async t => {
  const calls = [];
  const voiceTasks = new Map();
  const { options, requests } = await setup(t, { voiceTasks });
  function clientFor(credentialId, session) {
    return createBailianTtsClient({ ...options, credentialId, providerRequest: async body => {
      calls.push({ credentialId, session, body });
      if (body.model === 'qwen-voice-enrollment') return { voice: `voice-${credentialId}` };
      if (body.model === 'qwen-voice-design') return {
        voice: `design-${credentialId}`, preview_audio: { data: AUDIO.toString('base64') },
      };
      return { audio: { url: ASSET_URL } };
    } });
  }
  const first = clientFor('account-one', 'session-one');
  const second = clientFor('account-one', 'session-two');
  const [result] = await Promise.all([
    first.synthesize('第一位用户', 'longbaizhi', OWNER),
    second.synthesize('第二位用户', 'longbaizhi', OTHER),
  ]);
  assert.equal(calls.filter(item => item.body.model === 'qwen-voice-enrollment').length, 1);
  assert.deepEqual(calls.filter(item => item.body.model === 'qwen-audio-3.1-tts-plus').map(item => item.session).sort(), ['session-one', 'session-two']);
  await clientFor('account-one', 'session-three').synthesize('复用记录', 'longbaizhi', OWNER);
  assert.equal(calls.filter(item => item.body.model === 'qwen-voice-enrollment').length, 1);
  const updated = clientFor('account-two', 'session-four');
  await updated.synthesize('更新密钥', 'longbaizhi', OWNER);
  assert.equal(calls.filter(item => item.body.model === 'qwen-voice-enrollment').length, 2);
  assert.equal(calls.at(-1).body.input.voice, 'voice-account-two');
  assert.equal((await updated.designVoice('清澈的女声', '你好')).voice, 'design-account-two');
  assert.ok(requests.every(item => item.url === ASSET_URL && !item.init.headers));
  // Already saved audio remains readable even if the administrator clears configuration.
  const storageOnly = createBailianTtsClient({ ...options, credentialId: '', providerRequest: undefined });
  assert.deepEqual((await storageOnly.readAudio(result.audioUrl.split('/').at(-1), OWNER)).bytes, AUDIO);
  assert.equal(voiceTasks.size, 0);
});

test('an unconfigured transport keeps the client constructible and gives configuration guidance before any request', async t => {
  const { client, requests } = await setup(t, { credentialId: '' });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), { status: 503, message: /BAILIAN_TTS_API_KEY/ });
  await assert.rejects(client.designVoice('温柔的女声', '你好'), { status: 503 });
  assert.equal(requests.length, 0);
});

test('checks both cache and audio storage before paid calls and logs the local failure with its cause', async t => {
  for (const blocked of ['runtime', 'voices', 'audio']) {
    const { client, requests, runtimeDirectory } = await setup(t);
    if (blocked === 'runtime') {
      await writeFile(runtimeDirectory, 'not a directory');
    } else {
      await mkdir(runtimeDirectory);
      await writeFile(path.join(runtimeDirectory, blocked), 'not a directory');
    }
    const entries = [];
    const logger = createExternalApiLogger({ write: async entry => entries.push(entry) });
    await assert.rejects(logger.call('bailian', '文本试听完整流程', '/live-voice-api/synthesize', 'POST', {},
      () => client.synthesize('测试', 'longbaizhi', OWNER), value => ({ response: value })), error => {
      assert.equal(error.status, 500);
      assert.equal(error.providerAccepted, false);
      assert.match(error.message, /目录.*写入权限/);
      assert.match(error.cause.code, /ENOTDIR|EEXIST/);
      return true;
    });
    assert.equal(requests.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'error');
    assert.equal(entries[0].httpStatus, 500);
    assert.match(entries[0].error.cause.code, /ENOTDIR|EEXIST/);
    assert.ok(entries[0].error.cause.path);
  }
});

test('reports a storage failure after synthesis as accepted and preserves the enrollment for a retry', async t => {
  const { options, requests, runtimeDirectory } = await setup(t);
  const client = createBailianTtsClient({ ...options, fetcher: async (url, init) => {
    if (String(url) === ASSET_URL) {
      await rm(path.join(runtimeDirectory, 'audio'), { recursive: true });
      await writeFile(path.join(runtimeDirectory, 'audio'), 'storage changed during the provider call');
    }
    return options.fetcher(url, init);
  } });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), error => {
    assert.equal(error.status, 500);
    assert.equal(error.providerAccepted, true);
    assert.match(error.message, /保存已合成的试听音频/);
    assert.ok(error.cause.code);
    return true;
  });
  await rm(path.join(runtimeDirectory, 'audio'));
  await createBailianTtsClient(options).synthesize('重试', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
});

test('rejects invalid text, voice IDs, and identities before contacting the provider', async t => {
  const { client, requests } = await setup(t);
  await assert.rejects(client.synthesize('茶'.repeat(801), 'longbaizhi', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('  ', 'longbaizhi', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('测试', '../private', OWNER), { status: 400 });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', '../owner'), { status: 401 });
  assert.equal(requests.length, 0);
});

test('failed enrollment can be retried without persisting or retaining a rejected task', async t => {
  const { options, requests } = await setup(t);
  let fail = true;
  const client = createBailianTtsClient({ ...options, providerRequest: async body => {
    if (fail) { fail = false; throw new BailianTtsError('请求过于频繁', 429); }
    return options.providerRequest(body);
  } });
  await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), { status: 429 });
  await client.synthesize('重试', 'longbaizhi', OWNER);
  assert.equal(requests.filter(item => item.body?.model === 'qwen-voice-enrollment').length, 1);
});

test('blocks unsafe asset URLs and does not follow provider redirects', async t => {
  const { options } = await setup(t);
  for (const asset of ['http://localhost/private', 'https://example.com/private', 'https://evilaliyuncs.com/private', 'https://user:pass@asset.aliyuncs.com/private']) {
    const client = createBailianTtsClient({ ...options, providerRequest: async body => {
      if (body.model === 'qwen-voice-enrollment') return options.providerRequest(body);
      return { audio: { url: asset } };
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
  assert.deepEqual(await readdir(path.join(runtimeDirectory, 'audio', OWNER)), []);
});

test('keeps each user’s preview audio private and rejects file traversal', async t => {
  const { client } = await setup(t);
  const result = await client.synthesize('测试', 'longbaizhi', OWNER);
  const filename = result.audioUrl.split('/').at(-1);
  await assert.rejects(client.readAudio(filename, OTHER), { status: 404 });
  await assert.rejects(client.readAudio('../voices/private.json', OWNER), { status: 404 });
});

test('voice design uses the same backend transport and preserves the preview response contract', async t => {
  const { client, requests } = await setup(t);
  const result = await client.designVoice('清澈、专业的女声', '欢迎来到直播间');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model, 'qwen-voice-design');
  assert.equal(requests[0].body.input.target_model, 'qwen3-tts-vd-2026-01-26');
  assert.equal(result.voice, 'qwen-tts-vd-test-voice');
  assert.equal(result.audio_url, `data:audio/wav;base64,${AUDIO.toString('base64')}`);
  assert.doesNotMatch(JSON.stringify(result), /sk-test-bailian-key/);
});

test('malformed voice responses fail explicitly instead of caching an unusable voice', async t => {
  const { options } = await setup(t);
  for (const payload of [{}, { voice: '' }, { voice: '../invalid' }]) {
    const client = createBailianTtsClient({ ...options, providerRequest: async () => payload });
    await assert.rejects(client.synthesize('测试', 'longbaizhi', OWNER), { providerAccepted: true });
  }
});

test('upgrades official HTTP audio links to HTTPS before downloading without credentials', async t => {
  const { options, requests } = await setup(t);
  const client = createBailianTtsClient({ ...options, providerRequest: async body => {
    if (body.model === 'qwen-voice-enrollment') return options.providerRequest(body);
    return { audio: { url: ASSET_URL.replace('https:', 'http:') } };
  } });
  await client.synthesize('测试', 'longbaizhi', OWNER);
  const download = requests.find(item => item.url);
  assert.equal(download.url, ASSET_URL);
  assert.equal(download.init.headers, undefined);
  assert.equal(download.init.redirect, 'error');
});

test('replaces streaming WAV size markers so saved previews have a finite playback duration', async t => {
  const { options } = await setup(t);
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0); wav.writeUInt32LE(0x7fffffbf, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(0x7fffffff, 40);
  const client = createBailianTtsClient({ ...options, fetcher: async () => new Response(wav) });
  const result = await client.synthesize('测试', 'longbaizhi', OWNER);
  const saved = (await client.readAudio(result.audioUrl.split('/').at(-1), OWNER)).bytes;
  assert.equal(saved.readUInt32LE(4), saved.length - 8);
  assert.equal(saved.readUInt32LE(40), saved.length - 44);
  assert.deepEqual(saved.subarray(44), wav.subarray(44));
});
