import { getAliyunAvatarVideo } from '@/lib/server/aliyun-avatar-video';
import { assertAliyunVideoOwner } from '@/lib/server/aliyun-task-ownership';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DownloadRouteProps = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: DownloadRouteProps) {
  try {
    const { id } = await params;
    await assertAliyunVideoOwner(id, requireRequestUser(request));
    const video = await getAliyunAvatarVideo(id, { retryDownload: true });
    return Response.json({ video }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '透明数字人视频下载重试失败';
    return Response.json({ message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
