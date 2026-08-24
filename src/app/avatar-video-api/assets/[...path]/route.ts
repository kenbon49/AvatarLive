import path from 'node:path';
import { Readable } from 'node:stream';

import { avatarAssetFile } from '@/lib/avatar-video-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: segments } = await context.params;
    const asset = await avatarAssetFile(segments);
    const contentType = CONTENT_TYPES[path.extname(asset.filepath).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('range');
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
      'content-type': contentType,
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
      return new Response(Readable.toWeb(asset.stream(start, end)) as unknown as BodyInit, { status: 206, headers });
    }
    headers.set('content-length', String(asset.details.size));
    return new Response(Readable.toWeb(asset.stream()) as unknown as BodyInit, { headers });
  } catch {
    return Response.json({ message: '素材不存在' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
