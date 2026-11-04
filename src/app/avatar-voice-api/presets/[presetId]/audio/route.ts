import { getFishPreset, isAllowedFishAudioUrl } from '@/lib/server/avatar-voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
]);

function sniffAudioType(bytes: Buffer, declaredType: string) {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return declaredType === 'audio/m4a' ? 'audio/m4a' : 'audio/mp4';
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ presetId: string }> }) {
  try {
    const { presetId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(presetId)) return Response.json({ message: '无效的推荐音色' }, { status: 400 });
    const preset = await getFishPreset(presetId);
    if (!preset) return Response.json({ message: '推荐音色不存在或暂无试听' }, { status: 404 });
    if (!isAllowedFishAudioUrl(preset.sampleUrl)) return Response.json({ message: '推荐音色地址无效' }, { status: 502 });

    const upstream = await fetch(preset.sampleUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok || !isAllowedFishAudioUrl(upstream.url)) {
      return Response.json({ message: '推荐音色试听读取失败' }, { status: 502 });
    }
    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > MAX_AUDIO_BYTES) return Response.json({ message: '推荐音色试听超过 20 MB' }, { status: 502 });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return Response.json({ message: '推荐音色试听大小无效' }, { status: 502 });
    const rawType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO_TYPES.has(rawType)) return Response.json({ message: '推荐音色试听格式无效' }, { status: 502 });
    const contentType = sniffAudioType(bytes, rawType);
    if (!contentType) return Response.json({ message: '推荐音色试听内容无效' }, { status: 502 });
    return new Response(bytes, {
      headers: {
        'accept-ranges': 'none',
        'cache-control': 'public, max-age=86400',
        'content-length': String(bytes.length),
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '推荐音色试听代理失败';
    return Response.json({ message }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
