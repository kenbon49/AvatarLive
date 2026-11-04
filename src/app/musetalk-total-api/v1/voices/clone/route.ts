import { externalApi } from '@/lib/server/external-api-logging';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const upstream = (process.env.MUSETALK_TOTAL_UPSTREAM || 'http://127.0.0.1:8085').replace(/\/$/, '');
  try {
    const form = await request.formData();
    const response = await externalApi.fetch('musetalk', '克隆音色', `${upstream}/v1/voices/clone`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown proxy error';
    return Response.json({ detail: `音色克隆代理失败：${detail}` }, { status: 502 });
  }
}
