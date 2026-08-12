export interface MuseTalkTotalResult {
  answer: string;
  llmLatencyMs: number;
  totalLatencyMs: number;
}

export type MuseTalkAvatarProfile =
  | 'chinese'
  | 'business_male_1'
  | 'chen_yu'
  | 'casual_male'
  | 'middle_aged_male'
  | 'casual_conversation'
  | 'casual_female';
type MuseTalkStreamProfile = MuseTalkAvatarProfile;

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
  // Resolving this releases the buffered audio/video timeline together.
  onPlaybackReady?: () => Promise<void> | void;
  // Resolving this lets the UI reveal its neutral idle pose before the canvas fades out.
  onPlaybackFinished?: () => Promise<void> | void;
  onStage?: (stage: string) => void;
  onTextUnit?: (unit: string, text: string) => void;
}

type ControlMessage = Record<string, unknown> & { type?: string };

interface ActiveRequest {
  requestId: string;
  startedAt: number;
  answer: string;
  streamedText: string;
  llmLatencyMs: number;
  resolve: (value: MuseTalkTotalResult) => void;
  reject: (error: Error) => void;
}

const PACKET_HEADER_BYTES = 24;
const SUPPORTED_AVATAR_PROFILES = new Set<MuseTalkAvatarProfile>([
  'chinese',
  'business_male_1',
  'chen_yu',
  'casual_male',
  'middle_aged_male',
  'casual_conversation',
  'casual_female',
]);

function isAvatarProfile(value: unknown): value is MuseTalkAvatarProfile {
  return typeof value === 'string' && SUPPORTED_AVATAR_PROFILES.has(value as MuseTalkAvatarProfile);
}

function nextRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  private connecting: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private closedByUser = false;
  private audioContext: AudioContext | null = null;
  private audioSources = new Set<AudioBufferSourceNode>();
  private audioScheduledUntil = 0;
  private sessionGeneration = 0;
  private textGeneration = 0;
  private mediaStartAudio = 0;
  private mediaStartWall = 0;
  private mediaVisible = false;
  private mediaTimelineStarted = false;
  private displayedText = '';
  private pendingTextUnits = new Map<number, { text: string; ptsSeconds: number }>();
  private unpositionedTextUnits = new Map<number, string>();
  private scheduledTextUnits = new Set<number>();
  private textTimers = new Set<number>();
  private videoTimers = new Set<number>();
  private playbackEndTimer: number | null = null;
  private videoScheduledUntilWall = 0;
  private playbackGateOpen = true;
  private playbackGateRequested = false;
  private deferredMediaPackets: ArrayBuffer[] = [];
  private pendingVideoDecodes = 0;
  private pendingPlaybackCompletion: { active: ActiveRequest; result: MuseTalkTotalResult } | null = null;
  private activeRequest: ActiveRequest | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: MuseTalkTotalOptions = {},
  ) {}

  private setStage(stage: string) {
    this.options.onStage?.(stage);
  }

  private setMediaActive(active: boolean) {
    if (this.mediaVisible === active) return;
    this.mediaVisible = active;
    this.options.onMediaActive?.(active);
  }

  private failConnecting(error: Error) {
    this.connectReject?.(error);
    this.connectReject = null;
    this.connectResolve = null;
    this.connecting = null;
  }

  private resolveConnecting() {
    this.connectResolve?.();
    this.connectReject = null;
    this.connectResolve = null;
    this.connecting = null;
  }

  private rejectActive(error: Error) {
    const active = this.activeRequest;
    this.activeRequest = null;
    if (active) {
      this.setStage('error');
      active.reject(error);
    }
  }

  private requireLive(): WebSocket {
    const websocket = this.websocket;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      throw new Error('MuseTalk 直播连接尚未就绪');
    }
    return websocket;
  }

  private async handlePacket(buffer: ArrayBuffer, generation: number): Promise<void> {
    if (generation !== this.sessionGeneration || buffer.byteLength < PACKET_HEADER_BYTES) return;
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== 'MSTK' || view.getUint8(4) !== 1) throw new Error('收到无效的 MSTK/1 媒体包');
    const packetType = view.getUint8(5);
    const payloadSize = view.getUint32(12, true);
    const ptsSeconds = Number(view.getBigUint64(16, true)) / 1_000_000;
    if (payloadSize !== buffer.byteLength - PACKET_HEADER_BYTES) {
      throw new Error('MSTK 媒体包长度不匹配');
    }
    if (!this.playbackGateOpen) {
      this.deferredMediaPackets.push(buffer);
      // Wait for a video frame, rather than merely stream_start, so the canvas
      // never replaces the idle clip with an empty frame.
      if (packetType === 1 && !this.playbackGateRequested) {
        this.playbackGateRequested = true;
        void this.openPlaybackGate(generation);
      }
      return;
    }
    const payload = buffer.slice(PACKET_HEADER_BYTES);
    if (packetType === 2) {
      if (!payload.byteLength || payload.byteLength % 2) {
        throw new Error('收到无效的 PCM 音频包');
      }
      const audioContext = this.audioContext;
      if (!audioContext || audioContext.state !== 'running') return;
      const samples = new Int16Array(payload);
      const audioBuffer = audioContext.createBuffer(1, samples.length, 16_000);
      const channel = audioBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => this.audioSources.delete(source);
      this.audioSources.add(source);
      const startAt = Math.max(
        audioContext.currentTime + 0.01,
        this.mediaStartAudio + ptsSeconds,
        this.audioScheduledUntil,
      );
      source.start(startAt);
      this.audioScheduledUntil = startAt + audioBuffer.duration;
      return;
    }
    if (packetType !== 1) return;
    this.pendingVideoDecodes += 1;
    try {
      const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
      if (generation !== this.sessionGeneration) {
        bitmap.close();
        return;
      }
      const scheduledAt = this.mediaStartWall + ptsSeconds * 1000;
      this.videoScheduledUntilWall = Math.max(this.videoScheduledUntilWall, scheduledAt);
      const delay = Math.max(0, scheduledAt - performance.now());
      const timer = window.setTimeout(() => {
        this.videoTimers.delete(timer);
        if (generation !== this.sessionGeneration) {
          bitmap.close();
          return;
        }
        if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
          this.canvas.width = bitmap.width;
          this.canvas.height = bitmap.height;
        }
        this.canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        this.setMediaActive(true);
        bitmap.close();
      }, delay);
      this.videoTimers.add(timer);
    } finally {
      this.pendingVideoDecodes = Math.max(0, this.pendingVideoDecodes - 1);
      this.finishPendingPlayback();
    }
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
        if (generation !== this.textGeneration) return;
        this.displayedText += unit.text;
        this.options.onTextUnit?.(unit.text, this.displayedText);
      }, delay);
      this.textTimers.add(timer);
    }
  }

  private ensureAnswerVisible(answer: string, generation: number) {
    if (!answer || this.displayedText) return;
    const reveal = () => {
      if (generation !== this.textGeneration || this.displayedText) return;
      this.displayedText = answer;
      this.options.onTextUnit?.(answer, answer);
    };
    const delay = this.mediaTimelineStarted
      ? Math.max(0, this.mediaStartWall - performance.now())
      : 0;
    const timer = window.setTimeout(() => {
      this.textTimers.delete(timer);
      reveal();
    }, delay);
    this.textTimers.add(timer);
  }

  private resetTextTimeline() {
    for (const timer of this.textTimers) window.clearTimeout(timer);
    this.textTimers.clear();
    this.pendingTextUnits.clear();
    this.unpositionedTextUnits.clear();
    this.scheduledTextUnits.clear();
    this.displayedText = '';
  }

  private async closeAudio() {
    if (this.playbackEndTimer !== null) {
      window.clearTimeout(this.playbackEndTimer);
      this.playbackEndTimer = null;
    }
    for (const source of this.audioSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.audioSources.clear();
    this.audioScheduledUntil = 0;
    for (const timer of this.videoTimers) window.clearTimeout(timer);
    this.videoTimers.clear();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null;
    this.mediaTimelineStarted = false;
    this.videoScheduledUntilWall = 0;
    this.playbackGateOpen = true;
    this.playbackGateRequested = false;
    this.deferredMediaPackets = [];
    this.pendingPlaybackCompletion = null;
  }

  private finishPendingPlayback() {
    const pending = this.pendingPlaybackCompletion;
    if (!pending || this.pendingVideoDecodes) return;
    this.pendingPlaybackCompletion = null;
    this.finishAfterPlayback(pending.active, pending.result);
  }

  private finishAfterPlayback(active: ActiveRequest, result: MuseTalkTotalResult) {
    const audioDelay = this.audioContext
      ? Math.max(0, this.audioScheduledUntil - this.audioContext.currentTime) * 1000
      : 0;
    const videoDelay = Math.max(0, this.videoScheduledUntilWall - performance.now());
    const delay = Math.max(audioDelay, videoDelay);
    const finish = async () => {
      this.playbackEndTimer = null;
      if (this.activeRequest !== active) return;
      await this.options.onPlaybackFinished?.();
      if (this.activeRequest !== active) return;
      this.activeRequest = null;
      this.mediaTimelineStarted = false;
      this.audioScheduledUntil = 0;
      this.videoScheduledUntilWall = 0;
      this.setMediaActive(false);
      this.setStage('idle');
      active.resolve(result);
    };
    if (delay <= 0) {
      void finish();
      return;
    }
    this.playbackEndTimer = window.setTimeout(() => void finish(), delay + 50);
  }

  private startMediaTimeline(leadMilliseconds = 650): boolean {
    const audioContext = this.audioContext;
    if (!audioContext || audioContext.state === 'closed') return false;
    if (this.mediaTimelineStarted) return true;
    this.mediaTimelineStarted = true;
    this.mediaStartAudio = audioContext.currentTime + leadMilliseconds / 1000;
    this.audioScheduledUntil = this.mediaStartAudio;
    this.mediaStartWall = performance.now() + leadMilliseconds;
    this.scheduleTextUnits(this.textGeneration);
    return true;
  }

  private async openPlaybackGate(generation: number) {
    try {
      await this.options.onPlaybackReady?.();
      if (generation !== this.sessionGeneration || this.closedByUser) return;
      this.playbackGateOpen = true;
      this.startMediaTimeline(80);
      const packets = this.deferredMediaPackets;
      this.deferredMediaPackets = [];
      for (const packet of packets) void this.handlePacket(packet, generation);
    } catch (error) {
      this.rejectActive(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleControlMessage(message: ControlMessage, generation: number) {
    if (generation !== this.sessionGeneration) return;
    const type = String(message.type || 'unknown');
    if (type === 'ready') {
      this.resolveConnecting();
      return;
    }
    const requestId = message.request_id === undefined ? null : String(message.request_id);
    if (requestId && requestId !== this.activeRequest?.requestId) {
      return;
    }
    if (type === 'llm_start' || type === 'llm_delta') {
      if (type === 'llm_delta' && this.activeRequest) {
        this.activeRequest.streamedText += String(message.delta || '');
      }
      return;
    }
    if (type === 'llm_result') {
      if (this.activeRequest) {
        this.activeRequest.answer = String(message.answer || '');
        this.activeRequest.llmLatencyMs = Number(message.elapsed_ms || 0);
      }
      return;
    }
    if (type === 'speak_start' || type === 'speak_result') {
      this.setStage(type);
      return;
    }
    if (type === 'tts_start' || type === 'tts_result') {
      this.setStage(type);
      return;
    }
    if (type === 'text_unit') {
      const sequence = Number(message.seq);
      const ptsUs = Number(message.pts_us);
      const text = String(message.text || '');
      if (Number.isInteger(sequence) && text) {
        if (Number.isFinite(ptsUs)) {
          this.queueTextUnit(sequence, text, ptsUs / 1_000_000, this.textGeneration);
        } else {
          this.unpositionedTextUnits.set(sequence, text);
        }
      }
      return;
    }
    if (type === 'segment_start') {
      const sequence = Number(message.seq);
      const ptsUs = Number(message.pts_us);
      if (Number.isInteger(sequence) && Number.isFinite(ptsUs)) {
        const text = String(message.text || this.unpositionedTextUnits.get(sequence) || '');
        this.queueTextUnit(sequence, text, ptsUs / 1_000_000, this.textGeneration);
      }
      return;
    }
    if (type === 'stream_start') {
      this.deferredMediaPackets = [];
      this.playbackGateRequested = false;
      this.playbackGateOpen = !this.options.onPlaybackReady;
      if (this.playbackGateOpen) this.startMediaTimeline();
      return;
    }
    if (type === 'conversation_end') {
      const requestId = String(message.request_id || '');
      const active = this.activeRequest;
      if (active && active.requestId === requestId) {
        const answer = String(message.answer || active.streamedText || active.answer);
        this.ensureAnswerVisible(answer, this.textGeneration);
        this.setStage('playing');
        // A control message can overtake JPEG decoding. Wait until each image has
        // established its presentation timestamp before calculating the final frame.
        this.pendingPlaybackCompletion = { active, result: {
          answer,
          llmLatencyMs: active.llmLatencyMs,
          totalLatencyMs: Number(message.elapsed_ms || Math.round(performance.now() - active.startedAt)),
        } };
        this.finishPendingPlayback();
      }
      return;
    }
    if (type === 'error') {
      const requestId = message.request_id === undefined ? null : String(message.request_id);
      const error = new Error(String(message.message || 'MuseTalk 总流程失败'));
      if (requestId === null && !this.activeRequest) {
        this.failConnecting(error);
      } else if (requestId === null || (this.activeRequest && this.activeRequest.requestId === requestId)) {
        this.rejectActive(error);
      }
    }
  }

  private async handleMessage(event: MessageEvent, generation: number) {
    if (generation !== this.sessionGeneration) return;
    if (event.data instanceof ArrayBuffer) {
      try {
        await this.handlePacket(event.data, generation);
      } catch (error) {
        this.rejectActive(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    let message: ControlMessage;
    try {
      message = JSON.parse(String(event.data)) as ControlMessage;
    } catch {
      this.failConnecting(new Error('MuseTalk 总流程返回了无效 JSON'));
      return;
    }
    this.handleControlMessage(message, generation);
  }

  async prepareAudio(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    }
    const wasRunning = this.audioContext.state === 'running';
    if (!wasRunning) await this.audioContext.resume();
    if (!wasRunning && this.audioContext.state === 'running' && this.mediaTimelineStarted) {
      const wallElapsed = Math.max(0, performance.now() - this.mediaStartWall) / 1000;
      this.mediaStartAudio = this.audioContext.currentTime - wallElapsed;
      this.audioScheduledUntil = this.audioContext.currentTime;
    }
  }

  async startLive(): Promise<void> {
    const existing = this.websocket;
    if (existing && existing.readyState === WebSocket.OPEN) {
      await this.prepareAudio();
      return;
    }
    if (this.connecting) {
      await this.connecting;
      return;
    }
    if (existing) existing.close();
    this.sessionGeneration += 1;
    const generation = this.sessionGeneration;
    await this.prepareAudio();
    this.closedByUser = false;
    this.connecting = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      const websocket = new WebSocket(conversationUrl());
      websocket.binaryType = 'arraybuffer';
      this.websocket = websocket;
      websocket.onerror = () => this.failConnecting(new Error('无法连接 MuseTalk server_total :8080'));
      websocket.onclose = () => {
        if (this.websocket === websocket) this.websocket = null;
        this.failConnecting(new Error('MuseTalk 总流程连接提前关闭'));
        if (!this.closedByUser) {
          this.rejectActive(new Error('MuseTalk 总流程连接已断开'));
          this.resetTextTimeline();
          this.setStage('error');
          this.mediaVisible = false;
          this.mediaTimelineStarted = false;
          this.options.onMediaActive?.(false);
        }
      };
      websocket.onmessage = (event) => void this.handleMessage(event, generation);
    });
    await this.connecting;
  }

  async ask(question: string): Promise<MuseTalkTotalResult> {
    if (this.activeRequest) throw new Error('MuseTalk 总流程正在处理上一条问题');
    await this.startLive();
    const websocket = this.requireLive();
    const requestId = nextRequestId();
    const startedAt = performance.now();
    this.textGeneration += 1;
    this.resetTextTimeline();
    this.mediaTimelineStarted = false;
    this.audioScheduledUntil = 0;
    this.videoScheduledUntilWall = 0;
    this.pendingPlaybackCompletion = null;
    return new Promise<MuseTalkTotalResult>((resolve, reject) => {
      this.activeRequest = { requestId, startedAt, answer: '', streamedText: '', llmLatencyMs: 0, resolve, reject };
      websocket.send(
        JSON.stringify({
          type: 'ask',
          question,
          request_id: requestId,
          profile: this.options.profile || 'chinese',
          language: this.options.language || 'ZH',
          speed: this.options.speed || 1,
        }),
      );
      this.setStage('llm_start');
    });
  }

  async speak(text: string): Promise<MuseTalkTotalResult> {
    if (this.activeRequest) throw new Error('MuseTalk 正在播放上一段内容');
    await this.startLive();
    const websocket = this.requireLive();
    const requestId = nextRequestId();
    const startedAt = performance.now();
    this.textGeneration += 1;
    this.resetTextTimeline();
    this.mediaTimelineStarted = false;
    this.audioScheduledUntil = 0;
    this.videoScheduledUntilWall = 0;
    return new Promise<MuseTalkTotalResult>((resolve, reject) => {
      this.activeRequest = { requestId, startedAt, answer: '', streamedText: '', llmLatencyMs: 0, resolve, reject };
      websocket.send(
        JSON.stringify({
          type: 'speak',
          text,
          request_id: requestId,
          profile: this.options.profile || 'chinese',
          language: this.options.language || 'ZH',
          speed: this.options.speed || 1,
        }),
      );
      this.setStage('tts_start');
    });
  }

  async cancel(): Promise<void> {
    this.textGeneration += 1;
    const active = this.activeRequest;
    this.activeRequest = null;
    const requestId = active?.requestId;
    if (active) active.reject(new Error('请求已取消'));
    this.resetTextTimeline();
    const websocket = this.websocket;
    if (requestId && websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({ type: 'cancel', request_id: requestId }),
      );
    }
    await this.closeAudio();
    this.setMediaActive(false);
    if (websocket && websocket.readyState === WebSocket.OPEN) this.setStage('idle');
  }

  async stopLive(): Promise<void> {
    this.closedByUser = true;
    this.sessionGeneration += 1;
    this.textGeneration += 1;
    const active = this.activeRequest;
    this.activeRequest = null;
    if (active) active.reject(new Error('直播已停止'));
    this.resetTextTimeline();
    const websocket = this.websocket;
    this.websocket = null;
    websocket?.close();
    this.mediaTimelineStarted = false;
    this.setMediaActive(false);
    this.setStage('idle');
    await this.closeAudio();
  }
}
