import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';

const sourceFile = path.resolve(process.argv[2] ?? '.cache/yijing-all-templates.json');
const catalogFile = path.resolve('src/data/yijing-template-catalog.json');
const assetRoot = path.resolve('public');
const artifactDirectory = path.resolve('artifacts');
const reportFile = path.join(artifactDirectory, 'yijing-template-visual-audit.json');
const contactSheetFile = path.join(artifactDirectory, 'yijing-template-visual-audit-worst.png');
const sceneBackgroundManifestFile = path.join(assetRoot, 'assets/xiling-live/yijing/scene-backgrounds.json');
const renderWidth = 180;
const renderHeight = 320;
const geometryTolerance = 0.002;

const [source, catalog, sceneBackgrounds] = await Promise.all([
  readFile(sourceFile, 'utf8').then(JSON.parse),
  readFile(catalogFile, 'utf8').then(JSON.parse),
  readFile(sceneBackgroundManifestFile, 'utf8').then(JSON.parse),
]);
const rawTemplates = Array.isArray(source.list)
  ? source.list
  : (source.data?.list ?? []).flatMap(category => category.template_list ?? []);
const sourceTemplates = [...new Map(rawTemplates.map(template => [Number(template.id), template])).values()];
const catalogBySourceId = new Map(catalog.map(template => [Number(template.sourceId), template]));
const restoredByPage = new Map(sceneBackgrounds.map(item => [`${item.templateId}:${item.pageIndex}`, item]));
const clipPattern = /^inset\(\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s*\)$/;
const metadataCache = new Map();
const renderCache = new Map();

const round = value => Math.round(value * 1000) / 1000;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const numberFromCss = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeRotation = value => {
  const rotation = numberFromCss(value) % 360;
  return round(rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation);
};
const clipInsets = value => {
  if (!value || value === 'inset(0%)') return null;
  const match = String(value).match(clipPattern);
  return match ? { top: Number(match[1]), right: Number(match[2]), bottom: Number(match[3]), left: Number(match[4]) } : null;
};
const expectedPosition = element => {
  const x = numberFromCss(element.x);
  const y = numberFromCss(element.y);
  const width = numberFromCss(element.w, 1);
  const height = numberFromCss(element.h, 1);
  const clip = clipInsets(element.clipPath);
  if (!clip) {
    return {
      x: round((x + width / 2) * 100),
      y: round((y + height / 2) * 100),
      width: round(width * 100),
      height: round(height * 100),
      rotation: normalizeRotation(element.r),
    };
  }
  const visibleWidth = width * Math.max(0.001, 1 - (clip.left + clip.right) / 100);
  const visibleHeight = height * Math.max(0.001, 1 - (clip.top + clip.bottom) / 100);
  return {
    x: round((x + width * clip.left / 100 + visibleWidth / 2) * 100),
    y: round((y + height * clip.top / 100 + visibleHeight / 2) * 100),
    width: round(visibleWidth * 100),
    height: round(visibleHeight * 100),
    rotation: normalizeRotation(element.r),
  };
};
const geometryMatches = (layer, expected) => ['x', 'y', 'width', 'height', 'rotation']
  .every(key => Math.abs(Number(layer[key]) - Number(expected[key])) <= geometryTolerance);
const localFile = publicPath => path.join(assetRoot, publicPath.replace(/^\//, ''));
const sourceLayerId = (templateId, pageIndex, element, elementIndex) => {
  if (element.type === 'character') return `yijing-${templateId}-p${pageIndex}-host-${elementIndex}`;
  if (element.type === 'txt') return `yijing-${templateId}-p${pageIndex}-text-${elementIndex}`;
  if (element.type === 'image' || element.type === 'bg') return `yijing-${templateId}-p${pageIndex}-image-${elementIndex}`;
  return null;
};

async function inspectAsset(publicPath) {
  if (!metadataCache.has(publicPath)) {
    metadataCache.set(publicPath, (async () => {
      const filename = localFile(publicPath);
      const file = await stat(filename);
      const metadata = await sharp(filename, { animated: false }).metadata();
      return {
        bytes: file.size,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? '',
      };
    })());
  }
  return metadataCache.get(publicPath);
}

async function renderedLayer(layer) {
  const width = Math.max(1, Math.round(layer.width * renderWidth / 100));
  const height = Math.max(1, Math.round(layer.height * renderHeight / 100));
  const key = `${layer.preview}:${width}:${height}:${layer.rotation}:${layer.opacity}`;
  if (!renderCache.has(key)) {
    renderCache.set(key, (async () => {
      let pipeline = sharp(localFile(layer.preview), { animated: false })
        .ensureAlpha()
        .resize(width, height, { fit: 'fill' });
      if (Number(layer.opacity) < 100) {
        const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        for (let index = 3; index < data.length; index += 4) {
          data[index] = Math.round(data[index] * Number(layer.opacity) / 100);
        }
        pipeline = sharp(data, { raw: info });
      }
      if (Math.abs(Number(layer.rotation)) > 0.001) {
        pipeline = pipeline.rotate(Number(layer.rotation), { background: { r: 0, g: 0, b: 0, alpha: 0 } });
      }
      const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    })());
  }
  return renderCache.get(key);
}

async function renderPage(layers) {
  const background = layers.find(layer => layer.sceneKey === 'templateBackground' && layer.preview);
  const visualLayers = [
    ...(background ? [background] : []),
    ...layers.filter(layer => layer.sceneKey === 'templateElement' && layer.preview).reverse(),
  ];
  const inputs = [];
  for (const layer of visualLayers) {
    const rendered = await renderedLayer(layer);
    const left = Math.round(layer.x * renderWidth / 100 - rendered.width / 2);
    const top = Math.round(layer.y * renderHeight / 100 - rendered.height / 2);
    const sourceLeft = Math.max(0, -left);
    const sourceTop = Math.max(0, -top);
    const sourceWidth = Math.min(rendered.width - sourceLeft, renderWidth - Math.max(0, left));
    const sourceHeight = Math.min(rendered.height - sourceTop, renderHeight - Math.max(0, top));
    if (sourceWidth <= 0 || sourceHeight <= 0) continue;
    const input = sourceLeft || sourceTop || sourceWidth !== rendered.width || sourceHeight !== rendered.height
      ? await sharp(rendered.data).extract({
        left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight,
      }).png().toBuffer()
      : rendered.data;
    inputs.push({ input, left: Math.max(0, left), top: Math.max(0, top) });
  }
  const buffer = await sharp({
    create: { width: renderWidth, height: renderHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(inputs).png().toBuffer();
  return buffer;
}

async function imageCoverage(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let alpha = 0;
  let visible = 0;
  for (let index = 3; index < data.length; index += 4) {
    alpha += data[index];
    if (data[index] >= 16) visible += 1;
  }
  return {
    alpha: round(alpha / (info.width * info.height * 255)),
    visible: round(visible / (info.width * info.height)),
  };
}

async function compareWithCover(rendered, coverFile) {
  const [renderData, coverData] = await Promise.all([
    sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(coverFile, { animated: false }).ensureAlpha().resize(renderWidth, renderHeight, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true }),
  ]);
  let localVisible = 0;
  let coverVisible = 0;
  let intersection = 0;
  let outsideCover = 0;
  let colorError = 0;
  let colorSamples = 0;
  for (let index = 0; index < renderData.data.length; index += 4) {
    const localAlpha = renderData.data[index + 3];
    const coverAlpha = coverData.data[index + 3];
    const localOn = localAlpha >= 32;
    const coverOn = coverAlpha >= 32;
    if (localOn) localVisible += 1;
    if (coverOn) coverVisible += 1;
    if (localOn && coverOn) {
      intersection += 1;
      colorError += (
        Math.abs(renderData.data[index] - coverData.data[index])
        + Math.abs(renderData.data[index + 1] - coverData.data[index + 1])
        + Math.abs(renderData.data[index + 2] - coverData.data[index + 2])
      ) / (3 * 255);
      colorSamples += 1;
    }
    if (localOn && !coverOn) outsideCover += 1;
  }
  return {
    localVisible: round(localVisible / (renderWidth * renderHeight)),
    coverVisible: round(coverVisible / (renderWidth * renderHeight)),
    localOverlap: localVisible ? round(intersection / localVisible) : 1,
    localOutsideCover: localVisible ? round(outsideCover / localVisible) : 0,
    overlappingColorError: colorSamples ? round(colorError / colorSamples) : 0,
  };
}

function pageSeverity(page) {
  return (
    page.errors.length * 100
    + page.coverComparison.localOutsideCover * 5
    + page.coverComparison.overlappingColorError
  );
}

async function createContactSheet(items) {
  const cellWidth = renderWidth * 2;
  const labelHeight = 24;
  const cellHeight = renderHeight + labelHeight;
  const columns = 4;
  const rows = Math.ceil(items.length / columns);
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const left = index % columns * cellWidth;
    const top = Math.floor(index / columns) * cellHeight;
    const cover = await sharp(item.coverFile).resize(renderWidth, renderHeight, { fit: 'cover' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#17191d"/><text x="8" y="16" fill="#fff" font-size="12" font-family="sans-serif">${item.sourceId}  cover | imported</text></svg>`);
    composites.push(
      { input: label, left, top },
      { input: cover, left, top: top + labelHeight },
      { input: item.rendered, left: left + renderWidth, top: top + labelHeight },
    );
  }
  await sharp({
    create: { width: columns * cellWidth, height: rows * cellHeight, channels: 4, background: '#d7d8dc' },
  }).composite(composites).png().toFile(contactSheetFile);
}

await mkdir(artifactDirectory, { recursive: true });
const pageResults = [];
const contactCandidates = [];
let checkedLayers = 0;
let checkedAssets = 0;
let bottomSourceElements = 0;
let restoredScenePages = 0;
let transparentBackgroundPages = 0;

for (let templateIndex = 0; templateIndex < sourceTemplates.length; templateIndex += 1) {
  const sourceTemplate = sourceTemplates[templateIndex];
  const sourceId = Number(sourceTemplate.id);
  const catalogTemplate = catalogBySourceId.get(sourceId);
  if (!catalogTemplate) {
    pageResults.push({ sourceId, pageIndex: 0, errors: ['catalog entry missing'], warnings: [] });
    continue;
  }
  const imported = JSON.parse(await readFile(localFile(catalogTemplate.layersUrl), 'utf8'));
  const sourcePages = JSON.parse(sourceTemplate.template_data);
  for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex += 1) {
    const sourcePage = sourcePages[pageIndex];
    const importedPage = imported.pages[pageIndex];
    const layers = importedPage?.layers ?? [];
    const errors = [];
    const warnings = [];
    const backgroundLayers = layers.filter(layer => layer.sceneKey === 'templateBackground');
    const sourceBackground = (sourcePage.elements ?? []).find(element => element.type === 'bg');
    const sourceHost = (sourcePage.elements ?? []).find(element => element.type === 'character');
    const restored = restoredByPage.get(`${sourceId}:${pageIndex}`);
    if (backgroundLayers.length !== 1) errors.push(`expected one background layer, found ${backgroundLayers.length}`);
    if (restored) {
      restoredScenePages += 1;
      if (backgroundLayers[0]?.preview !== restored.path) errors.push('restored scene background is not applied');
    } else if (!sourceBackground) {
      transparentBackgroundPages += 1;
      if (backgroundLayers[0]?.preview !== '/assets/xiling-live/yijing/blank.png') {
        errors.push('source-transparent page does not use blank.png');
      }
    }
    const layerById = new Map(layers.map(layer => [layer.id, layer]));
    let pageBottomElements = 0;
    for (let elementIndex = 0; elementIndex < (sourcePage.elements ?? []).length; elementIndex += 1) {
      const element = sourcePage.elements[elementIndex];
      const expectedId = sourceLayerId(sourceId, pageIndex, element, elementIndex);
      if (!expectedId) continue;
      checkedLayers += 1;
      const layer = layerById.get(expectedId);
      if (!layer) {
        errors.push(`source element ${elementIndex} (${element.type}) is missing`);
        continue;
      }
      const expected = expectedPosition(element);
      if (!geometryMatches(layer, expected)) {
        errors.push(`source element ${elementIndex} geometry differs`);
      }
      if (element.y != null && numberFromCss(element.y) + numberFromCss(element.h, 1) >= 0.75) {
        pageBottomElements += 1;
        bottomSourceElements += 1;
      }
    }
    const importedSourceLayerCount = layers.length - (!sourceBackground ? 1 : 0);
    const expectedSourceLayerCount = (sourcePage.elements ?? []).filter(element => sourceLayerId(sourceId, pageIndex, element, 0)).length;
    if (importedSourceLayerCount !== expectedSourceLayerCount) {
      errors.push(`source/imported layer count differs (${expectedSourceLayerCount}/${importedSourceLayerCount})`);
    }
    for (const layer of layers.filter(layer => layer.preview)) {
      try {
        const metadata = await inspectAsset(layer.preview);
        checkedAssets += 1;
        if (!metadata.bytes || !metadata.width || !metadata.height) errors.push(`invalid asset ${layer.preview}`);
      } catch (cause) {
        errors.push(`unreadable asset ${layer.preview}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    let rendered = null;
    let coverage = { alpha: 0, visible: 0 };
    let coverComparison = {
      localVisible: 0, coverVisible: 0, localOverlap: 1, localOutsideCover: 0, overlappingColorError: 0,
    };
    if (pageIndex === 0 && !errors.some(error => error.startsWith('unreadable asset'))) {
      rendered = await renderPage(layers);
      coverage = await imageCoverage(rendered);
      const coverFile = localFile(catalogTemplate.image);
      coverComparison = await compareWithCover(rendered, coverFile);
      if (coverage.visible < 0.005 && coverComparison.coverVisible >= 0.05) {
        errors.push('rendered non-host artwork is effectively blank while the cover is not');
      }
      contactCandidates.push({ sourceId, coverFile, rendered, score: 0 });
    }
    const result = {
      sourceId,
      name: sourceTemplate.show_name,
      pageIndex,
      pageId: importedPage?.pageId ?? null,
      sourceLayerCount: expectedSourceLayerCount,
      importedLayerCount: layers.length,
      bottomSourceElements: pageBottomElements,
      background: restored ? 'restored-scene' : sourceBackground ? 'source' : 'transparent',
      templateHasHost: layers.some(layer => layer.sceneKey === 'host'),
      hostAfterApply: true,
      coverage,
      coverComparison,
      errors,
      warnings,
    };
    pageResults.push(result);
    if (rendered) contactCandidates.at(-1).score = pageSeverity(result);
  }
  if ((templateIndex + 1) % 100 === 0 || templateIndex + 1 === sourceTemplates.length) {
    process.stdout.write(`\rAudited ${templateIndex + 1}/${sourceTemplates.length} templates`);
  }
}
process.stdout.write('\n');

const errors = pageResults.flatMap(page => page.errors.map(message => ({ sourceId: page.sourceId, pageIndex: page.pageIndex, message })));
const warnings = pageResults.flatMap(page => page.warnings.map(message => ({ sourceId: page.sourceId, pageIndex: page.pageIndex, message })));
const report = {
  generatedAt: new Date().toISOString(),
  sourceFile: path.relative(process.cwd(), sourceFile),
  summary: {
    templates: sourceTemplates.length,
    pages: pageResults.length,
    checkedLayers,
    checkedAssets,
    uniqueAssets: metadataCache.size,
    bottomSourceElements,
    restoredScenePages,
    transparentBackgroundPages,
    pagesWithHost: pageResults.filter(page => page.templateHasHost).length,
    pagesWithoutTemplateHost: pageResults.filter(page => !page.templateHasHost).length,
    pagesWithHostAfterApply: pageResults.filter(page => page.hostAfterApply).length,
    errors: errors.length,
    warnings: warnings.length,
  },
  errors,
  warnings,
  pages: pageResults,
};
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
const worst = contactCandidates.sort((left, right) => right.score - left.score).slice(0, 24);
await createContactSheet(worst);
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);
console.log(`Contact sheet: ${path.relative(process.cwd(), contactSheetFile)}`);
if (errors.length) process.exitCode = 1;
