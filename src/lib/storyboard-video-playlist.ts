"use client";

export type StoryboardVideoItem = { id: number; title: string; url: string };

type StoryboardVideoPlaylistOptions = {
  items: StoryboardVideoItem[];
  loop: boolean;
  onItem: (item: StoryboardVideoItem | null, status: 'playing' | 'paused' | 'finished') => void;
  onError: (message: string) => void;
};

/** Plays downloaded storyboard videos through one persistent video and audio track. */
export class StoryboardVideoPlaylist {
  readonly video: HTMLVideoElement;
  readonly audioTrack: MediaStreamTrack;
  private readonly options: StoryboardVideoPlaylistOptions;
  private readonly context: AudioContext;
  private index = -1;
  private failures = 0;
  private generation = 0;
  private stopped = false;
  private loadingTimer: number | null = null;

  constructor(options: StoryboardVideoPlaylistOptions) {
    if (!options.items.length) throw new Error('没有可播放的分镜成片');
    this.options = options;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-2px;top:-2px';
    document.body.appendChild(this.video);
    try {
      this.context = new AudioContext();
      const destination = this.context.createMediaStreamDestination();
      this.context.createMediaElementSource(this.video).connect(destination);
      this.audioTrack = destination.stream.getAudioTracks()[0];
      if (!this.audioTrack) throw new Error('浏览器无法建立分镜音频轨');
    } catch (error) {
      this.video.remove();
      throw error;
    }
    this.video.addEventListener('ended', this.handleEnded);
    this.video.addEventListener('error', this.handleError);
    this.video.addEventListener('playing', this.handlePlaying);
  }

  start() {
    // Both calls begin inside the click handler to retain browser playback permission.
    void this.context.resume().catch(() => this.options.onError('浏览器无法启动分镜音频，请重新打开节目窗口'));
    this.playIndex(0);
    return this.audioTrack;
  }

  pause() {
    if (this.stopped || this.index < 0 || this.video.paused) return;
    this.video.pause();
    this.clearLoadingTimer();
    this.options.onItem(this.options.items[this.index], 'paused');
  }

  resume() {
    if (this.stopped || this.index < 0 || !this.video.paused) return;
    void this.context.resume();
    this.playIndex(this.index, true);
  }

  skip() {
    if (!this.stopped) this.advance();
  }

  restart() {
    if (this.stopped) return;
    this.failures = 0;
    this.playIndex(0);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.clearLoadingTimer();
    this.video.pause();
    this.video.removeEventListener('ended', this.handleEnded);
    this.video.removeEventListener('error', this.handleError);
    this.video.removeEventListener('playing', this.handlePlaying);
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    this.audioTrack.stop();
    void this.context.close();
  }

  private playIndex(index: number, resume = false) {
    if (this.stopped) return;
    this.clearLoadingTimer();
    this.index = index;
    const generation = ++this.generation;
    const item = this.options.items[index];
    this.options.onItem(item, 'playing');
    if (!resume) {
      this.video.src = item.url;
      this.video.load();
    }
    this.loadingTimer = window.setTimeout(() => this.fail(generation, '加载超时'), 25_000);
    void this.video.play().catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      this.fail(generation, cause instanceof Error ? cause.message : '无法播放');
    });
  }

  private advance() {
    this.clearLoadingTimer();
    const next = this.index + 1;
    if (next >= this.options.items.length && !this.options.loop) {
      this.video.pause();
      this.options.onItem(this.options.items[this.index], 'finished');
      return;
    }
    this.playIndex(next % this.options.items.length);
  }

  private fail(generation: number, reason: string) {
    if (this.stopped || generation !== this.generation) return;
    this.failures += 1;
    const title = this.options.items[this.index].title;
    if (this.failures >= this.options.items.length) {
      this.options.onError(`全部分镜成片都无法播放，最后失败的是“${title}”：${reason}`);
      return;
    }
    this.advance();
  }

  private clearLoadingTimer() {
    if (this.loadingTimer !== null) window.clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
  }

  private readonly handlePlaying = () => {
    this.failures = 0;
    this.clearLoadingTimer();
  };
  private readonly handleEnded = () => { if (!this.stopped) this.advance(); };
  private readonly handleError = () => this.fail(this.generation, '视频文件读取失败');
}
