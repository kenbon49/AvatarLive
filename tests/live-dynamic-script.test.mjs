import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDynamicScriptPrompt, normalizeGeneratedScript, validateDynamicScript } from '../src/lib/live-dynamic-script.ts';

test('builds a factual dynamic-script prompt with recent context', () => {
  const prompt = buildDynamicScriptPrompt({
    productName: '精品咖啡豆',
    productSellingPoints: ['新鲜烘焙', '醇厚风味'],
    currentScripts: ['第一段', '第二段'],
  });
  assert.match(prompt, /精品咖啡豆/);
  assert.match(prompt, /新鲜烘焙、醇厚风味/);
  assert.match(prompt, /避免重复/);
});

test('normalizes model output and removes markdown wrappers', () => {
  assert.equal(normalizeGeneratedScript('  话术：```\n欢迎来到直播间\n```  '), '欢迎来到直播间');
  assert.equal(normalizeGeneratedScript({ content: 'invalid' }), '');
});

test('rejects risky or repeated generated copy', () => {
  assert.equal(validateDynamicScript('这是全网最低价的商品', []).ok, false);
  assert.equal(validateDynamicScript('欢迎来到直播间', ['欢迎来到直播间']).duplicate, true);
  assert.equal(validateDynamicScript('新鲜烘焙，今天为大家介绍冲泡建议', ['欢迎来到直播间']).ok, true);
});
