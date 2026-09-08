import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProductScriptMessageContent, buildProductScriptPrompt, parseProductScripts } from '../src/lib/live-product-ai.ts';

test('includes product documents and image context without inventing missing fields', () => {
  const prompt = buildProductScriptPrompt({
    name: '精品咖啡豆',
    sellingPoints: ['中度烘焙', '坚果香气'],
    referenceText: '产地为云南，净含量 250 克。',
    referenceImageCount: 3,
  });

  assert.match(prompt, /精品咖啡豆/);
  assert.match(prompt, /产地为云南/);
  assert.match(prompt, /3 张商品图片/);
  assert.doesNotMatch(prompt, /直播价：/);
});

test('parses fenced LiteLLM JSON and enforces script order', () => {
  const scripts = parseProductScripts(`\n\`\`\`json\n{"scripts":[
    {"title":"欢迎","category":"讲品","text":"欢迎来到直播间，今天为大家介绍这款商品。"},
    {"title":"详情","category":"开场","text":"这款商品的具体特点以资料中提供的信息为准。"},
    {"title":"下单","category":"促单","text":"感兴趣的朋友可以查看商品详情并按实际需要选择。"}
  ]}\n\`\`\``);

  assert.deepEqual(scripts.map((script) => script.category), ['开场', '讲品', '促单']);
  assert.equal(scripts[0].title, '欢迎');
  assert.match(scripts[2].duration, /^00:\d{2}$/);
});

test('adds every uploaded product image to the multimodal message', () => {
  const content = buildProductScriptMessageContent('生成商品话术', [
    'data:image/jpeg;base64,one',
    'data:image/png;base64,two',
    'data:image/webp;base64,three',
  ]);

  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, 'text');
  assert.equal(content.filter((item) => item.type === 'image_url').length, 3);
});

test('supports a configurable script count and hard text limit', () => {
  const prompt = buildProductScriptPrompt({
    name: '测试商品',
    scriptCount: 5,
    maxCharactersPerScript: 40,
  });
  assert.match(prompt, /生成 5 段/);
  assert.match(prompt, /不超过 40 个汉字/);

  const content = JSON.stringify({ scripts: Array.from({ length: 5 }, (_, index) => ({
    title: `话术${index + 1}`,
    text: '这是一段用于验证字符上限的商品话术内容。'.repeat(5),
  })) });
  const scripts = parseProductScripts(content, { count: 5, maxCharactersPerScript: 40 });
  assert.deepEqual(scripts.map((item) => item.category), ['开场', '讲品', '讲品', '讲品', '促单']);
  assert.ok(scripts.every((item) => item.text.length <= 40));
});

test('rejects malformed or incomplete model output', () => {
  assert.throws(() => parseProductScripts('not json'), /无法解析/);
  assert.throws(() => parseProductScripts('{"scripts":[]}'), /3 段/);
});
