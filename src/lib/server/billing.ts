import 'server-only';

const API_UPSTREAM = (process.env.API_UPSTREAM || 'http://127.0.0.1:8000').replace(/\/$/, '');

type MeteredOperation = 'llm_chat' | 'storyboard_video';

async function billingFetch(request: Request, path: string, init: RequestInit) {
  const response = await fetch(`${API_UPSTREAM}/api/v1/billing${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      cookie: request.headers.get('cookie') || '',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: unknown };
    throw new Error(typeof body.detail === 'string' ? body.detail : `额度服务返回 HTTP ${response.status}`);
  }
  return response;
}

export async function chargeApiUsage(
  request: Request,
  operation: MeteredOperation,
  reference: string,
  detail: Record<string, unknown> = {},
) {
  const response = await billingFetch(request, '/charge', {
    method: 'POST',
    body: JSON.stringify({ operation, reference, detail }),
  });
  return response.json() as Promise<{ usageId: string; credits: number; balance: number }>;
}

export async function markApiUsage(request: Request, usageId: string, status: 'succeeded' | 'failed') {
  await billingFetch(request, `/usages/${encodeURIComponent(usageId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
