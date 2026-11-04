'use client';

import Link from 'next/link';
import { ChevronRight, CircleHelp, Images, Radio, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ServiceCenter } from '@/components/service-center';
import { API_BASE } from '@/lib/api';

type Account = { email: string; username: string | null; role: 'admin' | 'user' };

export function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const live = pathname.startsWith('/live');
  const library = pathname === '/';
  const [serviceOpen, setServiceOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/api/v1/auth/me`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<Account> : null)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  return (
    <div className="consoleShell">
      <aside className="consoleSidebar">
        <Link className="consoleBrand" href="/" aria-label="AI数字人控制台">
          <span className="brandMark"><Sparkles size={19} /></span>
          <span><strong>AI数字人</strong><small>AI AVATAR</small></span>
        </Link>

        <nav className="consoleNav" aria-label="数字人产品">
          <span className="navSectionLabel">数字人产品</span>
          <Link className={library ? 'active' : ''} href="/">
            <Images size={18} />
            <span>数字人形象库</span>
          </Link>
          <Link className={live ? 'active' : ''} href="/live">
            <Radio size={18} />
            <span>直播</span>
          </Link>
        </nav>

        <div className="sidebarUtilities">
          <button type="button" aria-expanded={serviceOpen} onClick={() => setServiceOpen(true)}><CircleHelp size={17} /><span>服务与支持</span></button>
          <Link className="sidebarAccount" href="/account" aria-label="账号管理">
            <span className="accountAvatar">{(account?.username || account?.email)?.slice(0, 2).toUpperCase() || '··'}</span>
            <span className="sidebarAccountDetails"><strong>{account?.role === 'admin' ? '管理员' : '用户'}</strong><small>{account?.username || account?.email || '正在读取账号'}</small></span>
            <ChevronRight className="sidebarAccountArrow" size={15} />
          </Link>
        </div>
      </aside>

      <div className="consoleBody">
        {children}
      </div>
      <ServiceCenter open={serviceOpen} onClose={() => setServiceOpen(false)} />
    </div>
  );
}
