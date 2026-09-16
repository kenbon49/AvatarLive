import { getAliyunAvatarVideo } from '@/lib/server/aliyun-avatar-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type VideoRouteProps = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: VideoRouteProps) {
  try {
    const { id } = await params;
    const video = await getAliyunAvatarVideo(id);
    return Response.json({ video }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '数字人口播状态读取失败';
    return Response.json({ message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
