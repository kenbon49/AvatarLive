import { getAliyunAvatarVideo } from '@/lib/server/aliyun-avatar-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DownloadRouteProps = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: DownloadRouteProps) {
  try {
    const { id } = await params;
    const video = await getAliyunAvatarVideo(id, { retryDownload: true });
    return Response.json({ video }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '透明数字人视频下载重试失败';
    return Response.json({ message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
