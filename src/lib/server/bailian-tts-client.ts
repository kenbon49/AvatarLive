import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CUSTOMIZATION_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';
const SYNTHESIS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const SYNTHESIS_MODEL = 'qwen3-tts-vc-2026-01-22';
const DESIGN_MODEL = 'qwen3-tts-vd-2026-01-26';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_FILENAME = /^bailian_tts_[a-f0-9-]{36}\.(wav|mp3)$/;
const USER_ID = /^[a-f0-9-]{36}$/;

type PublicVoice = { id: string; sampleText: string; language: string };
export type BailianProviderOutput = {
  voice?: string;
  audio?: { url?: string };
  preview_audio?: { data?: string };
};

export class BailianTtsError extends Error {
  status: number;
  providerAccepted: boolean;

  constructor(message: string, status = 502, providerAccepted = false) {
    super(message);
    this.name = 'BailianTtsError';
    this.status = status;
    this.providerAccepted = providerAccepted;
  }
}

function audioType(bytes: Buffer) {
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    return { mime: 'audio/wav', extension: 'wav' };
  }
  if ((bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3')
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', extension: 'mp3' };
  }
  throw new BailianTtsError('百炼返回的试听音频格式无效', 502, true);
}

function validVoice(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

async function writeAtomic(filename: string, bytes: string | Buffer) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

// Credentials are explicit here so protocol tests never load real keys.
// Production requests use the project's API backend to read encrypted settings.
export function createBailianTtsClient({ apiKey = '', credentialId, providerRequest, voiceTasks = new Map(), runtimeDirectory, publicDirectory, voices, fetcher = fetch }: {
  apiKey?: string;
  credentialId?: string;
  providerRequest?: (body: object) => Promise<BailianProviderOutput>;
  voiceTasks?: Map<string, Promise<string>>;
  runtimeDirectory: string;
  publicDirectory: string;
  voices: readonly PublicVoice[];
  fetcher?: typeof fetch;
}) {
  const key = apiKey.trim();

  function assertConfigured() {
    if (providerRequest && credentialId) return;
    if (!key || /[\r\n]/.test(key)) {
      throw new BailianTtsError('请在管理员系统设置中配置百炼语音 API Key（BAILIAN_TTS_API_KEY）', 503);
    }
  }

  async function callProvider(url: string, body: object): Promise<BailianProviderOutput> {
    assertConfigured();
    if (providerRequest) return providerRequest(body);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new BailianTtsError('连接百炼语音服务失败或超时，请检查网络后重试');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new BailianTtsError('百炼 API Key 无效或没有当前语音模型的访问权限');
      }
      if (response.status === 429) throw new BailianTtsError('百炼请求过于频繁或额度不足，请稍后重试', 429);
      throw new BailianTtsError(`百炼语音调用失败（HTTP ${response.status}），请检查账户额度和模型权限`);
    }
    const payload = await response.json().catch(() => null) as { code?: string; output?: BailianProviderOutput } | null;
    if (!payload || typeof payload !== 'object' || !payload.output || typeof payload.output !== 'object' || payload.code) {
      throw new BailianTtsError('百炼语音调用返回异常，请检查账户额度、模型权限和输入内容', 502, true);
    }
    return payload.output;
  }

  async function resolveVoice(voiceId: string) {
    assertConfigured();
    const voice = voices.find((item) => item.id === voiceId);
    if (!voice || !/^[a-z0-9_]+$/.test(voice.id)) throw new BailianTtsError('当前音色尚未接入自定义文本合成', 400);
    const sample = await readFile(path.join(publicDirectory, 'assets', 'aliyun-voices', `${voice.id}.mp3`));
    // A registration belongs to the API key, model and source sample.
    const cacheId = createHash('sha256').update(credentialId || key).update(SYNTHESIS_MODEL)
      .update(voice.id).update(voice.sampleText).update(voice.language).update(sample).digest('hex');
    const existing = voiceTasks.get(cacheId);
    if (existing) return existing;
    const pending = (async () => {
      const filename = path.join(runtimeDirectory, 'voices', `${cacheId}.json`);
      try {
        const saved = JSON.parse(await readFile(filename, 'utf8')) as { voice?: unknown };
        if (!validVoice(saved.voice)) throw new Error('音色缓存格式无效');
        return saved.voice;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const language = ({ 英文: 'en', 日文: 'ja', 韩文: 'ko' } as Record<string, string>)[voice.language] || 'zh';
      const output = await callProvider(CUSTOMIZATION_URL, {
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create', target_model: SYNTHESIS_MODEL,
          preferred_name: `lv_${cacheId.slice(0, 10)}`,
          audio: { data: `data:audio/mpeg;base64,${sample.toString('base64')}` },
          text: voice.sampleText.slice(0, 500), language,
        },
      });
      if (!validVoice(output.voice)) throw new BailianTtsError('百炼没有返回有效的音色标识', 502, true);
      await writeAtomic(filename, JSON.stringify({ voice: output.voice }));
      return output.voice;
    })();
    voiceTasks.set(cacheId, pending);
    try {
      return await pending;
    } finally {
      voiceTasks.delete(cacheId);
    }
  }

  async function downloadAudio(value: unknown) {
    if (typeof value !== 'string') throw new BailianTtsError('百炼没有返回试听音频地址', 502, true);
    let url: URL;
    try { url = new URL(value); } catch { throw new BailianTtsError('百炼返回的试听音频地址无效', 502, true); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname.endsWith('.aliyuncs.com') || url.hostname.endsWith('.alicdn.com'))) {
      throw new BailianTtsError('百炼返回了不受信任的试听音频地址', 502, true);
    }
    // Download signed assets without forwarding the API key or following redirects.
    let response: Response;
    try {
      response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new BailianTtsError('语音已生成，但试听音频下载失败', 502, true);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new BailianTtsError('语音已生成，但试听音频下载失败', 502, true);
    }
    if (Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
      await response.body.cancel();
      throw new BailianTtsError('试听音频超过 20 MB', 502, true);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_AUDIO_BYTES) throw new BailianTtsError('试听音频超过 20 MB', 502, true);
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    return { bytes, ...audioType(bytes) };
  }

  return {
    async synthesize(text: string, voiceId: string, ownerId: string) {
      if (!text.trim() || text.length > 800) throw new BailianTtsError('单段试听文本必须在 1 到 800 字之间', 400);
      if (!USER_ID.test(ownerId)) throw new BailianTtsError('用户身份无效', 401);
      const voice = await resolveVoice(voiceId);
      const output = await callProvider(SYNTHESIS_URL, { model: SYNTHESIS_MODEL, input: { text, voice } });
      const audio = await downloadAudio(output.audio?.url);
      const filename = `bailian_tts_${randomUUID()}.${audio.extension}`;
      await writeAtomic(path.join(runtimeDirectory, 'audio', ownerId, filename), audio.bytes);
      return { audioUrl: `/live-voice-api/audio/${filename}`, duration: 0 };
    },

    async readAudio(filename: string, ownerId: string) {
      if (!AUDIO_FILENAME.test(filename) || !USER_ID.test(ownerId)) throw new BailianTtsError('语音文件不存在', 404);
      try {
        const bytes = await readFile(path.join(runtimeDirectory, 'audio', ownerId, filename));
        return { bytes, ...audioType(bytes) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BailianTtsError('语音文件不存在', 404);
        throw error;
      }
    },

    async designVoice(voicePrompt: string, previewText: string) {
      if (!voicePrompt.trim() || voicePrompt.length > 1200) throw new BailianTtsError('声音描述长度必须在 1 到 1200 个字符之间', 400);
      if (!previewText.trim() || previewText.length > 500) throw new BailianTtsError('试听文本长度必须在 1 到 500 个字符之间', 400);
      const output = await callProvider(CUSTOMIZATION_URL, {
        model: 'qwen-voice-design',
        input: {
          action: 'create', target_model: DESIGN_MODEL, voice_prompt: voicePrompt,
          preview_text: previewText, language: 'zh', preferred_name: `av_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
        },
        parameters: { sample_rate: 24000, response_format: 'wav' },
      });
      const data = output.preview_audio?.data;
      if (!validVoice(output.voice) || typeof data !== 'string' || !data.length
        || data.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        throw new BailianTtsError('百炼已创建设计音色，但没有返回有效的试听音频', 502, true);
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > MAX_AUDIO_BYTES) throw new BailianTtsError('试听音频超过 20 MB', 502, true);
      const { mime } = audioType(bytes);
      return {
        success: true, voice: output.voice, target_model: DESIGN_MODEL,
        preview_text: previewText, audio_url: `data:${mime};base64,${bytes.toString('base64')}`,
      };
    },
  };
}
