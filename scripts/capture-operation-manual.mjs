import assert from 'node:assert/strict';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');

const baseUrl = process.env.MANUAL_BASE_URL ?? 'http://127.0.0.1:3000';
const identifier = process.env.MANUAL_LOGIN_ID;
const password = process.env.MANUAL_LOGIN_PASSWORD;
const outputDir = path.resolve('public/assets/manual');

assert.ok(identifier && password, 'Set MANUAL_LOGIN_ID and MANUAL_LOGIN_PASSWORD');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1505, height: 950 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});

try {
  const login = await context.request.post(`${baseUrl}/api/v1/auth/login`, {
    data: { identifier, password },
  });
  assert.equal(login.ok(), true, `Login failed: HTTP ${login.status()}`);

  let virtualVersion = 10_000;
  await context.route(/\/api\/v1\/live-rooms\/[^/?]+$/, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        id: route.request().url().split('/').at(-1),
        name: '新手演示直播间',
        status: 'draft',
        version: virtualVersion++,
        config: payload.config,
        updatedAt: new Date().toISOString(),
      },
    });
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/live`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /新建直播间/ }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByText('选择数字人', { exact: true }).waitFor();
  await createDialog.getByLabel('新直播间名称').fill('秋季新品直播间');
  const avatarOptions = createDialog.getByRole('radio');
  if (await avatarOptions.count() > 1) await avatarOptions.nth(1).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, '01-create-room.png') });

  await page.goto(`${baseUrl}/live?studio=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.xlRoomPicker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_000);

  await page.locator('.xlStudioNav').getByRole('button', { name: '脚本' }).click();
  await page.getByRole('button', { name: '写片段' }).click();
  const scriptEditor = page.getByRole('textbox', { name: '主播口播脚本' });
  await scriptEditor.fill('欢迎来到今天的新品直播间，这款六堡茶香气自然、冲泡方便，适合日常办公室饮用。');
  await page.locator('input[accept^=".pdf"]').setInputFiles(path.resolve('public/assets/products/liubao-tea-zodiac.webp'));
  await page.locator('.xlAttachedImage').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '02-script-and-image.png') });

  await page.locator('.xlComposerVoiceButton').click();
  const voiceDialog = page.getByRole('dialog', { name: '主播声音' });
  await voiceDialog.waitFor({ timeout: 10_000 });
  await voiceDialog.getByText('公共音色', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '03-voice-preview.png') });
  await page.getByRole('button', { name: '关闭主播声音' }).click();

  const addStoryboard = page.locator('.xlScriptEditorMeta').getByRole('button', { name: '加入分镜' });
  if (await addStoryboard.isVisible()) await addStoryboard.click();
  await page.locator('.xlStudioNav').getByRole('button', { name: '装修' }).click();
  await page.locator('.xlTemplateBrowser').waitFor({ timeout: 10_000 });
  await page.locator('.xlTemplateCard').first().getByRole('button').click();
  await page.waitForFunction(() => document.querySelectorAll('.xlLayersPanel .xlLayerRow').length >= 4);
  await page.waitForFunction(() => [...document.querySelectorAll('.xlPortraitCanvas img')]
    .every((image) => image.complete && image.naturalWidth > 0));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, '04-decorated-room.png') });

  await page.locator('.xlStudioNav').getByRole('button', { name: '脚本' }).click();
  await page.locator('.xlStoryboardRail').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '05-save-and-synthesize.png') });

  await page.getByRole('button', { name: '开播编排' }).click();
  const liveDialog = page.getByRole('dialog', { name: '开播编排' });
  await liveDialog.waitFor({ timeout: 10_000 });
  await liveDialog.getByRole('button', { name: '窗口采集（推荐）' }).click();
  await liveDialog.getByRole('button', { name: '普通窗口' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '06-start-live.png') });

  await page.goto(`${baseUrl}/help`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '第一次创建数字人直播' }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('figure img')];
    return images.length === 6 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
    'Desktop operation manual must not overflow horizontally');
  await page.screenshot({ path: path.resolve('artifacts/operation-manual-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
    'Mobile operation manual must not overflow horizontally');
  await page.screenshot({ path: path.resolve('artifacts/operation-manual-mobile.png') });

  console.log('Operation-manual screenshots captured from the current live studio UI');
} finally {
  await browser.close();
}
