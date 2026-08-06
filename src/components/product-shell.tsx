'use client';

import Link from 'next/link';
import { Radio, Sparkles, Video } from 'lucide-react';
import { usePathname } from 'next/navigation';

export function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const live = pathname.startsWith('/live');

  return (
    <div className="productShell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="灵境数字人首页">
          <span className="logoGlyph"><Sparkles size={18} /></span>
          <span>灵境数字人</span>
        </Link>
        <nav className="primaryNav" aria-label="核心功能">
          <Link className={!live ? 'active' : ''} href="/"><Radio size={17} />实时互动</Link>
          <Link className={live ? 'active' : ''} href="/live"><Video size={17} />数字人直播</Link>
        </nav>
        <div className="servicePill"><i /> MuseTalk 服务</div>
      </header>
      {children}
    </div>
  );
}
