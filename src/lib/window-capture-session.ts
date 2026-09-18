"use client";

export type WindowCaptureState = 'connecting' | 'live' | 'failed' | 'stopped';

type WindowCaptureSessionOptions = {
  popup: Window;
  sessionId: string;
  onState?: (state: WindowCaptureState, message?: string) => void;
};

type PictureInPictureCaptureSessionOptions = {
  onState?: (state: WindowCaptureState, message?: string) => void;
};

type ProgramWindow = Window & { __avatarProgramStream?: MediaStream | null };

const SIGNAL_TIMEOUT_MS = 15_000;

export function supportsPictureInPictureOutput(): boolean {
  return typeof document !== 'undefined'
    && document.pictureInPictureEnabled
    && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
}

/** Keeps the canvas stream unencoded between same-origin browser windows. */
export class WindowCaptureSession {
  private readonly popup: ProgramWindow;
  private readonly sessionId: string;
  private stream: MediaStream | null = null;
  private startedResolver: (() => void) | null = null;
  private startedRejecter: ((error: Error) => void) | null = null;
  private popupReadyRejecter: ((error: Error) => void) | null = null;
  private popupReadyCleanup: (() => void) | null = null;
  private signalTimer: number | null = null;
  private closed = false;

  constructor(private readonly options: WindowCaptureSessionOptions) {
    this.popup = options.popup;
    this.sessionId = options.sessionId;
    window.addEventListener('message', this.handleMessage);
  }

  async start(stream: MediaStream): Promise<void> {
    this.options.onState?.('connecting');
    this.stream = stream;
    await this.waitForPopupReady();
    if (this.closed || this.popup.closed) throw new Error('节目输出窗口已关闭');
    this.popup.__avatarProgramStream = stream;
    const started = this.waitForStarted();
    this.send({ type: 'direct-start', sessionId: this.sessionId });
    await started;
    this.options.onState?.('live');
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.signalTimer !== null) window.clearTimeout(this.signalTimer);
    this.signalTimer = null;
    window.removeEventListener('message', this.handleMessage);
    this.popupReadyRejecter?.(new Error('节目输出窗口已关闭'));
    this.popupReadyRejecter = null;
    this.popupReadyCleanup?.();
    this.popupReadyCleanup = null;
    this.startedRejecter?.(new Error('节目输出窗口已关闭'));
    this.startedResolver = null;
    this.startedRejecter = null;
    this.stream = null;
    if (!this.popup.closed) {
      try {
        this.send({ type: 'stop', sessionId: this.sessionId });
        this.popup.__avatarProgramStream = null;
      } catch {
        // The user may have navigated the output window to another origin.
      }
      this.popup.close();
    }
    this.options.onState?.('stopped');
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.stream || this.closed) throw new Error('节目输出窗口音频尚未就绪');
    this.stream = new MediaStream([...this.stream.getVideoTracks(), track]);
    if (this.popup.closed) throw new Error('节目输出窗口已关闭');
    this.popup.__avatarProgramStream = this.stream;
    this.send({ type: 'direct-start', sessionId: this.sessionId });
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== this.popup) return;
    const message = event.data as { type?: string; sessionId?: string; message?: string } | null;
    if (!message || message.sessionId !== this.sessionId) return;
    if (message.type === 'program-live') {
      this.startedResolver?.();
      this.startedResolver = null;
      this.startedRejecter = null;
    } else if (message.type === 'program-error') {
      this.startedRejecter?.(new Error(message.message || '节目窗口媒体播放失败'));
      this.startedResolver = null;
      this.startedRejecter = null;
    } else if (message.type === 'program-closed' && !this.closed) {
      this.options.onState?.('failed', '节目输出窗口已关闭');
    }
  };

  private send(message: { type: string; sessionId: string }) {
    if (this.popup.closed) throw new Error('节目输出窗口未打开或已关闭');
    this.popup.postMessage(message, window.location.origin);
  }

  private waitForPopupReady(): Promise<void> {
    if (this.popup.closed) return Promise.reject(new Error('节目输出窗口未打开或已关闭'));
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const readyHandler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== this.popup) return;
        const message = event.data as { type?: string; sessionId?: string } | null;
        if (message?.type !== 'program-ready' || message.sessionId !== this.sessionId) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.removeEventListener('message', readyHandler);
        if (this.signalTimer !== null) window.clearTimeout(this.signalTimer);
        this.signalTimer = null;
        this.popupReadyCleanup = null;
        this.popupReadyRejecter = null;
      };
      this.popupReadyCleanup = cleanup;
      this.popupReadyRejecter = reject;
      const poll = () => {
        if (this.popup.closed) {
          cleanup();
          reject(new Error('节目输出窗口未打开或已关闭'));
          return;
        }
        if (Date.now() - startedAt >= SIGNAL_TIMEOUT_MS) {
          cleanup();
          reject(new Error('节目输出窗口加载超时，请检查浏览器是否拦截了弹窗'));
          return;
        }
        this.signalTimer = window.setTimeout(poll, 250);
      };
      window.addEventListener('message', readyHandler);
      poll();
    });
  }

  private waitForStarted(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startedResolver = resolve;
      this.startedRejecter = reject;
      window.setTimeout(() => {
        if (!this.startedResolver) return;
        this.startedResolver = null;
        this.startedRejecter = null;
        reject(new Error('节目输出窗口媒体连接超时'));
      }, SIGNAL_TIMEOUT_MS);
    });
  }
}

/** Uses the browser's always-on-top video window without transcoding the canvas. */
export class PictureInPictureCaptureSession {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private closed = false;

  constructor(private readonly options: PictureInPictureCaptureSessionOptions) {}

  async start(stream: MediaStream): Promise<void> {
    if (!supportsPictureInPictureOutput()) throw new Error('当前浏览器不支持置顶画中画，请选择普通窗口');
    this.options.onState?.('connecting');
    const video = document.createElement('video');
    video.playsInline = true;
    video.autoplay = true;
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-2px;top:-2px';
    video.srcObject = stream;
    video.addEventListener('leavepictureinpicture', this.handleLeave);
    document.body.appendChild(video);
    this.video = video;
    this.stream = stream;
    try {
      await video.play();
      await video.requestPictureInPicture();
      if (this.closed) throw new Error('置顶画中画已关闭');
      this.options.onState?.('live');
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    const video = this.video;
    this.video = null;
    this.stream = null;
    if (video) {
      video.removeEventListener('leavepictureinpicture', this.handleLeave);
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => undefined);
      video.pause();
      video.srcObject = null;
      video.remove();
    }
    this.options.onState?.('stopped');
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.stream || !this.video || this.closed) throw new Error('置顶画中画音频尚未就绪');
    this.stream = new MediaStream([...this.stream.getVideoTracks(), track]);
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  private readonly handleLeave = () => {
    if (!this.closed) this.options.onState?.('failed', '置顶画中画已关闭');
  };
}

export function openWindowCaptureWindow(sessionId: string, orientation: 'portrait' | 'landscape'): Window | null {
  const width = orientation === 'portrait' ? 540 : 960;
  const height = orientation === 'portrait' ? 960 : 620;
  const query = new URLSearchParams({ session: sessionId, orientation });
  return window.open(
    `/live/program?${query.toString()}`,
    `avatar-live-program-${sessionId}`,
    `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
  );
}
