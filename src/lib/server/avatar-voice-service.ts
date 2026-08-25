import 'server-only';

const FISH_CACHE_TTL_MS = 10 * 60 * 1000;

const CURATED_FISH_PRESETS = [
  {
    id: '603e674b998943e3b664e3b3f5aff006',
    query: '专业知性女声',
    name: '专业知性女声',
    detail: '表达清晰、知性克制，适合品牌讲解与课程内容',
    tags: ['女声', '专业', '知性'],
  },
  {
    id: 'faccba1a8ac54016bcfc02761285e67f',
    query: '温柔动听女声',
    name: '温柔亲和女声',
    detail: '柔和自然、亲近感强，适合陪伴、生活与服务场景',
    tags: ['女声', '温柔', '亲和'],
  },
  {
    id: 'f44dd6bc180c4343b30b50d6ea4ed482',
    query: '亲切自然女声',
    name: '自然亲切女声',
    detail: '口语自然、节奏轻松，适合直播介绍与日常互动',
    tags: ['女声', '自然', '口语'],
  },
  {
    id: 'ef0f04de923849ca8836c5c63d23eefa',
    query: '清澈柔和女声',
    name: '清澈柔和女声',
    detail: '音色清澈、语气柔和，适合产品演示与轻叙事',
    tags: ['女声', '清澈', '柔和'],
  },
  {
    id: '5a0aac1ed36d47dab16cc27ebebd47af',
    query: '沉稳讲述男声',
    name: '沉稳讲述男声',
    detail: '节奏稳健、叙述感强，适合知识讲解与长内容',
    tags: ['男声', '沉稳', '讲述'],
  },
  {
    id: 'd91535d7837940d0a644dc1f4a277f24',
    query: '专业沉稳男声',
    name: '专业沉稳男声',
    detail: '成熟可靠、信息感明确，适合企业与商务内容',
    tags: ['男声', '专业', '商务'],
  },
  {
    id: '83f5551b1a554002971d897259bbea3c',
    query: '清澈青年男声',
    name: '清澈青年男声',
    detail: '年轻清晰、语气明快，适合科技、教育与互动内容',
    tags: ['男声', '青年', '清澈'],
  },
] as const;

type FishApiItem = {
  _id?: unknown;
  sample_url?: unknown;
};

type FishApiPayload = {
  success?: unknown;
  message?: unknown;
  items?: FishApiItem[];
};

export type ResolvedFishPreset = {
  id: string;
  name: string;
  detail: string;
  tags: string[];
  sampleUrl: string;
};

let fishCache: { expiresAt: number; presets: ResolvedFishPreset[] } | null = null;

export function voiceServiceConfig() {
  return {
    upstream: (process.env.SEO_VOICE_API_BASE_URL || process.env.SEO_IMAGE_API_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.SEO_VOICE_API_KEY || process.env.SEO_IMAGE_API_KEY || '',
  };
}

export function isAllowedFishAudioUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && [
      'platform.r2.fish.audio',
      'public-platform.r2.fish.audio',
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

async function queryFishPreset(
  preset: (typeof CURATED_FISH_PRESETS)[number],
  upstream: string,
  apiKey: string,
): Promise<ResolvedFishPreset | null> {
  const query = new URLSearchParams({
    page_size: '20',
    page_number: '1',
    title: preset.query,
    language: 'zh',
    sort_by: 'task_count',
  });
  const response = await fetch(`${upstream}/api/fish-audio/models?${query}`, {
    headers: { 'X-API-Key': apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as FishApiPayload;
  if (!response.ok || payload.success !== true) {
    const detail = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;
    throw new Error(`Fish Audio 音色查询失败：${detail}`);
  }
  const item = Array.isArray(payload.items)
    ? payload.items.find((candidate) => candidate?._id === preset.id)
    : undefined;
  if (!item || typeof item.sample_url !== 'string' || !isAllowedFishAudioUrl(item.sample_url)) return null;
  return {
    id: preset.id,
    name: preset.name,
    detail: preset.detail,
    tags: [...preset.tags],
    sampleUrl: item.sample_url,
  };
}

export async function loadFishPresets() {
  if (fishCache && fishCache.expiresAt > Date.now()) return fishCache.presets;
  const { upstream, apiKey } = voiceServiceConfig();
  if (!upstream || !apiKey) throw new Error('声音参考服务尚未配置');

  const results = await Promise.allSettled(
    CURATED_FISH_PRESETS.map((preset) => queryFishPreset(preset, upstream, apiKey)),
  );
  const presets = results.flatMap((result) => (
    result.status === 'fulfilled' && result.value ? [result.value] : []
  ));
  if (!presets.length) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw failure?.reason instanceof Error ? failure.reason : new Error('Fish Audio 没有返回可用试听音频');
  }
  fishCache = { expiresAt: Date.now() + FISH_CACHE_TTL_MS, presets };
  return presets;
}

export async function getFishPreset(id: string) {
  if (!CURATED_FISH_PRESETS.some((preset) => preset.id === id)) return null;
  return (await loadFishPresets()).find((preset) => preset.id === id) || null;
}
