import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const templateDirectory = path.resolve('public/assets/xiling-live/yijing/templates');
const outputFile = path.resolve('public/assets/xiling-live/yijing/components.json');
const publicDirectory = path.resolve('public');
const imagePattern = /^\/assets\/xiling-live\/yijing\/elements\/[a-f0-9]{24}\.(?:png|jpg)$/;

function categoryFor(name) {
  if (name.startsWith('顶部')) return '顶部';
  if (name.startsWith('底部')) return '底部';
  if (name.startsWith('商品')) return '商品';
  if (/矩形|圆形|线条|边框|底板|背景/.test(name)) return '形状';
  return '装饰';
}

const templates = (await readdir(templateDirectory)).filter(file => /^\d+\.json$/.test(file)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
const unique = new Map();
for (const file of templates) {
  const document = JSON.parse(await readFile(path.join(templateDirectory, file), 'utf8'));
  for (const page of document.pages ?? []) {
    for (const layer of page.layers ?? []) {
      if (layer.kind !== 'image' || layer.sceneKey !== 'templateElement' || !imagePattern.test(layer.preview ?? '')) continue;
      const existing = unique.get(layer.preview);
      if (existing) {
        existing.uses += 1;
        continue;
      }
      const name = String(layer.value ?? '').trim() || '装饰组件';
      unique.set(layer.preview, {
        id: path.basename(layer.preview, path.extname(layer.preview)),
        name, category: categoryFor(name), image: layer.preview,
        width: Math.max(5, Math.min(95, Number(layer.width) || 30)),
        height: Math.max(2, Math.min(85, Number(layer.height) || 10)),
        uses: 1,
      });
    }
  }
}

const available = await Promise.all([...unique.values()].map(async item => {
  const filename = path.join(publicDirectory, item.image.slice(1));
  return (await stat(filename).catch(() => null))?.size ? item : null;
}));
const list = available.filter(Boolean).sort((a, b) => b.uses - a.uses || a.id.localeCompare(b.id));
await writeFile(outputFile, `${JSON.stringify({ source: '百度一镜模板装饰图层', templateCount: templates.length, count: list.length, list })}\n`);
console.log(`${templates.length} templates, ${list.length} reusable components (${unique.size - list.length} missing assets)`);
