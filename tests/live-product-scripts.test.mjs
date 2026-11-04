import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProductStarterScripts } from '../src/lib/live-product-scripts.ts';

test('builds three product-linked scripts from factual product fields', () => {
  const scripts = buildProductStarterScripts({
    id: 'product-1',
    name: '精品咖啡豆',
    price: 39.9,
    originalPrice: 59.9,
    sellingPoints: ['新鲜烘焙', '醇厚风味'],
    stockMessage: '现货 100 件',
    afterSales: '七天无理由',
  }, 100);

  assert.deepEqual(scripts.map((item) => item.category), ['开场', '讲品', '促单']);
  assert.deepEqual(scripts.map((item) => item.id), [100, 101, 102]);
  assert.ok(scripts.every((item) => item.productId === 'product-1'));
  assert.match(scripts[1].text, /新鲜烘焙/);
  assert.match(scripts[2].text, /39\.90/);
  assert.match(scripts[2].text, /七天无理由/);
});

test('uses guarded copy when optional commercial facts are absent', () => {
  const scripts = buildProductStarterScripts({ id: 7, name: '未定价样品' }, 1);

  assert.match(scripts[1].text, /以商品页面展示为准/);
  assert.match(scripts[2].text, /具体优惠和售后规则请以商品页面为准/);
  assert.doesNotMatch(scripts.map((item) => item.text).join(''), /undefined|NaN/);
});
