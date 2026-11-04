import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const API_UPSTREAM = (process.env.API_UPSTREAM || 'http://127.0.0.1:8000').replace(/\/$/, '');

type ExpandPayload = { prompt?: unknown; systemPrompt?: unknown; maxTokens?: unknown; imageDataUrls?: unknown; stream?: unknown };

const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function parseEventStream(body: string) {
  let content = '';
  let error = '';
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const event = JSON.parse(line.slice(5).trim()) as { type?: unknown; text?: unknown; message?: unknown };
      if (event.type === 'content' && typeof event.text === 'string') content += event.text;
      if (event.type === 'error' && typeof event.message === 'string') error = event.message;
    } catch {
      // Ignore malformed keepalive events while preserving valid content chunks.
    }
  }
  if (error) throw new Error(error);
  return content.trim();
}

export async function POST(request: Request) {
  try {
    requireRequestUser(request);
    const input = await request.json() as ExpandPayload;
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || prompt.length > 30_000) {
      return Response.json({ message: '话术扩写内容长度无效' }, { status: 400 });
    }
    const systemPrompt = typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '';
    if (systemPrompt.length > 4_000) {
      return Response.json({ message: '话术生成规则长度无效' }, { status: 400 });
    }
    const imageDataUrls = Array.isArray(input.imageDataUrls)
      ? input.imageDataUrls.filter((value): value is string => typeof value === 'string')
      : [];
    if (imageDataUrls.length > 4 || imageDataUrls.some((url) => url.length > 8_000_000 || !IMAGE_DATA_URL.test(url))) {
      return Response.json({ message: '最多上传 4 张 JPG、PNG、WebP 或 GIF 图片' }, { status: 400 });
    }
    const requestedTokens = typeof input.maxTokens === 'number' ? input.maxTokens : 900;
    const wantsStream = input.stream === true;
    const messageContent = imageDataUrls.length
      ? [
        { type: 'text', text: prompt },
        ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
      : prompt;
    const response = await fetch(`${API_UPSTREAM}/api/v1/llm/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: messageContent }],
        system_prompt: systemPrompt || undefined,
        max_tokens: Math.max(100, Math.min(12_000, Math.round(requestedTokens))),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(150_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: unknown };
      return Response.json(
        { message: typeof payload.detail === 'string' ? payload.detail : `话术扩写服务返回 HTTP ${response.status}` },
        { status: response.status, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (wantsStream) {
      if (!response.body) throw new Error('话术扩写服务没有返回内容');
      return new Response(response.body, {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        },
      });
    }
    const body = await response.text();
    const content = parseEventStream(body);
    if (!content) throw new Error('话术扩写服务没有返回内容');
    return Response.json({ content }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '话术扩写失败' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
