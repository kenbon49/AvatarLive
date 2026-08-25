import { voiceServiceConfig } from '@/lib/server/avatar-voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const DESIGN_MODEL = 'qwen3-tts-vd-2026-01-26';

type DesignPayload = {
  voice_prompt?: unknown;
  preview_text?: unknown;
};

type UpstreamPayload = {
  success?: unknown;
  provider_accepted?: unknown;
  message?: unknown;
  voice?: unknown;
  audio_url?: unknown;
  target_model?: unknown;
};

function errorResponse(message: string, status: number, providerAccepted = false) {
  return Response.json(
    { success: false, message, provider_accepted: providerAccepted },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function audioMimeType(bytes: Buffer) {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

export async function POST(request: Request) {
  const { upstream, apiKey } = voiceServiceConfig();
  if (!upstream || !apiKey) return errorResponse('百炼声音设计服务尚未配置', 503);

  try {
    const input = await request.json() as DesignPayload;
    const voicePrompt = typeof input.voice_prompt === 'string' ? input.voice_prompt.trim() : '';
    const previewText = typeof input.preview_text === 'string' ? input.preview_text.trim() : '';
    if (!voicePrompt || voicePrompt.length > 1200) return errorResponse('声音描述长度必须在 1 到 1200 个字符之间', 400);
    if (!previewText || previewText.length > 500) return errorResponse('试听文本长度必须在 1 到 500 个字符之间', 400);

    const response = await fetch(`${upstream}/api/bailian-tts/create-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        voice_prompt: voicePrompt,
        preview_text: previewText,
        target_model: DESIGN_MODEL,
        language: 'zh',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(150_000),
    });
    const payload = await response.json() as UpstreamPayload;
    if (!response.ok || payload.success !== true) {
      const detail = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;
      return errorResponse(`百炼声音设计失败：${detail}`, response.status >= 500 ? 502 : response.status, payload.provider_accepted === true);
    }
    if (typeof payload.voice !== 'string' || !payload.voice.trim()) {
      return errorResponse('百炼声音设计没有返回音色标识', 502, true);
    }
    if (typeof payload.audio_url !== 'string' || !/^\/api\/bailian-tts\/audio\/bailian_preview_[A-Za-z0-9_-]+\.wav$/.test(payload.audio_url)) {
      return errorResponse('百炼已创建设计音色，但没有返回可用试听音频', 502, true);
    }

    const audioUrl = new URL(payload.audio_url, `${upstream}/`);
    if (audioUrl.origin !== new URL(upstream).origin) {
      return errorResponse('百炼试听音频地址无效', 502, true);
    }
    const audioResponse = await fetch(audioUrl, {
      headers: { 'X-API-Key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
    if (!audioResponse.ok) return errorResponse('百炼试听音频读取失败', 502, true);
    const declaredLength = Number(audioResponse.headers.get('content-length') || 0);
    if (declaredLength > MAX_AUDIO_BYTES) return errorResponse('百炼试听音频超过 20 MB', 502, true);
    const bytes = Buffer.from(await audioResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return errorResponse('百炼试听音频大小无效', 502, true);
    const contentType = audioMimeType(bytes);
    if (!contentType) return errorResponse('百炼试听音频格式无效', 502, true);

    return Response.json({
      success: true,
      voice: payload.voice,
      target_model: typeof payload.target_model === 'string' ? payload.target_model : DESIGN_MODEL,
      preview_text: previewText,
      audio_url: `data:${contentType};base64,${bytes.toString('base64')}`,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown proxy error';
    return errorResponse(`百炼声音设计代理失败：${detail}`, 502);
  }
}
