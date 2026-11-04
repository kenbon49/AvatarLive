import { aliyunAvatarVideoConfiguration } from '@/lib/server/aliyun-avatar-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(aliyunAvatarVideoConfiguration(), { headers: { 'cache-control': 'no-store' } });
}
