import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createExternalApiLogger, createExternalApiLogStore, filterLogs, logSortKey, sanitizeLogValue } from '../src/lib/server/external-api-log.ts';

test('records provider errors and request IDs while preserving the original response and hiding credentials', async () => {
  const entries = [];
  const logger = createExternalApiLogger({
    write: async entry => entries.push(entry),
    fetcher: async () => Response.json({ success: false, message: 'Rejected header-only-private-key', request_id: 'provider-123' }, { status: 403 }),
    context: async () => ({ userId: 'user-one', route: '/avatar-image-api/edit' }),
  });
  const response = await logger.fetch('content', '生成形象', 'https://user:password@example.test/image?token=private-query', {
    method: 'POST', headers: { 'X-API-Key': 'header-only-private-key' },
    body: JSON.stringify({ prompt: 'hello', api_key: 'nested-private-key', image: 'data:image/png;base64,' + 'a'.repeat(1000) }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).message, 'Rejected header-only-private-key');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].httpStatus, 403);
  assert.equal(entries[0].status, 'error');
  assert.equal(entries[0].requestId, 'provider-123');
  assert.equal(entries[0].context.userId, 'user-one');
  assert.doesNotMatch(JSON.stringify(entries), /header-only-private-key|nested-private-key|private-query|user:password|a{200}/);
});

test('preserves network exceptions and SDK details, including their sanitized stack', async () => {
  const entries = [];
  const error = Object.assign(new Error('SDK rejected Bearer private-api-token'), { statusCode: 429, requestId: 'sdk-456', data: { Code: 'QuotaExceeded' } });
  const logger = createExternalApiLogger({ write: async entry => entries.push(entry) });
  await assert.rejects(logger.call('aliyun-avatar', '生成视频', 'https://example.test/', 'POST', { text: '你好' },
    async () => { throw error; }, () => ({})), cause => cause === error);
  assert.equal(entries[0].httpStatus, 429);
  assert.equal(entries[0].requestId, 'sdk-456');
  assert.match(entries[0].error.stack, /SDK rejected/);
  assert.equal(entries[0].response.Code, 'QuotaExceeded');
  assert.doesNotMatch(JSON.stringify(entries), /private-api-token/);
});

test('captures HTTP 200 business failures and ignores diagnostic write failures', async () => {
  const entries = [];
  const logger = createExternalApiLogger({ write: async entry => entries.push(entry), fetcher: async () => Response.json({ status: 'failed', message: 'task-123 failed' }) });
  const response = await logger.fetch('content', '任务状态', 'https://example.test/');
  assert.equal(entries[0].status, 'error');
  assert.equal(response.status, 200);
  const failing = createExternalApiLogger({ write: async () => { throw new Error('disk full'); }, fetcher: async () => Response.json({ success: true }) });
  assert.deepEqual(await (await failing.fetch('content', '提交', 'https://example.test/')).json(), { success: true });
});

test('records multipart metadata and never consumes files or streaming responses', async () => {
  const entries = [];
  const body = new FormData();
  body.append('file', new File(['private-file-content'], 'sample.mp3', { type: 'audio/mpeg' }));
  body.append('model', 'test-model');
  const logger = createExternalApiLogger({ write: async entry => entries.push(entry), fetcher: async () => new Response('data: hello\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  const result = await logger.fetch('content', '上传', 'https://example.test/upload', { method: 'POST', body });
  assert.equal(entries[0].request.file.bytes, 20);
  assert.equal(entries[0].request.file.type, 'audio/mpeg');
  assert.equal(await result.text(), 'data: hello\n\n');
  assert.doesNotMatch(JSON.stringify(entries), /private-file-content|data: hello/);
});

test('bounds diagnostic response reads without changing large response bodies', async () => {
  const entries = [];
  const payload = { output: { preview_audio: { data: 'a'.repeat(100_000) } }, message: 'done' };
  const logger = createExternalApiLogger({ write: async entry => entries.push(entry), fetcher: async () => Response.json(payload) });
  const result = await logger.fetch('bailian', '设计声音', 'https://example.test/');
  assert.deepEqual(await result.json(), payload);
  assert.ok(JSON.stringify(entries).length < 25_000);
  assert.doesNotMatch(JSON.stringify(entries), /a{200}/);
});

test('serializes concurrent writes, rotates files, and keeps persisted logs private', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'avatarlive-api-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createExternalApiLogStore(directory, 400, 2);
  const logger = createExternalApiLogger({ write: store.write, fetcher: async () => Response.json({ success: true }) });
  await Promise.all(Array.from({ length: 6 }, (_, index) => logger.fetch('content', `call-${index}`, 'https://example.test/')));
  const items = await store.list({ limit: 50 });
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map(item => item.id)).size, 3);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'web.log'))).mode & 0o777, 0o600);
  assert.match(await readFile(path.join(directory, 'web.log.2'), 'utf8'), /call-/);
});

test('filters retained logs and paginates across both sources with stable cursors', () => {
  const now = new Date().toISOString();
  const entries = ['web-a', 'api-c', 'api-b'].map(id => ({ id, createdAt: now, source: id.startsWith('web') ? 'web' : 'api', provider: 'bailian', status: 'error', error: { message: 'quota' } }));
  entries.push({ ...entries[0], id: 'old', createdAt: '2020-01-01T00:00:00.000Z' });
  const first = filterLogs(entries, { provider: 'bailian', status: 'error', q: 'quota', limit: 2 });
  const second = filterLogs(entries, { before: logSortKey(first.at(-1)), limit: 2 });
  assert.deepEqual([...first, ...second].map(item => item.id), ['web-a', 'api-c', 'api-b']);
  assert.equal(filterLogs(entries, { status: 'success' }).length, 0);
});

test('bounds nested logs and redacts signed URLs, raw authorization and arbitrary key values', () => {
  const value = sanitizeLogValue({ Signature: 'private-signature', url: 'https://a.aliyuncs.com/a?x-oss-signature=signed-secret&model=qwen',
    detail: 'api_key=custom-private-key, Authorization: Bearer bearer-private-key', other: 'custom-private-key', audio: { data: 'a'.repeat(1000) } }, ['custom-private-key']);
  assert.doesNotMatch(JSON.stringify(value), /private-signature|signed-secret|custom-private-key|bearer-private-key|a{200}/);
  assert.match(value.url, /model=qwen/);
  const bounded = sanitizeLogValue({ request: Array.from({ length: 100 }, () => ({ prompt: '字'.repeat(10000) })), status: 'error' });
  assert.ok(JSON.stringify(bounded).length < 25_000);
});
