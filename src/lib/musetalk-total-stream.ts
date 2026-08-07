export interface MuseTalkTotalResult {
  answer: string;
  llmLatencyMs: number;
  totalLatencyMs: number;
}

export type MuseTalkAvatarProfile = 'chinese' | 'business_male_1';
type MuseTalkStreamProfile = MuseTalkAvatarProfile | 'american';

export interface MuseTalkAvatarCatalogEntry {
  id: MuseTalkAvatarProfile;
  name: string;
  default: boolean;
}

export interface MuseTalkAvatarCatalog {
  default: MuseTalkAvatarProfile;
  avatars: MuseTalkAvatarCatalogEntry[];
}

interface MuseTalkTotalOptions {
  profile?: MuseTalkStreamProfile;
  language?: 'ZH' | 'EN';
  speed?: number;
  onMediaActive?: (active: boolean) => void;
  onStage?: (stage: string) => void;
  onTextUnit?: (unit: string, text: string) => void;
}

type ControlMessage = Record<string, unknown> & { type?: string };

const PACKET_HEADER_BYTES = 24;
const PCM_CHUNK_BYTES = 64 * 1024;
const SUPPORTED_AVATAR_PROFILES = new Set<MuseTalkAvatarProfile>([
  'chinese',
  'business_male_1',
]);

function isAvatarProfile(value: unknown): value is MuseTalkAvatarProfile {
  return typeof value === 'string' && SUPPORTED_AVATAR_PROFILES.has(value as MuseTalkAvatarProfile);
}

export async function fetchMuseTalkAvatarCatalog(): Promise<MuseTalkAvatarCatalog> {
  const response = await fetch('/musetalk-total-api/v1/avatars', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`MuseTalk 数字人目录加载失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as {
    default?: unknown;
    avatars?: Array<{ id?: unknown; name?: unknown; default?: unknown }>;
  };
  const avatars = (Array.isArray(payload.avatars) ? payload.avatars : [])
    .filter((item): item is { id: MuseTalkAvatarProfile; name?: unknown; default?: unknown } =>
      isAvatarProfile(item?.id),
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
      default: item.default === true,
    }));
  if (!avatars.length) throw new Error('MuseTalk 服务没有返回可用的数字人');

  const defaultProfile = isAvatarProfile(payload.default) && avatars.some((item) => item.id === payload.default)
    ? payload.default
    : avatars.find((item) => item.default)?.id || avatars[0].id;
  return { default: defaultProfile, avatars };
}

function conversationUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MUSETALK_TOTAL_URL?.trim();
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  const sameOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const value = configured || (sameOrigin ? '/musetalk-total-api/v1/conversation' : `ws://${host}:8080/v1/conversation`);
  const url = new URL(value, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function acceleratedStreamUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MUSETALK_STREAM_URL?.trim();
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  const sameOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const value = configured || (sameOrigin ? '/musetalk-stream-api/v1/stream' : `ws://${host}:8083/v1/stream`);
  const url = new URL(value, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function pingMuseTalkTotal(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('/musetalk-total-api/health', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { status?: string; service?: string };
    return payload.status === 'ok' && payload.service === 'server_total';
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export class MuseTalkTotalStream {
  private websocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private audioSources = new Set<AudioBufferSourceNode>();
  private finishTimer: number | null = null;
  private generation = 0;
  private mediaStartAudio = 0;
  private mediaStartWall = 0;
  private mediaEndSeconds = 0;
  private mediaVisible = false;
  private mediaTimelineStarted = false;
  private displayedText = '';
  private pendingTextUnits = new Map<number, { text: string; ptsSeconds: number }>();
  private scheduledTextUnits = new Set<number>();
  private textTimers = new Set<number>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: MuseTalkTotalOptions = {},
  ) {}

  private setStage(stage: string) {
    this.options.onStage?.(stage);
  }

  private async handlePacket(buffer: ArrayBuffer, generation: number): Promise<void> {
    if (generation !== this.generation || buffer.byteLength < PACKET_HEADER_BYTES) return;
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== 'MSTK' || view.getUint8(4) !== 1) throw new Error('收到无效的 MSTK/1 媒体包');
    const packetType = view.getUint8(5);
    const payloadSize = view.getUint32(12, true);
    const ptsSeconds = Number(view.getBigUint64(16, true)) / 1_000_000;
    if (payloadSize !== buffer.byteLength - PACKET_HEADER_BYTES) {
      throw new Error('MSTK 媒体包长度不匹配');
    }
    const payload = buffer.slice(PACKET_HEADER_BYTES);
    if (packetType === 2) {
      if (!payload.byteLength || payload.byteLength % 2) {
        throw new Error('收到无效的 PCM 音频包');
      }
      const audioContext = this.audioContext;
      if (!audioContext || audioContext.state === 'closed') {
        throw new Error('PCM 音频包有效，但音频播放上下文不可用');
      }
      const samples = new Int16Array(payload);
      const audioBuffer = audioContext.createBuffer(1, samples.length, 16_000);
      const channel = audioBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => this.audioSources.delete(source);
      this.audioSources.add(source);
      source.start(Math.max(audioContext.currentTime, this.mediaStartAudio + ptsSeconds));
      this.mediaEndSeconds = Math.max(this.mediaEndSeconds, ptsSeconds + samples.length / 16_000);
      return;
    }
    if (packetType !== 1) return;
    this.mediaEndSeconds = Math.max(this.mediaEndSeconds, ptsSeconds + 1 / 25);
    const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
    if (generation !== this.generation) {
      bitmap.close();
      return;
    }
    const delay = Math.max(0, this.mediaStartWall + ptsSeconds * 1000 - performance.now());
    window.setTimeout(() => {
      if (generation !== this.generation) {
        bitmap.close();
        return;
      }
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width;
        this.canvas.height = bitmap.height;
      }
      this.canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      if (!this.mediaVisible) {
        this.mediaVisible = true;
        this.options.onMediaActive?.(true);
      }
      bitmap.close();
    }, delay);
  }

  private scheduleIdle(generation: number) {
    if (this.finishTimer !== null) window.clearTimeout(this.finishTimer);
    const delay = Math.max(0, this.mediaStartWall + this.mediaEndSeconds * 1000 - performance.now());
    this.finishTimer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      this.mediaVisible = false;
      this.mediaTimelineStarted = false;
      this.options.onMediaActive?.(false);
      this.setStage('idle');
      void this.closeAudio();
    }, delay + 80);
  }

  private queueTextUnit(sequence: number, text: string, ptsSeconds: number, generation: number) {
    if (!text || this.scheduledTextUnits.has(sequence)) return;
    this.pendingTextUnits.set(sequence, { text, ptsSeconds });
    if (this.mediaTimelineStarted) this.scheduleTextUnits(generation);
  }

  private scheduleTextUnits(generation: number) {
    if (!this.mediaTimelineStarted) return;
    for (const [sequence, unit] of [...this.pendingTextUnits.entries()].sort(([a], [b]) => a - b)) {
      if (this.scheduledTextUnits.has(sequence)) continue;
      this.scheduledTextUnits.add(sequence);
      const delay = Math.max(0, this.mediaStartWall + unit.ptsSeconds * 1000 - performance.now());
      const timer = window.setTimeout(() => {
        this.textTimers.delete(timer);
        if (generation !== this.generation) return;
        this.displayedText += unit.text;
        this.options.onTextUnit?.(unit.text, this.displayedText);
      }, delay);
      this.textTimers.add(timer);
    }
  }

  private resetTextTimeline() {
    for (const timer of this.textTimers) window.clearTimeout(timer);
    this.textTimers.clear();
    this.pendingTextUnits.clear();
    this.scheduledTextUnits.clear();
    this.displayedText = '';
  }

  private async closeAudio() {
    for (const source of this.audioSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.audioSources.clear();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null;
    this.mediaTimelineStarted = false;
  }

  private startMediaTimeline(): void {
    const audioContext = this.audioContext;
    if (!audioContext || audioContext.state === 'closed') {
      throw new Error('音频播放上下文不可用');
    }
    // server_total remaps every text segment onto one conversation-wide PTS timeline.
    if (this.mediaTimelineStarted) return;
    this.mediaTimelineStarted = true;
    this.mediaStartAudio = audioContext.currentTime + 0.65;
    this.mediaStartWall = performance.now() + 650;
    this.scheduleTextUnits(this.generation);
  }

  async prepareAudio(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    }
    if (this.audioContext.state !== 'running') await this.audioContext.resume();
  }

  async ask(question: string): Promise<MuseTalkTotalResult> {
    if (this.websocket) throw new Error('MuseTalk 总流程正在处理上一条问题');
    const generation = ++this.generation;
    const startedAt = performance.now();
    this.mediaEndSeconds = 0;
    this.mediaVisible = false;
    this.mediaTimelineStarted = false;
    this.resetTextTimeline();
    await this.prepareAudio();
    this.setStage('connecting');

    return new Promise<MuseTalkTotalResult>((resolve, reject) => {
      const websocket = new WebSocket(conversationUrl());
      websocket.binaryType = 'arraybuffer';
      this.websocket = websocket;
      let answer = '';
      let streamedText = '';
      let llmLatencyMs = 0;
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        this.options.onMediaActive?.(false);
        this.setStage('error');
        this.websocket = null;
        websocket.close();
        this.resetTextTimeline();
        void this.closeAudio();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      websocket.onerror = () => fail(new Error('无法连接 MuseTalk server_total :8080'));
      websocket.onclose = () => {
        if (!settled) fail(new Error('MuseTalk 总流程连接提前关闭'));
      };
      websocket.onmessage = (event) => {
        if (generation !== this.generation) return;
        if (event.data instanceof ArrayBuffer) {
          void this.handlePacket(event.data, generation).catch(fail);
          return;
        }
        let message: ControlMessage;
        try {
          message = JSON.parse(String(event.data)) as ControlMessage;
        } catch {
          fail(new Error('MuseTalk 总流程返回了无效 JSON'));
          return;
        }
        const type = String(message.type || 'unknown');
        this.setStage(type);
        if (type === 'ready') {
          websocket.send(
            JSON.stringify({
              type: 'ask',
              question,
              profile: this.options.profile || 'chinese',
              language: this.options.language || 'ZH',
              speed: this.options.speed || 1,
            }),
          );
        } else if (type === 'llm_delta') {
          const delta = String(message.delta || '');
          if (delta) streamedText += delta;
        } else if (type === 'text_unit') {
          const sequence = Number(message.seq);
          const ptsUs = Number(message.pts_us);
          if (Number.isInteger(sequence) && Number.isFinite(ptsUs)) {
            this.queueTextUnit(sequence, String(message.text || ''), ptsUs / 1_000_000, generation);
          }
        } else if (type === 'segment_start') {
          // Compatibility with older server_total versions that emitted text_unit before media PTS existed.
          const sequence = Number(message.seq);
          const ptsUs = Number(message.pts_us);
          if (Number.isInteger(sequence) && Number.isFinite(ptsUs)) {
            this.queueTextUnit(sequence, String(message.text || ''), ptsUs / 1_000_000, generation);
          }
        } else if (type === 'llm_result') {
          answer = String(message.answer || streamedText);
          llmLatencyMs = Number(message.elapsed_ms || 0);
        } else if (type === 'stream_start') {
          try {
            this.startMediaTimeline();
          } catch (error) {
            fail(error);
          }
        } else if (type === 'error') {
          fail(new Error(String(message.message || 'MuseTalk 总流程失败')));
        } else if (type === 'conversation_end') {
          answer = String(message.answer || answer || streamedText);
          this.setStage('playing');
          this.scheduleIdle(generation);
          settled = true;
          this.websocket = null;
          websocket.close();
          resolve({
            answer,
            llmLatencyMs,
            totalLatencyMs: Number(message.elapsed_ms || performance.now() - startedAt),
          });
        }
      };
    });
  }

  async speak(text: string): Promise<MuseTalkTotalResult> {
    if (this.websocket) throw new Error('MuseTalk 正在播放上一段内容');
    const generation = ++this.generation;
    const startedAt = performance.now();
    this.mediaEndSeconds = 0;
    this.mediaVisible = false;
    this.mediaTimelineStarted = false;
    this.resetTextTimeline();
    await this.prepareAudio();
    this.setStage('tts_start');

    const ttsResponse = await fetch('/melotts-api/v1/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language: this.options.language || 'ZH',
        speed: this.options.speed || 1,
        sample_rate: 16_000,
      }),
    });
    if (!ttsResponse.ok) {
      throw new Error(`MeloTTS 合成失败（HTTP ${ttsResponse.status}）`);
    }
    const pcm = await ttsResponse.arrayBuffer();
    if (!pcm.byteLength || pcm.byteLength % 2) throw new Error('MeloTTS 返回了无效 PCM 音频');
    this.setStage('tts_result');

    return new Promise<MuseTalkTotalResult>((resolve, reject) => {
      const websocket = new WebSocket(acceleratedStreamUrl());
      websocket.binaryType = 'arraybuffer';
      this.websocket = websocket;
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        this.options.onMediaActive?.(false);
        this.setStage('error');
        this.websocket = null;
        websocket.close();
        void this.closeAudio();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      websocket.onerror = () => fail(new Error('无法连接 MuseTalk accelerated :8083'));
      websocket.onclose = () => {
        if (!settled) fail(new Error('MuseTalk accelerated 连接提前关闭'));
      };
      websocket.onmessage = (event) => {
        if (generation !== this.generation) return;
        if (event.data instanceof ArrayBuffer) {
          void this.handlePacket(event.data, generation).catch(fail);
          return;
        }
        let message: ControlMessage;
        try {
          message = JSON.parse(String(event.data)) as ControlMessage;
        } catch {
          fail(new Error('MuseTalk accelerated 返回了无效 JSON'));
          return;
        }
        const type = String(message.type || 'unknown');
        this.setStage(type);
        if (type === 'ready') {
          websocket.send(JSON.stringify({
            type: 'start',
            profile: this.options.profile || 'chinese',
          }));
          for (let offset = 0; offset < pcm.byteLength; offset += PCM_CHUNK_BYTES) {
            websocket.send(pcm.slice(offset, offset + PCM_CHUNK_BYTES));
          }
          websocket.send(JSON.stringify({ type: 'commit' }));
        } else if (type === 'stream_start') {
          try {
            this.startMediaTimeline();
          } catch (error) {
            fail(error);
          }
        } else if (type === 'stream_end') {
          this.scheduleIdle(generation);
          settled = true;
          this.websocket = null;
          websocket.close();
          resolve({
            answer: text,
            llmLatencyMs: 0,
            totalLatencyMs: Math.round(performance.now() - startedAt),
          });
        } else if (type === 'error') {
          fail(new Error(String(message.message || 'MuseTalk accelerated 失败')));
        }
      };
    });
  }

  async cancel(): Promise<void> {
    this.generation += 1;
    if (this.finishTimer !== null) window.clearTimeout(this.finishTimer);
    this.finishTimer = null;
    const websocket = this.websocket;
    this.websocket = null;
    websocket?.close();
    this.mediaVisible = false;
    this.options.onMediaActive?.(false);
    this.resetTextTimeline();
    await this.closeAudio();
  }
}
