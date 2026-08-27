import assert from 'node:assert/strict';
import test from 'node:test';

import {
  avatarIdleVideo,
  avatarUsesSharedMuseTalkCycle,
} from '../src/lib/avatar-preview-media.ts';

function customAvatar(mode) {
  return {
    id: 'custom-test',
    profile: 'custom-test_job',
    language: 'ZH',
    name: '测试形象',
    role: '测试',
    description: '测试',
    image: '/custom.jpg',
    custom: true,
    video: {
      jobId: 'job',
      profile: 'custom-test_job',
      idleVideo: '/idle.mp4',
      talkVideo: '/talk.mp4',
      motion: mode ? { prompt: '挥手', mode, intensity: 'natural', duration: 4 } : undefined,
    },
  };
}

test('uses the complete generated video for looping and legacy custom avatars', () => {
  assert.equal(avatarIdleVideo(customAvatar('loop')), '/talk.mp4');
  assert.equal(avatarIdleVideo(customAvatar()), '/talk.mp4');
});

test('uses the neutral idle clip after a one-shot gesture', () => {
  assert.equal(avatarIdleVideo(customAvatar('once')), '/idle.mp4');
});

test('keeps curated idle media for built-in avatars', () => {
  assert.equal(avatarIdleVideo({
    id: 'chinese',
    profile: 'chinese',
    language: 'ZH',
    name: '中文女',
    role: '顾问',
    description: '内置',
    image: '/chinese.jpg',
  }), '/assets/musetalk-default/chinese2-cycle-4to7-d0853621.mp4');
});

test('only synchronizes source phase for the unchanged shared Chinese cycle', () => {
  const chinese = {
    id: 'chinese',
    profile: 'chinese',
    language: 'ZH',
    name: '中文女',
    role: '顾问',
    description: '内置',
    image: '/chinese.jpg',
  };
  assert.equal(avatarUsesSharedMuseTalkCycle(chinese), true);
  assert.equal(avatarUsesSharedMuseTalkCycle({ ...chinese, id: 'business-male-1' }), false);
  assert.equal(avatarUsesSharedMuseTalkCycle({
    ...chinese,
    video: customAvatar('loop').video,
  }), false);
});
