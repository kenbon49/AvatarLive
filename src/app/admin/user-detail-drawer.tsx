'use client';

import { Ban, Check, RotateCcw, Save, UserRound, WalletCards, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

export type ManagedUser = {
  id: string;
  username: string | null;
  email: string;
  role: 'admin' | 'user';
  status: string;
  creditBalance: number;
  walletMicros: number;
  reservedMicros: number;
  unlimited: boolean;
  usedCredits: number;
  upstreamCostRmb: number;
  apiCalls: number;
  createdAt: string;
  reviewedAt?: string | null;
};

type UserDetail = {
  user: ManagedUser;
  resources: {
    liveRooms: number;
    products: number;
    platformConnections: number;
    activeSessions: number;
  };
  lastSessionAt: string | null;
  ledger: Array<{
    id: string;
    kind: string;
    amount: number;
    balanceAfter: number;
    amountMicros: number;
    balanceAfterMicros: number;
    description: string;
    createdAt: string;
  }>;
  usage: Array<{
    id: string;
    operation: string;
    status: string;
    credits: number;
    chargedMicros: number;
    upstreamCostMicros: number;
    reservedMicros: number;
    provider: string;
    model: string;
    pricingVersion: string;
    pricingTimeBand: string;
    createdAt: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    detail: Record<string, unknown>;
    actor: string;
    createdAt: string;
  }>;
};

export async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/v1/${path}`, { cache: 'no-store', ...init });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // Keep the HTTP fallback when the server does not return JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const STATUS_LABELS: Record<string, string> = {
  approved: '已通过',
  pending: '待审核',
  rejected: '已拒绝',
  suspended: '已停用',
};

const OPERATION_LABELS: Record<string, string> = {
  llm_chat: 'LLM 话术生成',
  storyboard_video: '数字人分镜合成',
};

const AUDIT_LABELS: Record<string, string> = {
  account_approved: '通过账户审核',
  account_rejected: '拒绝账户申请',
  account_suspended: '停用账户',
  account_restored: '恢复账户',
  credit_allocated: '快速分配积分',
  credit_adjusted: '调整积分',
};

function displayTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '暂无记录';
}

function displayCredits(micros: number) {
  return (micros / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

function auditSummary(action: string, detail: Record<string, unknown>) {
  const reason = typeof detail.reason === 'string' ? detail.reason : '';
  if (action === 'credit_allocated') return `增加 ${detail.amount ?? 0}，余额 ${detail.balanceAfter ?? 0}`;
  if (action === 'credit_adjusted') {
    const mode = detail.mode === 'subtract' ? '扣减' : detail.mode === 'set' ? '设定' : '增加';
    return `${mode} ${detail.amount ?? 0}，余额 ${detail.balanceAfter ?? 0}${reason ? ` · ${reason}` : ''}`;
  }
  return reason || '无附加说明';
}

export function UserDetailDrawer({
  user,
  onClose,
  onChanged,
}: {
  user: ManagedUser;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [adjustMode, setAdjustMode] = useState<'add' | 'subtract' | 'set'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await adminJson<UserDetail>(`admin/users/${user.id}`));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取用户详情');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  async function adjustCredits() {
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount < (adjustMode === 'set' ? 0 : 1) || adjustReason.trim().length < 2) return;
    setSaving('credits'); setError('');
    try {
      await adminJson(`admin/users/${user.id}/credits/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: adjustMode, amount, reason: adjustReason.trim() }),
      });
      setAdjustAmount(''); setAdjustReason('');
      await loadDetail();
      await onChanged(`已调整 ${detail?.user.username || detail?.user.email || user.email} 的积分`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '积分调整失败');
    } finally {
      setSaving('');
    }
  }

  async function changeStatus() {
    if (!detail || statusReason.trim().length < 2) return;
    const nextStatus = detail.user.status === 'suspended' ? 'approved' : 'suspended';
    setSaving('status'); setError('');
    try {
      await adminJson(`admin/users/${user.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reason: statusReason.trim() }),
      });
      setStatusReason('');
      await loadDetail();
      await onChanged(nextStatus === 'suspended' ? '账户已停用' : '账户已恢复');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户状态修改失败');
    } finally {
      setSaving('');
    }
  }

  const managedUser = detail?.user;
  const canManage = managedUser?.role === 'user' && ['approved', 'suspended'].includes(managedUser.status);

  return <div className="adminDrawerBackdrop" onMouseDown={onClose}>
    <section ref={drawerRef} className="adminDrawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <header className="adminDrawerHeader">
        <span className="adminDrawerAvatar"><UserRound size={20} /></span>
        <div><span>{user.role === 'admin' ? '系统管理员' : '普通用户'}</span><h2 id={titleId}>{user.username || user.email || '未命名账号'}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭用户详情" title="关闭"><X size={18} /></button>
      </header>
      <div className="adminDrawerContent">
        {loading && !detail ? <p className="adminEmpty">正在读取用户详情</p> : null}
        {error && <p className="adminError" role="alert">{error}</p>}
        {detail && <>
          <dl className="adminDetailSummary">
            <div><dt>账户状态</dt><dd><span className={`adminStatus ${detail.user.status}`}>{STATUS_LABELS[detail.user.status] || detail.user.status}</span></dd></div>
            <div><dt>可用积分</dt><dd>{detail.user.unlimited ? '不限额' : detail.user.creditBalance}</dd></div>
            <div><dt>累计消耗</dt><dd>{detail.user.usedCredits}</dd></div>
            <div><dt>API 调用</dt><dd>{detail.user.apiCalls}</dd></div>
          </dl>

          <section className="adminDetailSection">
            <h3>账户资料</h3>
            <dl className="adminDetailFacts">
              <div><dt>邮箱</dt><dd>{detail.user.email || '未填写'}</dd></div>
              <div><dt>注册时间</dt><dd>{displayTime(detail.user.createdAt)}</dd></div>
              <div><dt>审核时间</dt><dd>{displayTime(detail.user.reviewedAt)}</dd></div>
              <div><dt>最近登录</dt><dd>{displayTime(detail.lastSessionAt)}</dd></div>
            </dl>
            <div className="adminResourceMetrics">
              <span><small>直播间</small><strong>{detail.resources.liveRooms}</strong></span>
              <span><small>商品</small><strong>{detail.resources.products}</strong></span>
              <span><small>推流配置</small><strong>{detail.resources.platformConnections}</strong></span>
              <span><small>在线会话</small><strong>{detail.resources.activeSessions}</strong></span>
            </div>
          </section>

          {canManage && <section className="adminDetailSection">
            <h3>账户状态</h3>
            <div className="adminStatusControl">
              <input type="text" maxLength={200} placeholder="填写操作原因" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} />
              <button type="button" className={detail.user.status === 'suspended' ? 'primary' : 'danger'} disabled={saving === 'status' || statusReason.trim().length < 2} onClick={() => void changeStatus()}>
                {detail.user.status === 'suspended' ? <RotateCcw size={15} /> : <Ban size={15} />}
                {detail.user.status === 'suspended' ? '恢复账户' : '停用账户'}
              </button>
            </div>
          </section>}

          {canManage && <section className="adminDetailSection">
            <h3>调整积分</h3>
            <div className="adminAdjustmentModes" role="group" aria-label="积分调整方式">
              {([['add', '增加'], ['subtract', '扣减'], ['set', '设定']] as const).map(([mode, label]) => <button key={mode} type="button" className={adjustMode === mode ? 'active' : ''} aria-pressed={adjustMode === mode} onClick={() => setAdjustMode(mode)}>{label}</button>)}
            </div>
            <div className="adminAdjustmentControl">
              <label><span>积分</span><input type="number" min={adjustMode === 'set' ? 0 : 1} step="1" value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} /></label>
              <label><span>调整原因</span><input type="text" maxLength={200} value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} /></label>
              <button type="button" className="primary" disabled={saving === 'credits' || !adjustAmount || adjustReason.trim().length < 2} onClick={() => void adjustCredits()}><Save size={15} />保存</button>
            </div>
          </section>}

          <section className="adminDetailSection">
            <h3>积分流水</h3>
            {detail.ledger.length ? <div className="adminTimeline">{detail.ledger.map((entry) => <div key={entry.id}>
              <span className={entry.amountMicros >= 0 ? 'positive' : 'negative'}>{entry.amountMicros >= 0 ? '+' : ''}{displayCredits(entry.amountMicros)}</span>
              <p><strong>{entry.description || '积分变动'}</strong><small>余额 {displayCredits(entry.balanceAfterMicros)} · {displayTime(entry.createdAt)}</small></p>
            </div>)}</div> : <p className="adminEmpty">暂无积分流水</p>}
          </section>

          <section className="adminDetailSection">
            <h3>最近 API 调用</h3>
            {detail.usage.length ? <div className="adminTimeline">{detail.usage.map((entry) => <div key={entry.id}>
              <span><WalletCards size={15} /></span>
              <p><strong>{OPERATION_LABELS[entry.operation] || entry.operation}</strong><small>{entry.status} · {entry.status === 'succeeded' ? `结算 ${displayCredits(entry.chargedMicros)} 积分` : `冻结 ${displayCredits(entry.reservedMicros)} 积分`} · 上游 ¥{(entry.upstreamCostMicros / 1_000_000).toFixed(6)} · {displayTime(entry.createdAt)}</small></p>
            </div>)}</div> : <p className="adminEmpty">暂无 API 调用</p>}
          </section>

          <section className="adminDetailSection">
            <h3>操作审计</h3>
            {detail.audit.length ? <div className="adminTimeline adminAuditTimeline">{detail.audit.map((entry) => <div key={entry.id}>
              <span><Check size={15} /></span>
              <p><strong>{AUDIT_LABELS[entry.action] || entry.action}</strong><small>{auditSummary(entry.action, entry.detail)} · {entry.actor} · {displayTime(entry.createdAt)}</small></p>
            </div>)}</div> : <p className="adminEmpty">暂无管理操作</p>}
          </section>
        </>}
      </div>
    </section>
  </div>;
}
