'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { API_BASE } from '@/lib/api';
import './auth.css';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }), credentials: 'same-origin',
      });
      if (!response.ok) {
        const body = await response.json() as { detail?: string };
        throw new Error(body.detail || '登录失败');
      }
      const session = await fetch(`${API_BASE}/api/v1/auth/me`, {
        cache: 'no-store', credentials: 'same-origin',
      });
      if (!session.ok) {
        throw new Error('登录状态未能保存，请刷新页面后重试');
      }
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      setPending(false);
    }
  }

  return <main className="authScreen"><section className="authPanel"><h1>登录</h1><p>数字人控制台</p>
    <form onSubmit={submit}>
      <label>账号或邮箱<input type="text" autoCapitalize="none" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <p className="authError" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? '登录中…' : '登录'}</button>
    </form><Link href="/register">注册账号</Link>
  </section></main>;
}
