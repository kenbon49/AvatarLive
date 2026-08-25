import { loadFishPresets } from '@/lib/server/avatar-voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const presets = await loadFishPresets();
    return Response.json({
      presets: presets.map(({ id, name, detail, tags }) => ({
        id,
        name,
        detail,
        tags,
        audio_url: `/avatar-voice-api/presets/${encodeURIComponent(id)}/audio`,
      })),
    }, { headers: { 'cache-control': 'private, max-age=300' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Fish Audio 推荐音色查询失败';
    return Response.json({ presets: [], message }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
