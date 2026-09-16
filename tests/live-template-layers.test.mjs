import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { applyTemplateLayersPreservingHost, repairLegacyTemplateBackground } from '../src/lib/live-template-layers.ts';

test('switching templates uses template geometry while preserving the current host identity and keying', () => {
  const currentHost = {
    id: 'host',
    sceneKey: 'host',
    value: '当前主播',
    x: 51,
    y: 58,
    width: 158,
    height: 94,
    chromaKeyEnabled: true,
    chromaKeyColor: '#f8f8f8',
  };
  const currentLayers = [currentHost, { id: 'old-background', sceneKey: 'templateBackground' }];
  const templateLayers = [
    { id: 'template-host', sceneKey: 'host', value: '模板主播', x: 50, y: 64, width: 76, height: 70 },
    { id: 'new-background', sceneKey: 'templateBackground' },
    { id: 'new-title', sceneKey: 'templateTitle' },
  ];

  const result = applyTemplateLayersPreservingHost(templateLayers, currentLayers, '灵婉');

  assert.notEqual(result[0], currentHost);
  assert.equal(result[0].value, '灵婉');
  assert.equal(result[0].x, templateLayers[0].x);
  assert.equal(result[0].y, templateLayers[0].y);
  assert.equal(result[0].width, templateLayers[0].width);
  assert.equal(result[0].height, templateLayers[0].height);
  assert.equal(result[0].chromaKeyEnabled, true);
  assert.equal(result[0].chromaKeyColor, '#f8f8f8');
  assert.equal(result[1], templateLayers[1]);
  assert.equal(result[2], templateLayers[2]);
});

test('uses the template host when the current scene has no host layer', () => {
  const templateLayers = [
    { id: 'template-host', sceneKey: 'host', width: 76, height: 70 },
    { id: 'new-background', sceneKey: 'templateBackground' },
  ];

  assert.deepEqual(
    applyTemplateLayersPreservingHost(templateLayers, []),
    templateLayers,
  );
});

test('uses the selected host identity when the previous template has no host layer', () => {
  const templateLayers = [
    { id: 'template-host', sceneKey: 'host', value: '模板主播', width: 76, height: 70 },
    { id: 'new-background', sceneKey: 'templateBackground' },
  ];

  const result = applyTemplateLayersPreservingHost(templateLayers, [], '灵婉');

  assert.equal(result[0].value, '灵婉');
  assert.equal(result[0].width, 76);
  assert.equal(result[0].height, 70);
});

test('keeps the current host when the target template has no host layer', () => {
  const currentHost = {
    id: 'current-host', kind: 'host', sceneKey: 'host', value: '灵婉',
    x: 42, y: 61, width: 68, height: 72, rotation: 3, opacity: 84,
    chromaKeyEnabled: true, chromaKeyColor: '#00ff00', chromaKeyTolerance: 9, chromaKeySoftness: 12,
  };
  const templateLayers = [
    { id: 'decoration', kind: 'image', sceneKey: 'templateElement' },
    { id: 'background', kind: 'image', sceneKey: 'templateBackground' },
  ];

  const result = applyTemplateLayersPreservingHost(templateLayers, [currentHost], '用户选择的数字人');

  assert.equal(result.length, 3);
  assert.deepEqual(result[1], { ...currentHost, value: '用户选择的数字人' });
  assert.equal(result[2], templateLayers[1]);
  assert.notEqual(result[1], currentHost);
});

test('adds the selected default host when neither template nor current scene has one', () => {
  const templateLayers = [{ id: 'background', kind: 'image', sceneKey: 'templateBackground' }];

  const result = applyTemplateLayersPreservingHost(templateLayers, [], '灵婉');

  assert.equal(result[0].sceneKey, 'host');
  assert.equal(result[0].value, '灵婉');
  assert.deepEqual(
    { x: result[0].x, y: result[0].y, width: result[0].width, height: result[0].height },
    { x: 50, y: 64, width: 76, height: 70 },
  );
  assert.equal(result[1], templateLayers[0]);
});

test('repairs only a known legacy template background without resetting edited layers', () => {
  const editedTitle = { id: 'title', sceneKey: 'templateElement', value: '用户修改后的标题', x: 31 };
  const currentLayers = [
    editedTitle,
    { id: 'host', sceneKey: 'host', value: '灵婉' },
    { id: 'background', sceneKey: 'templateBackground', preview: '/assets/xiling-live/yijing/blank.png', opacity: 82 },
  ];
  const templateLayers = [
    { id: 'title', sceneKey: 'templateElement', value: '原始标题', x: 50 },
    { id: 'background', sceneKey: 'templateBackground', preview: '/assets/xiling-live/yijing/scene-backgrounds/example.webp', opacity: 100 },
  ];

  const result = repairLegacyTemplateBackground(
    templateLayers,
    currentLayers,
    ['/assets/xiling-live/yijing/blank.png', '/covers/example.png'],
  );

  assert.equal(result[0], editedTitle);
  assert.equal(result[0].value, '用户修改后的标题');
  assert.deepEqual(result[2], {
    ...currentLayers[2],
    preview: '/assets/xiling-live/yijing/scene-backgrounds/example.webp',
  });
});

test('does not replace a user-selected background', () => {
  const currentLayers = [{ id: 'background', sceneKey: 'templateBackground', preview: 'data:image/png;base64,user' }];
  const result = repairLegacyTemplateBackground(
    [{ id: 'background', sceneKey: 'templateBackground', preview: '/assets/new.webp' }],
    currentLayers,
    ['/assets/xiling-live/yijing/blank.png'],
  );

  assert.deepEqual(result, currentLayers);
});

test('the complete local Yijing catalog contains every editable page and asset', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/yijing-template-catalog.json', import.meta.url), 'utf8'));
  const fonts = JSON.parse(fs.readFileSync(new URL('../src/data/yijing-font-catalog.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/xiling-live/yijing/manifest.json', import.meta.url), 'utf8'));
  let pageCount = 0;
  let layerCount = 0;

  assert.equal(catalog.length, 994);
  assert.ok(fonts.length >= 40);
  assert.ok(fonts.some(font => font.value === 'FZHZGBJW' && font.path));
  for (const font of fonts.filter(font => font.path)) {
    assert.ok(fs.existsSync(new URL(`../public${font.path}`, import.meta.url)), font.path);
  }
  assert.equal(new Set(catalog.map(template => template.id)).size, catalog.length);
  for (const template of catalog) {
    assert.ok(template.image.startsWith('/assets/xiling-live/yijing/covers/'));
    assert.ok(fs.existsSync(new URL(`../public${template.image}`, import.meta.url)), template.image);
    assert.ok(template.layersUrl.startsWith('/assets/xiling-live/yijing/templates/'));
    const document = JSON.parse(fs.readFileSync(new URL(`../public${template.layersUrl}`, import.meta.url), 'utf8'));
    assert.equal(document.pages.length, template.pageCount, `${template.id} page count`);
    pageCount += document.pages.length;
    for (const page of document.pages) {
      const layers = page.layers;
      layerCount += layers.length;
      assert.equal(new Set(layers.map(layer => layer.id)).size, layers.length, `${template.id} page ${page.index} layer ids`);
      assert.equal(layers.filter(layer => layer.sceneKey === 'templateBackground').length, 1, `${template.id} page ${page.index} background`);
      for (const layer of layers.filter(layer => layer.preview)) {
        assert.ok(layer.preview.startsWith('/assets/'), layer.preview);
        assert.ok(fs.existsSync(new URL(`../public${layer.preview}`, import.meta.url)), layer.preview);
      }
    }
  }

  assert.equal(pageCount, 1171);
  assert.equal(layerCount, 46661);
  assert.deepEqual(
    { templates: manifest.templateCount, pages: manifest.pageCount, layers: manifest.layerCount },
    { templates: 994, pages: 1171, layers: 46661 },
  );
  assert.equal(manifest.sourceFontCount, fonts.length);
  assert.ok(manifest.mappedFontCount >= 40);
  assert.ok(manifest.localFontCount >= 35);
  assert.equal(manifest.restoredSceneBackgroundCount, 11);

  const automotiveTemplate = JSON.parse(fs.readFileSync(new URL('../public/assets/xiling-live/yijing/templates/3316.json', import.meta.url), 'utf8'));
  assert.ok(automotiveTemplate.pages[0].layers.some(layer => layer.fontFamily === 'FZHZGBJW'));
  const travelTemplate = JSON.parse(fs.readFileSync(new URL('../public/assets/xiling-live/yijing/templates/3310.json', import.meta.url), 'utf8'));
  assert.ok(travelTemplate.pages[0].layers.filter(layer => layer.y >= 75).length >= 4, 'bottom artwork must be preserved');
  const restoredSceneTemplate = JSON.parse(fs.readFileSync(new URL('../public/assets/xiling-live/yijing/templates/3317.json', import.meta.url), 'utf8'));
  const restoredSceneBackground = restoredSceneTemplate.pages[0].layers.find(layer => layer.sceneKey === 'templateBackground');
  assert.match(restoredSceneBackground.preview, /\/scene-backgrounds\/3317-p0\.webp$/);
  assert.ok(fs.existsSync(new URL(`../public${restoredSceneBackground.preview}`, import.meta.url)));
  const transparentTemplate = JSON.parse(fs.readFileSync(new URL('../public/assets/xiling-live/yijing/templates/477.json', import.meta.url), 'utf8'));
  assert.equal(transparentTemplate.pages[0].layers.find(layer => layer.sceneKey === 'templateBackground').preview, '/assets/xiling-live/yijing/blank.png');
});

test('the live template catalog no longer prepends the eight legacy templates', () => {
  const source = fs.readFileSync(new URL('../src/components/live-studio.tsx', import.meta.url), 'utf8');
  for (const id of ['home', 'sale', 'spring', 'food', 'study', 'snack', 'fruit', 'fashion']) {
    assert.doesNotMatch(source, new RegExp(`\\{ id: '${id}', name:`));
  }
  assert.match(source, /const DEFAULT_LIVE_TEMPLATE = LIVE_TEMPLATES\[0\]/);
  assert.match(source, /preview: template\.source === '百度一镜' \? YIJING_BLANK_BACKGROUND : template\.image/);
});

test('new live rooms start with exactly one storyboard', () => {
  const source = fs.readFileSync(new URL('../src/components/live-studio.tsx', import.meta.url), 'utf8');
  const initialScriptsBlock = source.match(/const INITIAL_SCRIPTS: ScriptItem\[\] = (\[[\s\S]*?\]);\n\nconst textLayerDefaults/);
  assert.ok(initialScriptsBlock);
  assert.equal((initialScriptsBlock[1].match(/title:/g) ?? []).length, 1);
  assert.match(initialScriptsBlock[1], /title: '主播口播 1'/);
});
