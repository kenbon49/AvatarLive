'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SupportNav } from '@/components/support-nav';
import { API_BASE } from '@/lib/api';
import styles from '@/app/support.module.css';

type Usage = { id: string; operation: string; label: string; status: string; credits: number; chargedCredits: number; reservedCredits: number; upstreamCostRmb: number; createdAt: string };
type Report = {
  periodDays: number; currentBalance: number; unlimited: boolean; totalCalls: number; successfulCalls: number;
  failedCalls: number; chargedCredits: number; upstreamCostRmb: number; operationCounts: Record<string, number>;
  pricing: { operation: string; label: string; credits: number | null; description: string }[]; recentUsages: Usage[];
};

export default function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      const response = await fetch(`${API_BASE}/api/v1/resources/report`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport(await response.json() as Report);
      setError('');
    } catch { setError('无法读取运行记录，请稍后再试'); }
  }
  useEffect(() => { void refresh(); }, []);

  return <main className={styles.page}><SupportNav title="运行报告" />
    <section className={styles.section}>
      <div className={styles.reportHeading}>
        <div><h2>最近 30 天 API 用量</h2><p>当前账号的 LLM 话术与分镜合成调用。</p></div>
        <button className={styles.action} type="button" title="刷新报告" aria-label="刷新报告" onClick={() => void refresh()}><RefreshCw size={16} /></button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!report && !error && <p>正在读取任务记录…</p>}
      {report && <><div className={styles.metricGrid}>
        <div className={styles.metric}><strong>{report.unlimited ? '不限额' : report.currentBalance}</strong><span>{report.unlimited ? 'API 调用' : '当前可用积分'}</span></div>
        <div className={styles.metric}><strong>{report.totalCalls}</strong><span>API 调用</span></div>
        <div className={styles.metric}><strong>{report.chargedCredits}</strong><span>已扣积分</span></div>
        <div className={styles.metric}><strong>{report.operationCounts.llm_chat || 0}</strong><span>LLM 调用</span></div>
        <div className={styles.metric}><strong>{report.operationCounts.storyboard_video || 0}</strong><span>分镜合成</span></div>
        <div className={styles.metric}><strong>{report.failedCalls}</strong><span>失败调用</span></div>
      </div><div className={styles.reportGroup}><h3>积分标准</h3><p>{report.unlimited ? '管理员调用不扣积分，但记录上游实际成本。' : ''}{report.pricing.map((item) => `${item.label}：${item.description}`).join('；')}。</p></div>
      <div className={styles.reportGroup}><h3>最近调用</h3>{report.recentUsages.length ? report.recentUsages.map((usage) => <div className={styles.row} key={usage.id}>
        <span>{usage.label} · {usage.status === 'succeeded' ? '成功' : usage.status === 'failed' ? '失败' : '处理中'} · {usage.chargedCredits ? `-${usage.chargedCredits} 积分` : usage.status === 'failed' ? '已释放冻结' : `冻结 ${usage.reservedCredits} 积分`}</span><small>{new Date(usage.createdAt).toLocaleString('zh-CN')}</small>
      </div>) : <p>该时间段暂无 API 调用。</p>}</div></>}
    </section>
  </main>;
}
