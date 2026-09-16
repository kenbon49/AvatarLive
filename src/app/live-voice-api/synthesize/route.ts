import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ALIYUN_PUBLIC_VOICES, type AliyunPublicVoice } from '@/lib/aliyun-voice-catalog';
import { fetchSeoService } from '@/lib/server/seo-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;

type SynthesizePayload = { text?: unknown; voiceId?: unknown };
type VoiceDesignPayload = { success?: unknown; voice?: unknown; message?: unknown };

const TARGET_MODEL = 'qwen3-tts-vc-2026-01-22';
const voiceModelPromises = new Map<string, Promise<string>>();

function preferredVoiceName(voiceId: string) {
  if (voiceId.length <= 13 && /^[A-Za-z0-9_]+$/.test(voiceId)) return `lv_${voiceId}`;
  return `lv_${createHash('sha256').update(voiceId).digest('hex').slice(0, 10)}`;
}

function voiceLanguage(voice: AliyunPublicVoice) {
  if (voice.language === '英文') return 'en';
  if (voice.language === '日文') return 'ja';
  if (voice.language === '韩文') return 'ko';
  return 'zh';
}

async function findStoredVoice(preferredName: string) {
  const query = new URLSearchParams({ media_type: 'audio', status: 'completed', provider: 'bailian', page: '1', page_size: '100' });
  const { response } = await fetchSeoService(`/api/ai/generated-media?${query}`, {
    method: 'GET',
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ metadata?: { source?: unknown; preferred_name?: unknown; voice_id?: unknown; voice?: unknown } }>;
    message?: unknown;
  };
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : '音色记录查询失败');
  const matched = payload.data?.find((item) => (
    item.metadata?.source === 'voice_enrollment' && item.metadata?.preferred_name === preferredName
  ));
  const voiceId = matched?.metadata?.voice_id || matched?.metadata?.voice;
  return typeof voiceId === 'string' ? voiceId : '';
}

async function resolveVoiceModel(voiceId: string) {
  const cached = voiceModelPromises.get(voiceId);
  if (cached) return cached;

  const pending = (async () => {
    const voice = ALIYUN_PUBLIC_VOICES.find((item) => item.id === voiceId);
    if (!voice) throw new Error('当前音色尚未接入自定义文本合成');
    const preferredName = preferredVoiceName(voice.id);
    const storedVoice = await findStoredVoice(preferredName);
    if (storedVoice) return storedVoice;

    const sourcePath = path.join(process.cwd(), 'public', 'assets', 'aliyun-voices', `${voice.id}.mp3`);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    const form = new FormData();
    form.append('audio_file', new Blob([sourceBytes], { type: 'audio/mpeg' }), `${voice.id}.mp3`);
    form.append('target_model', TARGET_MODEL);
    form.append('preferred_name', preferredName);
    form.append('text', voice.sampleText.slice(0, 500));
    form.append('language', voiceLanguage(voice));
    const { response } = await fetchSeoService('/api/bailian-tts/enroll-voice', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const created = await response.json().catch(() => ({})) as VoiceDesignPayload;
    if (!response.ok || created.success !== true || typeof created.voice !== 'string') {
      throw new Error(typeof created.message === 'string' ? created.message : '音色初始化失败');
    }
    return created.voice;
  })();

  voiceModelPromises.set(voiceId, pending);
  try {
    return await pending;
  } catch (cause) {
    voiceModelPromises.delete(voiceId);
    throw cause;
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as SynthesizePayload;
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const voiceId = typeof input.voiceId === 'string' ? input.voiceId.trim() : '';
    if (!text || text.length > 800) return Response.json({ message: '单段试听文本必须在 800 字以内' }, { status: 400 });
    if (!voiceId) return Response.json({ message: '请先选择数字人声音' }, { status: 400 });

    const voice = await resolveVoiceModel(voiceId);
    const { response } = await fetchSeoService('/api/bailian-tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, target_model: TARGET_MODEL }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => ({})) as {
      success?: unknown;
      audio_url?: unknown;
      duration?: unknown;
      message?: unknown;
    };
    if (!response.ok || payload.success !== true || typeof payload.audio_url !== 'string') {
      throw new Error(typeof payload.message === 'string' ? payload.message : '当前文本语音合成失败');
    }
    const match = payload.audio_url.match(/^\/api\/bailian-tts\/audio\/([A-Za-z0-9_.-]+)$/);
    if (!match) throw new Error('语音服务返回了无效音频地址');
    return Response.json({
      audioUrl: `/live-voice-api/audio/${encodeURIComponent(match[1])}`,
      duration: typeof payload.duration === 'number' ? payload.duration : 0,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '当前文本语音合成失败' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
