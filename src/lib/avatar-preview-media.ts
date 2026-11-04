import type { Avatar } from '@/lib/avatar-catalog';

export const IDLE_VIDEO_BY_AVATAR_ID: Readonly<Partial<Record<string, string>>> = {
  chinese: '/assets/musetalk-default/chinese2-cycle-4to7-d0853621.mp4',
};

export function avatarPreviewVideo(avatarId: string) {
  return IDLE_VIDEO_BY_AVATAR_ID[avatarId] ?? '';
}

export function avatarIdleVideo(avatar: Avatar) {
  if (avatar.video) {
    // Loop-capable and legacy generated videos display the complete motion.
    // A one-shot gesture returns to its short neutral idle clip afterward.
    return avatar.video.motion?.mode === 'once'
      ? avatar.video.idleVideo || avatar.video.talkVideo
      : avatar.video.talkVideo || avatar.video.idleVideo;
  }
  return avatar.custom ? '' : IDLE_VIDEO_BY_AVATAR_ID[avatar.id] ?? '';
}

export function avatarUsesSharedMuseTalkCycle(avatar: Avatar) {
  return avatar.id === 'chinese'
    && avatar.profile === 'chinese'
    && !avatar.custom
    && !avatar.video;
}
