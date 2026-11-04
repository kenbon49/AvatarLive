import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3001/live?studio=1';
const curation = JSON.parse(await readFile('src/data/yijing-template-curation.json', 'utf8'));
const target = (await fetch('http://127.0.0.1:9224/json').then(response => response.json()))
  .find(item => item.type === 'page');
if (!target) throw new Error('No browser page available');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
  else request.resolve(message.result);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { method, resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}
async function waitFor(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1505, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await waitFor('Array.from(document.querySelectorAll(".xlStudioNav button")).some(button => button.textContent?.trim() === "装修")', 60000);
  assert.equal(await evaluate('document.querySelectorAll(".xlSceneHost").length > 0'), true);
  await waitFor('(() => { if (document.querySelector(".xlMaterialTabs")) return true; Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修")?.click(); return false; })()');
  await waitFor('document.querySelectorAll(".xlTemplateCard").length > 0');

  const fullCatalog = await evaluate(`(async () => {
    const result = await fetch('/assets/xiling-live/yijing/templates/3289.json');
    return { archivedTemplateAvailable: result.ok };
  })()`);
  assert.equal(fullCatalog.archivedTemplateAvailable, true);
  const expectedCount = 994 - curation.obscuredHost.length - Object.keys(curation.duplicateOf).length;
  const visible = await evaluate(`(async () => {
    let load = document.querySelector('.xlTemplateLoadMore');
    for (let page = 0; load && page < 15; page++) {
      load.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      load = document.querySelector('.xlTemplateLoadMore');
    }
    return Array.from(document.querySelectorAll('.xlTemplateCard img')).map(image => Number(image.src.split('/').at(-1).split('.')[0]));
  })()`);
  assert.equal(visible.length, expectedCount);
  const retired = new Set([...curation.obscuredHost, ...Object.keys(curation.duplicateOf).map(Number)]);
  assert.ok(visible.every(id => !retired.has(id)));

  await evaluate('Array.from(document.querySelectorAll(".xlTemplateCard button")).find(button => button.textContent.includes("豪华甄选")).click()');
  await waitFor('Boolean(document.querySelector(".xlTemplateCard.selected")?.textContent?.includes("豪华甄选") && document.querySelector(".xlSceneBackground"))');
  const scene = await evaluate(`(() => {
    const host = document.querySelector('.xlSceneHost');
    const background = document.querySelector('.xlSceneBackground');
    const canvas = document.querySelector('.xlPortraitCanvas');
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return { hostVisible: hostRect.width > 40 && hostRect.height > 100, backgroundLoaded: background.complete && background.naturalWidth > 0, canvasWidth: canvasRect.width };
  })()`);
  assert.equal(scene.hostVisible, true);
  assert.equal(scene.backgroundLoaded, true);
  const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('artifacts/live-template-curation-verified-desktop.png', Buffer.from(desktop.data, 'base64'));

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor('document.documentElement.clientWidth <= 390');
  const mobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('artifacts/live-template-curation-verified-mobile.png', Buffer.from(mobile.data, 'base64'));
  await evaluate('document.querySelector(".xlPortraitCanvas").scrollIntoView({ block: "center" })');
  const mobilePreview = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('artifacts/live-template-curation-verified-mobile-preview.png', Buffer.from(mobilePreview.data, 'base64'));
  console.log(JSON.stringify({ visibleTemplates: visible.length, hiddenTemplates: retired.size, scene }));
} finally {
  socket.close();
}
