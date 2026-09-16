import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Usage: node scripts/import-yijing-editable-templates.mjs <all-templates.json>');
}

const assetRoot = path.resolve('public/assets/xiling-live/yijing');
const coverDirectory = path.join(assetRoot, 'covers');
const elementDirectory = path.join(assetRoot, 'elements');
const templateDirectory = path.join(assetRoot, 'templates');
const fontDirectory = path.join(assetRoot, 'fonts');
const catalogFile = path.resolve('src/data/yijing-template-catalog.json');
const fontCatalogFile = path.resolve('src/data/yijing-font-catalog.json');
const manifestFile = path.join(assetRoot, 'manifest.json');
const fontCssFile = path.join(assetRoot, 'fonts.css');
const fallbackBackgroundFile = path.join(assetRoot, 'blank.png');
const sceneBackgroundManifestFile = path.join(assetRoot, 'scene-backgrounds.json');
const source = JSON.parse(await readFile(inputPath, 'utf8'));
const fontSource = await readFile(path.resolve('.cache/yijing-fonts.json'), 'utf8')
  .then(value => JSON.parse(value))
  .catch(() => ({ list: [] }));
const sceneBackgrounds = await readFile(sceneBackgroundManifestFile, 'utf8')
  .then(value => JSON.parse(value))
  .catch(() => []);
const sceneBackgroundByPage = new Map(sceneBackgrounds.map(item => [`${item.templateId}:${item.pageIndex}`, item]));
const outputWidth = 1080;
const outputHeight = 1920;
const coverWidth = 270;
const coverHeight = 480;

const categoryNames = new Map([
  [16, '热门推荐'], [76, '通用场景'], [13, '家居日用'], [92, '滋补保健'],
  [344, '健康养生'], [360, '医美医疗'], [214, '教育课程'], [318, '国学手播'],
  [18, '美妆个护'], [19, '食品酒水'], [223, '法律进行时'], [362, '成人用品'],
  [15, '服饰内衣'], [87, '数码家电'], [53, '实景'], [331, '汽车'],
  [361, '旅游'], [97, '咨询/培训'], [115, '书籍封面'],
]);
const colorNames = new Map([
  ['0', '其他'], ['1', '红色'], ['2', '橙色'], ['3', '黄色'], ['4', '绿色'],
  ['5', '浅蓝'], ['6', '深蓝'], ['7', '紫色'], ['8', '粉色'], ['9', '咖色'],
  ['10', '白色'], ['11', '灰色'], ['12', '黑色'],
]);
const cropPattern = /@c_1,x_(\d+),y_(\d+),w_(\d+),h_(\d+)/;
const clipPattern = /^inset\(\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s*\)$/;
const downloadJobs = new Map();

const rawTemplates = Array.isArray(source.list)
  ? source.list
  : (source.data?.list ?? []).flatMap(category => category.template_list ?? []);
const templates = [...new Map(rawTemplates.map(template => [template.id, template])).values()];
if (!templates.length) throw new Error('The source file does not contain any Yijing templates');

await Promise.all([
  mkdir(coverDirectory, { recursive: true }),
  mkdir(elementDirectory, { recursive: true }),
  mkdir(templateDirectory, { recursive: true }),
  mkdir(fontDirectory, { recursive: true }),
  mkdir(path.dirname(catalogFile), { recursive: true }),
]);
await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toFile(fallbackBackgroundFile);

const numberFromCss = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round = value => Math.round(value * 1000) / 1000;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalizeRotation = value => {
  const rotation = numberFromCss(value) % 360;
  return round(rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation);
};
const cssColorToHex = (value, fallback = '#ffffff') => {
  if (typeof value !== 'string') return fallback;
  const hex = value.match(/#[\da-f]{6}/i)?.[0];
  if (hex) return hex.toLowerCase();
  const rgba = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!rgba) return fallback;
  return `#${rgba.slice(1, 4).map(part => clamp(Math.round(Number(part)), 0, 255).toString(16).padStart(2, '0')).join('')}`;
};
const unavailablePrimaryFonts = new Set(['YuMoTi']);
const sourceFontFamily = value => {
  const families = String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return families.find(family => !unavailablePrimaryFonts.has(family)) ?? 'SiYuanHeiTi';
};
const layerName = (element, index) => {
  if (element.type === 'bg') return '场景背景';
  const name = String(element.name ?? '').trim();
  if (/top/i.test(name)) return `顶部装饰 ${index + 1}`;
  if (/btm|bottom/i.test(name)) return `底部装饰 ${index + 1}`;
  if (/stk|spk|product/i.test(name)) return `商品区装饰 ${index + 1}`;
  return name && !/^图层\s*\d*$/u.test(name) ? name : `装饰图片 ${index + 1}`;
};
const normalizedUrl = value => String(value).replace(/^http:\/\//, 'https://');
const acceleratedAssetUrl = value => value.replace(
  /\b(huibo-data|digital-video|live-cecom-image)\.bj\.bcebos\.com\b/,
  '$1.cdn.bcebos.com',
);
const extensionFor = value => {
  const sourceUrl = value.slice(0, value.search(/@c_1,|$/));
  return /\.jpe?g(?:$|\?)/i.test(sourceUrl) ? 'jpg' : 'png';
};
const clipInsets = value => {
  if (!value || value === 'inset(0%)') return null;
  const match = String(value).match(clipPattern);
  return match ? { top: Number(match[1]), right: Number(match[2]), bottom: Number(match[3]), left: Number(match[4]) } : null;
};
const clippedPosition = element => {
  const x = numberFromCss(element.x);
  const y = numberFromCss(element.y);
  const width = numberFromCss(element.w, 1);
  const height = numberFromCss(element.h, 1);
  const clip = clipInsets(element.clipPath);
  if (!clip) {
    return {
      x: round((x + width / 2) * 100), y: round((y + height / 2) * 100),
      width: round(width * 100), height: round(height * 100),
    };
  }
  const visibleWidth = width * Math.max(0.001, 1 - (clip.left + clip.right) / 100);
  const visibleHeight = height * Math.max(0.001, 1 - (clip.top + clip.bottom) / 100);
  return {
    x: round((x + width * clip.left / 100 + visibleWidth / 2) * 100),
    y: round((y + height * clip.top / 100 + visibleHeight / 2) * 100),
    width: round(visibleWidth * 100), height: round(visibleHeight * 100),
  };
};
const position = element => ({
  ...clippedPosition(element),
  rotation: normalizeRotation(element.r),
  opacity: clamp(numberFromCss(element.opacity, 100), 0, 100),
});

function registerAsset(sourceUrl, element) {
  const url = normalizedUrl(sourceUrl);
  const clip = clipInsets(element.clipPath);
  const key = `${url}\n${clip ? JSON.stringify(clip) : ''}`;
  const fingerprint = createHash('sha1').update(key).digest('hex').slice(0, 24);
  const processed = Boolean(clip || cropPattern.test(url));
  const extension = processed ? 'png' : extensionFor(url);
  const filename = `${fingerprint}.${extension}`;
  const target = path.join(elementDirectory, filename);
  const visible = clippedPosition(element);
  const targetWidth = clamp(Math.ceil(visible.width * outputWidth / 100), 8, outputWidth * 3);
  const targetHeight = clamp(Math.ceil(visible.height * outputHeight / 100), 8, outputHeight * 3);
  const existing = downloadJobs.get(key);
  if (existing) {
    existing.targetWidth = Math.max(existing.targetWidth, targetWidth);
    existing.targetHeight = Math.max(existing.targetHeight, targetHeight);
  } else {
    downloadJobs.set(key, { key, url, clip, target, processed, targetWidth, targetHeight });
  }
  return `/assets/xiling-live/yijing/elements/${filename}`;
}

function registerCover(template) {
  const url = normalizedUrl(template.cover);
  const extension = extensionFor(url);
  const filename = `${template.id}.${extension}`;
  const key = `cover:${template.id}:${url}`;
  const target = path.join(coverDirectory, filename);
  downloadJobs.set(key, {
    key, url, clip: null, target, processed: false,
    targetWidth: coverWidth, targetHeight: coverHeight,
  });
  return `/assets/xiling-live/yijing/covers/${filename}`;
}

const textLayer = (element, templateId, pageIndex, elementIndex) => {
  const styles = element.styles ?? {};
  const baseFontSize = numberFromCss(styles.fontSize, 16);
  const scaleY = numberFromCss(element.scaleY, 1);
  const lineHeightPixels = numberFromCss(styles.lineHeight, baseFontSize);
  const strokeColor = cssColorToHex(styles.textStrokeColor ?? styles.WebkitTextStrokeColor, '#000000');
  const strokeWidth = numberFromCss(styles.textStrokeWidth ?? styles.WebkitTextStrokeWidth);
  const shadow = typeof styles.textShadow === 'string' ? styles.textShadow : '';
  const shadowNumbers = [...shadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]));
  const fontWeight = String(styles.fontWeight ?? '').toLowerCase();
  return {
    id: `yijing-${templateId}-p${pageIndex}-text-${elementIndex}`,
    kind: 'text', value: String(element.name ?? '').trim() || '文字', sceneKey: 'templateElement',
    preview: registerAsset(element.url, element), ...position(element),
    fontSize: round(clamp(baseFontSize * scaleY, 6, 144)),
    color: cssColorToHex(styles.color), fontFamily: sourceFontFamily(styles.fontFamily),
    letterSpacing: round(numberFromCss(styles.letterSpacing) * numberFromCss(element.scaleX, 1)),
    fontWeight: fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : 'normal',
    fontStyle: styles.fontStyle === 'italic' ? 'italic' : 'normal',
    textDecoration: styles.textDecoration === 'underline' || styles.textDecoration === 'line-through' ? styles.textDecoration : 'none',
    textAlign: ['left', 'right'].includes(styles.textAlign) ? styles.textAlign : 'center',
    lineHeight: round(clamp(lineHeightPixels / Math.max(baseFontSize, 1), 0.8, 3)),
    strokeEnabled: strokeWidth > 1 && !String(styles.textStrokeColor ?? '').includes('transparent'), strokeColor,
    strokeWidth: round(strokeWidth * scaleY),
    shadowEnabled: Boolean(shadow && !shadow.includes('transparent')), shadowColor: cssColorToHex(shadow, '#000000'),
    shadowBlur: shadowNumbers[2] ?? 0, shadowX: shadowNumbers[0] ?? 0, shadowY: shadowNumbers[1] ?? 0,
    backgroundEnabled: false, backgroundColor: '#111827', backgroundOpacity: 72, backgroundRadius: 0,
  };
};

const catalog = [];
const normalizedTemplates = [];
const usedFontFamilies = new Set();
let totalPages = 0;
let totalLayers = 0;

for (const template of templates) {
  const sourcePages = JSON.parse(template.template_data);
  const pages = sourcePages.map((sourcePage, pageIndex) => {
    const sourceElements = sourcePage.elements ?? [];
    const firstBackgroundIndex = sourceElements.findIndex(element => element.type === 'bg');
    const sceneBackground = sceneBackgroundByPage.get(`${template.id}:${pageIndex}`);
    const sceneCharacter = sceneBackground
      ? sourceElements.find(element => element.type === 'character' && normalizedUrl(element.url) === normalizedUrl(sceneBackground.sourceUrl))
      : null;
    const layers = [];
    if (firstBackgroundIndex < 0) {
      layers.push({
        id: `yijing-${template.id}-p${pageIndex}-background`, kind: 'image', value: '场景背景',
        sceneKey: 'templateBackground', preview: sceneBackground?.path ?? '/assets/xiling-live/yijing/blank.png',
        ...(sceneCharacter ? position(sceneCharacter) : { x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 }),
      });
    }
    for (let index = 0; index < sourceElements.length; index += 1) {
      const element = sourceElements[index];
      if (element.type === 'character') {
        layers.push({
          id: `yijing-${template.id}-p${pageIndex}-host-${index}`, kind: 'host', value: '当前数字人', sceneKey: 'host',
          ...position(element), chromaKeyEnabled: false, chromaKeyColor: '#ffffff', chromaKeyTolerance: 4, chromaKeySoftness: 6,
        });
        continue;
      }
      if (element.type === 'txt') {
        layers.push(textLayer(element, template.id, pageIndex, index));
        continue;
      }
      if (!['bg', 'image'].includes(element.type) || !element.url) continue;
      layers.push({
        id: `yijing-${template.id}-p${pageIndex}-image-${index}`, kind: 'image', value: layerName(element, index),
        sceneKey: index === firstBackgroundIndex ? 'templateBackground' : 'templateElement',
        preview: registerAsset(element.url, element), ...position(element),
      });
    }
    const orderedLayers = layers.reverse();
    totalLayers += orderedLayers.length;
    return { index: pageIndex, pageId: sourcePage.page_index ?? String(pageIndex), layers: orderedLayers };
  });
  totalPages += pages.length;
  const categories = [...new Set((template.categories ?? []).map(id => categoryNames.get(Number(id))).filter(Boolean))];
  const visibleCategories = categories.length ? categories : ['其他'];
  const primaryCategory = visibleCategories.find(name => !['热门推荐', '实景'].includes(name)) ?? visibleCategories[0];
  const image = registerCover(template);
  catalog.push({
    id: `yijing-${template.id}`, sourceId: template.id, name: template.show_name, image,
    category: primaryCategory, categories: visibleCategories,
    color: colorNames.get(String(template.color)) ?? '其他', pageCount: pages.length,
    layersUrl: `/assets/xiling-live/yijing/templates/${template.id}.json`,
  });
  normalizedTemplates.push({ template, pages });
}

for (const { pages } of normalizedTemplates) {
  for (const page of pages) {
    for (const layer of page.layers) {
      if (layer.kind === 'text') usedFontFamilies.add(layer.fontFamily);
    }
  }
}

async function fileIsReady(filename) {
  try { return (await stat(filename)).size > 0; } catch { return false; }
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { Referer: 'https://yijing.baidu.com/', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${lastError?.message ?? 'download failed'}: ${url}`);
}

async function downloadJob(job) {
  if (await fileIsReady(job.target)) return 'cached';
  let sourceUrl = job.url;
  let directive = null;
  const crop = sourceUrl.match(cropPattern);
  if (crop) {
    directive = { left: Number(crop[1]), top: Number(crop[2]), width: Number(crop[3]), height: Number(crop[4]) };
    sourceUrl = sourceUrl.slice(0, crop.index);
  }
  sourceUrl = acceleratedAssetUrl(sourceUrl);
  const visibleWidthRatio = job.clip ? Math.max(0.001, 1 - (job.clip.left + job.clip.right) / 100) : 1;
  const visibleHeightRatio = job.clip ? Math.max(0.001, 1 - (job.clip.top + job.clip.bottom) / 100) : 1;
  const downloadWidth = clamp(Math.ceil(job.targetWidth / visibleWidthRatio), 8, 4096);
  const downloadHeight = clamp(Math.ceil(job.targetHeight / visibleHeightRatio), 8, 4096);
  const imageProcess = directive
    ? `image/crop,x_${directive.left},y_${directive.top},w_${directive.width},h_${directive.height}/resize,m_lfit,w_${downloadWidth},h_${downloadHeight}`
    : `image/resize,m_lfit,w_${downloadWidth},h_${downloadHeight}`;
  const processedUrl = `${sourceUrl}?x-bce-process=${imageProcess}`;
  let output;
  let usedRemoteProcessing = false;
  try {
    output = await fetchBuffer(processedUrl);
    usedRemoteProcessing = true;
  } catch (remoteError) {
    const message = remoteError instanceof Error ? remoteError.message : String(remoteError);
    process.stderr.write(`\nImage processing fallback: ${message}\n`);
    output = await fetchBuffer(sourceUrl);
  }

  let pipeline = sharp(output, { animated: false });
  if (!usedRemoteProcessing) {
    const metadata = await pipeline.metadata();
    if (directive) {
      const left = clamp(directive.left, 0, (metadata.width ?? 1) - 1);
      const top = clamp(directive.top, 0, (metadata.height ?? 1) - 1);
      pipeline = pipeline.extract({
        left, top,
        width: Math.max(1, Math.min(directive.width, (metadata.width ?? directive.width) - left)),
        height: Math.max(1, Math.min(directive.height, (metadata.height ?? directive.height) - top)),
      });
    }
    output = await pipeline.resize({ width: downloadWidth, height: downloadHeight, fit: 'inside', withoutEnlargement: true }).toBuffer();
    pipeline = sharp(output, { animated: false });
  }
  if (job.clip) {
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const left = clamp(Math.round(width * job.clip.left / 100), 0, width - 1);
    const top = clamp(Math.round(height * job.clip.top / 100), 0, height - 1);
    const right = clamp(Math.round(width * job.clip.right / 100), 0, width - left - 1);
    const bottom = clamp(Math.round(height * job.clip.bottom / 100), 0, height - top - 1);
    pipeline = pipeline.extract({ left, top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - bottom) });
  }
  if (job.processed) output = await pipeline.ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
  const temporary = `${job.target}.part-${process.pid}`;
  await writeFile(temporary, output);
  await rename(temporary, job.target);
  return 'downloaded';
}

const jobs = [...downloadJobs.values()];
const concurrency = Math.max(1, Math.min(96, Number.parseInt(process.env.YIJING_DOWNLOAD_CONCURRENCY ?? '24', 10) || 24));
let completed = 0;
let downloaded = 0;
let cached = 0;
const failures = [];
let nextJob = 0;
const workers = Array.from({ length: concurrency }, async () => {
  while (nextJob < jobs.length) {
    const job = jobs[nextJob++];
    try {
      const result = await downloadJob(job);
      if (result === 'cached') cached += 1; else downloaded += 1;
    } catch (error) {
      failures.push({ url: job.url, error: error instanceof Error ? error.message : String(error) });
    }
    completed += 1;
    if (completed % 100 === 0 || completed === jobs.length) {
      process.stdout.write(`\rAssets ${completed}/${jobs.length} (downloaded ${downloaded}, cached ${cached}, failed ${failures.length})`);
    }
  }
});
await Promise.all(workers);
process.stdout.write('\n');
if (failures.length) {
  await writeFile(path.join(assetRoot, 'download-failures.json'), `${JSON.stringify(failures, null, 2)}\n`);
  throw new Error(`${failures.length} Yijing assets could not be downloaded; see download-failures.json`);
}
await unlink(path.join(assetRoot, 'download-failures.json')).catch((error) => {
  if (error?.code !== 'ENOENT') throw error;
});

const fontAliases = new Map([
  ['baidunumber-Medium', 'BaiduNumberPlus_Medium'],
]);
const legacyFontSources = [
  {
    name: '仓耳非白体', value: 'CangErFeiBaiTi',
    path: 'https://live-cecom-image.bj.bcebos.com/huibo_font/cn/%E4%BB%93%E8%80%B3%E9%9D%9E%E7%99%BD%E4%BD%93.ttf',
  },
  {
    name: '真帅体', value: 'ZhenShuaiTi',
    path: 'https://live-cecom-image.bj.bcebos.com/huibo_font/cn/%E7%9C%9F%E5%B8%85%E4%BD%93.ttf',
  },
  {
    name: '马克笔', value: 'MaKeBi',
    path: 'https://live-cecom-image.bj.bcebos.com/huibo_font/cn/%E9%A9%AC%E5%85%8B%E7%AC%94.ttf',
  },
  {
    name: '演示春风楷', value: 'YanShiChunFengKai',
    path: 'https://live-cecom-image.bj.bcebos.com/huibo_font/cn/%E6%BC%94%E7%A4%BA%E6%98%A5%E9%A3%8E%E6%A5%B7.ttf',
  },
];
const remoteFonts = new Map([
  ...legacyFontSources,
  ...(fontSource.list ?? []),
].map(font => [font.value, font]));
const fontCatalog = [...usedFontFamilies].sort().map(value => {
  const resolvedValue = fontAliases.get(value) ?? value;
  const remote = remoteFonts.get(resolvedValue);
  return {
    value,
    label: remote?.name ?? value,
    family: resolvedValue,
    path: remote ? `/assets/xiling-live/yijing/fonts/${resolvedValue}.ttf` : null,
  };
});
const localFonts = [...new Map(fontCatalog.filter(item => item.path).map(font => [font.family, font])).values()];
for (const font of localFonts) {
  const target = path.join(fontDirectory, `${font.family}.ttf`);
  if (await fileIsReady(target)) continue;
  const remote = remoteFonts.get(font.family);
  const output = await fetchBuffer(remote.path);
  const temporary = `${target}.part-${process.pid}`;
  await writeFile(temporary, output);
  await rename(temporary, target);
}
const fontCss = localFonts.map(font => [
  '@font-face {',
  `  font-family: '${font.family.replaceAll("'", "\\'")}';`,
  `  src: url('${font.path}') format('truetype');`,
  '  font-weight: normal;',
  '  font-style: normal;',
  '  font-display: swap;',
  '}',
].join('\n')).join('\n\n');
await writeFile(fontCatalogFile, `${JSON.stringify(fontCatalog, null, 2)}\n`);
await writeFile(fontCssFile, `${fontCss}\n`);

for (const { template, pages } of normalizedTemplates) {
  await writeFile(path.join(templateDirectory, `${template.id}.json`), `${JSON.stringify({ sourceId: template.id, pages })}\n`);
}
const manifest = {
  source: 'https://yijing.baidu.com/', retrievedAt: source.retrievedAt ?? new Date().toISOString(),
  templateCount: catalog.length, pageCount: totalPages, layerCount: totalLayers, assetCount: jobs.length,
  sourceFontCount: usedFontFamilies.size, mappedFontCount: fontCatalog.filter(font => font.path).length,
  localFontCount: localFonts.length,
  restoredSceneBackgroundCount: sceneBackgrounds.length,
  processing: 'All covers, visual layers, original rendered text previews, and available source fonts are stored locally. Composite real-scene presenter images use locally restored presenter-free backgrounds. Digital-human layers use the selected project avatar.',
};
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
