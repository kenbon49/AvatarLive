"use client";

export type WindowCaptureState = 'connecting' | 'live' | 'failed' | 'stopped';

type WindowCaptureSessionOptions = {
  popup: Window;
  sessionId: string;
  onState?: (state: WindowCaptureState, message?: string) => void;
};

const SIGNAL_TIMEOUT_MS = 15_000;

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const handleChange = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const finish = () => {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    };
    const timeout = window.setTimeout(finish, 5_000);
    peer.addEventListener('icegatheringstatechange', handleChange);
  });
}

/** Bridges the compositor media tracks to the visible output popup locally. */
export class WindowCaptureSession {
  private readonly peer: RTCPeerConnection;
  private readonly popup: Window;
  private readonly sessionId: string;
  private answerResolver: ((description: RTCSessionDescriptionInit) => void) | null = null;
  private answerRejecter: ((error: Error) => void) | null = null;
  private popupReadyRejecter: ((error: Error) => void) | null = null;
  private popupReadyCleanup: (() => void) | null = null;
  private signalTimer: number | null = null;
  private closed = false;

  constructor(private readonly options: WindowCaptureSessionOptions) {
    this.popup = options.popup;
    this.sessionId = options.sessionId;
    if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持窗口采集媒体连接');
    this.peer = new RTCPeerConnection();
    window.addEventListener('message', this.handleMessage);
    this.peer.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.peer.connectionState === 'connected') options.onState?.('live');
      if (['failed', 'disconnected', 'closed'].includes(this.peer.connectionState)) {
        options.onState?.('failed', '节目输出窗口的媒体连接已断开');
      }
    };
  }

  async start(stream: MediaStream): Promise<void> {
    this.options.onState?.('connecting');
    stream.getTracks().forEach((track) => this.peer.addTrack(track, stream));
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    await waitForIceGathering(this.peer);
    await this.waitForPopupReady();
    const localDescription = this.peer.localDescription;
    if (!localDescription?.sdp) throw new Error('无法创建节目窗口媒体连接');
    const answerPromise = this.waitForAnswer();
    this.send({ type: 'offer', sessionId: this.sessionId, sdp: localDescription.sdp });
    const answer = await answerPromise;
    await this.peer.setRemoteDescription(answer);
    await this.waitForConnected();
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
    this.answerRejecter?.(new Error('节目输出窗口已关闭'));
    this.answerResolver = null;
    this.answerRejecter = null;
    this.peer.close();
    if (!this.popup.closed) {
      this.popup.postMessage({ type: 'stop', sessionId: this.sessionId }, window.location.origin);
      this.popup.close();
    }
    this.options.onState?.('stopped');
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== this.popup) return;
    const message = event.data as { type?: string; sessionId?: string; sdp?: string } | null;
    if (!message || message.sessionId !== this.sessionId) return;
    if (message.type === 'answer' && message.sdp) {
      this.answerResolver?.({ type: 'answer', sdp: message.sdp });
      this.answerResolver = null;
      this.answerRejecter = null;
    } else if (message.type === 'program-closed' && !this.closed) {
      this.options.onState?.('failed', '节目输出窗口已关闭');
    }
  };

  private send(message: { type: string; sessionId: string; sdp?: string }) {
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

  private waitForAnswer(): Promise<RTCSessionDescriptionInit> {
    return new Promise((resolve, reject) => {
      this.answerResolver = resolve;
      this.answerRejecter = reject;
      window.setTimeout(() => {
        if (!this.answerResolver) return;
        this.answerResolver = null;
        this.answerRejecter = null;
        reject(new Error('节目输出窗口媒体连接超时'));
      }, SIGNAL_TIMEOUT_MS);
    });
  }

  private waitForConnected(): Promise<void> {
    if (this.peer.connectionState === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('节目输出窗口媒体连接超时')), SIGNAL_TIMEOUT_MS);
      const handleChange = () => {
        if (this.peer.connectionState === 'connected') finish();
        else if (['failed', 'closed'].includes(this.peer.connectionState)) finish(new Error('节目输出窗口媒体连接失败'));
      };
      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        this.peer.removeEventListener('connectionstatechange', handleChange);
        if (error) reject(error);
        else resolve();
      };
      this.peer.addEventListener('connectionstatechange', handleChange);
    });
  }
}

export function openWindowCaptureWindow(sessionId: string, orientation: 'portrait' | 'landscape'): Window | null {
  const width = orientation === 'portrait' ? 420 : 960;
  const height = orientation === 'portrait' ? 780 : 620;
  const query = new URLSearchParams({ session: sessionId, orientation });
  return window.open(
    `/live/program?${query.toString()}`,
    `avatar-live-program-${sessionId}`,
    `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
  );
}
