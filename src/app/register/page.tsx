'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { API_BASE } from '@/lib/api';
import '../login/auth.css';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError('两次输入的密码不一致'); return; }
    setPending(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = await response.json() as { detail?: string };
        throw new Error(body.detail || '注册失败');
      }
      setSuccess(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '注册失败'); }
    finally { setPending(false); }
  }

  return <main className="authScreen"><section className="authPanel"><h1>注册账号</h1>
    {success ? <p role="status">申请已提交。管理员审核通过后即可登录。</p> : <form onSubmit={submit}>
      <label>邮箱<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>密码（至少 12 位）<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label>确认密码<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
      {error && <p className="authError" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? '提交中…' : '提交注册申请'}</button>
    </form>}
    <Link href="/login">返回登录</Link>
  </section></main>;
}
