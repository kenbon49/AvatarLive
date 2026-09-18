import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDynamicScriptPrompt, buildScriptSafetyRevisionPrompt, DEFAULT_SCRIPT_SAFETY_GUIDANCE, dynamicScriptComparisonTexts, isNearDuplicateScript, isScriptSafetyError, normalizeGeneratedScript, scriptRiskWords, scriptSafetyChanges, validateDynamicScript } from '../src/lib/live-dynamic-script.ts';

test('builds a factual dynamic-script prompt with recent context', () => {
  const prompt = buildDynamicScriptPrompt({
    productName: '精品咖啡豆',
    productSellingPoints: ['新鲜烘焙', '醇厚风味'],
    currentScripts: ['第一段', '第二段'],
    draftText: '请帮我介绍这款咖啡。',
    uploadedMaterials: [{ name: '产品资料.txt', content: '建议使用 92 摄氏度热水冲泡。' }],
    uploadedImages: ['包装正面.jpg'],
  });
  assert.match(prompt, /精品咖啡豆/);
  assert.match(prompt, /新鲜烘焙、醇厚风味/);
  assert.match(prompt, /请帮我介绍这款咖啡/);
  assert.match(prompt, /产品资料\.txt/);
  assert.match(prompt, /92 摄氏度/);
  assert.match(prompt, /包装正面\.jpg/);
  assert.match(prompt, /本次上传图片是用户最新指定的商品依据/);
  assert.match(prompt, /逐字识别包装/);
  assert.match(prompt, /以图片为准并忽略冲突的旧信息/);
  assert.match(prompt, /任一字符不确定时整项忽略/);
  assert.match(prompt, /不得出现.*图片.*画面.*包装上看到.*根据资料/);
  assert.match(prompt, /不得.*换序.*同义改写/);
  assert.match(prompt, /不得由外观推断口感/);
  assert.match(prompt, /避免重复/);
});

test('normalizes model output and removes markdown wrappers', () => {
  assert.equal(normalizeGeneratedScript('  话术：```\n欢迎来到直播间\n```  '), '欢迎来到直播间');
  assert.equal(
    normalizeGeneratedScript('话术：第一段内容。  段内继续。\r\n\r\n\r\n第二段内容。'),
    '第一段内容。 段内继续。\n\n第二段内容。',
  );
  assert.equal(normalizeGeneratedScript({ content: 'invalid' }), '');
});

test('uses operation-specific instructions for condense and polish', () => {
  const shared = {
    productName: '六堡茶',
    currentScripts: [],
    draftText: '这是一段需要处理的直播话术。',
  };
  const condensed = buildDynamicScriptPrompt({ ...shared, operation: 'condense' });
  const polished = buildDynamicScriptPrompt({ ...shared, operation: 'polish' });
  assert.match(condensed, /精简成一段/);
  assert.match(condensed, /原文约一半长度/);
  assert.doesNotMatch(condensed, /尽量扩写到/);
  assert.match(polished, /请润色用户草稿/);
  assert.match(polished, /篇幅与原文基本一致/);
  assert.doesNotMatch(polished, /尽量扩写到/);
});

test('requests a long-form expansion of at least 2000 characters', () => {
  const prompt = buildDynamicScriptPrompt({
    productName: '六堡茶',
    currentScripts: [],
    draftText: '介绍这款六堡茶。',
    operation: 'expand',
  });
  assert.match(prompt, /2000-2600/);
  assert.match(prompt, /超过 2000 字/);
  assert.match(prompt, /多个自然段/);
  assert.match(prompt, /段落之间保留一个空行/);
  assert.doesNotMatch(prompt, /120-500/);
});

test('rejects risky copy and reports repeated copy without discarding it', () => {
  assert.equal(validateDynamicScript('这是全网最低价的商品', []).ok, false);
  assert.deepEqual(validateDynamicScript('绝对放心，永不褪色', [], ['永不褪色']).riskWords, ['绝对', '永不褪色']);
  const repeated = validateDynamicScript('欢迎来到直播间', ['欢迎来到直播间']);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.duplicate, true);
  assert.equal(validateDynamicScript('新鲜烘焙，今天为大家介绍冲泡建议', ['欢迎来到直播间']).ok, true);
});

test('keeps default risk checks when a product defines additional words', () => {
  const terms = scriptRiskWords(['绝对', '特定风险词', ' 特定风险词 ']);
  assert.equal(terms.filter((word) => word === '绝对').length, 1);
  assert.ok(terms.includes('全网最低'));
  assert.ok(terms.includes('特定风险词'));
  const prompt = buildDynamicScriptPrompt({
    productName: '收纳盒', currentScripts: [], draftText: '介绍商品',
    riskWords: ['特定风险词'], safetyGuidance: '不作无依据的承诺',
  });
  assert.match(prompt, /全网最低/);
  assert.match(prompt, /特定风险词/);
  assert.match(prompt, /不作无依据的承诺/);
  assert.match(buildDynamicScriptPrompt({ productName: '收纳盒', currentScripts: [], draftText: '介绍商品' }), new RegExp(DEFAULT_SCRIPT_SAFETY_GUIDANCE.slice(0, 8)));
});

test('safety revision asks for the complete text without obfuscating risk words', () => {
  const prompt = buildScriptSafetyRevisionPrompt('第一段。\n\n绝对满意。', ['绝对'], '仅陈述商品事实');
  assert.match(prompt, /只改写包含风险表述的句子/);
  assert.match(prompt, /不加说明或标题/);
  assert.match(prompt, /不.*拆字.*谐音/);
  assert.match(prompt, /仅陈述商品事实/);
  assert.match(prompt, /第一段。\n\n绝对满意。/);
  assert.match(prompt, /如果没有需要修订的内容，原样返回全文/);
});

test('lists only changed sentences from the last safety revision', () => {
  assert.deepEqual(scriptSafetyChanges('开场。绝对值得买。卖点不变。全网最低。结尾。', '开场。可以按需选择。卖点不变。价格以实际为准。结尾。'), [
    { before: '绝对值得买。', after: '可以按需选择。' },
    { before: '全网最低。', after: '价格以实际为准。' },
  ]);
  assert.deepEqual(scriptSafetyChanges('原样返回。', '原样返回。'), []);
  assert.deepEqual(scriptSafetyChanges('旧句。', '旧句。新增句。'), [{ before: '', after: '新增句。' }]);
});

test('recognizes upstream moderation failures without treating network errors as safety issues', () => {
  assert.equal(isScriptSafetyError('触发风控关键词'), true);
  assert.equal(isScriptSafetyError('content_policy_violation'), true);
  assert.equal(isScriptSafetyError('socket closed'), false);
});

test('uses phrase overlap instead of shared single characters for duplicate detection', () => {
  assert.equal(isNearDuplicateScript(
    '直播间的朋友们，今天带大家看看这款六堡茶，正面写着十二生肖，净含量是8.4克乘12盒。',
    '想找一款有辨识度的茶，可以看看这款六堡茶。正面清楚写着十二生肖，净含量8.4克乘12盒，中间的树形纹样很醒目。',
  ), false);
  assert.equal(isNearDuplicateScript(
    '欢迎来到直播间，今天给大家介绍这款六堡茶，茶汤红浓明亮，入口醇和顺滑。',
    '欢迎来到直播间。今天给大家介绍这款六堡茶，茶汤红浓明亮，入口醇和顺滑！',
  ), true);
});

test('excludes the script being rewritten from duplicate comparisons', () => {
  const scripts = [
    { id: 1, text: '当前需要润色的原文' },
    { id: 2, text: '另一条已经存在的话术' },
  ];
  assert.deepEqual(dynamicScriptComparisonTexts(scripts, 1), ['另一条已经存在的话术']);
  assert.deepEqual(dynamicScriptComparisonTexts(scripts, null), ['当前需要润色的原文', '另一条已经存在的话术']);
});
