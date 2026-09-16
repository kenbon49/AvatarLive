import type { MuseTalkAvatarProfile } from '@/lib/musetalk-total-stream';
import aliyunPublicAvatarData from '../data/aliyun-public-avatars.json' with { type: 'json' };

export type AliyunAvatarSourceType =
  | 'AVATAR_2D'
  | 'AVATAR_2D_MOBILE'
  | 'AVATAR_2D_NO_TRAIN'
  | 'AVATAR_2D_PIC'
  | 'AVATAR_3D_TRADITIONAL'
  | 'AVATAR_UE_APPEARANCE';

export type AliyunAvatarBusinessType = 'BROADCAST' | 'BROADCAST_CHAT' | 'CHAT' | 'LIVE';

export type LiveAvatarCatalogItem = {
  id: string;
  name: string;
  role: string;
  image: string;
  type: '真人' | '卡通';
  gender: '女' | '男';
  age?: '青年' | '中年';
  scope: 'mine' | 'aliyun';
  providerName: string;
  capability: string;
  previewVideo?: string;
  favorite?: boolean;
  rendererProfile?: MuseTalkAvatarProfile;
  templateId?: string;
  officialId?: string;
  sourceType?: AliyunAvatarSourceType;
  businessType?: AliyunAvatarBusinessType;
  aspectRatio?: string;
  transparent?: boolean;
};

export const LOCAL_LIVE_AVATARS: LiveAvatarCatalogItem[] = [
  {
    id: 'business_male_1',
    name: '商务男',
    role: '企业服务顾问',
    image: '/assets/musetalk-avatars/business-male-1.jpg',
    type: '真人',
    gender: '男',
    age: '青年',
    scope: 'mine',
    providerName: '本地 MuseTalk',
    capability: '实时',
    rendererProfile: 'business_male_1',
  },
  {
    id: 'chen_yu',
    name: '陈屿',
    role: '企业服务顾问',
    image: '/assets/musetalk-avatars/chen-yu.jpg',
    type: '真人',
    gender: '男',
    age: '青年',
    scope: 'mine',
    providerName: '本地 MuseTalk',
    capability: '实时',
    rendererProfile: 'chen_yu',
  },
];

const SOURCE_TYPE_LABELS: Record<AliyunAvatarSourceType, string> = {
  AVATAR_2D: '2D 数字人',
  AVATAR_2D_MOBILE: '移动端 2D',
  AVATAR_2D_NO_TRAIN: '免训练 2D',
  AVATAR_2D_PIC: '图片数字人',
  AVATAR_3D_TRADITIONAL: '传统 3D',
  AVATAR_UE_APPEARANCE: 'UE 数字人',
};

const BUSINESS_TYPE_LABELS: Record<AliyunAvatarBusinessType, string> = {
  BROADCAST: '播报形象',
  BROADCAST_CHAT: '播报 / 对话形象',
  CHAT: '对话形象',
  LIVE: '直播形象',
};

export const ALIYUN_PUBLIC_AVATARS: LiveAvatarCatalogItem[] = aliyunPublicAvatarData.map((avatar) => {
  const sourceType = avatar.sourceType as AliyunAvatarSourceType;
  const businessType = avatar.businessType as AliyunAvatarBusinessType;
  const isThreeDimensional = sourceType === 'AVATAR_3D_TRADITIONAL' || sourceType === 'AVATAR_UE_APPEARANCE';

  return {
    id: `aliyun-${avatar.id}`,
    officialId: avatar.id,
    name: avatar.name,
    role: BUSINESS_TYPE_LABELS[businessType],
    image: avatar.image,
    type: isThreeDimensional ? '卡通' : '真人',
    gender: avatar.gender === 'FEMALE' ? '女' : '男',
    scope: 'aliyun',
    providerName: '官方形象库',
    capability: SOURCE_TYPE_LABELS[sourceType],
    previewVideo: avatar.previewVideo ?? undefined,
    favorite: avatar.name === '灵锐',
    sourceType,
    businessType,
    aspectRatio: avatar.aspectRatio ?? undefined,
    transparent: avatar.transparent,
  };
});

export function aliyunAvatarForCloudVideo(avatar: LiveAvatarCatalogItem) {
  return avatar.scope === 'aliyun' && avatar.officialId ? avatar : undefined;
}

export const LIVE_AVATARS = [...LOCAL_LIVE_AVATARS, ...ALIYUN_PUBLIC_AVATARS];
