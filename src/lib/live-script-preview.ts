export async function loadScriptPreviewAudio<T>({ text, voiceId, speed, signal, decode, fetcher = fetch }: {
  text: string;
  voiceId: string;
  speed: number;
  signal: AbortSignal;
  decode: (bytes: ArrayBuffer) => Promise<T>;
  fetcher?: typeof fetch;
}): Promise<T[]> {
  const buffers: T[] = [];
  for (let offset = 0; offset < text.length; offset += 800) {
    signal.throwIfAborted();
    const response = await fetcher('/live-voice-api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(offset, offset + 800), voiceId, speed }),
      signal,
    });
    const payload = await response.json().catch(() => ({})) as { audioUrl?: unknown; message?: unknown };
    if (!response.ok || typeof payload.audioUrl !== 'string' || !payload.audioUrl) {
      throw new Error(typeof payload.message === 'string' ? payload.message : '当前文本语音合成失败');
    }
    const audioResponse = await fetcher(payload.audioUrl, { signal });
    if (!audioResponse.ok) throw new Error('合成语音读取失败');
    const buffer = await decode(await audioResponse.arrayBuffer());
    signal.throwIfAborted();
    buffers.push(buffer);
  }
  return buffers;
}
