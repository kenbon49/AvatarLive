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
    throw new Error(typeof body.detail === 'string' ? body.detail : `积分服务返回 HTTP ${response.status}`);
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

export async function bindApiUsage(request: Request, usageId: string, resourceId: string) {
  await billingFetch(request, `/usages/${encodeURIComponent(usageId)}/provider-reference`, {
    method: 'PUT',
    body: JSON.stringify({ resource_id: resourceId }),
  });
}

export async function failApiUsage(request: Request, usageId: string, reason: string) {
  await billingFetch(request, `/usages/${encodeURIComponent(usageId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'failed', reason }),
  });
}

export async function settleVideoUsage(request: Request, usageId: string, durationSeconds: number) {
  const response = await billingFetch(request, `/usages/${encodeURIComponent(usageId)}/settle-video`, {
    method: 'POST',
    body: JSON.stringify({ duration_seconds: durationSeconds }),
  });
  return response.json() as Promise<{ chargedMicros: number; upstreamCostMicros: number }>;
}
