import { readFile, writeFile } from 'node:fs/promises';

const catalogFile = 'src/data/yijing-template-catalog.json';
const manifestFile = 'public/assets/xiling-live/yijing/manifest.json';
const curation = JSON.parse(await readFile('src/data/yijing-template-curation.json', 'utf8'));
const retiredIds = new Set([
  ...curation.obscuredHost,
  ...Object.keys(curation.duplicateOf).map(Number),
]);
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
const kept = catalog.filter(template => !retiredIds.has(template.sourceId));
const documents = await Promise.all(kept.map(async template => (
  JSON.parse(await readFile(`public${template.layersUrl}`, 'utf8'))
)));
const pages = documents.flatMap(document => document.pages);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
manifest.templateCount = kept.length;
manifest.pageCount = pages.length;
manifest.layerCount = pages.reduce((count, page) => count + page.layers.length, 0);

await writeFile(catalogFile, `${JSON.stringify(kept, null, 2)}\n`);
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ removed: catalog.length - kept.length, templates: kept.length, pages: manifest.pageCount, layers: manifest.layerCount }));
