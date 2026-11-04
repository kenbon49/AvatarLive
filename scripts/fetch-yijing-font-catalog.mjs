import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdpBase = process.env.YIJING_CDP_URL ?? 'http://127.0.0.1:9223';
const outputPath = path.resolve(process.argv[2] ?? '.cache/yijing-fonts.json');

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

const endpoint = 'https://yijing.baidu.com/ai_anchor/script/fonts/font';
const response = await fetch(endpoint, {
  method: 'POST',
  signal: AbortSignal.timeout(30_000),
  headers: {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Origin: 'https://yijing.baidu.com',
    Referer: 'https://yijing.baidu.com/',
  },
  body: JSON.stringify({ pn: 1, rn: 100 }),
});
const payload = await response.json();
if (!response.ok || payload.errno !== 0) {
  throw new Error(`HTTP ${response.status}, errno ${payload.errno}: ${payload.errmsg ?? 'unknown error'}`);
}
const fonts = payload.data?.list ?? [];
if (!fonts.length) throw new Error('Yijing returned an empty font catalog');

const output = { source: endpoint, retrievedAt: new Date().toISOString(), count: fonts.length, list: fonts };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Saved ${fonts.length} fonts to ${outputPath}`);
