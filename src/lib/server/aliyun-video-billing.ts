import 'server-only';

import { aliyunAvatarVideoDuration, type AliyunAvatarVideo } from '@/lib/server/aliyun-avatar-video';
import type { AliyunVideoOwnership } from '@/lib/server/aliyun-task-ownership';
import { failApiUsage, settleVideoUsage } from '@/lib/server/billing';

export async function reconcileAliyunVideoBilling(
  request: Request,
  user: { id: string },
  ownership: AliyunVideoOwnership,
  video: AliyunAvatarVideo,
) {
  if (!ownership.usageId || ownership.ownerId !== user.id) return video;
  if (video.status === 'ERROR') {
    await failApiUsage(request, ownership.usageId, video.error || '阿里云数字人合成失败')
      .catch((cause) => console.warn('[avatar-video] billing refund failed', cause));
    return video;
  }
  if (video.status !== 'SUCCESS' || video.download?.status !== 'ready') return video;
  try {
    const durationSeconds = await aliyunAvatarVideoDuration(video.id);
    await settleVideoUsage(request, ownership.usageId, durationSeconds);
    return { ...video, durationSeconds };
  } catch (cause) {
    // A local probe or billing-service failure does not change the upstream
    // synthesis result. A later poll will retry reconciliation idempotently.
    console.warn('[avatar-video] billing settlement deferred', cause);
    return video;
  }
}
