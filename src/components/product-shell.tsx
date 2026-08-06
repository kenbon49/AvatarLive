'use client';

import Link from 'next/link';
import { CircleHelp, MessageSquareText, Radio, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';

export function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const live = pathname.startsWith('/live');

  return (
    <div className="consoleShell">
      <aside className="consoleSidebar">
        <Link className="consoleBrand" href="/" aria-label="AI数字人控制台">
          <span className="brandMark"><Sparkles size={19} /></span>
          <span><strong>AI数字人</strong><small>AI AVATAR</small></span>
        </Link>

        <nav className="consoleNav" aria-label="数字人产品">
          <span className="navSectionLabel">数字人产品</span>
          <Link className={!live ? 'active' : ''} href="/">
            <MessageSquareText size={18} />
            <span>对话互动</span>
          </Link>
          <Link className={live ? 'active' : ''} href="/live">
            <Radio size={18} />
            <span>数字人直播</span>
          </Link>
        </nav>

        <div className="sidebarUtilities">
          <button type="button"><CircleHelp size={17} /><span>帮助中心</span></button>
          <div className="sidebarAccount">
            <span className="accountAvatar">AV</span>
            <span><strong>体验用户</strong><small>AI数字人控制台</small></span>
          </div>
        </div>
      </aside>

      <div className="consoleBody">
        {children}
      </div>
    </div>
  );
}
