import { aliyunAvatarVideoFile } from '@/lib/server/aliyun-avatar-video';
import { responseBodyStream } from '@/lib/server/response-body-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MediaRouteProps = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: MediaRouteProps) {
  try {
    const { id } = await params;
    const asset = await aliyunAvatarVideoFile(id);
    const range = request.headers.get('range');
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': `inline; filename="aliyun-avatar-${id}.webm"`,
      'content-type': 'video/webm',
    });
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
      if (!match) return new Response(null, { status: 416 });
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : asset.details.size - 1;
      const end = Math.min(requestedEnd, asset.details.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        return new Response(null, { status: 416 });
      }
      headers.set('content-length', String(end - start + 1));
      headers.set('content-range', `bytes ${start}-${end}/${asset.details.size}`);
      return new Response(responseBodyStream(asset.stream(start, end)) as unknown as BodyInit, { status: 206, headers });
    }
    headers.set('content-length', String(asset.details.size));
    return new Response(responseBodyStream(asset.stream()) as unknown as BodyInit, { headers });
  } catch {
    return Response.json({ message: '透明数字人视频不存在' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
