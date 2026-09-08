import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioMonitor } from '../src/lib/audio-monitor.ts';

class FakeGainParam {
  value = 1;
  changes = [];

  setValueAtTime(value, time) {
    this.value = value;
    this.changes.push({ value, time });
  }
}

class FakeGainNode {
  gain = new FakeGainParam();
  connections = [];

  connect(destination) {
    this.connections.push(destination);
  }

  disconnect() {
    this.connections = [];
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 2.5;
    this.destination = { kind: 'speakers' };
    this.gain = new FakeGainNode();
  }

  createGain() {
    return this.gain;
  }

}

test('mutes and restores only the local speaker output', () => {
  const context = new FakeAudioContext();
  const monitor = new AudioMonitor();
  const output = monitor.attach(context);

  assert.equal(output, context.gain);
  assert.equal(monitor.output(context), context.gain);
  assert.equal(context.gain.connections[0], context.destination);
  monitor.setMuted(true, context);
  monitor.setMuted(false, context);
  assert.deepEqual(context.gain.gain.changes, [
    { value: 0, time: 2.5 },
    { value: 1, time: 2.5 },
  ]);
});

test('remembers mute state before the audio context is created', () => {
  const context = new FakeAudioContext();
  const monitor = new AudioMonitor();

  monitor.setMuted(true, null);
  const output = monitor.attach(context);
  assert.equal(output.gain.value, 0);
});
