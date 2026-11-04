import { MUSETALK_URL } from '@/lib/api';

export interface MuseTalkStreamResult {
  requestId: number;
  queued: number;
  action: string;
  audioSeconds: number;
}

type ServerMessage = Record<string, unknown> & { type?: string };

function streamUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MUSETALK_STREAM_URL?.trim();
  const sameOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const value = configured || (sameOrigin ? '/musetalk-api/stream' : `${MUSETALK_URL}/stream`);
  const url = new URL(value, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function floatToPcm16(input: Float32Array, inputRate: number): ArrayBuffer {
  const outputLength = Math.max(1, Math.floor((input.length * 16_000) / inputRate));
  const pcm = new Int16Array(outputLength);
  const step = inputRate / 16_000;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * step;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    const sample = input[left] + (input[right] - input[left]) * fraction;
    pcm[index] = Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767));
  }
  return pcm.buffer as ArrayBuffer;
}

export class MuseTalkMicrophoneStream {
  private websocket: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private messages: ServerMessage[] = [];
  private waiter: ((message: ServerMessage) => void) | null = null;

  private nextMessage(): Promise<ServerMessage> {
    const queued = this.messages.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private pushMessage(message: ServerMessage) {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(message);
    } else {
      this.messages.push(message);
    }
  }

  private async expect(type: string): Promise<ServerMessage> {
    const message = await this.nextMessage();
    if (message.type === 'error') {
      throw new Error(String(message.message || message.code || 'MuseTalk stream failed'));
    }
    if (message.type !== type) {
      throw new Error(`MuseTalk stream expected ${type}, received ${String(message.type)}`);
    }
    return message;
  }

  async start(action: string): Promise<void> {
    if (this.websocket) throw new Error('麦克风流已经启动');
    const websocket = new WebSocket(streamUrl());
    websocket.binaryType = 'arraybuffer';
    this.websocket = websocket;
    websocket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.pushMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        this.pushMessage({ type: 'error', message: 'MuseTalk 返回了无效消息' });
      }
    };
    websocket.onerror = () => this.pushMessage({ type: 'error', message: 'MuseTalk 音频流连接失败' });
    websocket.onclose = () => {
      if (this.websocket === websocket) {
        this.pushMessage({ type: 'error', message: 'MuseTalk 音频流连接已关闭' });
      }
    };

    try {
      await new Promise<void>((resolve, reject) => {
        websocket.onopen = () => resolve();
        websocket.addEventListener('error', () => reject(new Error('无法连接 MuseTalk 音频流')), {
          once: true,
        });
      });
      await this.expect('ready');
      websocket.send(JSON.stringify({ type: 'start', action, interrupt: true }));
      await this.expect('started');

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext({ latencyHint: 'interactive' });
      await context.resume();
      const source = context.createMediaStreamSource(this.mediaStream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (websocket.readyState !== WebSocket.OPEN) return;
        websocket.send(floatToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      this.audioContext = context;
      this.source = source;
      this.processor = processor;
      this.mute = mute;
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }

  private async releaseCapture(): Promise<void> {
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mute?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.mediaStream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.mute = null;
  }

  async stop(): Promise<MuseTalkStreamResult> {
    const websocket = this.websocket;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      throw new Error('麦克风流尚未连接');
    }
    await this.releaseCapture();
    websocket.send(JSON.stringify({ type: 'commit' }));
    try {
      const message = await this.expect('queued');
      return {
        requestId: Number(message.request_id || 0),
        queued: Number(message.queued || 0),
        action: String(message.action || 'auto'),
        audioSeconds: Number(message.audio_seconds || 0),
      };
    } finally {
      websocket.close();
      this.websocket = null;
    }
  }

  getInputAudioTrack(): MediaStreamTrack | null {
    return this.mediaStream?.getAudioTracks()[0] ?? null;
  }

  async cancel(): Promise<void> {
    await this.releaseCapture();
    const websocket = this.websocket;
    this.websocket = null;
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: 'cancel' }));
      websocket.close();
    } else {
      websocket?.close();
    }
    this.messages = [];
    this.waiter = null;
  }
}
