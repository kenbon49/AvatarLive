/** Controls local speaker monitoring without touching the captured output track. */
export class AudioMonitor {
  private gain: GainNode | null = null;
  private muted = false;

  attach(context: BaseAudioContext): GainNode {
    if (this.gain) return this.gain;
    const gain = context.createGain();
    gain.gain.value = this.muted ? 0 : 1;
    gain.connect(context.destination);
    this.gain = gain;
    return gain;
  }

  output(context: BaseAudioContext): AudioNode {
    return this.gain ?? context.destination;
  }

  setMuted(muted: boolean, context: BaseAudioContext | null): void {
    this.muted = muted;
    if (!context || !this.gain) return;
    this.gain.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
  }

  disconnect(): void {
    this.gain?.disconnect();
    this.gain = null;
  }
}
