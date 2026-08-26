import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AVATAR_MOTION_PROMPT,
  MAX_AVATAR_MOTION_PROMPT_LENGTH,
  buildAvatarMotionGenerationPrompt,
  cleanAvatarMotionPrompt,
  normalizeAvatarMotionDuration,
  normalizeAvatarMotionSettings,
} from '../src/lib/avatar-motion.ts';

test('normalizes stored motion settings into supported values', () => {
  assert.deepEqual(normalizeAvatarMotionSettings({
    prompt: '  挥手\n两次  ',
    mode: 'once',
    intensity: 'expressive',
    duration: '7.4',
  }), {
    prompt: '挥手 两次',
    mode: 'once',
    intensity: 'expressive',
    duration: 7,
  });
  assert.equal(normalizeAvatarMotionDuration(99), 8);
  assert.equal(normalizeAvatarMotionDuration(-4), 2);
});

test('cleans and bounds untrusted prompt text', () => {
  assert.equal(cleanAvatarMotionPrompt(' 点头\u0000  并微笑 '), '点头 并微笑');
  assert.equal(normalizeAvatarMotionSettings({ prompt: '' }).prompt, DEFAULT_AVATAR_MOTION_PROMPT);
  assert.equal(
    normalizeAvatarMotionSettings({ prompt: '动'.repeat(500) }).prompt.length,
    MAX_AVATAR_MOTION_PROMPT_LENGTH,
  );
});

test('builds a constrained prompt with requested timing and loop behavior', () => {
  const prompt = buildAvatarMotionGenerationPrompt({
    prompt: '抬起右手挥手两次',
    mode: 'loop',
    intensity: 'natural',
    duration: 5,
  });
  assert.match(prompt, /抬起右手挥手两次/);
  assert.match(prompt, /5 seconds/);
  assert.match(prompt, /seamless motion cycle/);
  assert.match(prompt, /mouth relaxed and mostly closed/);
  assert.match(prompt, /camera movement/);

  const oncePrompt = buildAvatarMotionGenerationPrompt({
    prompt: '点头一次',
    mode: 'once',
    intensity: 'subtle',
    duration: 3,
  });
  assert.match(oncePrompt, /Perform the requested gesture once over about 3 seconds/);
  assert.match(oncePrompt, /Keep the gesture restrained/);
});
