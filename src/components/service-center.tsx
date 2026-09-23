'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { BarChart3, BookOpenText, ChevronRight, LifeBuoy, Rocket, X } from 'lucide-react';
import styles from './service-center.module.css';

const resources = [
  { href: '/updates', label: '版本更新', description: '版本检测与自动升级状态', icon: Rocket },
  { href: '/help', label: '操作手册', description: '各功能模块的图文操作说明', icon: BookOpenText },
  { href: '/reports', label: '运行报告', description: '直播 API 用量与积分记录', icon: BarChart3 },
];

export function ServiceCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('a, button:not(:disabled)'));
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return <div className={styles.backdrop} onMouseDown={onClose}>
    <section ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <header className={styles.header}>
        <div className={styles.headerIcon}><LifeBuoy size={19} /></div>
        <div><span>资源中心</span><h2 id={titleId}>服务与支持</h2></div>
        <button className={styles.closeButton} type="button" aria-label="关闭服务与支持" onClick={onClose}><X size={18} /></button>
      </header>
      <div className={styles.content}>
        <section className={styles.resources} aria-label="更新、学习与报告">
          <div className={styles.resourceHeading}><h3>更新、学习与报告</h3></div>
          <div className={styles.resourceList}>{resources.map((item) => {
            const Icon = item.icon;
            return <article className={styles.resourceItem} key={item.href}>
              <Link href={item.href} onClick={onClose}>
                <span className={styles.resourceIcon}><Icon size={18} /></span>
                <span className={styles.resourceCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
                <ChevronRight size={17} />
              </Link>
            </article>;
          })}</div>
        </section>
      </div>
    </section>
  </div>;
}
