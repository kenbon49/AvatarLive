type LiveAiStreamPayload = {
  type?: unknown;
  text?: unknown;
  message?: unknown;
  content?: unknown;
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as LiveAiStreamPayload;
  return new Error(typeof payload.message === 'string' ? payload.message : `AI 话术生成失败（HTTP ${response.status}）`);
}

export async function readLiveAiText(response: Response, {
  onText,
  charactersPerTick = 2,
  tickMilliseconds = 16,
}: {
  onText: (text: string) => void;
  charactersPerTick?: number;
  tickMilliseconds?: number;
}): Promise<string> {
  if (!response.ok) throw await responseError(response);

  let received = '';
  let displayed = '';
  const reveal = async (text: string) => {
    received += text;
    const remaining = Array.from(received.slice(displayed.length));
    const step = Math.max(1, Math.round(charactersPerTick));
    for (let index = 0; index < remaining.length; index += step) {
      displayed += remaining.slice(index, index + step).join('');
      onText(displayed);
      if (tickMilliseconds > 0) await wait(tickMilliseconds);
    }
  };

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const payload = await response.json().catch(() => ({})) as LiveAiStreamPayload;
    if (typeof payload.content !== 'string' || !payload.content.trim()) throw new Error('话术生成服务没有返回内容');
    await reveal(payload.content);
    return received.trim();
  }

  if (!response.body) throw new Error('话术生成服务没有返回内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamError = '';

  const processBlock = async (block: string) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    try {
      const event = JSON.parse(data) as LiveAiStreamPayload;
      if (event.type === 'content' && typeof event.text === 'string') await reveal(event.text);
      if (event.type === 'error' && typeof event.message === 'string') streamError = event.message;
    } catch {
      // Ignore malformed keepalive events while continuing to consume valid chunks.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) await processBlock(block);
    if (done) break;
  }
  if (buffer.trim()) await processBlock(buffer);
  if (streamError) throw new Error(streamError);
  if (!received.trim()) throw new Error('话术生成服务没有返回内容');
  return received.trim();
}
