import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '灵境数字人 | 数字人形象库与直播',
  description: '数字人形象资产与直播工作台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head><link rel="stylesheet" href="/assets/xiling-live/yijing/fonts.css" /></head>
      <body>{children}</body>
    </html>
  );
}
