'use client';

import Link from 'next/link';
import { Check, Eye, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { adminJson, type ManagedUser, UserDetailDrawer } from './user-detail-drawer';
import './admin.css';

const STATUS_LABELS: Record<string, string> = { approved: '已通过', pending: '待审核', rejected: '已拒绝', suspended: '已停用' };

type BillingStatus = {
  funding: {
    availableCredits: number;
    availableMicros: number;
    fundedMicros: number;
    allocatedMicros: number;
    returnedMicros: number;
    userWalletMicros: number;
    userWalletCredits: number;
  };
  providerBalance: {
    status: string;
    availableRmb: number | null;
    availableCredits: number | null;
    fetchedAt: string | null;
  };
  creditsPerRmb: number;
};

export default function AdminPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  const refresh = useCallback(async () => {
    const billingRequest = adminJson<BillingStatus>('admin/billing-status')
      .then(setBilling)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : '无法读取资金状态');
      });
    try {
      setUsers(await adminJson<ManagedUser[]>('admin/users'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取用户数据');
    }
    await billingRequest;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void adminJson<BillingStatus>('admin/billing-status').then(setBilling).catch(() => undefined);
    }, 600_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshProviderBalance() {
    setSaving('provider-balance'); setMessage(''); setError('');
    try {
      const next = await adminJson<BillingStatus>('admin/provider-balances/aliyun/refresh', { method: 'POST' });
      if (next.providerBalance.status !== 'ok' || next.providerBalance.availableCredits == null) {
        throw new Error('阿里云余额刷新失败，请稍后重试');
      }
      setBilling(next);
      setMessage(`平台可用积分已刷新，当前 ${next.funding.availableCredits.toLocaleString('zh-CN')} 积分`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '阿里云余额刷新失败，请稍后重试');
    } finally {
      setSaving('');
    }
  }

  async function review(user: ManagedUser, decision: 'approve' | 'reject') {
    setSaving(user.id); setMessage(''); setError('');
    try {
      await adminJson(`auth/pending/${user.id}/${decision}`, { method: 'POST' });
      setMessage(`${user.username || user.email} 已${decision === 'approve' ? '通过审核' : '拒绝'}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核失败'); }
    finally { setSaving(''); }
  }

  async function allocate(user: ManagedUser) {
    const amount = Number(creditDrafts[user.id]);
    if (!Number.isInteger(amount) || amount < 1) return;
    setSaving(`allocate:${user.id}`); setMessage(''); setError('');
    try {
      await adminJson(`admin/users/${user.id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
      });
      setCreditDrafts((current) => ({ ...current, [user.id]: '' }));
      setMessage(`已向 ${user.username || user.email} 分配 ${amount} 积分`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '积分分配失败'); }
    finally { setSaving(''); }
  }

  const closeDetails = useCallback(() => setSelectedUser(null), []);
  const handleUserChanged = useCallback(async (statusMessage: string) => {
    setMessage(statusMessage); setError('');
    await refresh();
  }, [refresh]);

  return <main className="adminPage">
    <header className="adminHeader"><div><Link href="/account">返回账号页面</Link><h1>用户管理</h1></div><button type="button" onClick={() => void refresh()} title="刷新用户数据" aria-label="刷新用户数据"><RefreshCw size={18} /></button></header>
    {message && <p className="adminMessage" role="status">{message}</p>}
    {error && <p className="adminError" role="alert">{error}</p>}
    <section className="adminBillingBar" aria-label="平台积分">
      <div className="adminBalanceMetric">
        <small>平台可用积分</small>
        <strong>{billing ? `${billing.funding.availableCredits.toLocaleString('zh-CN')} 积分` : '读取中'}</strong>
      </div>
      <button type="button" className="adminBalanceRefresh" title="刷新平台可用积分" aria-label="刷新平台可用积分" disabled={saving === 'provider-balance'} onClick={() => void refreshProviderBalance()}><RefreshCw className={saving === 'provider-balance' ? 'spinning' : ''} size={15} /></button>
    </section>
    <section aria-label="用户管理" className="adminContent">
      <h2>用户列表</h2>
      {users.length ? <div className="adminUserList">{users.map((user) => <div className="adminUserRow" key={user.id}>
        <div className="adminUserIdentity"><strong>{user.username || user.email || '未命名账号'}</strong><small>{user.email || (user.role === 'admin' ? '管理员邮箱为空' : '邮箱为空')} · {user.role === 'admin' ? '管理员' : '普通用户'} · {STATUS_LABELS[user.status] || user.status}</small></div>
        <div className="adminUserMetrics"><span><small>{user.unlimited ? 'API 调用权限' : '可用积分'}</small><strong>{user.unlimited ? '不限额' : user.creditBalance}</strong></span><span><small>累计消耗</small><strong>{user.usedCredits}</strong></span><span><small>API 调用</small><strong>{user.apiCalls}</strong></span></div>
        <div className="adminUserActions">
          {user.status === 'pending' && <><button type="button" disabled={Boolean(saving)} onClick={() => void review(user, 'reject')}><X size={15} />拒绝</button><button type="button" disabled={Boolean(saving)} className="primary" onClick={() => void review(user, 'approve')}><Check size={15} />通过</button></>}
          {user.role === 'user' && user.status === 'approved' && <div className="adminAllocate"><input type="number" min="1" step="1" aria-label={`分配给${user.username || user.email}的积分`} placeholder="分配积分" value={creditDrafts[user.id] || ''} onChange={(event) => setCreditDrafts((current) => ({ ...current, [user.id]: event.target.value }))} /><button type="button" className="primary" disabled={Boolean(saving) || !creditDrafts[user.id]} onClick={() => void allocate(user)}>分配</button></div>}
          <button type="button" onClick={() => setSelectedUser(user)} title="查看用户详情"><Eye size={15} />详情</button>
        </div>
      </div>)}</div> : <p className="adminEmpty">暂无用户</p>}
    </section>
    {selectedUser && <UserDetailDrawer user={selectedUser} onClose={closeDetails} onChanged={handleUserChanged} />}
  </main>;
}
