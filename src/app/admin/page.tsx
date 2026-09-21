'use client';

import Link from 'next/link';
import { Check, Coins, RefreshCw, WalletCards, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import './admin.css';

type ManagedUser = {
  id: string;
  username: string | null;
  email: string;
  role: 'admin' | 'user';
  status: string;
  creditBalance: number;
  unlimited: boolean;
  usedCredits: number;
  apiCalls: number;
  createdAt: string;
};

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/v1/${path}`, { cache: 'no-store', ...init });
  if (!response.ok) {
    const body = await response.json() as { detail?: string };
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function AdminPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setUsers(await getJson<ManagedUser[]>('admin/users'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取用户数据');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function review(user: ManagedUser, decision: 'approve' | 'reject') {
    setSaving(user.id); setMessage(''); setError('');
    try {
      await getJson(`auth/pending/${user.id}/${decision}`, { method: 'POST' });
      setMessage(`${user.username || user.email} 已${decision === 'approve' ? '通过审核' : '拒绝'}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核失败'); }
    finally { setSaving(''); }
  }

  async function recharge() {
    const amount = Number(rechargeAmount);
    if (!Number.isInteger(amount) || amount < 1 || !paymentReference.trim()) return;
    setSaving('recharge'); setMessage(''); setError('');
    try {
      await getJson('admin/credits/recharge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, payment_reference: paymentReference.trim() }),
      });
      setRechargeAmount(''); setPaymentReference('');
      setMessage(`充值 ${amount} 额度已按付款凭证入账`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '充值入账失败'); }
    finally { setSaving(''); }
  }

  async function allocate(user: ManagedUser) {
    const amount = Number(creditDrafts[user.id]);
    if (!Number.isInteger(amount) || amount < 1) return;
    setSaving(`allocate:${user.id}`); setMessage(''); setError('');
    try {
      await getJson(`admin/users/${user.id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
      });
      setCreditDrafts((current) => ({ ...current, [user.id]: '' }));
      setMessage(`已向 ${user.username || user.email} 分配 ${amount} 额度`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '额度分配失败'); }
    finally { setSaving(''); }
  }

  return <main className="adminPage">
    <header className="adminHeader"><div><Link href="/account">返回账号页面</Link><h1>用户与额度</h1></div><button type="button" onClick={() => void refresh()} title="刷新用户数据" aria-label="刷新用户数据"><RefreshCw size={18} /></button></header>
    {message && <p className="adminMessage" role="status">{message}</p>}
    {error && <p className="adminError" role="alert">{error}</p>}
    <section aria-label="用户与额度" className="adminContent">
      <h2>额度账户</h2>
      <p className="adminNote"><WalletCards size={16} />管理员 API 调用不限额。分配给普通用户的额度仍需实际付款入账。</p>
      <div className="adminCreditSummary"><span>可分配给用户的额度</span><strong>{users.find((user) => user.role === 'admin')?.creditBalance ?? 0}</strong></div>
      <div className="adminRecharge">
        <label><span>充值额度</span><input type="number" min="1" step="1" placeholder="输入实际购买额度" value={rechargeAmount} onChange={(event) => setRechargeAmount(event.target.value)} /></label>
        <label><span>付款凭证号</span><input type="text" maxLength={120} placeholder="每个凭证只能入账一次" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
        <button type="button" className="primary" disabled={saving === 'recharge' || !rechargeAmount || !paymentReference.trim()} onClick={() => void recharge()}><Coins size={15} />充值入账</button>
      </div>

      <h2 className="adminUsersHeading">用户列表</h2>
      {users.length ? <div className="adminUserList">{users.map((user) => <div className="adminUserRow" key={user.id}>
        <div className="adminUserIdentity"><strong>{user.username || user.email || '未命名账号'}</strong><small>{user.email || (user.role === 'admin' ? '管理员邮箱为空' : '邮箱为空')} · {user.role === 'admin' ? '管理员' : '普通用户'} · {user.status === 'approved' ? '已通过' : user.status === 'pending' ? '待审核' : '已拒绝'}</small></div>
        <div className="adminUserMetrics"><span><small>{user.unlimited ? '调用权限' : '可用额度'}</small><strong>{user.unlimited ? '不限额' : user.creditBalance}</strong></span><span><small>累计消耗</small><strong>{user.usedCredits}</strong></span><span><small>API 调用</small><strong>{user.apiCalls}</strong></span></div>
        {user.status === 'pending' ? <div className="adminUserActions"><button type="button" disabled={Boolean(saving)} onClick={() => void review(user, 'reject')}><X size={15} />拒绝</button><button type="button" disabled={Boolean(saving)} className="primary" onClick={() => void review(user, 'approve')}><Check size={15} />通过</button></div>
          : user.role === 'user' && user.status === 'approved' ? <div className="adminAllocate"><input type="number" min="1" step="1" aria-label={`分配给${user.username || user.email}的额度`} placeholder="分配额度" value={creditDrafts[user.id] || ''} onChange={(event) => setCreditDrafts((current) => ({ ...current, [user.id]: event.target.value }))} /><button type="button" className="primary" disabled={Boolean(saving) || !creditDrafts[user.id]} onClick={() => void allocate(user)}>分配</button></div> : <span className="adminUserLocked">{user.role === 'admin' ? '充值后可分配' : '不可分配'}</span>}
      </div>)}</div> : <p className="adminEmpty">暂无用户</p>}
    </section>
  </main>;
}
