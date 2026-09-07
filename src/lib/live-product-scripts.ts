export type ProductScriptSource = {
  id: string | number;
  name: string;
  price?: number;
  originalPrice?: number;
  sellingPoints?: string[];
  stockMessage?: string;
  afterSales?: string;
};

export type ProductStarterScript = {
  id: number;
  productId: string | number;
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
  state: 'ready';
};

export function buildProductStarterScripts(product: ProductScriptSource, baseId: number): ProductStarterScript[] {
  const points = product.sellingPoints?.filter(Boolean) ?? [];
  const priceText = typeof product.price === 'number' ? `当前直播价为${product.price.toFixed(2)}元。` : '';
  const originalPriceText = typeof product.originalPrice === 'number' ? `日常参考价为${product.originalPrice.toFixed(2)}元。` : '';
  return [
    {
      id: baseId,
      productId: product.id,
      title: `${product.name} · 开场引入`,
      category: '开场',
      duration: '00:20',
      text: `接下来为大家介绍${product.name}。${points.length ? `它的主要特点包括${points.slice(0, 3).join('、')}。` : '我们会根据商品资料逐项说明。'}`,
      state: 'ready',
    },
    {
      id: baseId + 1,
      productId: product.id,
      title: `${product.name} · 商品讲解`,
      category: '讲品',
      duration: '00:32',
      text: `${product.name}，${points.length ? `重点卖点是${points.join('、')}。` : '详细参数请以商品页面展示为准。'}${product.stockMessage ? `${product.stockMessage}。` : ''}`,
      state: 'ready',
    },
    {
      id: baseId + 2,
      productId: product.id,
      title: `${product.name} · 价格与售后`,
      category: '促单',
      duration: '00:24',
      text: `${priceText}${originalPriceText}${product.afterSales ? `售后说明：${product.afterSales}。` : '具体优惠和售后规则请以商品页面为准。'}`,
      state: 'ready',
    },
  ];
}
