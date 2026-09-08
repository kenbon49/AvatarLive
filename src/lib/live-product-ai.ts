export type ProductScriptDraft = {
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
};

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
};

export type ProductScriptMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>;

const SCRIPT_CATEGORIES = ['开场', '讲品', '促单'] as const;

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
    `请为数字人商品直播生成 ${scriptCount} 段可直接口播的中文话术。`,
    '只使用下方明确提供的事实；不要虚构价格、功效、库存、材质、认证或促销承诺。',
    `分类必须依次为“${categories.join('”“')}”，每段正文不超过 ${maxCharacters} 个汉字，避免 Markdown、表情和风险词。`,
    '只返回严格 JSON，不要代码围栏或额外说明。格式：',
    '{"scripts":[{"title":"...","category":"开场或讲品或促单","text":"..."}]}',
    '',
    ...facts,
  ].join('\n');
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
