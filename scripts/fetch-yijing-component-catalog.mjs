import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdpBase = process.env.YIJING_CDP_URL ?? 'http://127.0.0.1:9224';
const assetDirectory = path.resolve('public/assets/xiling-live/yijing/components');
const outputPath = path.resolve(process.argv[2] ?? 'public/assets/xiling-live/yijing/components.json');
const endpoint = 'https://yijing.baidu.com/ai_anchor/paster/component_list';
const pageSize = 50;
const categories = [
  { id: 259, name: '直播标题' },
  { id: 231, name: '优惠信息' },
  { id: 230, name: '商品卡' },
  { id: 235, name: '保障信息' },
  { id: 363, name: '主播名片' },
  { id: 364, name: '擅长项目' },
];

async function readYijingCookies() {
  const targets = await fetch(`${cdpBase}/json`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url.includes('yijing.baidu.com'));
  if (!target) throw new Error(`Open a logged-in https://yijing.baidu.com page in the Chrome instance at ${cdpBase}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const cookies = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out while reading Yijing browser cookies')), 5_000);
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

const cookieHeader = await readYijingCookies();

async function fetchPage(componentType, pageNumber) {
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

async function fetchCategory(category) {
  const first = await fetchPage(category.id, 1);
  const pageCount = Math.ceil(first.count / pageSize);
  const list = [...(first.list ?? [])];
  for (let start = 2; start <= pageCount; start += 6) {
    const count = Math.min(6, pageCount - start + 1);
    const pages = await Promise.all(Array.from({ length: count }, (_, index) => fetchPage(category.id, start + index)));
    pages.forEach(page => list.push(...(page.list ?? [])));
    process.stdout.write(`\r${category.name}: ${Math.min(start + count - 1, pageCount)}/${pageCount} pages`);
  }
  process.stdout.write(`\r${category.name}: ${pageCount}/${pageCount} pages, ${list.length} components\n`);
  const unique = [...new Map(list.map(item => [item.id, item])).values()];
  if (unique.length !== first.count) throw new Error(`${category.name}: expected ${first.count} components, received ${unique.length}`);
  return unique;
}

function componentBounds(component) {
  let pages = [];
  try {
    pages = JSON.parse(component.content ?? '[]');
  } catch {
    // Some historical entries have malformed editable content; their cover remains usable.
  }
  const elements = pages.flatMap(page => Array.isArray(page.elements) ? page.elements : []);
  const boxes = elements.map(element => ({
    left: Number(element.x), top: Number(element.y),
    right: Number(element.x) + Number(element.w), bottom: Number(element.y) + Number(element.h),
  })).filter(box => Object.values(box).every(Number.isFinite));
  if (!boxes.length) return { x: 50, y: 50, width: 40, height: 20 };

  const left = Math.min(...boxes.map(box => box.left));
  const top = Math.min(...boxes.map(box => box.top));
  const right = Math.max(...boxes.map(box => box.right));
  const bottom = Math.max(...boxes.map(box => box.bottom));
  return {
    x: Math.max(0, Math.min(100, ((left + right) / 2) * 100)),
    y: Math.max(0, Math.min(100, ((top + bottom) / 2) * 100)),
    width: Math.max(5, Math.min(100, (right - left) * 100)),
    height: Math.max(2, Math.min(100, (bottom - top) * 100)),
  };
}

function coverPath(component) {
  const extension = path.extname(new URL(component.cover).pathname).toLowerCase();
  const safeExtension = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension) ? extension : '.png';
  return {
    filename: `${component.id}${safeExtension}`,
    publicPath: `/assets/xiling-live/yijing/components/${component.id}${safeExtension}`,
  };
}

async function downloadCover(component) {
  const { filename, publicPath } = coverPath(component);
  const destination = path.join(assetDirectory, filename);
  if ((await stat(destination).catch(() => null))?.size > 0) return publicPath;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(component.cover, { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      await writeFile(destination, bytes);
      return publicPath;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Failed to download component ${component.id}: ${lastError?.message ?? 'unknown error'}`);
}

const categoryLists = [];
for (const category of categories) categoryLists.push(await fetchCategory(category));
const sourceComponents = categoryLists.flat();
const availableComponents = sourceComponents.filter(component => {
  if (!component.cover) return false;
  try {
    return Boolean(new URL(component.cover).protocol);
  } catch {
    return false;
  }
});
const unavailableCount = sourceComponents.length - availableComponents.length;
if (unavailableCount) console.warn(`Skipped ${unavailableCount} Yijing components without a usable cover`);
await mkdir(assetDirectory, { recursive: true });

const downloaded = new Map();
let nextIndex = 0;
async function downloadWorker() {
  while (nextIndex < availableComponents.length) {
    const index = nextIndex;
    nextIndex += 1;
    const component = availableComponents[index];
    downloaded.set(component.id, await downloadCover(component));
    if ((index + 1) % 100 === 0 || index + 1 === availableComponents.length) {
      process.stdout.write(`\rDownloaded ${index + 1}/${availableComponents.length} component covers`);
    }
  }
}
await Promise.all(Array.from({ length: 12 }, () => downloadWorker()));
process.stdout.write('\n');

const list = availableComponents.map(component => ({
  id: String(component.id),
  name: component.show_name || component.component_type_name || `组件 ${component.id}`,
  category: component.component_type_name,
  image: downloaded.get(component.id),
  ...componentBounds(component),
  color: component.color_name || '',
}));
const categorySummary = categories.map((category, index) => ({
  id: category.id,
  name: category.name,
  count: categoryLists[index].filter(component => component.cover).length,
}));
const catalog = {
  source: endpoint,
  retrievedAt: new Date().toISOString(),
  sourceCount: sourceComponents.length,
  categories: categorySummary,
  count: list.length,
  list,
};
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Saved ${list.length} official Yijing components to ${outputPath}`);
