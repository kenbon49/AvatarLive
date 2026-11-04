import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';

const cdpBase = process.env.YIJING_CDP_URL ?? 'http://127.0.0.1:9224';
const assetRoot = path.resolve('public/assets/xiling-live/yijing');
const coverDirectory = path.join(assetRoot, 'components');
const layerDirectory = path.join(assetRoot, 'component-layers');
const elementDirectory = path.join(assetRoot, 'elements');
const outputPath = path.resolve(process.argv[2] ?? 'public/assets/xiling-live/yijing/components.json');
const deduplicationPath = path.join(assetRoot, 'component-deduplication.json');
const endpoint = 'https://yijing.baidu.com/ai_anchor/paster/component_list';
const pageSize = 50;
const outputWidth = 1080;
const outputHeight = 1920;
const perceptualDistanceLimit = 3;
const pixelDifferenceLimit = 0.045;
const colorVariantPattern = /[（(](?:红色|橙色|黄色|绿色|浅蓝|深蓝|蓝色|紫色|粉色|白色|灰色|黑色|咖色|棕色)[）)]/g;
const explicitColorVariantPattern = /[（(](?:红色|橙色|黄色|绿色|浅蓝|深蓝|蓝色|紫色|粉色|白色|灰色|黑色|咖色|棕色)[）)]/;
const categories = [
  { id: 259, name: '直播标题' },
  { id: 231, name: '优惠信息' },
  { id: 230, name: '商品卡' },
  { id: 235, name: '保障信息' },
  { id: 363, name: '主播名片' },
  { id: 364, name: '擅长项目' },
];
const cropPattern = /@c_1,x_(\d+),y_(\d+),w_(\d+),h_(\d+)/;
const clipPattern = /^inset\(\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s*\)$/;
const downloadJobs = new Map();

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
const normalizedUrl = value => String(value ?? '').replace(/^http:\/\//, 'https://');
const acceleratedAssetUrl = value => value.replace(
  /\b(huibo-data|digital-video|live-cecom-image)\.bj\.bcebos\.com\b/,
  '$1.cdn.bcebos.com',
);
const extensionFor = value => {
  const sourceUrl = value.slice(0, value.search(/@c_1,|$/));
  return /\.jpe?g(?:$|\?)/i.test(sourceUrl) ? 'jpg' : 'png';
};
const cssColorToHex = (value, fallback = '#ffffff') => {
  if (typeof value !== 'string') return fallback;
  const hex = value.match(/#[\da-f]{6}/i)?.[0];
  if (hex) return hex.toLowerCase();
  const rgba = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!rgba) return fallback;
  return `#${rgba.slice(1, 4).map(part => clamp(Math.round(Number(part)), 0, 255).toString(16).padStart(2, '0')).join('')}`;
};
const sourceFontFamily = value => String(value ?? '').split(',').map(item => item.trim()).find(Boolean) ?? 'SiYuanHeiTi';
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

async function fileIsReady(filename) {
  try { return (await stat(filename)).size > 0; } catch { return false; }
}

async function readYijingCookies() {
  const targets = await fetch(`${cdpBase}/json`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url.includes('yijing.baidu.com'));
  if (!target) throw new Error(`Open a logged-in https://yijing.baidu.com page in the Chrome instance at ${cdpBase}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const cookies = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out while reading Yijing browser cookies')), 15_000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message.result.cookies ?? []);
      socket.close();
    };
    socket.onerror = reject;
  });
  const header = cookies.filter(cookie => cookie.domain.endsWith('baidu.com')).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  if (!header) throw new Error('The selected Chrome profile is not logged into Baidu Yijing');
  return header;
}

async function fetchPage(cookieHeader, componentType, pageNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
          Origin: 'https://yijing.baidu.com',
          Referer: 'https://yijing.baidu.com/',
        },
        body: JSON.stringify({ component_type: [componentType], pn: pageNumber, rn: pageSize, color: null }),
      });
      const payload = await response.json();
      if (!response.ok || payload.errno !== 0) {
        throw new Error(`HTTP ${response.status}, errno ${payload.errno}: ${payload.errmsg ?? 'unknown error'}`);
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Yijing component type ${componentType}, page ${pageNumber} failed: ${lastError?.message ?? 'unknown error'}`);
}

async function fetchCategory(cookieHeader, category) {
  const first = await fetchPage(cookieHeader, category.id, 1);
  const pageCount = Math.ceil(first.count / pageSize);
  const list = [...(first.list ?? [])];
  for (let start = 2; start <= pageCount; start += 6) {
    const count = Math.min(6, pageCount - start + 1);
    const pages = await Promise.all(Array.from({ length: count }, (_, index) => fetchPage(cookieHeader, category.id, start + index)));
    pages.forEach(page => list.push(...(page.list ?? [])));
    process.stdout.write(`\r${category.name}: ${Math.min(start + count - 1, pageCount)}/${pageCount} pages`);
  }
  process.stdout.write(`\r${category.name}: ${pageCount}/${pageCount} pages, ${list.length} components\n`);
  const unique = [...new Map(list.map(item => [item.id, item])).values()];
  if (unique.length !== first.count) throw new Error(`${category.name}: expected ${first.count} components, received ${unique.length}`);
  return unique;
}

function coverPath(component) {
  const extension = path.extname(new URL(component.cover).pathname).toLowerCase();
  const safeExtension = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension) ? extension : '.png';
  return {
    filename: `${component.id}${safeExtension}`,
    publicPath: `/assets/xiling-live/yijing/components/${component.id}${safeExtension}`,
  };
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

async function downloadCover(component) {
  const { filename, publicPath } = coverPath(component);
  const destination = path.join(coverDirectory, filename);
  if (await fileIsReady(destination)) return publicPath;
  const bytes = await fetchBuffer(component.cover);
  const temporary = `${destination}.part-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
  return publicPath;
}

const hammingDistance = (left, right) => {
  let value = left ^ right;
  let distance = 0;
  while (value) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
};

async function coverFingerprint(publicPath) {
  const filename = path.resolve('public', publicPath.slice(1));
  const bytes = await readFile(filename);
  const metadata = await sharp(bytes).metadata();
  const pixels = await sharp(bytes).flatten({ background: '#ffffff' }).resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const gray = await sharp(bytes).flatten({ background: '#ffffff' }).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  let differenceHash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      differenceHash = (differenceHash << 1n) | BigInt(gray[y * 9 + x] > gray[y * 9 + x + 1]);
    }
  }
  return {
    exact: createHash('sha256').update(bytes).digest('hex'),
    differenceHash,
    pixels,
    aspectRatio: (metadata.width ?? 1) / (metadata.height ?? 1),
  };
}

function pixelDifference(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / (left.length * 255);
}

async function filterSimilarComponents(components, coverPaths) {
  const fingerprints = new Map();
  let fingerprintIndex = 0;
  const workers = Array.from({ length: 12 }, async () => {
    while (fingerprintIndex < components.length) {
      const index = fingerprintIndex++;
      const component = components[index];
      fingerprints.set(component.id, await coverFingerprint(coverPaths.get(component.id)));
      if ((index + 1) % 100 === 0 || index + 1 === components.length) {
        process.stdout.write(`\rFingerprinted ${index + 1}/${components.length} component covers`);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');

  const kept = [];
  const removed = [];
  for (const category of categories) {
    const candidates = components.filter(component => component.component_type_name === category.name).sort((left, right) => (
      Number(right.top_mark ?? 0) - Number(left.top_mark ?? 0)
      || String(right.mtime ?? '').localeCompare(String(left.mtime ?? ''))
      || Number(right.show_index ?? 0) - Number(left.show_index ?? 0)
    ));
    const accepted = [];
    const exact = new Map();
    for (const component of candidates) {
      const fingerprint = fingerprints.get(component.id);
      const exactMatch = exact.get(fingerprint.exact);
      let similarMatch = exactMatch;
      let perceptualDistance = 0;
      let meanPixelDifference = 0;
      if (!similarMatch) {
        for (const existing of accepted) {
          const existingFingerprint = fingerprints.get(existing.id);
          if (Math.abs(Math.log(fingerprint.aspectRatio / existingFingerprint.aspectRatio)) > 0.04) continue;
          perceptualDistance = hammingDistance(fingerprint.differenceHash, existingFingerprint.differenceHash);
          if (perceptualDistance > perceptualDistanceLimit) continue;
          meanPixelDifference = pixelDifference(fingerprint.pixels, existingFingerprint.pixels);
          if (meanPixelDifference <= pixelDifferenceLimit) {
            similarMatch = existing;
            break;
          }
        }
      }
      if (similarMatch) {
        removed.push({
          id: component.id,
          name: component.show_name,
          category: category.name,
          keptId: similarMatch.id,
          keptName: similarMatch.show_name,
          reason: exactMatch ? 'exact' : 'perceptual',
          perceptualDistance,
          meanPixelDifference: round(meanPixelDifference),
        });
        continue;
      }
      exact.set(fingerprint.exact, component);
      accepted.push(component);
      kept.push(component);
    }
  }
  return { kept, removed };
}

const normalizedDesignName = component => String(component.show_name ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(colorVariantPattern, '')
  .replace(/[123]行标题/g, '多行标题')
  .replace(/[（(](?:一个卖点|两个卖点|无卖点|单行标题无卖点|双行标题无卖点|双行标题)[）)]/g, '')
  .replace(/(-保障信息-纯文字)[234]/g, '$1');

function componentFirstPageElements(component) {
  const sourcePages = JSON.parse(component.content ?? '[]');
  return Array.isArray(sourcePages[0]?.elements) ? sourcePages[0].elements : [];
}

function filterDesignFamilies(components) {
  const groups = new Map();
  for (const component of components) {
    const designKey = `${component.component_type_name}\n${normalizedDesignName(component)}`;
    const group = groups.get(designKey) ?? [];
    group.push(component);
    groups.set(designKey, group);
  }

  const keptIds = new Set();
  const removed = [];
  for (const [designKey, group] of groups) {
    const preferred = [...group].sort((left, right) => {
      const leftElements = componentFirstPageElements(left);
      const rightElements = componentFirstPageElements(right);
      const textDifference = rightElements.filter(element => element.type === 'txt').length
        - leftElements.filter(element => element.type === 'txt').length;
      return textDifference
        || rightElements.length - leftElements.length
        || Number(explicitColorVariantPattern.test(String(left.show_name ?? '')))
          - Number(explicitColorVariantPattern.test(String(right.show_name ?? '')));
    })[0];
    keptIds.add(preferred.id);
    for (const component of group) {
      if (component.id === preferred.id) continue;
      removed.push({
        id: component.id,
        name: component.show_name,
        category: component.component_type_name,
        keptId: preferred.id,
        keptName: preferred.show_name,
        reason: 'design-family',
        designKey: designKey.slice(designKey.indexOf('\n') + 1),
      });
    }
  }
  return { kept: components.filter(component => keptIds.has(component.id)), removed };
}

function registerAsset(sourceUrl, element) {
  if (!sourceUrl) return undefined;
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
    downloadJobs.set(key, { url, clip, target, processed, targetWidth, targetHeight });
  }
  return `/assets/xiling-live/yijing/elements/${filename}`;
}

function layerName(element, index) {
  const name = String(element.name ?? '').trim();
  if (element.moduleType === 'image') return '可替换图片';
  return name || (element.type === 'txt' ? `组件文字 ${index + 1}` : `组件图片 ${index + 1}`);
}

function textLayer(element, componentId, elementIndex) {
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
    id: `yijing-component-${componentId}-text-${elementIndex}`,
    kind: 'text',
    value: String(element.name ?? '').trim() || '文字',
    sceneKey: 'templateElement',
    preview: registerAsset(element.url, element),
    ...position(element),
    fontSize: round(clamp(baseFontSize * scaleY, 6, 144)),
    color: cssColorToHex(styles.color),
    fontFamily: sourceFontFamily(styles.fontFamily),
    letterSpacing: round(numberFromCss(styles.letterSpacing ?? styles.letterSpace) * numberFromCss(element.scaleX, 1)),
    fontWeight: fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : 'normal',
    fontStyle: styles.fontStyle === 'italic' ? 'italic' : 'normal',
    textDecoration: styles.textDecoration === 'underline' || styles.textDecoration === 'line-through' ? styles.textDecoration : 'none',
    textAlign: styles.justifyContent === 'start' || styles.textAlign === 'left' ? 'left' : styles.justifyContent === 'end' || styles.textAlign === 'right' ? 'right' : 'center',
    lineHeight: round(clamp(lineHeightPixels / Math.max(baseFontSize, 1), 0.8, 3)),
    strokeEnabled: strokeWidth > 1 && !String(styles.textStrokeColor ?? '').includes('transparent'),
    strokeColor,
    strokeWidth: round(strokeWidth * scaleY),
    shadowEnabled: Boolean(shadow && !shadow.includes('transparent')),
    shadowColor: cssColorToHex(shadow, '#000000'),
    shadowBlur: shadowNumbers[2] ?? 0,
    shadowX: shadowNumbers[0] ?? 0,
    shadowY: shadowNumbers[1] ?? 0,
    backgroundEnabled: false,
    backgroundColor: '#111827',
    backgroundOpacity: 72,
    backgroundRadius: 0,
    componentRole: element.moduleType,
    componentTextLimit: Number(element.moduleTextLimit) || undefined,
  };
}

function componentDocument(component) {
  const sourceElements = componentFirstPageElements(component);
  const layers = sourceElements.map((element, index) => {
    const geometry = position(element);
    if (geometry.width <= 0 || geometry.height <= 0) return null;
    if (element.type === 'txt') return textLayer(element, component.id, index);
    if (element.type !== 'image' || !element.url) return null;
    return {
      id: `yijing-component-${component.id}-image-${index}`,
      kind: 'image', value: layerName(element, index), sceneKey: 'templateElement',
      preview: registerAsset(element.url, element), ...geometry,
      componentRole: element.moduleType,
    };
  }).filter(Boolean).reverse();
  return {
    sourceId: component.id,
    name: component.show_name || component.component_type_name || `组件 ${component.id}`,
    category: component.component_type_name,
    layers,
  };
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
    process.stderr.write(`\nImage processing fallback: ${remoteError instanceof Error ? remoteError.message : String(remoteError)}\n`);
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

async function downloadRegisteredAssets() {
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
        process.stdout.write(`\rLayer assets ${completed}/${jobs.length} (downloaded ${downloaded}, cached ${cached}, failed ${failures.length})`);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
  if (failures.length) {
    await writeFile(path.join(assetRoot, 'component-download-failures.json'), `${JSON.stringify(failures, null, 2)}\n`);
    throw new Error(`${failures.length} component assets could not be downloaded; see component-download-failures.json`);
  }
  await unlink(path.join(assetRoot, 'component-download-failures.json')).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { jobs: jobs.length, downloaded, cached };
}

await Promise.all([
  mkdir(coverDirectory, { recursive: true }),
  mkdir(layerDirectory, { recursive: true }),
  mkdir(elementDirectory, { recursive: true }),
]);
const cookieHeader = await readYijingCookies();
const categoryLists = [];
for (const category of categories) categoryLists.push(await fetchCategory(cookieHeader, category));
const sourceComponents = categoryLists.flat();
const availableComponents = sourceComponents.filter(component => {
  if (!component.cover) return false;
  try { return Boolean(new URL(component.cover).protocol); } catch { return false; }
});
console.log(`Downloading ${availableComponents.length} component covers (${sourceComponents.length - availableComponents.length} unavailable)`);

const coverPaths = new Map();
let nextCover = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (nextCover < availableComponents.length) {
    const index = nextCover++;
    const component = availableComponents[index];
    coverPaths.set(component.id, await downloadCover(component));
    if ((index + 1) % 100 === 0 || index + 1 === availableComponents.length) process.stdout.write(`\rCovers ${index + 1}/${availableComponents.length}`);
  }
}));
process.stdout.write('\n');

const { kept: visuallyDistinctComponents, removed: similarComponents } = await filterSimilarComponents(availableComponents, coverPaths);
const { kept: designDistinctComponents, removed: designFamilyComponents } = filterDesignFamilies(visuallyDistinctComponents);
const designReplacements = new Map(designFamilyComponents.map(item => [String(item.id), item]));
const remappedSimilarComponents = similarComponents.map((item) => {
  const replacement = designReplacements.get(String(item.keptId));
  return replacement ? { ...item, keptId: replacement.keptId, keptName: replacement.keptName } : item;
});
const removedComponents = [...remappedSimilarComponents, ...designFamilyComponents];
console.log(`Cover similarity filter kept ${visuallyDistinctComponents.length}/${availableComponents.length} components and removed ${similarComponents.length}`);
console.log(`Design family filter kept ${designDistinctComponents.length}/${visuallyDistinctComponents.length} components and removed ${designFamilyComponents.length}`);
const candidateDocuments = new Map(designDistinctComponents.map(component => [component.id, componentDocument(component)]));
const nonEditableComponents = designDistinctComponents.filter(component => (
  !candidateDocuments.get(component.id)?.layers.some(layer => layer.kind === 'text')
)).map(component => ({
  id: component.id,
  name: component.show_name,
  category: component.component_type_name,
  reason: 'no-editable-text',
}));
const nonEditableIds = new Set(nonEditableComponents.map(component => component.id));
const filteredComponents = designDistinctComponents.filter(component => !nonEditableIds.has(component.id));
const documents = new Map(filteredComponents.map(component => [component.id, candidateDocuments.get(component.id)]));
console.log(`Editable text filter kept ${filteredComponents.length}/${designDistinctComponents.length} components and removed ${nonEditableComponents.length}`);
const assetSummary = await downloadRegisteredAssets();

for (const component of filteredComponents) {
  const document = documents.get(component.id);
  await writeFile(path.join(layerDirectory, `${component.id}.json`), `${JSON.stringify(document)}\n`);
}

const list = filteredComponents.map(component => {
  const document = documents.get(component.id);
  const textLayerCount = document.layers.filter(layer => layer.kind === 'text').length;
  return {
    id: String(component.id),
    name: document.name,
    category: component.component_type_name,
    image: coverPaths.get(component.id),
    layersUrl: `/assets/xiling-live/yijing/component-layers/${component.id}.json`,
    layerCount: document.layers.length,
    textLayerCount,
    editable: textLayerCount > 0,
    color: component.color_name || '',
  };
});
const categorySummary = categories.map((category, index) => ({
  id: category.id,
  name: category.name,
  sourceCount: categoryLists[index].length,
  availableCount: availableComponents.filter(component => component.component_type_name === category.name).length,
  count: list.filter(component => component.category === category.name).length,
}));
const catalog = {
  source: endpoint,
  retrievedAt: new Date().toISOString(),
  sourceCount: sourceComponents.length,
  availableCount: availableComponents.length,
  duplicateCount: removedComponents.length,
  nonEditableCount: nonEditableComponents.length,
  coverDuplicateCount: similarComponents.length,
  designDuplicateCount: designFamilyComponents.length,
  categories: categorySummary,
  count: list.length,
  list,
};
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(deduplicationPath, `${JSON.stringify({
    generatedAt: catalog.retrievedAt,
    perceptualDistanceLimit,
    pixelDifferenceLimit,
    sourceCount: availableComponents.length,
    keptCount: list.length,
    removedCount: removedComponents.length,
    coverDuplicateCount: similarComponents.length,
    designDuplicateCount: designFamilyComponents.length,
    excludedCount: nonEditableComponents.length,
    excluded: nonEditableComponents,
    removed: removedComponents,
  }, null, 2)}\n`),
]);
console.log(`Saved ${list.length} editable Yijing components to ${outputPath}`);
console.log(`Layer assets: ${assetSummary.jobs} unique, ${assetSummary.cached} cached, ${assetSummary.downloaded} downloaded`);
