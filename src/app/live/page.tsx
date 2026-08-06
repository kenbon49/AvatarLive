import { Construction, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { ProductShell } from '@/components/product-shell';

export default function LivePage() {
  return (
    <ProductShell>
      <main className="developingPage">
        <div className="developingMark"><Construction size={32} /></div>
        <span className="eyebrow">DIGITAL HUMAN LIVE</span>
        <h1>数字人直播<br />正在开发</h1>
        <p>直播编排与推流能力正在准备中，敬请期待。</p>
        <Link className="developingBack" href="/"><ArrowLeft size={17} />返回实时互动</Link>
      </main>
    </ProductShell>
  );
}
