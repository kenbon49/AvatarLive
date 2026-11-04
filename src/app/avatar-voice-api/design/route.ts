import { getBailianTts, BailianTtsError } from '@/lib/server/bailian-tts';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: Request) {
  try { requireRequestUser(request); } catch {
    return Response.json({ success: false, message: '请先登录' }, { status: 401 });
  }
  try {
    const input = await request.json().catch(() => null) as { voice_prompt?: unknown; preview_text?: unknown } | null;
    if (!input || typeof input.voice_prompt !== 'string' || typeof input.preview_text !== 'string') {
      return Response.json({ success: false, message: '请填写声音描述和试听文本' }, { status: 400 });
    }
    const client = await getBailianTts(request);
    return Response.json(await client.designVoice(input.voice_prompt.trim(), input.preview_text.trim()), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({
      success: false,
      message: error instanceof BailianTtsError ? error.message : '百炼声音设计失败',
      provider_accepted: error instanceof BailianTtsError && error.providerAccepted,
    }, { status: error instanceof BailianTtsError ? error.status : 502, headers: { 'cache-control': 'no-store' } });
  }
}
