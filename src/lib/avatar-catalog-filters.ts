import type { LiveAvatarCatalogItem } from '@/lib/live-avatar-catalog';

export type AvatarGenderFilter = '全部' | LiveAvatarCatalogItem['gender'];
export type AvatarTypeFilter = '全部类型' | '2D' | '3D / UE';
export type AvatarSceneFilter = '全部场景' | '播报' | '对话' | '直播';

export function matchesAvatar(
  avatar: LiveAvatarCatalogItem,
  query: string,
  gender: AvatarGenderFilter,
  type: AvatarTypeFilter,
  scene: AvatarSceneFilter,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const matchesQuery = !normalizedQuery
    || `${avatar.name}${avatar.role}${avatar.providerName}${avatar.capability}${avatar.officialId ?? ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedQuery);
  const matchesGender = gender === '全部' || avatar.gender === gender;
  const isThreeDimensional = avatar.sourceType === 'AVATAR_3D_TRADITIONAL'
    || avatar.sourceType === 'AVATAR_UE_APPEARANCE';
  const matchesType = type === '全部类型'
    || (type === '2D' && !isThreeDimensional)
    || (type === '3D / UE' && isThreeDimensional);
  const matchesScene = scene === '全部场景'
    || (scene === '播报' && (avatar.businessType === 'BROADCAST' || avatar.businessType === 'BROADCAST_CHAT'))
    || (scene === '对话' && (avatar.businessType === 'CHAT' || avatar.businessType === 'BROADCAST_CHAT'))
    || (scene === '直播' && avatar.businessType === 'LIVE');
  return matchesQuery && matchesGender && matchesType && matchesScene;
}
