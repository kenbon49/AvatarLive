export type PlaybackQueueStatus = 'idle' | 'running' | 'paused';
export type PlaybackQueueMode = 'sequence' | 'random';

export type PlaybackQueueItem<Id extends string | number = string | number> = {
  id: Id;
  text: string;
};

export type PlaybackQueueItemState = 'ready' | 'playing' | 'done';

export type LivePlaybackQueueOptions<Id extends string | number> = {
  speak: (item: PlaybackQueueItem<Id>) => Promise<unknown>;
  cancel?: () => Promise<void> | void;
  onState?: (status: PlaybackQueueStatus, currentId: Id | null) => void;
  onItemState?: (id: Id, state: PlaybackQueueItemState) => void;
  onError?: (id: Id, error: unknown, attempt: number) => void;
  retryCount?: number;
  random?: () => number;
};

/** Coordinates one active utterance and makes queue cancellation race-safe. */
export class LivePlaybackQueue<Id extends string | number = string | number> {
  private readonly options: LivePlaybackQueueOptions<Id>;
  private items: PlaybackQueueItem<Id>[] = [];
  private order: number[] = [];
  private cursor = 0;
  private loop = false;
  private mode: PlaybackQueueMode = 'sequence';
  private token = 0;
  private pumpPromise: Promise<void> | null = null;
  private status: PlaybackQueueStatus = 'idle';
  private currentId: Id | null = null;
  private currentIndex: number | null = null;

  constructor(options: LivePlaybackQueueOptions<Id>) {
    this.options = options;
  }

  getStatus(): PlaybackQueueStatus {
    return this.status;
  }

  getCurrentId(): Id | null {
    return this.currentId;
  }

  async start(items: PlaybackQueueItem<Id>[], config: { mode?: PlaybackQueueMode; loop?: boolean } = {}): Promise<void> {
    await this.stop();
    this.items = items.filter((item) => item.text.trim());
    this.mode = config.mode ?? 'sequence';
    this.loop = config.loop ?? false;
    this.cursor = 0;
    this.currentIndex = null;
    this.order = this.items.map((_, index) => index);
    if (this.mode === 'random') this.shuffle(this.order);
    if (!this.items.length) return;
    const token = this.token;
    this.setStatus('running');
    this.pumpPromise = this.pump(token);
    await this.pumpPromise;
  }

  pause(): void {
    if (this.status === 'running') this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.setStatus('running');
    if (!this.pumpPromise) {
      const token = this.token;
      this.pumpPromise = this.pump(token);
    }
  }

  async stop(): Promise<void> {
    this.token += 1;
    const active = this.currentId !== null;
    if (active) {
      try {
        await Promise.resolve(this.options.cancel?.());
      } catch {
        // Cancellation is best effort; the generation token still fences old work.
      }
    }
    this.setItemState(this.currentId, 'ready');
    this.currentId = null;
    this.currentIndex = null;
    this.setStatus('idle');
    const pending = this.pumpPromise;
    this.pumpPromise = null;
    if (pending) await pending.catch(() => undefined);
  }

  async skip(): Promise<void> {
    if (this.currentId === null || this.currentIndex === null) return;
    const skippedId = this.currentId;
    this.token += 1;
    try {
      await Promise.resolve(this.options.cancel?.());
    } catch {
      // The skipped utterance is fenced below even if the renderer is already closed.
    }
    this.setItemState(skippedId, 'ready');
    this.currentId = null;
    this.currentIndex = null;
    this.pumpPromise = null;
    if (this.status === 'running') {
      const token = this.token;
      this.pumpPromise = this.pump(token);
    }
  }

  private async pump(token: number): Promise<void> {
    try {
      while (token === this.token) {
        if (this.status === 'paused') {
          await new Promise<void>((resolve) => {
            const check = () => {
              if (token !== this.token || this.status !== 'paused') resolve();
              else setTimeout(check, 20);
            };
            check();
          });
          continue;
        }
        const nextIndex = this.order[this.cursor];
        if (nextIndex === undefined) {
          if (!this.loop || !this.items.length) break;
          this.cursor = 0;
          this.order = this.items.map((_, index) => index);
          if (this.mode === 'random') this.shuffle(this.order);
          continue;
        }
        this.cursor += 1;
        const item = this.items[nextIndex];
        this.currentIndex = nextIndex;
        this.currentId = item.id;
        this.setItemState(item.id, 'playing');
        const maxRetries = Math.max(0, Math.floor(this.options.retryCount ?? 1));
        let completed = false;
        for (let attempt = 0; attempt <= maxRetries && token === this.token; attempt += 1) {
          try {
            await this.options.speak(item);
            completed = true;
            break;
          } catch (error) {
            if (token !== this.token) return;
            this.options.onError?.(item.id, error, attempt + 1);
            // A paused queue treats an interrupted utterance as deferred;
            // retrying immediately would restart speech while the operator
            // is taking over the microphone.
            if ((this.status as PlaybackQueueStatus) === 'paused') break;
          }
        }
        if (token !== this.token) return;
        this.setItemState(item.id, completed ? 'done' : 'ready');
        this.currentId = null;
        this.currentIndex = null;
      }
    } finally {
      if (token === this.token) {
        this.currentId = null;
        this.currentIndex = null;
        this.setStatus('idle');
      }
      if (this.pumpPromise) this.pumpPromise = null;
    }
  }

  private setStatus(status: PlaybackQueueStatus): void {
    this.status = status;
    this.options.onState?.(status, this.currentId);
  }

  private setItemState(id: Id | null, state: PlaybackQueueItemState): void {
    if (id !== null) this.options.onItemState?.(id, state);
  }

  private shuffle(values: number[]): void {
    const random = this.options.random ?? Math.random;
    for (let index = values.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [values[index], values[target]] = [values[target], values[index]];
    }
  }
}
