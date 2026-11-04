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

const undoButton = `document.querySelector(${JSON.stringify('button[aria-label="撤回上一步画面编辑"]')})`;
const redoButton = `document.querySelector(${JSON.stringify('button[aria-label="恢复下一步画面编辑"]')})`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1505, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await waitFor(`Boolean(${undoButton} && ${redoButton})`, 60000);
  await waitFor('(() => { if (document.querySelector(".xlMaterialTabs")) return true; Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修")?.click(); return false; })()');
  await evaluate('Array.from(document.querySelectorAll(".xlMaterialTabs button")).find(button => button.textContent?.trim() === "组件").click()');
  await waitFor('Boolean(document.querySelector(".xlComponentCard[data-component-id=\\"1806\\"]"))');
  const initialLayerCount = await evaluate('document.querySelectorAll(".xlLayerRow").length');
  await evaluate('document.querySelector(".xlComponentCard[data-component-id=\\"1806\\"]").click()');
  const addedLayerCount = await waitFor(`(() => { const count = document.querySelectorAll('.xlLayerRow').length; return count > ${initialLayerCount} ? count : 0; })()`);
  await waitFor(`!${undoButton}.disabled`);
  await evaluate(`${undoButton}.click()`);
  await waitFor(`document.querySelectorAll('.xlLayerRow').length === ${initialLayerCount} && !${redoButton}.disabled`);
  await evaluate(`${redoButton}.click()`);
  await waitFor(`document.querySelectorAll('.xlLayerRow').length === ${addedLayerCount}`);

  const originalText = '中药保健品好物大促销';
  const editedText = '中药保健品秋季好物大促销';
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(input => input.value === '${originalText}'))`);
  await evaluate(`(() => { const input = Array.from(document.querySelectorAll('.xlLayerRow input')).find(item => item.value === '${originalText}'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '${editedText}'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(input => input.value === '${editedText}'))`);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(input => input.value === '${originalText}'))`);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))");
  await waitFor(`Boolean(Array.from(document.querySelectorAll('.xlLayerRow input')).find(input => input.value === '${editedText}'))`);

  const dragResult = await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('[data-layer-hit]')).find(item => !item.getAttribute('aria-label').startsWith('选择组件'));
    const canvas = document.querySelector('.xlPortraitCanvas');
    if (!target || !canvas) return null;
    const before = target.style.left;
    const rect = target.getBoundingClientRect();
    const init = { pointerId: 41, pointerType: 'mouse', button: 0, buttons: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    for (const offset of [8, 16, 24]) canvas.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: init.clientX + offset }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: init.clientX + 24 }));
    return { id: target.dataset.layerHit, before };
  })()`);
  if (!dragResult) throw new Error('No draggable layer was found');
  const movedLeft = await waitFor(`(() => { const item = document.querySelector('[data-layer-hit="${dragResult.id}"]'); return item?.style.left !== '${dragResult.before}' ? item.style.left : ''; })()`);
  await evaluate(`${undoButton}.click()`);
  await waitFor(`document.querySelector('[data-layer-hit="${dragResult.id}"]')?.style.left === '${dragResult.before}'`);

  const layout = await evaluate(`(() => {
    const header = document.querySelector('.xlPreviewHeader').getBoundingClientRect();
    const controls = document.querySelector('.xlHistoryControls').getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll('.xlHistoryControls button')).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }));
    return { header: { width: header.width, height: header.height }, controls: { left: controls.left, right: controls.right, width: controls.width }, buttons };
  })()`);
  await screenshot('artifacts/live-history-desktop.png');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise(resolve => setTimeout(resolve, 500));
  const mobileOverflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  await screenshot('artifacts/live-history-mobile.png');
  if (mobileOverflow > 1) throw new Error(`Mobile layout overflows by ${mobileOverflow}px`);
  if (layout.buttons.some(button => button.width !== 26 || button.height !== 26)) throw new Error(`Unexpected history button size: ${JSON.stringify(layout.buttons)}`);

  console.log(JSON.stringify({ initialLayerCount, addedLayerCount, movedLeft, layout, mobileOverflow }, null, 2));
} finally {
  socket.close();
}
