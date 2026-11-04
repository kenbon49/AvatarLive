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
  const deduplication = JSON.parse(await readFile(path.join(assetDirectory, 'component-deduplication.json'), 'utf8'));
  const colorVariantPattern = /[（(](?:红色|橙色|黄色|绿色|浅蓝|深蓝|蓝色|紫色|粉色|白色|灰色|黑色|咖色|棕色)[）)]/g;
  const normalizedDesignName = name => name.trim()
    .replace(/\s+/g, ' ')
    .replace(colorVariantPattern, '')
    .replace(/[123]行标题/g, '多行标题')
    .replace(/[（(](?:一个卖点|两个卖点|无卖点|单行标题无卖点|双行标题无卖点|双行标题)[）)]/g, '')
    .replace(/(-保障信息-纯文字)[234]/g, '$1');
  assert.equal(catalog.source, 'https://yijing.baidu.com/ai_anchor/paster/component_list');
  assert.equal(catalog.count, catalog.list.length);
  assert.equal(catalog.count, 181);
  assert.equal(catalog.nonEditableCount, 15);
  assert.equal(catalog.availableCount - catalog.duplicateCount - catalog.nonEditableCount, catalog.count);
  assert.equal(deduplication.removedCount, catalog.duplicateCount);
  assert.equal(deduplication.excludedCount, catalog.nonEditableCount);
  assert.equal(deduplication.excluded.length, catalog.nonEditableCount);
  assert.ok(deduplication.excluded.every(item => item.reason === 'no-editable-text'));
  assert.equal(catalog.coverDuplicateCount + catalog.designDuplicateCount, catalog.duplicateCount);
  assert.equal(deduplication.designDuplicateCount, catalog.designDuplicateCount);
  assert.ok(deduplication.removed.some(item => item.reason === 'design-family'));
  assert.ok(deduplication.removedCount > 0);
  assert.deepEqual(catalog.categories.map(category => category.name), [
    '直播标题', '优惠信息', '商品卡', '保障信息', '主播名片', '擅长项目',
  ]);
  assert.deepEqual(catalog.categories.map(category => category.count), [44, 10, 60, 43, 12, 12]);
  assert.equal(new Set(catalog.list.map(item => item.image)).size, catalog.count);
  const catalogIds = new Set(catalog.list.map(item => String(item.id)));
  const excludedIds = new Set(deduplication.excluded.map(item => String(item.id)));
  assert.equal(new Set(deduplication.removed.map(item => String(item.id))).size, deduplication.removedCount);
  assert.ok(deduplication.removed.every(item => catalogIds.has(String(item.keptId)) || excludedIds.has(String(item.keptId))));
  assert.equal(new Set(catalog.list.map(item => (
    `${item.category}\n${normalizedDesignName(item.name)}`
  ))).size, catalog.count);
  let layerCount = 0;
  let textLayerCount = 0;
  for (const component of catalog.list) {
    assert.ok((await stat(path.resolve('public', component.image.slice(1)))).size > 0, component.image);
    assert.match(component.layersUrl, /\/component-layers\/\d+\.json$/);
    const document = JSON.parse(await readFile(path.resolve('public', component.layersUrl.slice(1)), 'utf8'));
    assert.equal(document.sourceId, Number(component.id));
    assert.equal(document.layers.length, component.layerCount);
    assert.equal(document.layers.filter(layer => layer.kind === 'text').length, component.textLayerCount);
    assert.equal(component.editable, true);
    assert.ok(component.textLayerCount > 0);
    layerCount += document.layers.length;
    textLayerCount += component.textLayerCount;
    for (const layer of document.layers) {
      assert.ok(['text', 'image'].includes(layer.kind));
      assert.ok(Number.isFinite(layer.x) && Number.isFinite(layer.y));
      assert.ok(layer.width > 0 && layer.height > 0);
      if (layer.preview) assert.ok((await stat(path.resolve('public', layer.preview.slice(1)))).size > 0, layer.preview);
      if (layer.kind === 'text') {
        assert.ok(layer.value.trim(), `${component.id}: editable text value`);
        assert.ok(layer.preview, `${component.id}: original text preview`);
        assert.ok(fontsByValue.has(layer.fontFamily), `${component.id}: ${layer.fontFamily}`);
        assert.ok(installedFamilies.has(resolveYijingFontFamily(layer.fontFamily, fontCatalog)), `${component.id}: ${layer.fontFamily}`);
        assert.ok(Number.isFinite(layer.fontSize) && layer.fontSize >= 6 && layer.fontSize <= 144, `${component.id}: font size`);
        assert.ok(Number.isFinite(layer.letterSpacing), `${component.id}: letter spacing`);
        assert.ok(Number.isFinite(layer.lineHeight) && layer.lineHeight >= 0.8 && layer.lineHeight <= 3, `${component.id}: line height`);
        assert.ok(['left', 'center', 'right'].includes(layer.textAlign), `${component.id}: text alignment`);
      }
    }
  }
  assert.ok(layerCount > 1_300);
  assert.equal(textLayerCount, 622);
});
