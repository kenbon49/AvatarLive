import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdpBase = process.env.YIJING_CDP_URL ?? 'http://127.0.0.1:9223';
const outputPath = path.resolve(process.argv[2] ?? '.cache/yijing-all-templates.json');
const pageSize = 16;

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
const cookieHeader = cookies.filter(cookie => cookie.domain.endsWith('baidu.com')).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
if (!cookieHeader) throw new Error('The selected Chrome profile is not logged into Baidu Yijing');

const endpoint = 'https://yijing.baidu.com/ai_anchor/template/public/list';
async function fetchPage(pageNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', Origin: 'https://yijing.baidu.com', Referer: 'https://yijing.baidu.com/' },
        body: JSON.stringify({ pn: pageNumber, rn: pageSize }),
      });
      const payload = await response.json();
      if (!response.ok || payload.errno !== 0) throw new Error(`HTTP ${response.status}, errno ${payload.errno}: ${payload.errmsg ?? 'unknown error'}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Yijing page ${pageNumber} failed: ${lastError?.message ?? 'unknown error'}`);
}

const first = await fetchPage(1);
const pageCount = Math.ceil(first.data.count / pageSize);
const templates = [...(first.data.list ?? [])];
for (let start = 2; start <= pageCount; start += 6) {
  const batchSize = Math.min(6, pageCount - start + 1);
  const pages = await Promise.all(Array.from({ length: batchSize }, (_, index) => fetchPage(start + index)));
  for (const page of pages) templates.push(...(page.data.list ?? []));
  process.stdout.write(`\rFetched ${Math.min(start + batchSize - 1, pageCount)}/${pageCount} pages`);
}
process.stdout.write('\n');

const uniqueTemplates = [...new Map(templates.map(template => [template.id, template])).values()];
if (uniqueTemplates.length !== first.data.count) throw new Error(`Expected ${first.data.count} templates, received ${uniqueTemplates.length} unique templates`);
const output = { source: endpoint, retrievedAt: new Date().toISOString(), count: uniqueTemplates.length, list: uniqueTemplates };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output));
console.log(`Saved ${uniqueTemplates.length} templates to ${outputPath}`);
