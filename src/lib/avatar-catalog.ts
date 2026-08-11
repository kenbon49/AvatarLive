import type { MuseTalkAvatarProfile } from '@/lib/musetalk-total-stream';

export type AvatarStyle = {
  outfit: string;
  hair: string;
  accessory: string;
};

export type Avatar = {
  id: string;
  profile: MuseTalkAvatarProfile;
  language: 'ZH' | 'EN';
  name: string;
  role: string;
  description: string;
  image: string;
  custom?: boolean;
  voice?: string;
  background?: string;
  style?: AvatarStyle;
};

export const DEFAULT_AVATARS: Avatar[] = [
  {
    id: 'chinese',
    profile: 'chinese',
    language: 'ZH',
    name: '中文女',
    role: '智能接待顾问',
    description: '使用后端 chinese2 视频形象，支持实时对话',
    image: '/assets/musetalk-avatars/chinese.jpg',
  },
  {
    id: 'business-male-1',
    profile: 'business_male_1',
    language: 'ZH',
    name: '商务男',
    role: '企业服务顾问',
    description: '使用后端商务男视频形象，支持实时对话',
    image: '/assets/musetalk-avatars/business-male-1.jpg',
  },
  {
    id: 'chenyu',
    profile: 'business_male_1',
    language: 'ZH',
    name: '陈屿',
    role: '企业服务顾问',
    description: '沉稳可靠，擅长企业服务',
    image: '/assets/digital-humans/chenyu.webp',
  },
  {
    id: 'maya',
    profile: 'chinese',
    language: 'EN',
    name: 'Maya',
    role: '产品解决方案顾问',
    description: '清晰敏锐，专注产品咨询',
    image: '/assets/digital-humans/maya.webp',
  },
  {
    id: 'zhoulan',
    profile: 'chinese',
    language: 'ZH',
    name: '周岚',
    role: '资深服务顾问',
    description: '温和可信，善于深度沟通',
    image: '/assets/digital-humans/zhoulan.webp',
  },
  {
    id: 'noah',
    profile: 'business_male_1',
    language: 'EN',
    name: 'Noah',
    role: '国际业务顾问',
    description: '活力友好，熟悉国际业务',
    image: '/assets/digital-humans/noah.webp',
  },
  {
    id: 'suqing',
    profile: 'chinese',
    language: 'ZH',
    name: '苏晴',
    role: '生活方式顾问',
    description: '温暖松弛，擅长生活分享',
    image: '/assets/digital-humans/suqing.webp',
  },
  {
    id: 'guyan',
    profile: 'business_male_1',
    language: 'ZH',
    name: '顾言',
    role: '科技产品顾问',
    description: '理性清晰，善于产品演示',
    image: '/assets/digital-humans/guyan.webp',
  },
  {
    id: 'tangyue',
    profile: 'chinese',
    language: 'ZH',
    name: '唐悦',
    role: '文化内容顾问',
    description: '知性自然，专注内容讲解',
    image: '/assets/digital-humans/tangyue.webp',
  },
  {
    id: 'liangchuan',
    profile: 'business_male_1',
    language: 'ZH',
    name: '梁川',
    role: '商务沟通顾问',
    description: '成熟从容，擅长商务沟通',
    image: '/assets/digital-humans/liangchuan.webp',
  },
];

export const CUSTOM_AVATAR_STORAGE_KEY = 'lingjing-custom-avatars';

const AVATAR_PROFILES = new Set<MuseTalkAvatarProfile>([
  'chinese',
  'business_male_1',
  'casual_male',
  'middle_aged_male',
  'casual_conversation',
  'casual_female',
]);

export function readCustomAvatars(): Avatar[] {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_AVATAR_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(value)) return [];

    const ids = new Set<string>();
    return value.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const stored = item as Record<string, unknown>;
      const name = typeof stored.name === 'string' ? stored.name.trim() : '';
      const image = typeof stored.image === 'string' ? stored.image : '';
      if (!name || !image) return [];

      const requestedId = typeof stored.id === 'string' && stored.id.trim()
        ? stored.id.trim()
        : `custom-${index}`;
      const id = ids.has(requestedId) ? `${requestedId}-${index}` : requestedId;
      const storedStyle = stored.style && typeof stored.style === 'object'
        ? stored.style as Record<string, unknown>
        : null;
      ids.add(id);
      const profile = typeof stored.profile === 'string' && AVATAR_PROFILES.has(stored.profile as MuseTalkAvatarProfile)
        ? stored.profile as MuseTalkAvatarProfile
        : 'chinese';
      return [{
        id,
        profile,
        language: stored.language === 'EN' ? 'EN' as const : 'ZH' as const,
        name,
        role: typeof stored.role === 'string' && stored.role.trim() ? stored.role.trim() : '专属数字人',
        description: typeof stored.description === 'string' && stored.description.trim()
          ? stored.description.trim()
          : '专属互动数字人',
        image,
        custom: true,
        voice: typeof stored.voice === 'string' ? stored.voice : undefined,
        background: typeof stored.background === 'string' ? stored.background : undefined,
        style: storedStyle
          && typeof storedStyle.outfit === 'string'
          && typeof storedStyle.hair === 'string'
          && typeof storedStyle.accessory === 'string'
          ? {
              outfit: storedStyle.outfit,
              hair: storedStyle.hair,
              accessory: storedStyle.accessory,
            }
          : undefined,
      }];
    });
  } catch {
    return [];
  }
}

export function findDefaultAvatar(id?: string): Avatar | undefined {
  return id ? DEFAULT_AVATARS.find((avatar) => avatar.id === id) : undefined;
}
