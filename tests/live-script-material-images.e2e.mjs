import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firstStudioRoom, loginStudio } from './studio-auth.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const baseUrl = process.env.LIVE_STUDIO_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await loginStudio(context, baseUrl);
const sourceRoom = await firstStudioRoom(context, baseUrl);
const room = {
  ...structuredClone(sourceRoom), id: 'script-material-images-test', name: '脚本多图上传测试', version: 1,
  config: { ...structuredClone(sourceRoom.config), importedMaterialImages: [], editorDraft: '' },
};
const png = await readFile(new URL('../public/assets/xiling-live/yijing-elements/3304-08-0f9cdc559d.png', import.meta.url));
await context.addInitScript(() => localStorage.setItem('synlive.activeLiveRoom.v1', 'script-material-images-test'));
await context.route(/\/api\/v1\/live-rooms(?:\/|\?|$)/, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/live-rooms') && route.request().method() === 'GET') {
    await route.fulfill({ json: [room] });
  } else if (path.endsWith(`/live-rooms/${room.id}`) && route.request().method() === 'PUT') {
    room.config = route.request().postDataJSON().config;
    room.version += 1;
    await route.fulfill({ json: { ...room, updatedAt: new Date().toISOString() } });
  } else {
    await route.fulfill({ status: 404, json: { detail: 'not found' } });
  }
});

try {
  const page = await context.newPage();
  const input = page.locator('.xlMaterialsPanel input[accept^=".pdf"]');
  const images = page.locator('.xlAttachedImageList .xlAttachedImage');
  const image = (name) => ({ name, mimeType: 'image/png', buffer: png });
  const waitForImages = (count) => page.waitForFunction(
    (expected) => document.querySelectorAll('.xlAttachedImageList .xlAttachedImage').length === expected,
    count,
  );

  await page.goto(`${baseUrl}/live?studio=1`);
  await page.locator('.xlRoomPicker strong').getByText(room.name).waitFor();
  await page.locator('.xlStudioNav').getByRole('button', { name: '脚本' }).click();
  assert.equal(await input.getAttribute('multiple'), '');

  await input.setInputFiles(image('正面.png'));
  await waitForImages(1);
  await input.setInputFiles(image('背面.png'));
  await waitForImages(2);
  await input.setInputFiles([image('侧面.png'), image('细节.png')]);
  await waitForImages(4);
  assert.deepEqual(await images.locator('img.xlAttachedImageThumb').evaluateAll((nodes) => nodes.map((node) => node.alt)),
    ['正面.png', '背面.png', '侧面.png', '细节.png']);

  await input.setInputFiles(image('第五张.png'));
  await page.getByText(/最多上传 4 张图片/).waitFor();
  assert.equal(await images.count(), 4);
  await images.getByRole('button', { name: '移除上传图片背面.png' }).click();
  await waitForImages(3);
  await input.setInputFiles(image('第五张.png'));
  await waitForImages(4);

  await input.setInputFiles({ name: '参考资料.txt', mimeType: 'text/plain', buffer: Buffer.from('商品资料：正面展示的品名准确。') });
  await page.getByRole('dialog', { name: '文档导入结果' }).getByRole('button', { name: '取消' }).click();
  await page.locator('.xlAttachedMaterial').getByText('参考资料.txt').waitFor();
  assert.equal(await images.count(), 4);

  let expandRequest;
  await page.route('**/live-ai-api/expand', async (route) => {
    expandRequest = route.request().postDataJSON();
    await route.fulfill({ json: { content: '欢迎来到直播间，今天介绍这款商品。' } });
  });
  await page.getByRole('button', { name: '扩写', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="主播口播脚本"]')?.value.includes('今天介绍这款商品'));
  assert.equal(expandRequest.imageDataUrls.length, 4);
  assert.ok(expandRequest.imageDataUrls.every((url) => url.startsWith('data:image/png;base64,')));
  for (const name of ['正面.png', '侧面.png', '细节.png', '第五张.png', '参考资料.txt']) {
    assert.ok(expandRequest.prompt.includes(name), `Expansion prompt is missing ${name}`);
  }

  for (const name of ['正面.png', '侧面.png', '细节.png', '第五张.png']) {
    await images.getByRole('button', { name: `移除上传图片${name}` }).click();
  }
  await waitForImages(0);
  await page.locator('.xlAttachedMaterial').getByText('参考资料.txt').waitFor();
  await input.setInputFiles(['正面.png', '侧面.png', '细节.png', '第五张.png'].map(image));
  await waitForImages(4);
  await page.locator('.xlAttachedMaterial').getByRole('button', { name: '移除上传文档' }).click();
  assert.equal(await images.count(), 4);
  await page.waitForTimeout(1300);
  assert.deepEqual(room.config.importedMaterialImages.map((item) => item.name),
    ['正面.png', '侧面.png', '细节.png', '第五张.png']);
  await page.reload();
  await page.locator('.xlRoomPicker strong').getByText(room.name).waitFor();
  await page.locator('.xlStudioNav').getByRole('button', { name: '脚本' }).click();
  await waitForImages(4);
  assert.equal(await page.locator('.xlAttachedMaterial').count(), 0);
  console.log('Script image attachments passed: append, batch, limit, removal, document, expansion and restore');
} finally {
  await browser.close();
}
