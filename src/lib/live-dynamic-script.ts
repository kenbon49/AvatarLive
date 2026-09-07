export type DynamicScriptContext = {
  productName: string;
  productSellingPoints?: string[];
  currentScripts: string[];
};

export function buildDynamicScriptPrompt(context: DynamicScriptContext): string {
  const points = (context.productSellingPoints ?? []).filter(Boolean).slice(0, 8).join('、') || '以已有直播间信息为准';
  const recent = context.currentScripts.filter(Boolean).slice(-3).join('\n') || '暂无已播内容';
  return [
    '请为 AI 数字人直播生成下一段中文动态话术。',
    `商品：${context.productName || '未命名商品'}`,
    `已确认卖点：${points}`,
    '最近已播内容（请避免重复）：',
    recent,
    '要求：只输出一段自然口语；保留已确认事实；不要编造价格、库存、功效、品牌承诺或绝对化用语；长度 60-180 字。',
  ].join('\n');
}

export function normalizeGeneratedScript(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/```(?:[a-z]+)?/gi, '')
    .replace(/^\s*(话术|回复|文案)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000);
}

const DEFAULT_RISK_WORDS = ['全网最低', '绝对', '百分之百', '100%', '包治', '稳赚', '零风险', '永久'];

export function validateDynamicScript(text: string, recentTexts: string[], riskWords = DEFAULT_RISK_WORDS): { ok: boolean; riskWords: string[]; duplicate: boolean } {
  const normalized = text.replace(/[，。！？、,.!?\s]/g, '');
  const matchedRiskWords = riskWords.filter((word) => word && text.includes(word));
  const duplicate = recentTexts.some((recent) => {
    const candidate = recent.replace(/[，。！？、,.!?\s]/g, '');
    if (!candidate || !normalized) return false;
    const shared = Array.from(new Set(candidate.split(''))).filter((char) => normalized.includes(char)).length;
    return shared / Math.max(1, new Set(candidate.split('')).size) >= 0.8;
  });
  return { ok: matchedRiskWords.length === 0 && !duplicate, riskWords: matchedRiskWords, duplicate };
}
