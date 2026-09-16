import { fetchSeoService } from '@/lib/server/seo-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await context.params;
    if (!/^bailian_tts_[A-Za-z0-9_.-]+\.mp3$/.test(filename)) {
      return Response.json({ message: '无效的语音文件' }, { status: 400 });
    }
    const { response } = await fetchSeoService(`/api/bailian-tts/audio/${encodeURIComponent(filename)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return Response.json({ message: '语音文件读取失败' }, { status: 502 });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
      return Response.json({ message: '语音文件大小无效' }, { status: 502 });
    }
    const isWave = bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
    return new Response(bytes, {
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-length': String(bytes.length),
        'content-type': isWave ? 'audio/wav' : response.headers.get('content-type') || 'audio/mpeg',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '语音文件读取失败' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
