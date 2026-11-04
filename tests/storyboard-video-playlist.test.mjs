import assert from 'node:assert/strict';
import test from 'node:test';
import { StoryboardVideoPlaylist } from '../src/lib/storyboard-video-playlist.ts';

class FakeVideo extends EventTarget {
  style = {};
  paused = true;
  playsInline = false;
  preload = '';
  src = '';
  removed = false;
  playCalls = [];
  load() {}
  remove() { this.removed = true; }
  removeAttribute() { this.src = ''; }
  pause() { this.paused = true; }
  play() {
    this.playCalls.push(this.src);
    this.paused = false;
    return Promise.resolve();
  }
}

function setup(t) {
  const video = new FakeVideo();
  const track = { kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; } };
  const audio = { connected: false, closed: false, resumed: false };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalAudioContext = globalThis.AudioContext;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { createElement: () => video, body: { appendChild() {} } };
  globalThis.AudioContext = class {
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track] } }; }
    createMediaElementSource(element) {
      assert.equal(element, video);
      return { connect() { audio.connected = true; } };
    }
    resume() { audio.resumed = true; return Promise.resolve(); }
    close() { audio.closed = true; return Promise.resolve(); }
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.AudioContext = originalAudioContext;
  });
  return { video, track, audio };
}

const items = [
  { id: 1, title: '第一条', url: '/videos/1/media' },
  { id: 2, title: '第二条', url: '/videos/2/media' },
];

test('plays in storyboard order, loops with one persistent audio track, and cleans up', (t) => {
  const { video, track, audio } = setup(t);
  const states = [];
  const playlist = new StoryboardVideoPlaylist({ items, loop: true, onItem: (item, status) => states.push([item?.id, status]), onError: assert.fail });
  assert.equal(playlist.start(), track);
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('ended'));
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('ended'));
  assert.deepEqual(video.playCalls, [items[0].url, items[1].url, items[0].url]);
  assert.deepEqual(states, [[1, 'playing'], [2, 'playing'], [1, 'playing']]);
  assert.equal(audio.connected, true);
  assert.equal(audio.resumed, true);
  playlist.stop();
  assert.equal(track.readyState, 'ended');
  assert.equal(audio.closed, true);
  assert.equal(video.removed, true);
  video.dispatchEvent(new Event('ended'));
  assert.equal(video.playCalls.length, 3);
});

test('non-looping playlist holds the last frame and supports pause, resume and skip', (t) => {
  const { video } = setup(t);
  const states = [];
  const playlist = new StoryboardVideoPlaylist({ items, loop: false, onItem: (item, status) => states.push([item?.id, status]), onError: assert.fail });
  playlist.start();
  playlist.pause();
  assert.equal(video.paused, true);
  playlist.resume();
  playlist.skip();
  video.dispatchEvent(new Event('ended'));
  assert.deepEqual(states, [[1, 'playing'], [1, 'paused'], [1, 'playing'], [2, 'playing'], [2, 'finished']]);
  assert.equal(video.src, items[1].url);
  playlist.restart();
  assert.equal(video.src, items[0].url);
  playlist.stop();
});

test('skips an unreadable video and stops after all videos fail', (t) => {
  const { video } = setup(t);
  const errors = [];
  const playlist = new StoryboardVideoPlaylist({ items, loop: true, onItem() {}, onError: (message) => errors.push(message) });
  playlist.start();
  video.dispatchEvent(new Event('error'));
  assert.equal(video.src, items[1].url);
  video.dispatchEvent(new Event('error'));
  assert.match(errors[0], /全部分镜成片都无法播放/);
  assert.equal(video.playCalls.length, 2);
  playlist.stop();
});
