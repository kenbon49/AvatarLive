export type DynamicScriptOperation = 'expand' | 'condense' | 'polish';

export const DYNAMIC_SCRIPT_SYSTEM_PROMPT = '你是专业的数字人直播带货脚本编导。严格遵守用户要求的目标篇幅、事实边界和输出格式；扩写时要形成内容充实、节奏自然、可直接连续播报的长稿，不要因为默认追求简洁而提前结束。';
export const SCRIPT_SAFETY_SYSTEM_PROMPT = '你是直播口播稿的合规编辑。只修订有风险的表达，保留原文事实、篇幅和段落，不新增承诺或未经证实的信息。';
export const DEFAULT_SCRIPT_SAFETY_GUIDANCE = '避免绝对化承诺、极限价格、未经证实的功效和保证性用语。只陈述已提供且可以核实的商品信息；遇到高风险表述时，改为中性、具体的描述，不拆字、谐音或换符号规避审核。';

const DEFAULT_RISK_WORDS = ['全网最低', '绝对', '百分之百', '100%', '包治', '稳赚', '零风险', '永久'];

export function scriptRiskWords(productRiskWords: string[] = []): string[] {
  return [...new Set([...DEFAULT_RISK_WORDS, ...productRiskWords].map((word) => word.trim()).filter(Boolean))];
}

export function isScriptSafetyError(message: string): boolean {
  return /风控|风险词|敏感词|违规|内容审核|内容安全|moderation|content.policy|safety/i.test(message);
}

export type DynamicScriptContext = {
  operation?: DynamicScriptOperation;
  productName: string;
  productSellingPoints?: string[];
  currentScripts: string[];
  draftText?: string;
  uploadedMaterials?: Array<{ name: string; content: string }>;
  uploadedImages?: string[];
  safetyGuidance?: string;
  riskWords?: string[];
};

export function dynamicScriptComparisonTexts(
  scripts: Array<{ id: number; text: string }>,
  editingScriptId: number | null,
): string[] {
  return scripts
    .filter((script) => script.id !== editingScriptId)
    .map((script) => script.text.trim())
    .filter(Boolean);
}

export function buildDynamicScriptPrompt(context: DynamicScriptContext): string {
  const operation = context.operation ?? 'expand';
  const taskInstruction = operation === 'condense'
    ? '请将用户草稿精简成一段可直接播报的中文直播话术，保留可核实的核心信息，不得新增事实。'
    : operation === 'polish'
      ? '请润色用户草稿，使其成为一段可直接播报的中文直播话术，保持原有信息量和篇幅，不得新增事实。'
      : '请将用户草稿扩写成一篇可直接连续播报的中文直播长稿。';
  const lengthInstruction = operation === 'condense'
    ? '成稿控制在原文约一半长度。'
    : operation === 'polish'
      ? '成稿篇幅与原文基本一致。'
      : '请输出完整长稿，目标 2000-2600 个中文字符，正文尽量达到并超过 2000 字；不得少量改写后提前结束。可以通过自然的直播互动、分层介绍、重点回顾、选购提醒和转场承接充实内容，但不得重复堆砌同一句话，也不得编造事实。';
  const points = (context.productSellingPoints ?? []).filter(Boolean).slice(0, 8).join('、') || '以已有直播间信息为准';
  const recent = context.currentScripts.filter(Boolean).slice(-3).join('\n') || '暂无已播内容';
  const draft = context.draftText?.trim() || '暂无用户草稿';
  const materials = (context.uploadedMaterials ?? [])
    .filter((item) => item.name.trim() && item.content.trim())
    .slice(0, 4)
    .map((item) => `【${item.name.trim()}】\n${item.content.trim().slice(0, 6_000)}`)
    .join('\n') || '暂无可读取的上传素材';
  const images = (context.uploadedImages ?? []).filter(Boolean).slice(0, 4);
  const productLabel = images.length ? '直播间已有商品字段（可能是旧信息，仅在与上传图片一致时使用）' : '商品';
  const pointsLabel = images.length ? '直播间已有卖点（可能是旧信息，仅在与上传图片一致时使用）' : '已确认卖点';
  const outputInstruction = operation === 'expand'
    ? '只输出处理后的直播正文；按照内容转折分成多个自然段，每段 2-5 句，段落之间保留一个空行；不要添加标题、序号或 Markdown 标记'
    : '只输出处理后的一段自然口语';
  return [
    taskInstruction,
    images.length ? '本次上传图片是用户最新指定的商品依据。请先在内部逐字识别包装上清晰可见的品牌、品名、系列名、规格和短句，再开始写作；不要输出识别过程。' : '',
    images.length ? '若图片中清晰可见的品牌、品名、规格或包装文字与直播间已有字段、草稿或最近话术冲突，以图片为准并忽略冲突的旧信息。包装文字须在内部对照图片二次核对；弧形、装饰字体或小字中任一字符不确定时整项忽略，不得猜测、补全、换序或同义改写。' : '',
    `${productLabel}：${context.productName || '未命名商品'}`,
    `${pointsLabel}：${points}`,
    '用户当前草稿（保留核心意图）：',
    draft,
    '用户上传的参考素材（仅使用明确出现的信息）：',
    materials,
    images.length ? `同时参考随消息上传的 ${images.length} 张图片（${images.join('、')}）。包装上清晰可辨的专有名称、数字、单位和并列短句必须逐字保留；不确定的信息直接忽略。` : '',
    '最近已播内容（请避免重复）：',
    recent,
    `风控要求：避免出现${scriptRiskWords(context.riskWords).join('、')}；${context.safetyGuidance?.trim() || DEFAULT_SCRIPT_SAFETY_GUIDANCE}`,
    `要求：${outputInstruction}；保留用户原意和已确认事实；有素材时融合素材里的信息；图片只可用于描述清晰可辨的外观、原文文字和使用场景，不得由外观推断口感、功效、品质、适用人群或送礼价值；成稿中不得出现“图片”“画面”“包装上看到”“根据资料”等幕后措辞；不要编造价格、库存、功效、品牌承诺或绝对化用语；${lengthInstruction}`,
  ].filter(Boolean).join('\n');
}

export function buildScriptSafetyRevisionPrompt(text: string, riskWords: string[], guidance: string): string {
  return [
    '请对下面的直播口播稿做一次合规修订。只改写包含风险表述的句子，其他内容、事实、自然段结构和篇幅尽量保持不变。',
    `必须移除的词语：${riskWords.join('、')}。不要用拆字、谐音或符号变形来替代。`,
    `修订要求：${guidance.trim() || DEFAULT_SCRIPT_SAFETY_GUIDANCE}`,
    '同时检查未经证实的功效、价格、保证性承诺等不在词表中的风险表述；如果没有需要修订的内容，原样返回全文。',
    '不增加未经提供的价格、功效、材质或品牌承诺。只输出修订后的完整正文，不加说明或标题。',
    '待修订正文：',
    text,
  ].join('\n');
}

export type ScriptSafetyChange = { before: string; after: string };

export function scriptSafetyChanges(before: string, after: string): ScriptSafetyChange[] {
  if (before === after) return [];
  const sentences = (text: string) => text.match(/[^。！？!?；;\n]+[。！？!?；;]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  const left = sentences(before);
  const right = sentences(after);
  if (!left.length || !right.length || left.length > 160 || right.length > 160) return [{ before, after }];

  const shared = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      shared[i][j] = left[i] === right[j] ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1]);
    }
  }

  const changes: ScriptSafetyChange[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    if (removed || added) changes.push({ before: removed, after: added });
    removed = '';
    added = '';
  };
  for (let i = 0, j = 0; i < left.length || j < right.length;) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      flush();
      i++;
      j++;
    } else if (i < left.length && (j === right.length || shared[i + 1][j] >= shared[i][j + 1])) {
      removed += left[i++];
    } else {
      added += right[j++];
    }
  }
  flush();
  return changes.length ? changes : [{ before, after }];
}

export function normalizeGeneratedScript(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/```(?:[a-z]+)?/gi, '')
    .replace(/^\s*(话术|回复|文案)\s*[:：]\s*/i, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}

function duplicateText(value: string): string {
  return value.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function textNgrams(value: string, size = 3): Set<string> {
  if (value.length < size) return new Set(value ? [value] : []);
  const grams = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.add(value.slice(index, index + size));
  }
  return grams;
}

export function isNearDuplicateScript(left: string, right: string): boolean {
  const normalizedLeft = duplicateText(left);
  const normalizedRight = duplicateText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (Math.min(normalizedLeft.length, normalizedRight.length) < 16) return false;

  const leftGrams = textNgrams(normalizedLeft);
  const rightGrams = textNgrams(normalizedRight);
  const shared = Array.from(leftGrams).filter((gram) => rightGrams.has(gram)).length;
  const containment = shared / Math.min(leftGrams.size, rightGrams.size);
  const dice = (2 * shared) / (leftGrams.size + rightGrams.size);
  return containment >= 0.82 && dice >= 0.72;
}

export function validateDynamicScript(text: string, recentTexts: string[], riskWords: string[] = []): { ok: boolean; riskWords: string[]; duplicate: boolean } {
  const matchedRiskWords = scriptRiskWords(riskWords).filter((word) => text.includes(word));
  const duplicate = recentTexts.some((recent) => isNearDuplicateScript(text, recent));
  return { ok: matchedRiskWords.length === 0, riskWords: matchedRiskWords, duplicate };
}
