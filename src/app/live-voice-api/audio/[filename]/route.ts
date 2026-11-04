import { bailianTts, BailianTtsError } from '@/lib/server/bailian-tts';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ filename: string }> }) {
  let user: ReturnType<typeof requireRequestUser>;
  try { user = requireRequestUser(request); } catch {
    return Response.json({ message: '请先登录' }, { status: 401 });
  }
  try {
    const { filename } = await context.params;
    const audio = await bailianTts.readAudio(filename, user.id);
    return new Response(new Uint8Array(audio.bytes), {
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-length': String(audio.bytes.length),
        'content-type': audio.mime,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({ message: error instanceof BailianTtsError ? error.message : '语音文件读取失败' }, {
      status: error instanceof BailianTtsError ? error.status : 502,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
