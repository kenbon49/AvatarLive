function waitForPoll(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForAvatarVideo(taskId: string, { signal, fetcher = fetch, pollInterval = 4000, timeoutMs = 30 * 60 * 1000 }: {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  pollInterval?: number;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const response = await fetcher(`/aliyun-avatar-video-api/videos/${encodeURIComponent(taskId)}`, { signal, cache: 'no-store' });
    const payload = await response.json().catch(() => ({})) as { video?: { status?: string; error?: string }; message?: string };
    if (!response.ok || typeof payload.video?.status !== 'string') throw new Error(payload.message || '数字人合成状态读取失败，已停止后续合成');
    const state = payload.video.status.trim().toUpperCase();
    if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(state)) return;
    if (['FAIL', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(state)) throw new Error(payload.video.error || '数字人合成失败，已停止后续合成');
    await waitForPoll(pollInterval, signal);
  }
  throw new Error('当前数字人仍在合成，已停止提交后续分镜');
}
