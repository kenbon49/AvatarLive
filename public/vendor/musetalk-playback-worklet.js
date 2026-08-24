class MuseTalkPlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.chunk = null;
    this.offset = 0;
    this.playing = false;
    this.ended = false;
    this.delaySamples = 0;
    this.underrunBlocks = 0;
    this.processedSamples = 0;
    this.lastMetricsAt = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data || {});
  }

  reset() {
    this.queue = [];
    this.chunk = null;
    this.offset = 0;
    this.playing = false;
    this.ended = false;
    this.delaySamples = 0;
    this.underrunBlocks = 0;
    this.processedSamples = 0;
    this.lastMetricsAt = 0;
  }

  handleMessage(message) {
    if (message.type === 'stop') {
      this.reset();
      return;
    }
    if (message.type === 'enqueue' && message.data instanceof ArrayBuffer) {
      this.queue.push(new Int16Array(message.data));
      return;
    }
    if (message.type === 'start') {
      this.delaySamples = Math.max(0, Number(message.delaySamples) || 0);
      this.playing = true;
      this.port.postMessage({ type: 'playback-started' });
      return;
    }
    if (message.type === 'end') this.ended = true;
  }

  queuedSamples() {
    let total = this.chunk ? Math.max(0, this.chunk.length - this.offset) : 0;
    for (const chunk of this.queue) total += chunk.length;
    return total;
  }

  reportMetrics() {
    this.port.postMessage({
      type: 'metrics',
      queuedSamples: this.queuedSamples(),
      underrunBlocks: this.underrunBlocks,
      processedSamples: this.processedSamples,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    if (!this.playing) return true;

    let outputOffset = 0;
    if (this.delaySamples > 0) {
      const silent = Math.min(output.length, this.delaySamples);
      this.delaySamples -= silent;
      outputOffset += silent;
    }

    while (outputOffset < output.length) {
      if (!this.chunk || this.offset >= this.chunk.length) {
        this.chunk = this.queue.shift() || null;
        this.offset = 0;
        if (!this.chunk) {
          if (this.ended) {
            this.playing = false;
            this.reportMetrics();
            this.port.postMessage({ type: 'playback-ended' });
          } else if (this.delaySamples === 0) {
            this.underrunBlocks += 1;
          }
          break;
        }
      }
      const count = Math.min(output.length - outputOffset, this.chunk.length - this.offset);
      for (let index = 0; index < count; index += 1) {
        output[outputOffset + index] = this.chunk[this.offset + index] / 32768;
      }
      outputOffset += count;
      this.offset += count;
    }

    this.processedSamples += output.length;
    if (this.processedSamples - this.lastMetricsAt >= sampleRate / 2) {
      this.lastMetricsAt = this.processedSamples;
      this.reportMetrics();
    }
    return true;
  }
}

registerProcessor('musetalk-playback-worklet', MuseTalkPlaybackWorklet);
