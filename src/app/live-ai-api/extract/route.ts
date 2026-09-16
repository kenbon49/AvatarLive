import { fetchSeoService } from '@/lib/server/seo-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const input = await request.formData();
    const file = input.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES) {
      return Response.json({ message: '文件大小必须在 20 MB 以内' }, { status: 400 });
    }
    const form = new FormData();
    form.append('file', file, file.name);
    const { response } = await fetchSeoService('/api/llm/extract-file', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => ({})) as { success?: unknown; text?: unknown; filename?: unknown; message?: unknown };
    if (!response.ok || payload.success !== true || typeof payload.text !== 'string') {
      const message = typeof payload.message === 'string' ? payload.message : '文件内容提取失败';
      return Response.json({ message }, { status: response.ok ? 502 : response.status });
    }
    return Response.json({ text: payload.text, filename: typeof payload.filename === 'string' ? payload.filename : file.name });
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '文件内容提取失败' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
