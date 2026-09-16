import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { resolveYijingFontFamily, UNAVAILABLE_FONT_FALLBACKS } from '../src/lib/yijing-fonts.ts';

const assetDirectory = path.resolve('public/assets/xiling-live/yijing');
const fontCatalog = JSON.parse(await readFile('src/data/yijing-font-catalog.json', 'utf8'));
const fontsByValue = new Map(fontCatalog.map(font => [font.value, font]));
const installedFamilies = new Set(fontCatalog.filter(font => font.path).map(font => font.family));

test('every text layer in all Yijing templates resolves to a local font', async () => {
  const files = (await readdir(path.join(assetDirectory, 'templates'))).filter(file => /^\d+\.json$/.test(file));
  assert.equal(files.length, 994);
  const missing = [];
  let textCount = 0;
  for (const file of files) {
    const document = JSON.parse(await readFile(path.join(assetDirectory, 'templates', file), 'utf8'));
    for (const page of document.pages ?? []) {
      for (const layer of page.layers ?? []) {
        if (layer.kind !== 'text') continue;
        textCount += 1;
        if (!fontsByValue.has(layer.fontFamily) || !installedFamilies.has(resolveYijingFontFamily(layer.fontFamily, fontCatalog))) {
          missing.push(`${file}: ${layer.fontFamily}`);
        }
      }
    }
  }
  assert.ok(textCount > 20_000);
  assert.deepEqual(missing, []);
});

test('source fonts are present and unavailable fonts use an explicit fallback', async () => {
  const css = await readFile(path.join(assetDirectory, 'fonts.css'), 'utf8');
  for (const font of fontCatalog) {
    if (!font.path) {
      assert.equal(font.value, 'YuMoTi');
      assert.equal(resolveYijingFontFamily(font.value, fontCatalog), UNAVAILABLE_FONT_FALLBACKS[font.value]);
      continue;
    }
    assert.ok((await stat(path.resolve('public', font.path.slice(1)))).size > 0, font.path);
    assert.ok(css.includes(`font-family: '${font.family}';`), font.family);
  }
});

test('templates with the unavailable YuMoTi primary font use their local source fallbacks', async () => {
  const expected = new Map([
    ['yijing-83-p0-text-7', 'MaKeBi'],
    ['yijing-124-p0-text-14', 'SiYuanHeiTi'],
    ['yijing-124-p0-text-15', 'SiYuanHeiTi'],
    ['yijing-124-p0-text-16', 'YanShiChunFengKai'],
  ]);
  for (const templateId of [83, 124]) {
    const document = JSON.parse(await readFile(path.join(assetDirectory, 'templates', `${templateId}.json`), 'utf8'));
    for (const layer of document.pages.flatMap(page => page.layers)) {
      if (expected.has(layer.id)) assert.equal(layer.fontFamily, expected.get(layer.id));
    }
  }
});

test('component catalog uses the official Yijing component library', async () => {
  const catalog = JSON.parse(await readFile(path.join(assetDirectory, 'components.json'), 'utf8'));
  assert.equal(catalog.source, 'https://yijing.baidu.com/ai_anchor/paster/component_list');
  assert.equal(catalog.count, catalog.list.length);
  assert.ok(catalog.count > 2_000);
  assert.deepEqual(catalog.categories.map(category => category.name), [
    '直播标题', '优惠信息', '商品卡', '保障信息', '主播名片', '擅长项目',
  ]);
  assert.equal(new Set(catalog.list.map(item => item.image)).size, catalog.count);
  for (const component of catalog.list) {
    assert.ok(component.x >= 0 && component.x <= 100);
    assert.ok(component.y >= 0 && component.y <= 100);
    assert.ok(component.width > 0 && component.height > 0);
    assert.ok((await stat(path.resolve('public', component.image.slice(1)))).size > 0, component.image);
  }
});
