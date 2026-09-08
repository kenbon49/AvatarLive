import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductScriptMessageContent,
  buildProductScriptPrompt,
  PRODUCT_SCRIPT_SYSTEM_PROMPT,
  parseProductScripts,
} from '../src/lib/live-product-ai.ts';

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
  assert.match(prompt, /绝不能超过 40 字/);
  assert.match(prompt, /字数是上限而不是目标/);

  const content = JSON.stringify({ scripts: Array.from({ length: 5 }, (_, index) => ({
    title: `话术${index + 1}`,
    text: '这是一段用于验证字符上限的商品话术内容。'.repeat(5),
  })) });
  const scripts = parseProductScripts(content, { count: 5, maxCharactersPerScript: 40 });
  assert.deepEqual(scripts.map((item) => item.category), ['开场', '讲品', '讲品', '讲品', '促单']);
  assert.ok(scripts.every((item) => item.text.length <= 40));
});

test('guides the model toward natural, differentiated live copy', () => {
  const prompt = buildProductScriptPrompt({
    name: '横州茉莉花茶',
    style: '专业讲解',
    creativeDirection: '面向办公室人群，重点讲日常冲泡场景',
    previousScripts: [{ title: '旧稿', text: '欢迎来到直播间，今天为大家介绍这款商品。' }],
  });

  assert.match(PRODUCT_SCRIPT_SYSTEM_PROMPT, /不要提到图片、文档、资料、AI/);
  assert.match(prompt, /专业讲解/);
  assert.match(prompt, /办公室人群/);
  assert.match(prompt, /具体事实 -> 对用户有什么用 -> 适合什么场景/);
  assert.match(prompt, /资料只有商品外观/);
  assert.match(prompt, /删除可以套用到任意商品的空话/);
  assert.match(prompt, /不要生硬解释成更省心、不易拿错/);
  assert.match(prompt, /完整商品名在整组话术中最多出现两次/);
  assert.match(prompt, /不得复述旧稿/);
  assert.match(prompt, /欢迎来到直播间/);
});

test('rejects malformed or incomplete model output', () => {
  assert.throws(() => parseProductScripts('not json'), /无法解析/);
  assert.throws(() => parseProductScripts('{"scripts":[]}'), /3 段/);
});
