import { writeFile } from 'node:fs/promises';

const browserUrl = process.env.CDP_URL ?? 'http://127.0.0.1:9224';
const pageUrl = process.argv[2] ?? 'http://127.0.0.1:3001/live?studio=1';
const screenshotPath = process.argv[3];
const targets = await fetch(`${browserUrl}/json`).then(response => response.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('No Chrome page target');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let requestId = 0;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(`${request.method} ${request.expression ?? ''}: ${message.error.message}`));
  else request.resolve(message.result);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { method, expression: params.expression?.slice(0, 110), resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  if (process.env.VIEWPORT_WIDTH) await send('Emulation.setDeviceMetricsOverride', {
    width: Number(process.env.VIEWPORT_WIDTH), height: Number(process.env.VIEWPORT_HEIGHT ?? 844),
    deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: pageUrl });
  await waitFor('Array.from(document.querySelectorAll(".xlStudioNav button")).some(button => button.textContent?.trim() === "装修")');
  await waitFor('(() => { if (document.querySelector(".xlMaterialTabs")) return true; Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修")?.click(); return false; })()');
  const tabs = await waitFor('document.querySelector(".xlMaterialTabs")?.textContent?.trim()');
  if (tabs.replace(/\s+/g, '') !== '模板组件图片文字') throw new Error(`Unexpected decoration tabs: ${tabs}`);
  const oldBadges = await evaluate('Array.from(document.querySelectorAll(".xlTemplateCover i")).filter(item => item.textContent === "一镜").length');
  if (oldBadges) throw new Error(`${oldBadges} template source badges remain`);

  await evaluate('Array.from(document.querySelectorAll(".xlMaterialTabs button")).find(button => button.textContent?.trim() === "组件").click()');
  await waitFor('document.querySelectorAll(".xlComponentCard").length === 60');
  const count = await evaluate('document.querySelector(".xlComponentCount").textContent');
  await evaluate('Array.from(document.querySelectorAll(".xlComponentCategories button")).find(button => button.textContent === "顶部").click()');
  const categoryCount = await waitFor('document.querySelector(".xlComponentCount")?.textContent?.startsWith("2018 ") && document.querySelectorAll(".xlComponentCard").length === 60');
  if (process.env.VIEWPORT_WIDTH && screenshotPath) {
    await evaluate('document.querySelector(".xlComponentCategories").scrollIntoView({ block: "center" })');
    const panel = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(screenshotPath.replace(/\.png$/, '-panel.png'), Buffer.from(panel.data, 'base64'));
  }
  const name = await evaluate('document.querySelector(".xlComponentCard strong")?.textContent');
  await evaluate('document.querySelector(".xlComponentCard").click()');
  await waitFor('document.querySelectorAll(".xlCustomSceneAsset.templateElement img").length > 0');

  const fontProbe = await evaluate('(() => { const input = document.querySelector(".xlLayerRow input"); if (!input) return "no editable text"; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, input.value + "测"); input.dispatchEvent(new Event("input", { bubbles: true })); return "edited"; })()');
  if (fontProbe === 'edited') await waitFor('Boolean(document.querySelector(".xlCanvasText.templateElement:not(.xlCanvasRenderedText)"))');
  const renderedFont = await evaluate('(() => { const text = document.querySelector(".xlCanvasText.templateElement:not(.xlCanvasRenderedText)"); return text ? getComputedStyle(text).fontFamily : null; })()');
  const supplementalFonts = await evaluate('(async () => { const names = ["MaKeBi", "YanShiChunFengKai"]; await Promise.all(names.map(name => document.fonts.load(`16px ${name}`, "测试字体"))); return Object.fromEntries(names.map(name => [name, document.fonts.check(`16px ${name}`, "测试字体")])); })()');
  if (Object.values(supplementalFonts).some(loaded => !loaded)) throw new Error(`Supplemental fonts failed: ${JSON.stringify(supplementalFonts)}`);

  if (screenshotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
  }
  console.log(JSON.stringify({ tabs, oldBadges, count, categoryCount: Boolean(categoryCount), selectedComponent: name, fontProbe, renderedFont, supplementalFonts }));
} finally {
  socket.close();
}
