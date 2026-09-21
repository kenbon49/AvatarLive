'use client';

import { CheckCircle2, Download, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SupportNav } from '@/components/support-nav';
import styles from '@/app/support.module.css';

type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  branch: string;
  updateAvailable: boolean;
  canManage: boolean;
  latestMessage: string;
  latestPublishedAt: string | null;
  checkedAt: string;
  updateState: { status?: string; message?: string; version?: string; updatedAt?: string } | null;
};

export default function UpdatesPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const apply = useCallback(async () => {
    if (updating) return;
    setUpdating(true);
    setMessage(''); setError('');
    try {
      const response = await fetch('/system-update-api/apply', { method: 'POST' });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || '无法启动系统更新');
      setMessage(body.message || '系统更新已启动');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法启动系统更新');
      setUpdating(false);
    }
  }, [updating]);

  const check = useCallback(async () => {
    setChecking(true); setError('');
    try {
      const response = await fetch('/system-update-api/status', { cache: 'no-store' });
      const body = await response.json() as UpdateStatus & { message?: string };
      if (!response.ok) throw new Error(body.message || '版本检测失败');
      setStatus(body);
      if (!body.updateAvailable || ['current', 'complete', 'blocked', 'failed'].includes(body.updateState?.status || '')) {
        setUpdating(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '版本检测失败');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [check]);

  const current = status && !status.updateAvailable;
  return <main className={styles.page}><SupportNav title="版本更新" />
    <section className={styles.section}>
      <div className={styles.updateHeading}><div><h2>系统版本</h2><p>管理员手动更新；存在合并冲突时不会覆盖本地内容。</p></div>
        <div className={styles.updateActions}>
          <button className={styles.action} type="button" disabled={checking || updating} onClick={() => void check()}>{checking ? <LoaderCircle size={15} /> : <RefreshCw size={15} />}手动检测</button>
          {status?.updateAvailable && status.canManage && <button className={styles.action} type="button" disabled={updating} onClick={() => void apply()}>{updating ? <LoaderCircle size={15} /> : <Download size={15} />}{updating ? '正在更新' : '立即更新'}</button>}
        </div></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.updateMessage} role="status">{message}</p>}
      <div className={styles.versionGrid}>
        <div><span>当前版本</span><strong>{status?.currentVersion || '正在检测'}</strong><small>{status?.branch || '—'}</small></div>
        <div><span>最新版本</span><strong>{status?.latestVersion || '正在检测'}</strong><small>{status?.latestPublishedAt ? new Date(status.latestPublishedAt).toLocaleString('zh-CN') : '—'}</small></div>
      </div>
      {status && <div className={`${styles.updateState} ${current ? styles.updateCurrent : styles.updatePending}`}>
        {current ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
        <div><strong>{current ? '当前已是最新版本' : status.canManage ? '检测到新版本，可手动更新' : '检测到新版本，请联系管理员更新'}</strong>
          <span>{status.latestMessage || status.updateState?.message || '版本状态已同步'}</span></div>
      </div>}
      {status?.updateState?.message && <p className={styles.updateNote}>最近更新任务：{status.updateState.message}{status.updateState.updatedAt ? ` · ${new Date(status.updateState.updatedAt).toLocaleString('zh-CN')}` : ''}</p>}
    </section>
  </main>;
}
