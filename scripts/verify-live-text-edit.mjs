import { writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:3001/live?studio=1';
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
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
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
async function screenshot(filename) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(filename, Buffer.from(result.data, 'base64'));
}
const targetText = '中药保健品好物大促销';
const editedText = '中药保健品好物大促惠';
const details = `(() => {
  const input = Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '${targetText}' || item.value === '${editedText}');
  if (!input) return null;
  const layer = input.closest('.xlLayerRow');
  const asset = Array.from(document.querySelectorAll('.xlCanvasText')).find(item => item.textContent === input.value || item.querySelector('img')?.alt === input.value);
  const element = asset?.querySelector('.xlCanvasTextContent') ?? asset;
  const bounds = element?.getBoundingClientRect();
  const container = asset?.getBoundingClientRect();
  const style = element ? getComputedStyle(element) : null;
  const outerStyle = asset ? getComputedStyle(asset) : null;
  return { value: input.value, layerId: layer?.dataset.layerId, rendered: Boolean(asset?.querySelector('img')), width: bounds?.width, height: bounds?.height, containerWidth: container?.width, containerHeight: container?.height, font: outerStyle?.font, fontFamily: outerStyle?.fontFamily, fontSize: outerStyle?.fontSize, stroke: outerStyle?.webkitTextStroke, transform: style?.transform, image: asset?.querySelector('img')?.src };
})()`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1505, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await waitFor('Boolean(Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修"))', 60000);
  await waitFor('(() => { if (document.querySelector(".xlMaterialTabs")) return true; Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修")?.click(); return false; })()');
  await evaluate('Array.from(document.querySelectorAll(".xlMaterialTabs button")).find(button => button.textContent?.trim() === "组件").click()');
  await waitFor('Boolean(document.querySelector(".xlComponentCard[data-component-id=\\"1806\\"]"))');
  await evaluate('document.querySelector(".xlComponentCard[data-component-id=\\"1806\\"]").click()');
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '${targetText}'))`);
  await evaluate('(async () => { await document.fonts.ready; return true; })()');
  const before = await evaluate(details);
  await screenshot('artifacts/live-text-edit-before.png');
  await evaluate(`(() => { const input = Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '${targetText}'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '${editedText}'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '${editedText}'))`);
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlCanvasText:not(.xlCanvasRenderedText)')).find(item => item.textContent === '${editedText}'))`);
  const after = await evaluate(`(() => { const result = ${details}; const text = Array.from(document.querySelectorAll('.xlCanvasText:not(.xlCanvasRenderedText)')).find(item => item.textContent === '${editedText}'); return { ...result, paintOrder: getComputedStyle(text).paintOrder }; })()`);
  await screenshot('artifacts/live-text-edit-after.png');
  if (after.paintOrder !== 'stroke') throw new Error(`Edited text does not paint its fill above the stroke: ${after.paintOrder}`);
  if (Math.abs(before.width - after.width) / before.width > .08) throw new Error(`Edited text width changed too much: ${before.width} -> ${after.width}`);
  if (Math.abs(before.height - after.height) / before.height > .15) throw new Error(`Edited text height changed too much: ${before.height} -> ${after.height}`);
  await evaluate('Array.from(document.querySelectorAll(".xlMaterialTabs button")).find(button => button.textContent?.trim() === "模板").click()');
  await waitFor('Boolean(document.querySelector(".xlTemplateBrowser .xlMaterialSearch input"))');
  await evaluate(`(() => { const input = document.querySelector('.xlTemplateBrowser .xlMaterialSearch input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '云南昆大'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor('Boolean(Array.from(document.querySelectorAll(".xlTemplateCard button")).find(button => button.textContent.includes("云南昆大")))');
  await evaluate('Array.from(document.querySelectorAll(".xlTemplateCard button")).find(button => button.textContent.includes("云南昆大")).click()');
  await waitFor('Boolean(Array.from(document.querySelectorAll(".xlLayerRow input")).find(input => input.value === "1xxx"))');
  await evaluate(`(() => { const input = Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '1xxx'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '2xxx'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const templateText = await waitFor(`(() => { const text = Array.from(document.querySelectorAll('.xlCanvasText:not(.xlCanvasRenderedText)')).find(item => item.textContent === '2xxx'); if (!text) return null; const style = getComputedStyle(text); return { paintOrder: style.paintOrder, color: style.color, stroke: style.webkitTextStroke }; })()`);
  if (templateText.paintOrder !== 'stroke') throw new Error(`Template text does not paint its fill above the stroke: ${templateText.paintOrder}`);
  await screenshot('artifacts/live-template-text-edit-after.png');
  console.log(JSON.stringify({ component: { before, after }, template: templateText }, null, 2));
} finally {
  socket.close();
}
