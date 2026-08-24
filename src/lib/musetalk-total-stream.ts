import { getMuseTalkAvatars } from './api';
import { LocalMuseTalkStream } from './musetalk-local-stream';

export interface MuseTalkTotalResult {
  answer: string;
  llmLatencyMs: number;
  totalLatencyMs: number;
}

export type MuseTalkAvatarProfile = string;
type MuseTalkStreamProfile = MuseTalkAvatarProfile;

export interface MuseTalkAvatarCatalogEntry {
  id: MuseTalkAvatarProfile;
  name: string;
  default: boolean;
}

export interface MuseTalkAvatarCatalog {
  default: MuseTalkAvatarProfile;
  avatars: MuseTalkAvatarCatalogEntry[];
  availableAvatarIds: string[];
  defaultAvatarId: string;
}

export interface MuseTalkVoice {
  voice_id: string;
  name: string;
  kind: 'preset' | 'clone' | string;
  language?: string;
  whisper_text?: string;
  source?: { provider?: string; sample_url?: string } | null;
}

export async function fetchMuseTalkVoices(): Promise<MuseTalkVoice[]> {
  const response = await fetch('/musetalk-total-api/v1/voices', { cache: 'no-store' });
  if (!response.ok) throw new Error(`音色目录加载失败（HTTP ${response.status}）`);
  const payload = (await response.json()) as { voices?: MuseTalkVoice[] };
  return Array.isArray(payload.voices) ? payload.voices : [];
}

export async function cloneMuseTalkVoice(name: string, audio: File): Promise<MuseTalkVoice> {
  const form = new FormData();
  form.append('name', name);
  form.append('audio', audio, audio.name);
  const response = await fetch('/musetalk-total-api/v1/voices/clone', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
    } catch {
      // Keep the HTTP status when the proxy returns a non-JSON error page.
    }
    throw new Error(`音色克隆失败：${detail}`);
  }
  return (await response.json()) as MuseTalkVoice;
}

export interface MuseTalkTotalOptions {
  avatarId?: string;
  profile?: MuseTalkStreamProfile;
  language?: 'ZH' | 'EN';
  voice?: string;
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
const PLAYBACK_LEAD_SECONDS = 0.12;
const MAX_PENDING_VIDEO_DECODES = 2;
const configuredPlaybackBufferMs = Number(
  process.env.NEXT_PUBLIC_MUSETALK_PLAYBACK_BUFFER_MS || 1500,
);
const PLAYBACK_BUFFER_MS = Number.isFinite(configuredPlaybackBufferMs)
  ? Math.min(4_000, Math.max(500, configuredPlaybackBufferMs))
  : 1500;
const PLAYBACK_HANDOFF_TIMEOUT_MS = 1_000;
const PLAYBACK_COMPLETION_FALLBACK_MS = 2_500;
function isAvatarProfile(value: unknown): value is MuseTalkAvatarProfile {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
}

function nextRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function fetchMuseTalkAvatarCatalog(): Promise<MuseTalkAvatarCatalog> {
  const serverTotalCatalog = async () => {
    const healthResponse = await fetch('/musetalk-total-api/health', { cache: 'no-store' });
    if (!healthResponse.ok) throw new Error(`server_total 探活 HTTP ${healthResponse.status}`);
    let health: { status?: unknown; service?: unknown };
    try {
      health = (await healthResponse.json()) as { status?: unknown; service?: unknown };
    } catch {
      throw new Error('server_total 未启动');
    }
    if (health.status !== 'ok' || health.service !== 'server_total') {
      throw new Error('server_total 未启动');
    }
    const response = await fetch('/musetalk-total-api/v1/avatars', { cache: 'no-store' });
    if (!response.ok) throw new Error(`server_total HTTP ${response.status}`);
    const payload = (await response.json()) as {
      default?: unknown;
      avatars?: Array<{ id?: unknown; name?: unknown; default?: unknown; custom?: unknown }>;
    };
    const avatars = (Array.isArray(payload.avatars) ? payload.avatars : [])
      .filter((item): item is { id: MuseTalkAvatarProfile; name?: unknown; default?: unknown; custom?: unknown } =>
        isAvatarProfile(item?.id),
      )
      .map((item) => ({
        id: item.id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
        default: item.default === true,
        custom: item.custom === true,
      }));
    if (!avatars.length) throw new Error('server_total 没有返回可用的数字人');
    const defaultProfile = isAvatarProfile(payload.default) && avatars.some((item) => item.id === payload.default)
      ? payload.default
      : avatars.find((item) => item.default)?.id || avatars[0].id;
    const avatarIdByProfile: Record<string, string> = {
      chinese: 'chinese',
      business_male_1: 'business-male-1',
      chen_yu: 'chenyu',
    };
    return {
      avatars,
      defaultProfile,
      availableAvatarIds: avatars.map((avatar) => avatarIdByProfile[avatar.id] || avatar.id),
      defaultAvatarId: avatarIdByProfile[defaultProfile] || defaultProfile,
    };
  };

  const localCatalog = async () => {
    const state = await getMuseTalkAvatars();
    const profileByAvatarId: Record<string, MuseTalkAvatarProfile> = {
      suqing: 'chinese',
      guyan: 'business_male_1',
    };
    const avatars = state.avatars.flatMap<MuseTalkAvatarCatalogEntry>((avatar) => {
      const profile = profileByAvatarId[avatar.id];
      return profile ? [{ id: profile, name: avatar.label, default: avatar.id === state.active_avatar }] : [];
    });
    if (!avatars.length) throw new Error('本地 MuseTalk 没有返回可用的数字人');
    const defaultAvatarId = state.avatars.some((avatar) => avatar.id === state.active_avatar)
      ? state.active_avatar
      : state.avatars[0].id;
    return {
      avatars,
      defaultProfile: profileByAvatarId[defaultAvatarId] || avatars[0].id,
      availableAvatarIds: state.avatars.map((avatar) => avatar.id),
      defaultAvatarId,
    };
  };

  const normalize = (catalog: Awaited<ReturnType<typeof localCatalog>>): MuseTalkAvatarCatalog => ({
    default: catalog.defaultProfile,
    avatars: catalog.avatars,
    availableAvatarIds: catalog.availableAvatarIds,
    defaultAvatarId: catalog.defaultAvatarId,
  });

  const [serverTotalResult, localResult] = await Promise.allSettled([
    serverTotalCatalog(),
    localCatalog(),
  ]);
  if (serverTotalResult.status === 'fulfilled' && localResult.status === 'fulfilled') {
    const serverTotal = serverTotalResult.value;
    const local = localResult.value;
    return normalize({
      avatars: [...serverTotal.avatars, ...local.avatars],
      defaultProfile: serverTotal.defaultProfile,
      availableAvatarIds: [...new Set([
        ...serverTotal.availableAvatarIds,
        ...local.availableAvatarIds,
      ])],
      defaultAvatarId: serverTotal.defaultAvatarId,
    });
  }
  if (serverTotalResult.status === 'fulfilled') return normalize(serverTotalResult.value);
  if (localResult.status === 'fulfilled') return normalize(localResult.value);

  const detail = (error: unknown) => error instanceof Error ? error.message : '服务不可用';
  throw new Error(
    `MuseTalk 数字人目录加载失败（本地 MuseTalk：${detail(localResult.reason)}；server_total：${detail(serverTotalResult.reason)}）`,
  );
}

function conversationUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MUSETALK_TOTAL_URL?.trim();
  const value = configured || '/musetalk-total-api/v1/conversation';
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

export class ServerTotalStream {
  private websocket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private closedByUser = false;
  private audioContext: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
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
  private playbackEndTimer: number | null = null;
  private playbackFallbackTimer: number | null = null;
  private decodedVideoFrames = new Map<number, ImageBitmap>();
  private videoFrameRequest: number | null = null;
  private lastDrawnVideoPts = -Infinity;
  private videoEndPts = 0;
  private playbackGateOpen = true;
  private playbackGateRequested = false;
  private conversationStreamStarted = false;
  private deferredMediaPackets: ArrayBuffer[] = [];
  private bufferedAudioEndPts = 0;
  private bufferedVideoReady = false;
  private playbackBufferSeconds = PLAYBACK_BUFFER_MS / 1000;
  private conversationEnded = false;
  private audioWorkletStarted = false;
  private workletUnderrunBlocks = 0;
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

  private setMediaActive(active: boolean, force = false) {
    if (this.mediaVisible === active && !force) return;
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
      if (packetType === 1) {
        this.bufferedVideoReady = true;
      } else if (packetType === 2) {
        this.bufferedAudioEndPts = Math.max(
          this.bufferedAudioEndPts,
          ptsSeconds + payloadSize / 2 / 16_000,
        );
      }
      this.maybeOpenPlaybackGate(generation);
      return;
    }
    const payload = buffer.slice(PACKET_HEADER_BYTES);
    if (packetType === 2) {
      if (!payload.byteLength || payload.byteLength % 2) {
        throw new Error('收到无效的 PCM 音频包');
      }
      const audioContext = this.audioContext;
      if (!audioContext || audioContext.state !== 'running') return;
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.postMessage({ type: 'enqueue', data: payload }, [payload]);
        this.audioScheduledUntil = Math.max(
          this.audioScheduledUntil,
          this.mediaStartAudio + ptsSeconds + payloadSize / 2 / 16_000,
        );
        return;
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
      // PTS is the source of truth. Serialising against the previous packet's
      // actual start time permanently shifts audio after one late packet and
      // makes it drift away from video.
      const startAt = Math.max(audioContext.currentTime + 0.01, this.mediaStartAudio + ptsSeconds);
      source.start(startAt);
      this.audioScheduledUntil = Math.max(this.audioScheduledUntil, startAt + audioBuffer.duration);
      return;
    }
    if (packetType !== 1) return;
    const packetRequest = this.activeRequest;
    this.videoEndPts = Math.max(this.videoEndPts, ptsSeconds);
    if (this.pendingVideoDecodes >= MAX_PENDING_VIDEO_DECODES) return;
    this.pendingVideoDecodes += 1;
    try {
      const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
      if (
        generation !== this.sessionGeneration
        || this.activeRequest !== packetRequest
        || ptsSeconds <= this.lastDrawnVideoPts
      ) {
        bitmap.close();
        return;
      }
      this.decodedVideoFrames.get(ptsSeconds)?.close();
      this.decodedVideoFrames.set(ptsSeconds, bitmap);
      this.requestVideoRender(generation);
    } finally {
      this.pendingVideoDecodes = Math.max(0, this.pendingVideoDecodes - 1);
      this.finishPendingPlayback();
    }
  }

  private requestVideoRender(generation: number) {
    if (this.videoFrameRequest !== null) return;
    this.videoFrameRequest = window.requestAnimationFrame(() => this.renderDueVideoFrame(generation));
  }

  private renderDueVideoFrame(generation: number) {
    this.videoFrameRequest = null;
    const audioContext = this.audioContext;
    if (generation !== this.sessionGeneration || !audioContext || !this.mediaTimelineStarted) return;

    const mediaPts = audioContext.currentTime - this.mediaStartAudio;
    let nextPts: number | null = null;
    for (const [pts, bitmap] of this.decodedVideoFrames) {
      if (pts <= this.lastDrawnVideoPts) {
        bitmap.close();
        this.decodedVideoFrames.delete(pts);
      } else if (pts <= mediaPts && (nextPts === null || pts > nextPts)) {
        nextPts = pts;
      }
    }

    if (nextPts !== null) {
      const bitmap = this.decodedVideoFrames.get(nextPts);
      for (const [pts, stale] of this.decodedVideoFrames) {
        if (pts <= nextPts) {
          if (pts !== nextPts) stale.close();
          this.decodedVideoFrames.delete(pts);
        }
      }
      if (bitmap) {
        if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
          this.canvas.width = bitmap.width;
          this.canvas.height = bitmap.height;
        }
        this.canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        bitmap.close();
        this.lastDrawnVideoPts = nextPts;
        this.setMediaActive(true);
      }
    }

    // When decoding or the tab stalls, only the newest due frame is drawn.
    // Replaying every overdue timer is the visible fast/slow judder.
    if (this.mediaTimelineStarted && (this.activeRequest || this.decodedVideoFrames.size)) {
      this.requestVideoRender(generation);
    }
  }

  private clearVideoPlayback() {
    if (this.videoFrameRequest !== null) {
      window.cancelAnimationFrame(this.videoFrameRequest);
      this.videoFrameRequest = null;
    }
    for (const bitmap of this.decodedVideoFrames.values()) bitmap.close();
    this.decodedVideoFrames.clear();
    this.lastDrawnVideoPts = -Infinity;
    this.videoEndPts = 0;
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
    if (this.playbackFallbackTimer !== null) {
      window.clearTimeout(this.playbackFallbackTimer);
      this.playbackFallbackTimer = null;
    }
    for (const source of this.audioSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.audioSources.clear();
    this.audioWorkletNode?.port.postMessage({ type: 'stop' });
    this.audioWorkletNode?.disconnect();
    this.audioWorkletNode = null;
    this.audioScheduledUntil = 0;
    this.clearVideoPlayback();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null;
    this.mediaTimelineStarted = false;
    this.playbackGateOpen = true;
    this.playbackGateRequested = false;
    this.conversationStreamStarted = false;
    this.deferredMediaPackets = [];
    this.bufferedAudioEndPts = 0;
    this.bufferedVideoReady = false;
    this.conversationEnded = false;
    this.audioWorkletStarted = false;
    this.pendingPlaybackCompletion = null;
  }

  private finishPendingPlayback() {
    const pending = this.pendingPlaybackCompletion;
    if (!pending || (!this.playbackGateOpen && this.playbackGateRequested)) return;
    this.pendingPlaybackCompletion = null;
    this.armPlaybackFallback(pending.active, pending.result);
    this.finishAfterPlayback(pending.active, pending.result);
  }

  private armPlaybackFallback(active: ActiveRequest, result: MuseTalkTotalResult) {
    if (this.playbackFallbackTimer !== null) window.clearTimeout(this.playbackFallbackTimer);
    const audioDelay = this.audioContext
      ? Math.max(0, this.audioScheduledUntil - this.audioContext.currentTime) * 1000
      : 0;
    const videoDelay = this.audioContext
      ? Math.max(0, this.mediaStartAudio + this.videoEndPts - this.audioContext.currentTime) * 1000
      : 0;
    this.playbackFallbackTimer = window.setTimeout(() => {
      this.playbackFallbackTimer = null;
      if (this.activeRequest !== active) return;
      if (this.playbackEndTimer !== null) {
        window.clearTimeout(this.playbackEndTimer);
        this.playbackEndTimer = null;
      }
      this.pendingPlaybackCompletion = null;
      this.completePlayback(active, result);
    }, Math.max(audioDelay, videoDelay) + PLAYBACK_COMPLETION_FALLBACK_MS);
  }

  private async finishPlaybackHandoff() {
    const callback = this.options.onPlaybackFinished;
    if (!callback) return;
    let timeout: number | null = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => callback()),
        new Promise<void>((resolve) => {
          timeout = window.setTimeout(resolve, PLAYBACK_HANDOFF_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // UI handoff failures must not leave the request and input permanently locked.
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }

  private completePlayback(active: ActiveRequest, result: MuseTalkTotalResult) {
    if (this.playbackFallbackTimer !== null) {
      window.clearTimeout(this.playbackFallbackTimer);
      this.playbackFallbackTimer = null;
    }
    this.playbackEndTimer = null;
    if (this.activeRequest !== active) return;
    this.activeRequest = null;
    this.mediaTimelineStarted = false;
    this.audioScheduledUntil = 0;
    this.conversationStreamStarted = false;
    this.clearVideoPlayback();
    this.deferredMediaPackets = [];
    this.playbackGateOpen = true;
    this.playbackGateRequested = false;
    this.setStage('idle');
    active.resolve(result);
    // The visual handoff is best effort and must never own the request lock.
    // Keep the final canvas frame visible until the idle source is ready.
    void this.finishPlaybackHandoff().finally(() => this.setMediaActive(false, true));
  }

  private finishAfterPlayback(active: ActiveRequest, result: MuseTalkTotalResult) {
    const audioDelay = this.audioContext
      ? Math.max(0, this.audioScheduledUntil - this.audioContext.currentTime) * 1000
      : 0;
    const videoDelay = this.audioContext
      ? Math.max(0, this.mediaStartAudio + this.videoEndPts - this.audioContext.currentTime) * 1000
      : 0;
    const delay = Math.max(audioDelay, videoDelay);
    if (delay <= 0) {
      this.completePlayback(active, result);
      return;
    }
    this.playbackEndTimer = window.setTimeout(
      () => this.completePlayback(active, result),
      delay + 50,
    );
  }

  private startMediaTimeline(leadSeconds = 0.65): boolean {
    const audioContext = this.audioContext;
    if (!audioContext || audioContext.state === 'closed') return false;
    if (this.mediaTimelineStarted) return true;
    this.mediaTimelineStarted = true;
    this.mediaStartAudio = audioContext.currentTime + leadSeconds;
    this.audioScheduledUntil = this.mediaStartAudio;
    this.mediaStartWall = performance.now() + leadSeconds * 1000;
    this.scheduleTextUnits(this.textGeneration);
    return true;
  }

  private maybeOpenPlaybackGate(generation: number, force = false) {
    if (this.playbackGateOpen || this.playbackGateRequested) return;
    if (!this.bufferedVideoReady || this.bufferedAudioEndPts <= 0) return;
    if (!force && this.bufferedAudioEndPts < this.playbackBufferSeconds) return;
    const active = this.activeRequest;
    if (!active) return;
    this.playbackGateRequested = true;
    void this.openPlaybackGate(generation, active);
  }

  private async openPlaybackGate(generation: number, active: ActiveRequest) {
    try {
      await this.options.onPlaybackReady?.();
      if (generation !== this.sessionGeneration || this.closedByUser || this.activeRequest !== active) return;
      this.playbackGateOpen = true;
      this.startMediaTimeline(PLAYBACK_LEAD_SECONDS);
      const packets = this.deferredMediaPackets;
      this.deferredMediaPackets = [];
      for (const packet of packets) void this.handlePacket(packet, generation);
      if (this.audioWorkletNode && !this.audioWorkletStarted) {
        this.audioWorkletStarted = true;
        this.audioWorkletNode.port.postMessage({
          type: 'start',
          delaySamples: Math.round(PLAYBACK_LEAD_SECONDS * 16_000),
        });
        if (this.conversationEnded) this.audioWorkletNode.port.postMessage({ type: 'end' });
      }
      this.finishPendingPlayback();
    } catch (error) {
      this.rejectActive(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleControlMessage(message: ControlMessage, generation: number) {
    if (generation !== this.sessionGeneration) return;
    const type = String(message.type || 'unknown');
    if (type === 'ready') {
      const configuredSeconds = Number(message.playback_buffer_seconds);
      if (Number.isFinite(configuredSeconds)) {
        this.playbackBufferSeconds = Math.min(4, Math.max(0.5, configuredSeconds));
      }
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
      // server_total emits stream_start once per sentence while all sentences
      // share one continuous PTS timeline. Reopening the UI handoff for every
      // sentence pauses/seeks the idle video and creates a visible gap.
      if (this.conversationStreamStarted) return;
      this.conversationStreamStarted = true;
      this.deferredMediaPackets = [];
      this.playbackGateRequested = false;
      this.playbackGateOpen = false;
      return;
    }
    if (type === 'conversation_end') {
      const requestId = String(message.request_id || '');
      const active = this.activeRequest;
      if (active && active.requestId === requestId) {
        this.conversationEnded = true;
        if (!this.playbackGateOpen) {
          this.maybeOpenPlaybackGate(generation, true);
        } else {
          this.audioWorkletNode?.port.postMessage({ type: 'end' });
        }
        const answer = String(message.answer || active.streamedText || active.answer);
        this.ensureAnswerVisible(answer, this.textGeneration);
        this.setStage('playing');
        // A control message can overtake JPEG decoding. Wait until each image has
        // established its presentation timestamp before calculating the final frame.
        const result = {
          answer,
          llmLatencyMs: active.llmLatencyMs,
          totalLatencyMs: Number(message.elapsed_ms || Math.round(performance.now() - active.startedAt)),
        };
        this.pendingPlaybackCompletion = { active, result };
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
      this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 16_000 });
      if (this.audioContext.sampleRate === 16_000 && this.audioContext.audioWorklet) {
        try {
          await this.audioContext.audioWorklet.addModule('/vendor/musetalk-playback-worklet.js');
          const node = new AudioWorkletNode(this.audioContext, 'musetalk-playback-worklet', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          node.port.onmessage = (event: MessageEvent<{ type?: string; underrunBlocks?: number }>) => {
            if (event.data?.type === 'metrics') {
              const underrunBlocks = Number(event.data.underrunBlocks || 0);
              if (underrunBlocks > this.workletUnderrunBlocks) {
                console.warn(`MuseTalk audio buffer underrun: ${underrunBlocks} blocks`);
              }
              this.workletUnderrunBlocks = underrunBlocks;
            }
          };
          node.connect(this.audioContext.destination);
          this.audioWorkletNode = node;
        } catch (error) {
          console.warn('MuseTalk AudioWorklet unavailable; using scheduled audio fallback.', error);
          this.audioWorkletNode = null;
        }
      }
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
      websocket.onerror = () => this.failConnecting(new Error('无法连接 MuseTalk server_total'));
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
    this.conversationStreamStarted = false;
    this.bufferedAudioEndPts = 0;
    this.bufferedVideoReady = false;
    this.conversationEnded = false;
    this.audioWorkletStarted = false;
    this.workletUnderrunBlocks = 0;
    this.audioWorkletNode?.port.postMessage({ type: 'stop' });
    this.clearVideoPlayback();
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
          voice_id: this.options.voice || undefined,
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
    this.conversationStreamStarted = false;
    this.bufferedAudioEndPts = 0;
    this.bufferedVideoReady = false;
    this.conversationEnded = false;
    this.audioWorkletStarted = false;
    this.workletUnderrunBlocks = 0;
    this.audioWorkletNode?.port.postMessage({ type: 'stop' });
    this.clearVideoPlayback();
    return new Promise<MuseTalkTotalResult>((resolve, reject) => {
      this.activeRequest = { requestId, startedAt, answer: '', streamedText: '', llmLatencyMs: 0, resolve, reject };
      websocket.send(
        JSON.stringify({
          type: 'speak',
          text,
          request_id: requestId,
          profile: this.options.profile || 'chinese',
          language: this.options.language || 'ZH',
          voice_id: this.options.voice || undefined,
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

type MuseTalkStreamImplementation = Pick<
  ServerTotalStream,
  'startLive' | 'prepareAudio' | 'ask' | 'speak' | 'cancel' | 'stopLive'
>;

const LOCAL_AVATAR_IDS = new Set(['suqing', 'guyan']);

export class MuseTalkTotalStream implements MuseTalkStreamImplementation {
  private readonly implementation: MuseTalkStreamImplementation;

  constructor(canvas: HTMLCanvasElement, options: MuseTalkTotalOptions = {}) {
    this.implementation = LOCAL_AVATAR_IDS.has(options.avatarId || '')
      ? new LocalMuseTalkStream(canvas, options)
      : new ServerTotalStream(canvas, options);
  }

  startLive() {
    return this.implementation.startLive();
  }

  prepareAudio() {
    return this.implementation.prepareAudio();
  }

  ask(question: string) {
    return this.implementation.ask(question);
  }

  speak(text: string) {
    return this.implementation.speak(text);
  }

  cancel() {
    return this.implementation.cancel();
  }

  stopLive() {
    return this.implementation.stopLive();
  }
}
