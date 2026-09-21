import assert from 'node:assert/strict';
import { ALIYUN_PUBLIC_VOICES } from '../src/lib/aliyun-voice-catalog.ts';
import { loginStudio } from './studio-auth.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const baseUrl = process.env.LIVE_STUDIO_URL ?? 'http://127.0.0.1:3000';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await loginStudio(context, baseUrl);
await context.route(/\/api\/v1\/live-rooms(?:\/|\?|$)/, async (route) => {
  await route.fulfill({ json: [] });
});

try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${baseUrl}/live?studio=1`);
  await page.locator('.xlComposerVoiceButton').waitFor();
  await page.locator('.xlComposerVoiceButton').click();
  const dialog = page.getByRole('dialog', { name: '主播声音' });
  const grid = dialog.locator('.xlVoiceGrid');
  await dialog.waitFor();
  assert.equal(await grid.locator('.xlVoiceCard').count(), 35);
  assert.equal(await dialog.getByRole('slider', { name: '主播语速' }).inputValue(), '1.1');
  assert.equal(await dialog.locator('.xlVoiceTuning em').first().textContent(), '1.1x');

  const card = grid.locator('.xlVoiceCard').first();
  const style = await card.evaluate((element) => {
    const button = element.querySelector('.xlVoiceListen');
    return { color: getComputedStyle(button).color, markColor: getComputedStyle(element).getPropertyValue('--voice-mark-color').trim(), icon: !!button.querySelector('svg') };
  });
  assert.equal(style.icon, true);
  assert.equal(style.color, 'rgb(20, 127, 115)', `Voice icon must use its mark color (${style.markColor})`);
  const footer = dialog.locator('.xlVoiceFooter');
  const footerBounds = await footer.boundingBox();
  const applyBounds = await dialog.getByRole('button', { name: '应用', exact: true }).boundingBox();
  assert.ok(footerBounds && applyBounds && footerBounds.y + footerBounds.height <= 720 && applyBounds.y + applyBounds.height <= 720, 'Mobile actions must stay on screen');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await grid.evaluate((element) => element.scrollHeight > element.clientHeight), true, 'Voice cards should scroll independently of the footer');
  if (process.env.VOICE_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/voice-picker-320.png` });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const rect = await dialog.boundingBox();
    const actions = await footer.boundingBox();
    assert.ok(rect && actions && actions.y + actions.height <= (width === 390 ? 844 : 900));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.VOICE_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/voice-picker-${width}.png` });
  }

  await dialog.getByRole('radio', { name: '男性', exact: true }).first().click();
  assert.equal(await grid.locator('.xlVoiceCard').count(), 15);
  await dialog.getByRole('radio', { name: '全部性别' }).click();
  await dialog.getByRole('textbox', { name: '搜索主播声音' }).fill(ALIYUN_PUBLIC_VOICES[1].name);
  assert.equal(await grid.locator('.xlVoiceCard').count(), 1);
  await dialog.getByRole('textbox', { name: '搜索主播声音' }).fill('');

  const target = grid.getByRole('radio', { name: `选择声音${ALIYUN_PUBLIC_VOICES[1].name}` });
  await target.getByRole('button', { name: `试听${ALIYUN_PUBLIC_VOICES[1].name}` }).click();
  await target.getByRole('button', { name: `停止试听${ALIYUN_PUBLIC_VOICES[1].name}` }).waitFor();
  assert.equal(await target.getAttribute('aria-checked'), 'true');
  await target.getByRole('button', { name: `停止试听${ALIYUN_PUBLIC_VOICES[1].name}` }).click();
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.xlComposerVoiceButton').textContent()).includes(ALIYUN_PUBLIC_VOICES[1].name));
  assert.ok((await page.locator('.xlComposerVoiceButton').textContent()).includes('1.1x'));

  await page.locator('.xlComposerVoiceButton').click();
  await dialog.getByRole('slider', { name: '主播语速' }).fill('1.2');
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await page.locator('.xlComposerVoiceButton').click();
  assert.equal(await dialog.getByRole('slider', { name: '主播语速' }).inputValue(), '1.2', 'User-selected speed should persist');
} finally {
  await browser.close();
}
