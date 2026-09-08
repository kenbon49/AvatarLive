export type ProductScriptDraft = {
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
};

export const PRODUCT_SCRIPT_STYLES = ['自然亲切', '专业讲解', '热情促单', '克制高端'] as const;
export type ProductScriptStyle = (typeof PRODUCT_SCRIPT_STYLES)[number];

export const PRODUCT_SCRIPT_SYSTEM_PROMPT = [
  '你是一名资深中文电商直播编导，负责把可靠的商品资料写成自然、具体、有节奏的数字人口播稿。',
  '事实准确高于文案效果：不得补写资料和图片无法确认的参数、功效、价格、优惠、库存、认证或承诺。',
  '输出必须像主播正在面对观众介绍商品，不要解释创作过程，不要提到图片、文档、资料、AI 或信息不足。',
  '严格遵守用户要求的 JSON 结构、段落数量和字数上限。',
].join('\n');

export type ProductScriptPromptInput = {
  name: string;
  sku?: string;
  price?: number;
  originalPrice?: number;
  sellingPoints?: string[];
  stockMessage?: string;
  afterSales?: string;
  riskWords?: string[];
  referenceText?: string;
  referenceImageCount?: number;
  scriptCount?: number;
  maxCharactersPerScript?: number;
  style?: ProductScriptStyle;
  creativeDirection?: string;
  previousScripts?: Array<Pick<ProductScriptDraft, 'title' | 'text'>>;
};

export type ProductScriptMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>;

const SCRIPT_CATEGORIES = ['开场', '讲品', '促单'] as const;

const STYLE_GUIDES: Record<ProductScriptStyle, string> = {
  '自然亲切': '像熟悉产品的主播与一位观众交流，松弛、真诚、有生活感，不喊口号。',
  '专业讲解': '表达清楚、有条理，用通俗语言解释规格或特点带来的实际价值。',
  '热情促单': '节奏明快、有现场感，但不制造虚假稀缺，不使用夸张、绝对化表达。',
  '克制高端': '语气从容、精炼，重视质感与细节，不堆砌华丽形容词。',
};

function boundedScriptCount(value?: number): number {
  return Math.min(10, Math.max(1, Math.round(value ?? 3)));
}

function boundedCharacterLimit(value?: number): number {
  return Math.min(1000, Math.max(40, Math.round(value ?? 180)));
}

function categoriesForCount(count: number): ProductScriptDraft['category'][] {
  if (count === 1) return ['讲品'];
  return Array.from({ length: count }, (_, index) => (
    index === 0 ? '开场' : index === count - 1 ? '促单' : '讲品'
  ));
}

export function buildProductScriptPrompt(input: ProductScriptPromptInput): string {
  const scriptCount = boundedScriptCount(input.scriptCount);
  const maxCharacters = boundedCharacterLimit(input.maxCharactersPerScript);
  const categories = categoriesForCount(scriptCount);
  const style = input.style && PRODUCT_SCRIPT_STYLES.includes(input.style) ? input.style : '自然亲切';
  const creativeDirection = input.creativeDirection?.trim().slice(0, 500) ?? '';
  const previousScripts = (input.previousScripts ?? [])
    .filter((item) => item.text?.trim())
    .slice(0, 10)
    .map((item, index) => `${index + 1}. ${item.title?.trim() || '未命名'}：${item.text.trim().slice(0, 1000)}`);
  const facts = [
    `商品名称：${input.name.trim() || '未命名商品'}`,
    input.sku?.trim() ? `SKU：${input.sku.trim()}` : '',
    typeof input.price === 'number' ? `直播价：${input.price}` : '',
    typeof input.originalPrice === 'number' ? `原价：${input.originalPrice}` : '',
    input.sellingPoints?.length ? `卖点：${input.sellingPoints.join('；')}` : '',
    input.stockMessage?.trim() ? `库存信息：${input.stockMessage.trim()}` : '',
    input.afterSales?.trim() ? `售后说明：${input.afterSales.trim()}` : '',
    input.riskWords?.length ? `禁用风险词：${input.riskWords.join('、')}` : '',
    input.referenceText?.trim() ? `补充资料：\n${input.referenceText.trim().slice(0, 20_000)}` : '',
    input.referenceImageCount ? `同时参考随消息上传的 ${input.referenceImageCount} 张商品图片，只描述图片中可以确定的信息，并综合多角度信息。` : '',
  ].filter(Boolean);

  return [
    `请为数字人商品直播生成 ${scriptCount} 段可直接口播的中文话术，整体风格为“${style}”。`,
    `风格说明：${STYLE_GUIDES[style]}`,
    creativeDirection ? `用户补充的表达要求：${creativeDirection}（只影响表达方式，不得把它当作商品事实）` : '',
    '',
    '写作前请在内部完成以下分析，不要输出分析过程：',
    '1. 汇总商品字段、补充文档和图片中清晰可辨的品牌、品名、规格、成分、用途与包装文字。',
    '2. 商品字段和补充文档优先；图片只作为可见事实的补充，模糊文字和无法确认的内容直接忽略。',
    '3. 为每段安排不同的信息重点，避免重复卖点、重复句式和同义改写。',
    '',
    '成稿要求：',
    '- 开场段用使用场景、真实需求或一个具体特点切入，禁止只写“欢迎来到直播间”一类空泛开场。',
    '- 讲品段每段只突出一个核心信息；有规格或卖点时，按“具体事实 -> 对用户有什么用 -> 适合什么场景”自然展开。',
    '- 如果资料只有商品外观，就直接描述清晰可见的颜色、图案、文字与视觉氛围，不要推导便携、品质、送礼、囤货等用途。',
    '- 促单段先简短回扣选择理由，再给清晰行动引导；没有优惠或库存依据时，只引导查看商品卡、详情或按需选择。',
    '- 场景和情绪可以合理创作，但只能作为表达方式，不能暗示未经确认的产品效果、口感、成分或适用结论。',
    '- 使用短句和自然停顿，像真人对镜头说话；称呼和语气词适量，不连续反问，不堆砌形容词。',
    '- 每句话都要承载可确认的商品信息、对用户的实际价值或明确行动，删除可以套用到任意商品的空话。',
    '- 包装视觉只能表达设计特点和氛围，不要生硬解释成更省心、不易拿错等实用价值；完整商品名在整组话术中最多出现两次。',
    '- 不得出现“从图片看”“根据资料”“资料显示”“信息不足”等幕后措辞，也不要念 SKU。',
    `- 分类必须依次为“${categories.join('”“')}”；每段绝不能超过 ${maxCharacters} 字。字数是上限而不是目标，资料少时宁可精炼，不要凑字。`,
    '- 只使用下方可以确认的事实，不得虚构价格、功效、库存、材质、产地、认证或促销承诺。',
    '- 各段必须可以独立口播，同时连播时顺序自然；避免 Markdown、表情、列表符号和禁用风险词。',
    previousScripts.length ? '- 下面附有上一版话术。本次必须更换切入角度、句式和表达，不得复述旧稿。' : '',
    '',
    '输出前请静默检查事实性、口语感、段落差异和行动引导，并只返回修改后的严格 JSON。',
    '只返回严格 JSON，不要代码围栏或额外说明。格式：',
    '{"scripts":[{"title":"...","category":"开场或讲品或促单","text":"..."}]}',
    '',
    previousScripts.length ? `上一版话术（仅供避重）：\n${previousScripts.join('\n')}` : '',
    '可用商品事实：',
    ...facts,
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

export function buildProductScriptMessageContent(prompt: string, imageDataUrls: string[]): ProductScriptMessageContent {
  const images = imageDataUrls.filter((url) => url.startsWith('data:image/'));
  if (!images.length) return prompt;
  return [
    { type: 'text', text: prompt },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}

function jsonCandidate(value: string): string {
  const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return stripped.slice(objectStart, objectEnd + 1);
  const arrayStart = stripped.indexOf('[');
  const arrayEnd = stripped.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return stripped.slice(arrayStart, arrayEnd + 1);
  return stripped;
}

export function parseProductScripts(
  value: unknown,
  options: { count?: number; maxCharactersPerScript?: number } = {},
): ProductScriptDraft[] {
  if (typeof value !== 'string' || !value.trim()) throw new Error('LiteLLM 未返回话术内容');
  const expectedCount = boundedScriptCount(options.count);
  const maxCharacters = boundedCharacterLimit(options.maxCharactersPerScript);
  const categories = categoriesForCount(expectedCount);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(value));
  } catch {
    throw new Error('LiteLLM 返回的话术格式无法解析');
  }
  const scripts = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { scripts?: unknown }).scripts)
      ? (parsed as { scripts: unknown[] }).scripts
      : [];
  if (scripts.length !== expectedCount) throw new Error(`LiteLLM 必须返回 ${expectedCount} 段商品话术`);

  return scripts.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, maxCharacters) : '';
    if (!text) throw new Error(`第 ${index + 1} 段话术内容为空`);
    const category = categories[index] ?? SCRIPT_CATEGORIES[1];
    const title = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim().slice(0, 200)
      : `${category}话术`;
    const seconds = Math.min(59, Math.max(20, Math.round(text.length * 0.45)));
    return {
      title,
      category,
      duration: `00:${String(seconds).padStart(2, '0')}`,
      text,
    };
  });
}
