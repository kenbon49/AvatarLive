'use client';

import { FileText, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExternalApiLog } from '@/lib/server/external-api-log';

const PROVIDERS: Record<string, string> = {
  llm: '大模型 / DeepSeek', bailian: '百炼语音', 'aliyun-avatar': '阿里云数字人',
  'aliyun-billing': '阿里云余额', content: '素材与图像视频', fish: 'Fish Audio', github: '版本检查', musetalk: '音色克隆',
};
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function ExternalApiLogPanel() {
  const [filters, setFilters] = useState({ provider: '', status: '', q: '' });
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>(['']);
  const [items, setItems] = useState<ExternalApiLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [automatic, setAutomatic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const cursor = cursors.at(-1) || '';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ ...filters, before: cursor });
    void fetch(`/external-api-logs-api?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || payload.detail || '无法读取接口日志');
        if (!Array.isArray(payload.items)) throw new Error('接口日志返回格式无效');
        setItems(payload.items); setNextCursor(payload.nextCursor); setWarning(payload.warning || '');
      }).catch(cause => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : '无法读取接口日志');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, cursor, refresh]);

  useEffect(() => {
    if (!automatic || cursor) return;
    const timer = window.setInterval(() => setRefresh(value => value + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [automatic, cursor]);

  function updateFilters(patch: Partial<typeof filters>) {
    setFilters(value => ({ ...value, ...patch })); setCursors(['']);
  }

  return <>
    <header className="accountAdminHeader">
      <div><span><FileText size={17} />管理员功能</span><h2>日志查看</h2></div>
      <button type="button" className="apiLogRefresh" disabled={loading} onClick={() => { setCursors(['']); setRefresh(value => value + 1); }}>
        <RefreshCw size={15} className={loading ? 'spinning' : ''} />刷新
      </button>
    </header>
    <p className="apiLogNote">查看最近 7 天保留的外部接口调用和报错。展开记录可查看详情，密钥和文件内容不会显示。</p>
    <form className="apiLogFilters" onSubmit={event => { event.preventDefault(); updateFilters({ q: search.trim() }); }}>
      <label><span>服务</span><select value={filters.provider} onChange={event => updateFilters({ provider: event.target.value })}>
        <option value="">全部服务</option>{Object.entries(PROVIDERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label><span>调用结果</span><select value={filters.status} onChange={event => updateFilters({ status: event.target.value })}>
        <option value="">全部结果</option><option value="error">仅失败</option><option value="success">仅成功</option>
      </select></label>
      <label className="apiLogSearch"><span>关键词</span><input value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="错误信息、模型、任务 ID 或接口地址" /></label>
      <button type="submit"><Search size={15} />查询</button>
      <label className="apiLogAutomatic"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />自动刷新</label>
    </form>
    {error && <p className="accountError" role="alert">{error}</p>}
    {warning && <p className="apiLogWarning" role="status">{warning}</p>}
    <div className="apiLogList" aria-busy={loading}>
      {!items.length && !error && <p className="apiLogEmpty" role="status">{loading ? '正在读取日志…' : '暂无符合条件的日志。更新后的外部接口调用会显示在这里。'}</p>}
      {items.map(item => <details className="apiLogEntry" key={item.id}>
        <summary>
          <span className={`apiLogStatus ${item.status}`}>{item.status === 'error' ? '失败' : '成功'}</span>
          <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
          <strong>{PROVIDERS[item.provider] || item.provider}<small>{item.operation}</small></strong>
          <span className="apiLogTiming">{item.httpStatus ? `HTTP ${item.httpStatus} · ` : ''}{item.durationMs} ms</span>
        </summary>
        <div className="apiLogDetail">
          <dl><div><dt>调用地址</dt><dd>{item.method} {item.url}</dd></div>
            <div><dt>调用来源</dt><dd>{item.source === 'api' ? '后端服务' : '前端服务'}{typeof item.context?.route === 'string' ? ` · ${item.context.route}` : ''}</dd></div>
            {item.requestId && <div><dt>服务请求 ID</dt><dd>{item.requestId}</dd></div>}
            {typeof item.context?.userId === 'string' && <div><dt>操作用户 ID</dt><dd>{item.context.userId}</dd></div>}
            <div><dt>日志 ID</dt><dd>{item.id}</dd></div>
          </dl>
          {([['异常详情', item.error], ['请求参数', item.request], ['返回内容', item.response]] as const).map(([label, value]) => value != null && <section key={label}>
            <h3>{label}</h3><pre>{pretty(value)}</pre>
          </section>)}
        </div>
      </details>)}
    </div>
    <footer className="apiLogPagination"><span>第 {cursors.length} 页 · {items.length} 条记录{automatic && !cursor ? ' · 每 10 秒刷新' : ''}</span>
      <button type="button" disabled={loading || cursors.length <= 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页</button>
      <button type="button" disabled={loading || !nextCursor || Boolean(error)} onClick={() => { if (nextCursor) setCursors(value => [...value, nextCursor]); }}>下一页</button>
    </footer>
  </>;
}
