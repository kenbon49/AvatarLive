import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '灵境数字人 | 实时互动与直播',
  description: '基于 MuseTalk 的实时数字人互动与直播工作台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
