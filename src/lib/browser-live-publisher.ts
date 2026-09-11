import {
  ChromaKeyRenderer,
  normalizeChromaKeySettings,
  type ChromaKeySettings,
} from './chroma-key';
import { layersBackToFront } from './live-layer-order';

export type BroadcastSceneLayer = {
  id: string;
  kind: 'text' | 'image' | 'video' | 'host';
  value: string;
  sceneKey?: string;
  preview?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  letterSpacing?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  chromaKeyEnabled?: boolean;
  chromaKeyColor?: string;
  chromaKeyTolerance?: number;
  chromaKeySoftness?: number;
};

export type BroadcastSceneSnapshot = {
  layers: BroadcastSceneLayer[];
  backgroundUrl: string;
  loopVideoUrl?: string;
  hostUrl: string;
  mediaActive: boolean;
  productCard?: {
    title: string;
    price?: number;
    originalPrice?: number;
    sellingPoints?: string[];
  };
};

export type BrowserPublisherState = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'stopped';

type BrowserLivePublisherOptions = {
  endpoint: string;
  sourceCanvas: HTMLCanvasElement;
  resolution: string;
  frameRate: number;
  orientation?: 'portrait' | 'landscape';
  audioTrack: MediaStreamTrack | null;
  getScene: () => BroadcastSceneSnapshot;
  onState?: (state: BrowserPublisherState, message?: string) => void;
};

const CONNECTION_TIMEOUT_MS = 15_000;
const MAX_RECONNECTS = 4;

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
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

function preferCodec(transceiver: RTCRtpTransceiver, kind: 'audio' | 'video', mimeType: string) {
  if (!transceiver.setCodecPreferences || !RTCRtpSender.getCapabilities) return;
  const codecs = RTCRtpSender.getCapabilities(kind)?.codecs ?? [];
  const preferred = codecs.filter((codec) => codec.mimeType.toLowerCase() === mimeType.toLowerCase());
  if (preferred.length) transceiver.setCodecPreferences(preferred);
}

class WhipSession {
  private peer: RTCPeerConnection | null = null;
  private resourceUrl = '';
  private stopped = false;

  constructor(
    private readonly endpoint: string,
    private readonly onDisconnected: (message: string) => void,
  ) {}

  async start(stream: MediaStream): Promise<void> {
    this.stopped = false;
    const peer = new RTCPeerConnection();
    this.peer = peer;
    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0];
    if (!video || !audio) throw new Error('浏览器最终画面必须同时包含视频和音频轨');
    const videoTransceiver = peer.addTransceiver(video, { direction: 'sendonly', streams: [stream] });
    const audioTransceiver = peer.addTransceiver(audio, { direction: 'sendonly', streams: [stream] });
    preferCodec(videoTransceiver, 'video', 'video/H264');
    preferCodec(audioTransceiver, 'audio', 'audio/opus');

    peer.onconnectionstatechange = () => {
      if (this.stopped) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        this.onDisconnected(`WHIP 连接${peer.connectionState === 'failed' ? '失败' : '中断'}`);
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    if (!peer.localDescription?.sdp) throw new Error('无法生成 WHIP SDP offer');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
      body: peer.localDescription.sdp,
    });
    if (!response.ok) throw new Error(`SRS WHIP 信令失败（HTTP ${response.status}）`);
    const answer = await response.text();
    if (!answer.trim()) throw new Error('SRS WHIP 未返回 SDP answer');
    const location = response.headers.get('Location');
    if (location) this.resourceUrl = new URL(location, new URL(this.endpoint, window.location.href)).toString();
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    await this.waitForConnected(peer);
  }

  private waitForConnected(peer: RTCPeerConnection): Promise<void> {
    if (peer.connectionState === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('WHIP 媒体连接超时')), CONNECTION_TIMEOUT_MS);
      const handleChange = () => {
        if (peer.connectionState === 'connected') finish();
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          finish(new Error(`WHIP 媒体连接失败（${peer.connectionState}）`));
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

  async stop(): Promise<void> {
    this.stopped = true;
    const peer = this.peer;
    this.peer = null;
    peer?.close();
    if (!this.resourceUrl) return;
    const resourceUrl = this.resourceUrl;
    this.resourceUrl = '';
    try {
      await fetch(resourceUrl, { method: 'DELETE', keepalive: true });
    } catch {
      // Closing the peer still lets SRS expire the publisher session.
    }
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    const sender = this.peer?.getSenders().find((candidate) => candidate.track?.kind === 'audio');
    if (!sender) throw new Error('WHIP 音频发送器尚未就绪');
    await sender.replaceTrack(track);
  }
}

function outputDimensions(resolution: string, orientation: 'portrait' | 'landscape' = 'portrait'): { width: number; height: number } {
  const portrait = resolution.toLowerCase() === '4k'
    ? { width: 2160, height: 3840 }
    : { width: 1080, height: 1920 };
  return orientation === 'landscape'
    ? { width: portrait.height, height: portrait.width }
    : portrait;
}

function sourceDimensions(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  const source = image as unknown as {
    width?: number;
    height?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  return {
    width: source.width ?? source.displayWidth ?? 0,
    height: source.height ?? source.displayHeight ?? 0,
  };
}

function drawCover(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number) {
  const { width: sourceWidth, height: sourceHeight } = sourceDimensions(image);
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawContain(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number) {
  const { width: sourceWidth, height: sourceHeight } = sourceDimensions(image);
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
}

export function layerChromaKeySettings(
  layer: Pick<BroadcastSceneLayer, 'chromaKeyEnabled' | 'chromaKeyColor' | 'chromaKeyTolerance' | 'chromaKeySoftness'> | null | undefined,
): ChromaKeySettings {
  return normalizeChromaKeySettings({
    enabled: layer?.chromaKeyEnabled,
    color: layer?.chromaKeyColor,
    tolerance: layer?.chromaKeyTolerance,
    softness: layer?.chromaKeySoftness,
  });
}

export class SceneCompositor {
  private readonly canvas = document.createElement('canvas');
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly videos = new Map<string, HTMLVideoElement>();
  private readonly keyedHostCanvas = document.createElement('canvas');
  private readonly keyedHostRenderer = new ChromaKeyRenderer(this.keyedHostCanvas);
  private frameTimer: number | null = null;
  private stream: MediaStream | null = null;

  constructor(
    private readonly sourceCanvas: HTMLCanvasElement,
    private readonly resolution: string,
    private readonly frameRate: number,
    private readonly getScene: () => BroadcastSceneSnapshot,
    private readonly orientation: 'portrait' | 'landscape' = 'portrait',
  ) {
    const { width, height } = outputDimensions(resolution, orientation);
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.001;pointer-events:none;left:-2px;top:-2px';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  start(): MediaStream {
    if (!this.canvas.captureStream) throw new Error('当前浏览器不支持 Canvas 实时媒体输出');
    document.body.appendChild(this.canvas);
    this.draw();
    this.frameTimer = window.setInterval(() => this.draw(), 1000 / this.frameRate);
    this.stream = this.canvas.captureStream(this.frameRate);
    return this.stream;
  }

  stop() {
    if (this.frameTimer !== null) window.clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.stream?.getVideoTracks().forEach((track) => track.stop());
    this.stream = null;
    this.videos.forEach((video) => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    this.videos.clear();
    this.canvas.remove();
  }

  private image(url: string): HTMLImageElement | null {
    if (!url) return null;
    const cached = this.images.get(url);
    if (cached) return cached.complete && cached.naturalWidth ? cached : null;
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    this.images.set(url, image);
    return null;
  }

  private loopVideo(url: string): HTMLVideoElement | null {
    if (!url) return null;
    let video = this.videos.get(url);
    if (!video) {
      video = document.createElement('video');
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.crossOrigin = 'anonymous';
      video.src = url;
      this.videos.set(url, video);
      video.load();
    }
    if (video.paused) void video.play().catch(() => undefined);
    return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight
      ? video
      : null;
  }

  private draw() {
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) return;
    const { width, height } = this.canvas;
    const scene = this.getScene();
    context.fillStyle = '#7ec9f0';
    context.fillRect(0, 0, width, height);
    const loopVideo = scene.loopVideoUrl ? this.loopVideo(scene.loopVideoUrl) : null;
    if (loopVideo) {
      drawCover(context, loopVideo, width, height);
    } else {
      const background = this.image(scene.backgroundUrl);
      if (background) drawCover(context, background, width, height);
    }

    layersBackToFront(scene.layers).forEach((layer) => {
      if (layer.sceneKey === 'templateBackground') return;
      if (layer.sceneKey === 'host') {
        if (scene.loopVideoUrl) return;
        const liveSource = scene.mediaActive && this.sourceCanvas.width && this.sourceCanvas.height
          ? this.sourceCanvas
          : this.image(scene.hostUrl);
        if (!liveSource) return;
        let hostSource = liveSource;
        const chromaKey = layerChromaKeySettings(layer);
        if (!scene.mediaActive && chromaKey.enabled) {
          const dimensions = sourceDimensions(liveSource);
          this.keyedHostRenderer.render(
            liveSource as HTMLCanvasElement | HTMLImageElement,
            dimensions.width,
            dimensions.height,
            chromaKey,
          );
          hostSource = this.keyedHostCanvas;
        }
        this.drawVisualLayer(context, layer, hostSource, 'contain');
        return;
      }
      if (layer.kind === 'text') this.drawTextLayer(context, layer);
      if (layer.kind === 'image' && layer.preview) {
        const image = this.image(layer.preview);
        if (image) this.drawVisualLayer(context, layer, image, 'contain');
      }
    });
    if (scene.productCard) this.drawProductCard(context, scene.productCard);
  }

  private drawProductCard(context: CanvasRenderingContext2D, card: NonNullable<BroadcastSceneSnapshot['productCard']>) {
    const width = this.canvas.width * 0.86;
    const height = this.canvas.height * 0.14;
    const left = this.canvas.width * 0.07;
    const top = this.canvas.height * 0.81;
    context.save();
    context.fillStyle = 'rgba(10, 14, 17, .86)';
    context.fillRect(left, top, width, height);
    context.fillStyle = '#ffffff';
    context.font = `600 ${Math.max(22, this.canvas.width / 30)}px sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(card.title.slice(0, 28), left + width * 0.04, top + height * 0.16, width * 0.58);
    if (typeof card.price === 'number') {
      context.fillStyle = '#ffcf4a';
      context.font = `700 ${Math.max(26, this.canvas.width / 24)}px sans-serif`;
      context.fillText(`¥${card.price.toFixed(2)}`, left + width * 0.04, top + height * 0.52, width * 0.42);
    }
    const points = (card.sellingPoints ?? []).filter(Boolean).slice(0, 2).join(' · ');
    if (points) {
      context.fillStyle = '#b8c6c8';
      context.font = `${Math.max(16, this.canvas.width / 48)}px sans-serif`;
      context.fillText(points.slice(0, 40), left + width * 0.04, top + height * 0.78, width * 0.86);
    }
    context.restore();
  }

  private withLayer(context: CanvasRenderingContext2D, layer: BroadcastSceneLayer, draw: (width: number, height: number) => void) {
    const width = this.canvas.width * layer.width / 100;
    const height = this.canvas.height * layer.height / 100;
    context.save();
    context.translate(this.canvas.width * layer.x / 100, this.canvas.height * layer.y / 100);
    context.rotate(layer.rotation * Math.PI / 180);
    context.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));
    draw(width, height);
    context.restore();
  }

  private drawVisualLayer(
    context: CanvasRenderingContext2D,
    layer: BroadcastSceneLayer,
    image: CanvasImageSource,
    fit: 'contain' | 'cover',
  ) {
    this.withLayer(context, layer, (width, height) => {
      if (fit === 'cover') drawCover(context, image, width, height);
      else drawContain(context, image, width, height);
    });
  }

  private drawTextLayer(context: CanvasRenderingContext2D, layer: BroadcastSceneLayer) {
    this.withLayer(context, layer, (width, height) => {
      const scale = this.canvas.width / 340;
      const fontSize = Math.max(20, (layer.fontSize ?? 16) * scale);
      const lineHeight = fontSize * (layer.lineHeight ?? 1.2);
      context.font = `${layer.fontStyle ?? 'normal'} ${layer.fontWeight ?? 'normal'} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`;
      context.fillStyle = layer.color || '#ffffff';
      context.textAlign = layer.textAlign || 'center';
      context.textBaseline = 'middle';
      const words = Array.from(layer.value);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (context.measureText(current + word).width <= width || !current) current += word;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      const visible = lines.slice(0, Math.max(1, Math.floor(height / lineHeight)));
      const x = context.textAlign === 'left' ? -width / 2 : context.textAlign === 'right' ? width / 2 : 0;
      const startY = -(visible.length - 1) * lineHeight / 2;
      visible.forEach((line, index) => context.fillText(line, x, startY + index * lineHeight, width));
    });
  }
}

function createSilentAudio(): { context: AudioContext; track: MediaStreamTrack } {
  const context = new AudioContext({ sampleRate: 48_000 });
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  return { context, track: destination.stream.getAudioTracks()[0] };
}

export class BrowserLivePublisher {
  private readonly compositor: SceneCompositor;
  private mediaStream: MediaStream | null = null;
  private whip: WhipSession | null = null;
  private silentAudio: { context: AudioContext; track: MediaStreamTrack } | null = null;
  private reconnectTimer: number | null = null;
  private reconnectCount = 0;
  private stopped = false;

  constructor(private readonly options: BrowserLivePublisherOptions) {
    this.compositor = new SceneCompositor(
      options.sourceCanvas,
      options.resolution,
      options.frameRate,
      options.getScene,
      options.orientation,
    );
  }

  async start(): Promise<void> {
    this.stopped = false;
    const stream = this.compositor.start();
    let audioTrack = this.options.audioTrack;
    if (!audioTrack || audioTrack.readyState !== 'live') {
      this.silentAudio = createSilentAudio();
      audioTrack = this.silentAudio.track;
    }
    stream.addTrack(audioTrack);
    this.mediaStream = stream;
    await this.connect(false);
  }

  private async connect(reconnecting: boolean): Promise<void> {
    if (this.stopped || !this.mediaStream) return;
    this.options.onState?.(reconnecting ? 'reconnecting' : 'connecting');
    const session = new WhipSession(this.options.endpoint, (message) => this.scheduleReconnect(message));
    this.whip = session;
    try {
      await session.start(this.mediaStream);
      if (this.stopped || this.whip !== session) {
        await session.stop();
        return;
      }
      this.reconnectCount = 0;
      this.options.onState?.('live');
    } catch (error) {
      await session.stop();
      if (this.whip === session) this.whip = null;
      if (!reconnecting) throw error;
      this.scheduleReconnect(error instanceof Error ? error.message : 'WHIP 重连失败');
    }
  }

  private scheduleReconnect(message: string) {
    if (this.stopped || this.reconnectTimer !== null) return;
    if (this.reconnectCount >= MAX_RECONNECTS) {
      this.options.onState?.('failed', `${message}，已达到最大重连次数`);
      return;
    }
    const delay = Math.min(5_000, 1_000 * (2 ** this.reconnectCount));
    this.reconnectCount += 1;
    this.options.onState?.('reconnecting', `${message}，${Math.round(delay / 1000)} 秒后重试`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      const previous = this.whip;
      this.whip = null;
      void previous?.stop().finally(() => void this.connect(true));
    }, delay);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const whip = this.whip;
    this.whip = null;
    await whip?.stop();
    this.compositor.stop();
    this.mediaStream = null;
    if (this.silentAudio) {
      this.silentAudio.track.stop();
      await this.silentAudio.context.close();
      this.silentAudio = null;
    }
    this.options.onState?.('stopped');
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.whip) throw new Error('浏览器媒体推流尚未连接');
    await this.whip.replaceAudioTrack(track);
    const previous = this.mediaStream?.getAudioTracks() ?? [];
    previous.forEach((candidate) => {
      if (candidate !== track) this.mediaStream?.removeTrack(candidate);
    });
    this.mediaStream?.addTrack(track);
  }
}
