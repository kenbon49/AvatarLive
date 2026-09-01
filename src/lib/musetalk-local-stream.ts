import {
  api,
  getMuseTalkHealth,
  interruptMuseTalk,
  offerMuseTalk,
  setMuseTalkAvatar,
  speakMuseTalk,
} from './api';

import type {
  MuseTalkAvatarProfile,
  MuseTalkTotalOptions,
  MuseTalkTotalResult,
} from './musetalk-total-stream';

const PROFILE_TO_RENDERER: Partial<Record<MuseTalkAvatarProfile, string>> = {
  chinese: 'suqing',
  business_male_1: 'guyan',
};

const CONNECTION_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 180_000;
const PLAYBACK_HANDOFF_TIMEOUT_MS = 1_000;

function rendererProfile(profile: MuseTalkAvatarProfile | undefined): string {
  return PROFILE_TO_RENDERER[profile || 'chinese'] || 'suqing';
}

function errorDetail(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const body = value as Record<string, unknown>;
  for (const key of ['detail', 'message', 'error']) {
    if (typeof body[key] === 'string' && body[key]) return body[key];
  }
  return fallback;
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, 5_000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    }
    function handleChange() {
      if (peer.iceGatheringState === 'complete') finish();
    }
    peer.addEventListener('icegatheringstatechange', handleChange);
  });
}

export class LocalMuseTalkStream {
  private peer: RTCPeerConnection | null = null;
  private connecting: Promise<void> | null = null;
  private video: HTMLVideoElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioCaptureDestination: MediaStreamAudioDestinationNode | null = null;
  private audioSource: MediaElementAudioSourceNode | null = null;
  private drawFrameId: number | null = null;
  private drawFrameKind: 'raf' | 'timeout' | null = null;
  private visibilityListenerAttached = false;
  private firstFrameResolve: (() => void) | null = null;
  private firstFrameReject: ((error: Error) => void) | null = null;
  private firstFrameTimer: number | null = null;
  private mediaVisible = false;
  private closedByUser = false;
  private operationGeneration = 0;
  private activeOperation = false;
  private sessionId: string | null = null;

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

  private assertCurrent(generation: number) {
    if (generation !== this.operationGeneration || this.closedByUser) {
      throw new Error('请求已取消');
    }
  }

  private startDrawing(video: HTMLVideoElement) {
    if (this.drawFrameId !== null) {
      if (this.drawFrameKind === 'timeout') window.clearTimeout(this.drawFrameId);
      else window.cancelAnimationFrame(this.drawFrameId);
    }
    if (!this.visibilityListenerAttached) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('blur', this.handleVisibilityChange);
      window.addEventListener('focus', this.handleVisibilityChange);
      this.visibilityListenerAttached = true;
    }
    const draw = () => {
      if (this.video !== video || this.closedByUser) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
          this.canvas.width = video.videoWidth;
          this.canvas.height = video.videoHeight;
        }
        this.canvas.getContext('2d')?.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        if (this.firstFrameResolve) {
          this.firstFrameResolve();
          this.clearFirstFrameWait();
        }
      }
      const backgrounded = document.hidden || !document.hasFocus();
      this.drawFrameKind = backgrounded ? 'timeout' : 'raf';
      this.drawFrameId = backgrounded
        ? window.setTimeout(draw, 67)
        : window.requestAnimationFrame(draw);
    };
    const backgrounded = document.hidden || !document.hasFocus();
    this.drawFrameKind = backgrounded ? 'timeout' : 'raf';
    this.drawFrameId = backgrounded
      ? window.setTimeout(draw, 67)
      : window.requestAnimationFrame(draw);
  }

  private readonly handleVisibilityChange = () => {
    if (!(document.hidden || !document.hasFocus()) || !this.video || this.drawFrameKind !== 'raf' || this.drawFrameId === null) return;
    window.cancelAnimationFrame(this.drawFrameId);
    this.drawFrameId = null;
    this.drawFrameKind = null;
    this.startDrawing(this.video);
  };

  private clearFirstFrameWait() {
    if (this.firstFrameTimer !== null) window.clearTimeout(this.firstFrameTimer);
    this.firstFrameTimer = null;
    this.firstFrameResolve = null;
    this.firstFrameReject = null;
  }

  private waitForFirstFrame(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.firstFrameResolve = resolve;
      this.firstFrameReject = reject;
      this.firstFrameTimer = window.setTimeout(() => {
        const fail = this.firstFrameReject;
        this.clearFirstFrameWait();
        fail?.(new Error('MuseTalk WebRTC 已连接，但未收到视频帧'));
      }, CONNECTION_TIMEOUT_MS);
    });
  }

  private attachTrack(track: MediaStreamTrack) {
    if (track.kind === 'video') {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      this.video?.pause();
      this.video = video;
      this.startDrawing(video);
      void video.play().catch(() => undefined);
      return;
    }
    if (track.kind === 'audio') {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.muted = true;
      audio.srcObject = new MediaStream([track]);
      this.audio?.pause();
      this.audioSource?.disconnect();
      this.audioSource = null;
      this.audio = audio;
      this.connectAudioCapture();
      void audio.play().catch(() => undefined);
    }
  }

  private waitForConnection(peer: RTCPeerConnection): Promise<void> {
    if (peer.connectionState === 'connected') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('MuseTalk WebRTC 连接超时')), CONNECTION_TIMEOUT_MS);
      const handleChange = () => {
        if (peer.connectionState === 'connected') finish();
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          finish(new Error(`MuseTalk WebRTC 连接失败（${peer.connectionState}）`));
        }
      };
      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        peer.removeEventListener('connectionstatechange', handleChange);
        if (error) reject(error);
        else resolve();
      };
      peer.addEventListener('connectionstatechange', handleChange);
    });
  }

  async prepareAudio(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' });
      this.audioCaptureDestination = this.audioContext.createMediaStreamDestination();
    }
    this.connectAudioCapture();
    if (!this.audio) return;
    try {
      await this.audio.play();
    } catch {
      // The next explicit speak/ask click gets another chance to unlock audio.
    }
  }

  getOutputAudioTrack(): MediaStreamTrack | null {
    return this.audioCaptureDestination?.stream.getAudioTracks()[0]
      ?? (this.audio?.srcObject instanceof MediaStream ? this.audio.srcObject.getAudioTracks()[0] : null);
  }

  private connectAudioCapture() {
    if (!this.audio || !this.audioContext || !this.audioCaptureDestination || this.audioSource) return;
    try {
      this.audioSource = this.audioContext.createMediaElementSource(this.audio);
      this.audioSource.connect(this.audioContext.destination);
      this.audioSource.connect(this.audioCaptureDestination);
    } catch {
      // A browser may reject reusing a media element; the direct track remains
      // available as a fallback for the publisher.
      this.audioSource = null;
    }
  }

  async startLive(): Promise<void> {
    if (this.peer?.connectionState === 'connected') {
      await this.prepareAudio();
      return;
    }
    if (this.connecting) return this.connecting;

    this.closedByUser = false;
    this.connecting = (async () => {
      await setMuseTalkAvatar(rendererProfile(this.options.profile));
      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => this.attachTrack(event.track);
      peer.onconnectionstatechange = () => {
        if (!this.closedByUser && (peer.connectionState === 'failed' || peer.connectionState === 'disconnected')) {
          this.setStage('error');
        }
      };

      const firstFrame = this.waitForFirstFrame();
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      if (!peer.localDescription) throw new Error('MuseTalk WebRTC offer 生成失败');
      const answer = await offerMuseTalk(peer.localDescription.sdp, peer.localDescription.type);
      if (answer.type !== 'answer') throw new Error('MuseTalk WebRTC answer 类型无效');
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      await Promise.all([this.waitForConnection(peer), firstFrame]);
      await this.prepareAudio();
    })();

    try {
      await this.connecting;
    } catch (error) {
      await this.closePeer();
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const session = await api.createSession({ title: 'MuseTalk 实时对话' });
    this.sessionId = session.id;
    return session.id;
  }

  private async waitForSpeech(requestId: string, generation: number): Promise<void> {
    const deadline = performance.now() + SPEECH_TIMEOUT_MS;
    while (performance.now() < deadline) {
      this.assertCurrent(generation);
      const health = await getMuseTalkHealth();
      const timing = health.last_timing as Record<string, unknown> | null;
      if (timing && String(timing.request_id ?? '') === String(requestId)) {
        const state = String(timing.state || '');
        if (state === 'completed') return;
        if (state === 'failed') throw new Error(errorDetail(timing, 'MuseTalk 播报失败'));
        if (state === 'interrupted' || state === 'cancelled') throw new Error('MuseTalk 播报已取消');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error('MuseTalk 播报等待超时');
  }

  private async playText(text: string, generation: number): Promise<void> {
    this.assertCurrent(generation);
    await this.prepareAudio();
    this.setStage('tts_start');
    const queued = await speakMuseTalk(text, true, 'auto');
    this.assertCurrent(generation);
    await this.options.onPlaybackReady?.();
    this.assertCurrent(generation);
    this.setMediaActive(true);
    this.setStage('playing');
    await this.waitForSpeech(queued.requestId, generation);
  }

  private beginOperation(): number {
    if (this.activeOperation) throw new Error('MuseTalk 正在处理上一条内容');
    this.activeOperation = true;
    this.operationGeneration += 1;
    return this.operationGeneration;
  }

  private async finishOperation(generation: number) {
    if (generation !== this.operationGeneration) return;
    this.activeOperation = false;
    const callback = this.options.onPlaybackFinished;
    let timeout: number | null = null;
    try {
      if (callback) {
        await Promise.race([
          Promise.resolve().then(() => callback()),
          new Promise<void>((resolve) => {
            timeout = window.setTimeout(resolve, PLAYBACK_HANDOFF_TIMEOUT_MS);
          }),
        ]);
      }
    } catch {
      // UI handoff failures must not leave the request and input permanently locked.
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      if (generation === this.operationGeneration) {
        this.setMediaActive(false);
        this.setStage('idle');
      }
    }
  }

  async ask(question: string): Promise<MuseTalkTotalResult> {
    await this.startLive();
    const generation = this.beginOperation();
    const startedAt = performance.now();
    try {
      this.setStage('llm_start');
      const sessionId = await this.ensureSession();
      this.assertCurrent(generation);
      const result = await api.answer(sessionId, { question, speak: false });
      this.assertCurrent(generation);
      this.options.onTextUnit?.(result.answer, result.answer);
      await this.playText(result.answer, generation);
      return {
        answer: result.answer,
        llmLatencyMs: result.llm_latency_ms,
        totalLatencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      if (generation === this.operationGeneration) this.setStage('error');
      throw error;
    } finally {
      await this.finishOperation(generation);
    }
  }

  async speak(text: string): Promise<MuseTalkTotalResult> {
    await this.startLive();
    const generation = this.beginOperation();
    const startedAt = performance.now();
    try {
      await this.playText(text, generation);
      return {
        answer: text,
        llmLatencyMs: 0,
        totalLatencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      if (generation === this.operationGeneration) this.setStage('error');
      throw error;
    } finally {
      await this.finishOperation(generation);
    }
  }

  async cancel(): Promise<void> {
    this.operationGeneration += 1;
    this.activeOperation = false;
    await interruptMuseTalk();
    this.setMediaActive(false);
    this.setStage('idle');
  }

  private async closePeer() {
    this.clearFirstFrameWait();
    if (this.drawFrameId !== null) {
      if (this.drawFrameKind === 'timeout') window.clearTimeout(this.drawFrameId);
      else window.cancelAnimationFrame(this.drawFrameId);
    }
    this.drawFrameId = null;
    this.drawFrameKind = null;
    if (this.visibilityListenerAttached) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('blur', this.handleVisibilityChange);
      window.removeEventListener('focus', this.handleVisibilityChange);
      this.visibilityListenerAttached = false;
    }
    this.video?.pause();
    this.audio?.pause();
    this.audioSource?.disconnect();
    this.audioSource = null;
    if (this.video) this.video.srcObject = null;
    if (this.audio) this.audio.srcObject = null;
    this.video = null;
    this.audio = null;
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null;
    this.audioCaptureDestination = null;
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.getSenders().forEach((sender) => sender.track?.stop());
      peer.getReceivers().forEach((receiver) => receiver.track?.stop());
      peer.close();
    }
  }

  async stopLive(): Promise<void> {
    this.closedByUser = true;
    this.operationGeneration += 1;
    this.activeOperation = false;
    await interruptMuseTalk();
    await this.closePeer();
    this.setMediaActive(false);
    this.setStage('idle');
  }
}
