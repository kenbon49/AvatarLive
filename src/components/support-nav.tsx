'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/app/support.module.css';

export function SupportNav({ title }: { title: string }) {
  const pathname = usePathname();
  return <><header className={styles.top}><Link href="/">返回控制台</Link><h1>{title}</h1></header>
    <nav className={styles.tabs} aria-label="服务资源"><Link href="/updates" aria-current={pathname === '/updates' ? 'page' : undefined}>版本更新</Link><Link href="/help" aria-current={pathname === '/help' ? 'page' : undefined}>操作手册</Link><Link href="/reports" aria-current={pathname === '/reports' ? 'page' : undefined}>运行报告</Link></nav></>;
}
