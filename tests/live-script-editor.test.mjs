import assert from 'node:assert/strict';
import test from 'node:test';
import { SCRIPT_EDITOR_LIMIT, duplicateStoryboardScript, estimateScriptSeconds, formatScriptDuration, replaceScriptSelection, reviseStoryboardScript } from '../src/lib/live-script-editor.ts';

test('estimates duration using current speed without a one-minute cap', () => {
  assert.equal(formatScriptDuration(estimateScriptSeconds('茶'.repeat(1000), 1)), '05:50');
  assert.equal(estimateScriptSeconds('茶'.repeat(1000), 2), 175);
  assert.equal(estimateScriptSeconds('  ', 1), 0);
  assert.equal(estimateScriptSeconds('茶'.repeat(100), NaN), 35);
});

test('applies pronunciation corrections and punctuation at the selection', () => {
  assert.deepEqual(replaceScriptSelection('重庆六堡茶', 0, 2, '崇庆'), { text: '崇庆六堡茶', cursor: 2 });
  assert.deepEqual(replaceScriptSelection('六堡茶', 2, 2, '，'), { text: '六堡，茶', cursor: 3 });
  assert.deepEqual(replaceScriptSelection('六堡茶', 99, 99, '\n'), { text: '六堡茶\n', cursor: 4 });
  assert.throws(() => replaceScriptSelection('茶'.repeat(SCRIPT_EDITOR_LIMIT), 0, 0, '，'), /不能超过/);
});

test('inline revisions preserve the old video signature so it becomes stale', () => {
  const avatarVideo = { taskId: 'existing-task', inputSignature: 'old-text-signature' };
  const script = { id: 1, text: '原文', duration: '00:33', state: 'done', avatarVideo };
  assert.equal(reviseStoryboardScript(script, '原文', 1), script);
  const revised = reviseStoryboardScript(script, '茶'.repeat(1000), 1);
  assert.equal(revised.text.length, 1000);
  assert.equal(revised.duration, '05:50');
  assert.equal(revised.state, 'ready');
  assert.equal(revised.avatarVideo, avatarVideo);
});

test('duplicating a storyboard preserves its content and reusable video association', () => {
  const original = { id: 1, title: '茶叶介绍', text: '六堡茶', duration: '00:03', state: 'done', productId: 42, avatarVideo: { taskId: 'existing-task', inputSignature: 'existing-signature' } };
  const copy = duplicateStoryboardScript(original, 2);
  assert.equal(copy.id, 2);
  assert.equal(copy.title, '茶叶介绍 副本');
  assert.equal(copy.state, 'ready');
  assert.equal(copy.text, original.text);
  assert.equal(copy.productId, 42);
  assert.deepEqual(copy.avatarVideo, original.avatarVideo);
  assert.equal(original.id, 1);
  const revised = reviseStoryboardScript(copy, '新的讲解内容', 1);
  assert.equal(original.text, '六堡茶');
  assert.equal(revised.avatarVideo.inputSignature, 'existing-signature');
});
