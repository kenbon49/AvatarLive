import { getBailianTts, BailianTtsError } from '@/lib/server/bailian-tts';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  let user: ReturnType<typeof requireRequestUser>;
  try { user = requireRequestUser(request); } catch {
    return Response.json({ message: '请先登录' }, { status: 401 });
  }
  try {
    const input = await request.json().catch(() => null) as { text?: unknown; voiceId?: unknown } | null;
    if (!input || typeof input.text !== 'string' || typeof input.voiceId !== 'string') {
      return Response.json({ message: '请填写试听文本并选择数字人声音' }, { status: 400 });
    }
    const client = await getBailianTts(request);
    const result = await client.synthesize(input.text.trim(), input.voiceId.trim(), user.id);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({
      message: error instanceof BailianTtsError ? error.message : '当前文本语音合成失败，请检查语音文件和运行目录',
    }, { status: error instanceof BailianTtsError ? error.status : 502, headers: { 'cache-control': 'no-store' } });
  }
}
