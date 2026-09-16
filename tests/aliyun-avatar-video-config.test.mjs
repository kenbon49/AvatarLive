import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLingMouVariables,
  normalizeLingMouVideoStatus,
  validateLingMouTemplateVariables,
} from '../src/lib/aliyun-avatar-video-config.ts';
import { scriptAvatarVideoInputSignature, scriptAvatarVideoIsBusy } from '../src/lib/script-avatar-video.ts';

test('builds the documented LingMou template variable payload', () => {
  assert.deepEqual(createLingMouVariables({
    text: '六堡茶口播',
    voiceOfficialId: 'M1-voice',
    avatarOfficialId: 'M1-avatar',
    names: { text: 'copy' },
  }), [
    { name: 'copy', type: 'text', properties: { content: '六堡茶口播' } },
    { type: 'voice', properties: { resourceId: 'M1-voice' } },
    { type: 'avatar', properties: { resourceId: 'M1-avatar' } },
  ]);
  assert.throws(() => createLingMouVariables({
    text: '六堡茶口播',
    voiceOfficialId: 'M1-voice',
    avatarOfficialId: 'M1-avatar',
    names: { text: '' },
  }), /变量名无效/);
});

test('rejects fixed templates before submitting chargeable video generation', () => {
  const names = { text: 'text' };
  assert.throws(() => validateLingMouTemplateVariables([], names), /未发布所需变量.*当前请求未提交合成/);
  assert.throws(() => validateLingMouTemplateVariables(undefined, names), /未发布所需变量/);
});

test('requires the configured text variable name and type', () => {
  const names = { text: 'copy' };
  const variables = [{ name: 'copy', type: 'text' }, { name: 'speaker', type: 'voice' }, { name: 'host', type: 'avatar' }];
  assert.doesNotThrow(() => validateLingMouTemplateVariables(variables, names));
  assert.throws(() => validateLingMouTemplateVariables([{ name: 'copy', type: 'voice' }], names), /变量类型不匹配/);
  assert.throws(() => validateLingMouTemplateVariables(variables, { text: 'wrong' }), /wrong\(text\)/);
});

test('normalizes LingMou task statuses for the live console', () => {
  assert.equal(normalizeLingMouVideoStatus('CREATED'), 'QUEUED');
  assert.equal(normalizeLingMouVideoStatus('PROCESSING'), 'PROCESSING');
  assert.equal(normalizeLingMouVideoStatus('SUCCESS'), 'SUCCESS');
  assert.equal(normalizeLingMouVideoStatus('FAILED'), 'ERROR');
  assert.equal(normalizeLingMouVideoStatus('CANCELLED'), 'CANCELED');
});

test('signs the script and its active avatar voice settings', () => {
  const input = {
    text: '六堡茶口播',
    avatarId: 'avatar-1',
    voiceId: 'voice-1',
    speechRate: 1.1,
    pitchRate: 3,
  };
  assert.equal(scriptAvatarVideoInputSignature(input), scriptAvatarVideoInputSignature({ ...input }));
  assert.notEqual(
    scriptAvatarVideoInputSignature(input),
    scriptAvatarVideoInputSignature({ ...input, text: '修改后的六堡茶口播' }),
  );
  assert.notEqual(
    scriptAvatarVideoInputSignature(input),
    scriptAvatarVideoInputSignature({ ...input, voiceId: 'voice-2' }),
  );
});

test('keeps the synthesis control busy through submission and cloud processing', () => {
  assert.equal(scriptAvatarVideoIsBusy('missing', true), true);
  assert.equal(scriptAvatarVideoIsBusy('submitting'), true);
  assert.equal(scriptAvatarVideoIsBusy('queued'), true);
  assert.equal(scriptAvatarVideoIsBusy('processing'), true);
  assert.equal(scriptAvatarVideoIsBusy('ready'), false);
  assert.equal(scriptAvatarVideoIsBusy('failed'), false);
});
