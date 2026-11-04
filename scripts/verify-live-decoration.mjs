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
    deviceScaleFactor: 1, mobile: Number(process.env.VIEWPORT_WIDTH) <= 760,
  });
  await send('Page.navigate', { url: pageUrl });
  await waitFor('Array.from(document.querySelectorAll(".xlStudioNav button")).some(button => button.textContent?.trim() === "装修")');
  const blankDraft = await evaluate('({ layerCount: document.querySelectorAll(".xlLayerRow").length, backgroundCount: document.querySelectorAll(".xlSceneBackground").length, decorationCount: document.querySelectorAll(".xlCanvasText, .xlCustomSceneAsset").length })');
  if (blankDraft.layerCount !== 1 || blankDraft.backgroundCount !== 0 || blankDraft.decorationCount !== 0) {
    throw new Error(`Studio did not open as a blank single-host draft: ${JSON.stringify(blankDraft)}`);
  }
  if (screenshotPath) {
    const blankShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(screenshotPath.replace(/\.png$/, '-blank.png'), Buffer.from(blankShot.data, 'base64'));
  }
  await waitFor('(() => { if (document.querySelector(".xlMaterialTabs")) return true; Array.from(document.querySelectorAll(".xlStudioNav button")).find(button => button.textContent?.trim() === "装修")?.click(); return false; })()');
  const tabs = await waitFor('document.querySelector(".xlMaterialTabs")?.textContent?.trim()');
  if (tabs.replace(/\s+/g, '') !== '模板组件图片文字') throw new Error(`Unexpected decoration tabs: ${tabs}`);
  const oldBadges = await evaluate('Array.from(document.querySelectorAll(".xlTemplateCover i")).filter(item => item.textContent === "一镜").length');
  if (oldBadges) throw new Error(`${oldBadges} template source badges remain`);

  await evaluate('Array.from(document.querySelectorAll(".xlMaterialTabs button")).find(button => button.textContent?.trim() === "组件").click()');
  await waitFor('document.querySelectorAll(".xlComponentCard").length === 60');
  const count = await evaluate('document.querySelector(".xlComponentCount").textContent');
  const componentCount = Number.parseInt(count, 10);
  if (componentCount !== 181) throw new Error(`Unexpected editable component count: ${count}`);
  const catalogAudit = await evaluate('(async () => { const catalog = await fetch("/assets/xiling-live/yijing/components.json").then(response => response.json()); const documents = await Promise.all(catalog.list.map(item => fetch(item.layersUrl).then(response => response.json()))); const invalid = catalog.list.filter((item, index) => !item.editable || item.textLayerCount < 1 || documents[index].layers.filter(layer => layer.kind === "text").length !== item.textLayerCount); return { count: catalog.list.length, textLayers: catalog.list.reduce((sum, item) => sum + item.textLayerCount, 0), invalid: invalid.map(item => item.id) }; })()');
  if (catalogAudit.count !== 181 || catalogAudit.textLayers !== 622 || catalogAudit.invalid.length) throw new Error(`Component edit audit failed: ${JSON.stringify(catalogAudit)}`);
  const pencilIconCount = await evaluate('document.querySelectorAll(".xlComponentCard > span > svg").length');
  if (pencilIconCount) throw new Error(`${pencilIconCount} component card icons remain`);
  const componentCardCenter = await evaluate('(() => { const bounds = document.querySelector(".xlComponentCard").getBoundingClientRect(); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }; })()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: componentCardCenter.x, y: componentCardCenter.y });
  const hoverStyle = await evaluate('(() => { const style = getComputedStyle(document.querySelector(".xlComponentCard")); return { borderColor: style.borderColor, backgroundColor: style.backgroundColor, boxShadow: style.boxShadow }; })()');
  if (hoverStyle.borderColor !== 'rgb(23, 100, 242)' || hoverStyle.boxShadow === 'none') throw new Error(`Component hover style is not visible: ${JSON.stringify(hoverStyle)}`);
  await evaluate('Array.from(document.querySelectorAll(".xlComponentCategories button")).find(button => button.textContent === "直播标题").click()');
  const categoryCount = await waitFor('(() => { const count = Number.parseInt(document.querySelector(".xlComponentCount")?.textContent, 10); return count > 40 && document.querySelectorAll(".xlComponentCard").length === Math.min(60, count); })()');
  if (process.env.VIEWPORT_WIDTH && screenshotPath) {
    await evaluate('document.querySelector(".xlComponentCategories").scrollIntoView({ block: "center" })');
    const panel = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(screenshotPath.replace(/\.png$/, '-panel.png'), Buffer.from(panel.data, 'base64'));
  }
  const name = await evaluate('document.querySelector(".xlComponentCard strong")?.textContent');
  await evaluate('document.querySelector(".xlComponentCard").click()');
  await waitFor('Boolean(document.querySelector(".xlLayerSelectionBox.component"))');
  const selectedCard = await evaluate('(() => { const card = document.querySelector(".xlComponentCard.selected"); if (!card) return null; const style = getComputedStyle(card); return { pressed: card.getAttribute("aria-pressed"), borderColor: style.borderColor, backgroundColor: style.backgroundColor, boxShadow: style.boxShadow }; })()');
  if (!selectedCard || selectedCard.pressed !== 'true' || selectedCard.borderColor !== 'rgb(23, 100, 242)' || selectedCard.boxShadow === 'none') throw new Error(`Component selected style is not visible: ${JSON.stringify(selectedCard)}`);
  const positionInspectorVisible = await evaluate('Boolean(document.querySelector(".xlLayerInspector"))');
  if (positionInspectorVisible) throw new Error('Canvas position inspector should stay hidden');
  await waitFor('document.querySelectorAll(".xlCustomSceneAsset.templateElement img").length > 0');
  const componentPosition = await evaluate('(() => { const item = document.querySelector(".xlCustomSceneAsset.templateElement"); return item ? { left: item.style.left, top: item.style.top, width: item.style.width, height: item.style.height } : null; })()');
  if (!componentPosition || Number.parseFloat(componentPosition.top) > 30) throw new Error(`Official title component was not placed at the top: ${JSON.stringify(componentPosition)}`);

  const componentLayerCount = await evaluate('document.querySelectorAll(".xlLayerRow").length');
  const highlightedComponentLayerCount = await evaluate('document.querySelectorAll(".xlLayerRow.component-selected").length');
  if (highlightedComponentLayerCount < 2) throw new Error(`Component layers were not highlighted as a group: ${highlightedComponentLayerCount}`);
  const originalTextBounds = await evaluate('(() => { const text = document.querySelector(".xlCanvasRenderedText"); const canvas = document.querySelector(".xlPortraitCanvas"); if (!text || !canvas) return null; const bounds = text.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, canvasWidth: canvas.getBoundingClientRect().width, containerType: getComputedStyle(canvas).containerType }; })()');
  const fontProbe = await evaluate('(() => { const input = document.querySelector(".xlLayerRow input"); if (!input) return "no editable text"; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, input.value + "测"); input.dispatchEvent(new Event("input", { bubbles: true })); return "edited"; })()');
  if (fontProbe === 'edited') await waitFor('Boolean(document.querySelector(".xlCanvasText.templateElement:not(.xlCanvasRenderedText)"))');
  const editedTextStyle = await evaluate('(() => { const text = document.querySelector(".xlCanvasText.templateElement:not(.xlCanvasRenderedText)"); if (!text) return null; const bounds = text.getBoundingClientRect(); const style = getComputedStyle(text); return { width: bounds.width, height: bounds.height, fontFamily: style.fontFamily, fontSize: style.fontSize, inlineFontSize: text.style.fontSize }; })()');
  if (fontProbe === 'edited' && (!originalTextBounds || !editedTextStyle || originalTextBounds.containerType !== 'inline-size' || Math.abs(originalTextBounds.width - editedTextStyle.width) > 1 || Math.abs(originalTextBounds.height - editedTextStyle.height) > 1 || !editedTextStyle.inlineFontSize.endsWith('cqw'))) {
    throw new Error(`Edited text geometry changed: ${JSON.stringify({ originalTextBounds, editedTextStyle })}`);
  }
  const renderedFont = editedTextStyle?.fontFamily ?? null;
  const supplementalFonts = await evaluate('(async () => { const names = ["MaKeBi", "YanShiChunFengKai"]; await Promise.all(names.map(name => document.fonts.load(`16px ${name}`, "测试字体"))); return Object.fromEntries(names.map(name => [name, document.fonts.check(`16px ${name}`, "测试字体")])); })()');
  if (Object.values(supplementalFonts).some(loaded => !loaded)) throw new Error(`Supplemental fonts failed: ${JSON.stringify(supplementalFonts)}`);
  await evaluate('Array.from(document.querySelectorAll(".xlComponentCategories button")).find(button => button.textContent === "商品卡").click()');
  await waitFor('Boolean(document.querySelector(".xlComponentCard[data-component-id=\\"310\\"]"))');
  await evaluate('document.querySelector(".xlComponentCard[data-component-id=\\"310\\"]").click()');
  await waitFor('document.querySelector(".xlComponentCard[data-component-id=\\"310\\"]")?.classList.contains("selected")');
  const priceProbe = await evaluate('(() => { const input = Array.from(document.querySelectorAll(".xlLayerRow input")).find(item => item.value === "49799"); if (!input) return "missing"; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "497990"); input.dispatchEvent(new Event("input", { bubbles: true })); return "edited"; })()');
  if (priceProbe !== 'edited') throw new Error('Editable product-card price was not found');
  const priceFit = await waitFor('(() => { const outer = Array.from(document.querySelectorAll(".xlCanvasText.templateElement")).find(item => item.textContent === "497990"); const content = outer?.querySelector(".xlCanvasTextContent"); if (!outer || !content || content.getBoundingClientRect().width > outer.getBoundingClientRect().width + 1) return null; const outerBounds = outer.getBoundingClientRect(); const contentBounds = content.getBoundingClientRect(); const style = getComputedStyle(content); return { outerWidth: outerBounds.width, outerHeight: outerBounds.height, contentWidth: contentBounds.width, contentHeight: contentBounds.height, transform: style.transform, whiteSpace: style.whiteSpace }; })()');
  if (priceFit.whiteSpace !== 'nowrap' || priceFit.contentWidth > priceFit.outerWidth + 1 || priceFit.contentHeight > priceFit.outerHeight + 1) throw new Error(`Product-card price did not retain its single-line style: ${JSON.stringify(priceFit)}`);

  if (screenshotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
  }
  console.log(JSON.stringify({ blankDraft, tabs, oldBadges, count, catalogAudit, pencilIconCount, hoverStyle, categoryCount: Boolean(categoryCount), selectedComponent: name, selectedCard, componentLayerCount, highlightedComponentLayerCount, positionInspectorVisible, componentPosition, fontProbe, originalTextBounds, editedTextStyle, renderedFont, supplementalFonts, priceProbe, priceFit }));
} finally {
  socket.close();
}
