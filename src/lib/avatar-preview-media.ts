export const IDLE_VIDEO_BY_AVATAR_ID: Readonly<Partial<Record<string, string>>> = {
  chinese: '/assets/musetalk-default/idle-chinese2-0to1-d0853621.mp4',
  'business-male-1': '/assets/musetalk-default/idle-business-male-0to1-9b3d19af.mp4',
  chenyu: '/assets/musetalk-default/idle-chen-yu-0to1-4e6b2339.mp4',
};

export function avatarPreviewVideo(avatarId: string) {
  return IDLE_VIDEO_BY_AVATAR_ID[avatarId] ?? '';
}
