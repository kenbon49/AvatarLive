import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cacheAliyunWebm } from '../src/lib/server/aliyun-avatar-video-cache.ts';

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1196, 0x42)]);
const URL = 'https://example.oss-cn-beijing.aliyuncs.com/video.webm';

test('streams WebM to an atomic local file and reports progress', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avatar-webm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'video.webm');
  const progress = [];
  const size = await cacheAliyunWebm({
    url: URL,
    destination,
    maxBytes: 2048,
    onProgress: (received, total) => progress.push([received, total]),
    fetcher: async () => new Response(WEBM, { headers: { 'content-length': '1200' } }),
  });
  assert.equal(size, WEBM.length);
  assert.deepEqual(await readFile(destination), WEBM);
  assert.deepEqual(progress.at(-1), [1200, 1200]);
  await assert.rejects(stat(`${destination}.part`), { code: 'ENOENT' });
});

test('resumes an incomplete download using byte ranges', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avatar-webm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'video.webm');
  const requests = [];
  const fetcher = async (_url, options) => {
    requests.push(options.headers?.range || '');
    return requests.length === 1
      ? new Response(WEBM.subarray(0, 600), { headers: { 'content-length': '1200' } })
      : new Response(WEBM.subarray(600), { status: 206, headers: { 'content-range': 'bytes 600-1199/1200', 'content-length': '600' } });
  };
  const options = { url: URL, destination, maxBytes: 2048, onProgress: () => {}, fetcher };
  await assert.rejects(cacheAliyunWebm(options), /下载不完整/);
  assert.equal((await stat(`${destination}.part`)).size, 600);
  await cacheAliyunWebm(options);
  assert.deepEqual(requests, ['', 'bytes=600-']);
  assert.deepEqual(await readFile(destination), WEBM);
});

test('rejects oversize or invalid files without publishing them', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avatar-webm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'video.webm');
  const options = { url: URL, destination, maxBytes: 1024, onProgress: () => {} };
  await assert.rejects(cacheAliyunWebm({ ...options, fetcher: async () => new Response(WEBM, { headers: { 'content-length': '1200' } }) }), /缓存上限/);
  await assert.rejects(cacheAliyunWebm({ ...options, maxBytes: 2048, fetcher: async () => new Response(Buffer.alloc(1200)) }), /透明 WebM/);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  await assert.rejects(stat(`${destination}.part`), { code: 'ENOENT' });
});
