import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForAvatarVideo } from '../src/lib/live-video-batch.ts';

test('waits for current video completion before allowing a subsequent submission', async () => {
  let calls = 0;
  await waitForAvatarVideo('task-current', {
    signal: new AbortController().signal, pollInterval: 0,
    fetcher: async url => {
      assert.equal(url, '/aliyun-avatar-video-api/videos/task-current');
      calls++;
      return Response.json({ video: { status: calls === 1 ? 'PROCESSING' : 'SUCCESS' } });
    },
  });
  assert.equal(calls, 2);
});

test('stopping during a poll promptly cancels further work', async () => {
  const controller = new AbortController();
  const waiting = waitForAvatarVideo('task-current', {
    signal: controller.signal, pollInterval: 60000,
    fetcher: async () => {
      setTimeout(() => controller.abort(), 0);
      return Response.json({ video: { status: 'PROCESSING' } });
    },
  });
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('waits for local download and stops when it fails', async () => {
  let calls = 0;
  await waitForAvatarVideo('task-current', {
    signal: new AbortController().signal, pollInterval: 0,
    fetcher: async () => Response.json({ video: { status: 'SUCCESS', download: { status: ++calls === 1 ? 'downloading' : 'ready' } } }),
  });
  assert.equal(calls, 2);
  await assert.rejects(waitForAvatarVideo('task-current', {
    signal: new AbortController().signal,
    fetcher: async () => Response.json({ video: { status: 'SUCCESS', download: { status: 'failed', error: '下载失败' } } }),
  }), /下载失败/);
});

test('failure, invalid status and timeout prevent automatic continuation', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(waitForAvatarVideo('task-current', { signal, fetcher: async () => Response.json({ video: { status: 'ERROR' } }) }), /合成失败/);
  await assert.rejects(waitForAvatarVideo('task-current', { signal, fetcher: async () => Response.json({}) }), /状态读取失败/);
  await assert.rejects(waitForAvatarVideo('task-current', { signal, timeoutMs: 0 }), /停止提交后续/);
});
