import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SYNTHESIS_MODEL = 'qwen-audio-3.1-tts-plus';
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

  constructor(message: string, status = 502, providerAccepted = false, options?: ErrorOptions) {
    super(message, options);
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

function normalizeWav(bytes: Buffer) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return bytes;
  // The speech API can return streaming WAV headers with unknown size markers.
  const result = Buffer.from(bytes);
  if (result.readUInt32LE(4) >= 0x7fff0000) result.writeUInt32LE(result.length - 8, 4);
  for (let offset = 12; offset + 8 <= result.length;) {
    const size = result.readUInt32LE(offset + 4);
    if (result.toString('ascii', offset, offset + 4) === 'data') {
      if (size >= 0x7fff0000) result.writeUInt32LE(result.length - offset - 8, offset + 4);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return result;
}

function validVoice(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

async function writeAtomic(filename: string, bytes: string | Buffer) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function storageOperation<T>(label: string, operation: () => Promise<T>, providerAccepted = false): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new BailianTtsError(`${label}失败，请检查服务运行用户对 runtime/bailian-tts 目录的写入权限及磁盘空间`, 500, providerAccepted, { cause });
  }
}

async function checkWritable(directory: string, label: string) {
  await storageOperation(label, async () => {
    const probe = path.join(directory, `.write-check-${randomUUID()}`);
    try {
      // Exercise creation and atomic rename before any paid provider request.
      await writeAtomic(probe, '');
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  });
}

// The API backend owns credentials and the provider's HTTP protocol.
export function createBailianTtsClient({ credentialId, providerRequest, voiceTasks = new Map(), runtimeDirectory, publicDirectory, voices, fetcher = fetch }: {
  credentialId?: string;
  providerRequest?: (body: object) => Promise<BailianProviderOutput>;
  voiceTasks?: Map<string, Promise<string>>;
  runtimeDirectory: string;
  publicDirectory: string;
  voices: readonly PublicVoice[];
  fetcher?: typeof fetch;
}) {
  function assertConfigured() {
    if (providerRequest && credentialId) return;
    throw new BailianTtsError('请在管理员系统设置中配置百炼语音 API Key（BAILIAN_TTS_API_KEY）', 503);
  }

  async function callProvider(body: object): Promise<BailianProviderOutput> {
    assertConfigured();
    return providerRequest!(body);
  }

  async function resolveVoice(voiceId: string) {
    assertConfigured();
    const voice = voices.find((item) => item.id === voiceId);
    if (!voice || !/^[a-z0-9_]+$/.test(voice.id)) throw new BailianTtsError('当前音色尚未接入自定义文本合成', 400);
    let sample: Buffer;
    try {
      sample = await readFile(path.join(publicDirectory, 'assets', 'aliyun-voices', `${voice.id}.mp3`));
    } catch (cause) {
      throw new BailianTtsError('无法读取官方音色样本，请检查 public/assets/aliyun-voices 中的语音文件', 500, false, { cause });
    }
    // A registration belongs to the account/region, model and source sample.
    const cacheId = createHash('sha256').update(credentialId!).update(SYNTHESIS_MODEL)
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
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new BailianTtsError('无法读取音色缓存，请检查 runtime/bailian-tts/voices 中的缓存文件及读取权限', 500, false, { cause: error });
        }
      }
      const language = ({ 英文: 'en', 日文: 'ja', 韩文: 'ko' } as Record<string, string>)[voice.language] || 'zh';
      const output = await callProvider({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create', target_model: SYNTHESIS_MODEL,
          preferred_name: `av${cacheId.slice(0, 8)}`,
          audio: { data: `data:audio/mpeg;base64,${sample.toString('base64')}` },
          text: voice.sampleText.slice(0, 500), language,
        },
      });
      if (!validVoice(output.voice)) throw new BailianTtsError('百炼没有返回有效的音色标识', 502, true);
      await storageOperation('保存已注册音色的缓存', () => writeAtomic(filename, JSON.stringify({ voice: output.voice })), true);
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
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !(url.hostname.endsWith('.aliyuncs.com') || url.hostname.endsWith('.alicdn.com'))) {
      throw new BailianTtsError('百炼返回了不受信任的试听音频地址', 502, true);
    }
    // BaiLian can return an HTTP OSS URL; download the trusted asset over HTTPS.
    url.protocol = 'https:';
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
      assertConfigured();
      await checkWritable(path.join(runtimeDirectory, 'voices'), '检查音色缓存目录');
      const audioDirectory = path.join(runtimeDirectory, 'audio', ownerId);
      await checkWritable(audioDirectory, '检查试听音频目录');
      const voice = await resolveVoice(voiceId);
      const output = await callProvider({ model: SYNTHESIS_MODEL, input: { text, voice } });
      const audio = await downloadAudio(output.audio?.url);
      const bytes = normalizeWav(audio.bytes);
      const filename = `bailian_tts_${randomUUID()}.${audio.extension}`;
      await storageOperation('保存已合成的试听音频', () => writeAtomic(path.join(audioDirectory, filename), bytes), true);
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
      const output = await callProvider({
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
