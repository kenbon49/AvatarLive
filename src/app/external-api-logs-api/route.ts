import { readWebApiLogs } from '@/lib/server/external-api-logging';
import { logSortKey, type ExternalApiLog } from '@/lib/server/external-api-log';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const API_UPSTREAM = (process.env.API_UPSTREAM || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function GET(request: Request) {
  try {
    if (requireRequestUser(request).role !== 'admin') return Response.json({ message: '仅管理员可查看日志' }, { status: 403 });
  } catch { return Response.json({ message: '请先登录' }, { status: 401 }); }
  const search = new URL(request.url).searchParams;
  const query = {
    provider: (search.get('provider') || '').slice(0, 60), status: search.get('status') || '',
    q: (search.get('q') || '').slice(0, 120), before: (search.get('before') || '').slice(0, 100), limit: 51,
  };
  if (!['', 'success', 'error'].includes(query.status)) return Response.json({ message: '日志筛选参数无效' }, { status: 400 });
  const upstreamQuery = new URLSearchParams({ ...query, limit: String(query.limit) });
  let apiItems: ExternalApiLog[] = [];
  let warning = '';
  try {
    const response = await fetch(`${API_UPSTREAM}/api/v1/admin/external-api-logs?${upstreamQuery}`, {
      headers: { cookie: request.headers.get('cookie') || '' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401 || response.status === 403) return Response.json({ message: '仅管理员可查看日志' }, { status: response.status });
    if (!response.ok) throw new Error('后端日志暂时无法读取');
    const payload = await response.json() as { items?: ExternalApiLog[] };
    if (!Array.isArray(payload.items)) throw new Error('后端日志返回格式无效');
    apiItems = payload.items;
  } catch { warning = '后端日志暂时无法读取，当前仅显示前端服务的日志。请确认后端已更新并正常运行。'; }
  let webItems: ExternalApiLog[] = [];
  try { webItems = await readWebApiLogs(query); }
  catch { warning += ' 前端日志读取失败，请检查日志目录权限。'; }
  const all = [...webItems, ...apiItems].sort((a, b) => logSortKey(b).localeCompare(logSortKey(a)));
  const items = all.slice(0, 50);
  return Response.json({ items, nextCursor: all.length > 50 ? logSortKey(items[49]) : null, warning }, {
    headers: { 'cache-control': 'private, no-store' },
  });
}
