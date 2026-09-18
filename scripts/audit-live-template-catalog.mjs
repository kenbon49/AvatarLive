import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';

const catalog = JSON.parse(await readFile('src/data/yijing-template-catalog.json', 'utf8'));
const width = 108;
const height = 192;
const assetRoot = path.resolve('public');
const assetCache = new Map();
const round = value => Math.round(value * 1000) / 1000;
const assetFile = url => path.join(assetRoot, url.slice(1));

async function alphaFor(layer) {
  const w = Math.max(1, Math.round(layer.width * width / 100));
  const h = Math.max(1, Math.round(layer.height * height / 100));
  const key = `${layer.preview}:${w}:${h}:${layer.rotation}`;
  if (!assetCache.has(key)) {
    assetCache.set(key, (async () => {
      let pipeline = sharp(assetFile(layer.preview)).ensureAlpha().resize(w, h, { fit: 'fill' });
      if (layer.rotation) pipeline = pipeline.rotate(layer.rotation, { background: '#00000000' });
      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const alpha = new Uint8Array(info.width * info.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * info.channels + 3];
      return { alpha, width: info.width, height: info.height };
    })());
  }
  return assetCache.get(key);
}

function hostPixel(host, x, y) {
  const left = (host.x - host.width / 2) * width / 100;
  const top = (host.y - host.height / 2) * height / 100;
  const u = (x - left) / (host.width * width / 100);
  const v = (y - top) / (host.height * height / 100);
  // The default presenter occupies the central part of a portrait host layer.
  const face = ((u - .5) / .14) ** 2 + ((v - .40) / .11) ** 2 < 1;
  const body = ((u - .5) / .28) ** 2 + ((v - .62) / .13) ** 2 < 1;
  return { face, body };
}

async function inspectPage(layers) {
  const hostIndex = layers.findIndex(layer => layer.sceneKey === 'host');
  const host = hostIndex < 0
    ? { x: 50, y: 64, width: 76, height: 70, opacity: 100 }
    : layers[hostIndex];
  const backgroundIndex = layers.findIndex(layer => layer.sceneKey === 'templateBackground');
  const front = layers.slice(0, hostIndex < 0 ? backgroundIndex : hostIndex)
    .filter(layer => layer.preview && (layer.kind === 'image' || layer.kind === 'text'));
  const opacity = new Float32Array(width * height);
  for (const layer of front) {
    const image = await alphaFor(layer);
    const left = Math.round(layer.x * width / 100 - image.width / 2);
    const top = Math.round(layer.y * height / 100 - image.height / 2);
    const factor = layer.opacity / 100;
    for (let y = Math.max(0, top); y < Math.min(height, top + image.height); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, left + image.width); x++) {
        const index = y * width + x;
        opacity[index] = 1 - (1 - opacity[index]) * (1 - factor * image.alpha[(y - top) * image.width + x - left] / 255);
      }
    }
  }
  let faceCount = 0;
  let faceObscured = 0;
  let bodyCount = 0;
  let bodyObscured = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const { face, body } = hostPixel(host, x, y);
    if (face) { faceCount++; faceObscured += opacity[y * width + x]; }
    if (body) { bodyCount++; bodyObscured += opacity[y * width + x]; }
  }
  return {
    hasHost: hostIndex >= 0,
    host: { x: host.x, y: host.y, width: host.width, height: host.height },
    faceObscured: round(faceObscured / faceCount),
    bodyObscured: round(bodyObscured / bodyCount),
    frontImages: front.filter(layer => layer.kind === 'image').length,
  };
}

const pages = [];
const designs = new Map();
const backgrounds = new Map();
for (const [index, template] of catalog.entries()) {
  const document = JSON.parse(await readFile(assetFile(template.layersUrl), 'utf8'));
  const pageDesigns = [];
  for (const page of document.pages) {
    const metrics = await inspectPage(page.layers);
    pages.push({ sourceId: template.sourceId, name: template.name, page: page.index, ...metrics });
    const design = page.layers.map(layer => {
      const { id, value, preview, fontSize, ...shape } = layer;
      if (layer.kind === 'text') return { ...shape, fontSize };
      return { ...shape, preview };
    });
    pageDesigns.push(design);
  }
  const signature = JSON.stringify([template.category, pageDesigns]);
  const group = designs.get(signature) ?? [];
  group.push({ sourceId: template.sourceId, name: template.name });
  designs.set(signature, group);
  const backgroundKey = JSON.stringify([template.category, document.pages.map(page => (
    page.layers.find(layer => layer.sceneKey === 'templateBackground')?.preview
  ))]);
  const backgroundGroup = backgrounds.get(backgroundKey) ?? [];
  backgroundGroup.push(template);
  backgrounds.set(backgroundKey, backgroundGroup);
  if ((index + 1) % 100 === 0) process.stdout.write(`Audited ${index + 1}/${catalog.length}\n`);
}
const duplicates = [...designs.values()].filter(group => group.length > 1);
const coverCache = new Map();
async function coverPixels(template) {
  if (!coverCache.has(template.sourceId)) {
    coverCache.set(template.sourceId, sharp(assetFile(template.image))
      .resize(72, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer());
  }
  return coverCache.get(template.sourceId);
}
const similarCovers = [];
const artworkCache = new Map();
async function artworkPixels(template) {
  if (!artworkCache.has(template.sourceId)) {
    artworkCache.set(template.sourceId, (async () => {
      const document = JSON.parse(await readFile(assetFile(template.layersUrl), 'utf8'));
      const output = [];
      for (const page of document.pages) {
        const backdrop = page.layers.find(layer => layer.sceneKey === 'templateBackground');
        const layers = [...page.layers].reverse().filter(layer => layer.kind === 'image' && layer.preview);
        const inputs = [];
        for (const layer of layers) {
          const w = Math.max(1, Math.round(layer.width * 72 / 100));
          const h = Math.max(1, Math.round(layer.height * 128 / 100));
          let source = sharp(assetFile(layer.preview)).resize(w, h, { fit: 'fill' });
          if (layer.rotation) source = source.rotate(layer.rotation, { background: '#00000000' });
          const buffer = await source.png().toBuffer();
          const info = await sharp(buffer).metadata();
          const left = Math.round(layer.x * 72 / 100 - info.width / 2);
          const top = Math.round(layer.y * 128 / 100 - info.height / 2);
          const clip = {
            left: Math.max(0, -left), top: Math.max(0, -top),
            width: Math.min(info.width - Math.max(0, -left), 72 - Math.max(0, left)),
            height: Math.min(info.height - Math.max(0, -top), 128 - Math.max(0, top)),
          };
          if (clip.width < 1 || clip.height < 1) continue;
          inputs.push({
            input: clip.left || clip.top || clip.width !== info.width || clip.height !== info.height
              ? await sharp(buffer).extract(clip).png().toBuffer()
              : buffer,
            left: Math.max(0, left), top: Math.max(0, top),
          });
        }
        const background = backdrop?.preview
          ? await sharp(assetFile(backdrop.preview)).resize(72, 128, { fit: 'fill' }).png().toBuffer()
          : null;
        const pixels = await sharp(background ?? {
          create: { width: 72, height: 128, channels: 4, background: '#00000000' },
        }).composite(inputs).removeAlpha().raw().toBuffer();
        output.push(pixels);
      }
      return output;
    })());
  }
  return artworkCache.get(template.sourceId);
}
const similarArtwork = [];
for (const group of backgrounds.values()) {
  if (group.length < 2) continue;
  const images = await Promise.all(group.map(coverPixels));
  const artwork = await Promise.all(group.map(artworkPixels));
  for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
    let error = 0;
    for (let i = 0; i < images[a].length; i++) error += Math.abs(images[a][i] - images[b][i]);
    similarCovers.push({
      ids: [group[a].sourceId, group[b].sourceId],
      names: [group[a].name, group[b].name],
      difference: round(error / (images[a].length * 255)),
    });
    if (artwork[a].length !== artwork[b].length) continue;
    let artworkError = 0;
    let samples = 0;
    for (let page = 0; page < artwork[a].length; page++) {
      const first = artwork[a][page];
      const second = artwork[b][page];
      for (let i = 0; i < first.length; i++) artworkError += Math.abs(first[i] - second[i]);
      samples += first.length;
    }
    similarArtwork.push({
      ids: [group[a].sourceId, group[b].sourceId],
      names: [group[a].name, group[b].name],
      difference: round(artworkError / (samples * 255)),
    });
  }
}
similarCovers.sort((a, b) => a.difference - b.difference);
similarArtwork.sort((a, b) => a.difference - b.difference);
const report = {
  pages,
  duplicates,
  similarCovers,
  similarArtwork,
  summary: {
    templates: catalog.length,
    pages: pages.length,
    faceHidden: pages.filter(page => page.faceObscured >= .7).length,
    bodyHidden: pages.filter(page => page.bodyObscured >= .75).length,
    duplicateDesignGroups: duplicates.length,
    duplicateTemplates: duplicates.reduce((count, group) => count + group.length - 1, 0),
    similarCoverPairs: similarCovers.length,
  },
};
await writeFile('artifacts/live-template-catalog-audit.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
