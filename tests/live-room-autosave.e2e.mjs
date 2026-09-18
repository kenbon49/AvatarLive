import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const baseUrl = process.env.LIVE_STUDIO_URL ?? 'http://127.0.0.1:3000';
const sourceResponse = await fetch('http://127.0.0.1:8000/api/v1/live-rooms?limit=1');
assert.equal(sourceResponse.ok, true, 'A read-only room fixture must be available');
const [sourceRoom] = await sourceResponse.json();
assert.ok(sourceRoom);

const rooms = new Map(['first', 'second'].map((id) => [id, {
  ...structuredClone(sourceRoom), id: `autosave-test-${id}`, name: `自动保存测试-${id}`,
  version: 1,
}]));
const originalScriptCount = rooms.get('first').config.scripts.length;
const sampleBackground = await readFile(new URL('../public/assets/live/scenes/nature-live-background.webp', import.meta.url));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
  if (!localStorage.getItem('synlive.activeLiveRoom.v1')) {
    localStorage.setItem('synlive.activeLiveRoom.v1', 'autosave-test-first');
  }
});
let failNextUpdate = false;
const updates = [];
await context.route(/\/api\/v1\/live-rooms(?:\/|\?|$)/, async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path.endsWith('/live-rooms') && request.method() === 'GET') {
    await route.fulfill({ json: [...rooms.values()] });
    return;
  }
  const id = path.split('/live-rooms/')[1];
  const room = rooms.get(id?.replace('autosave-test-', ''));
  if (room && request.method() === 'PUT') {
    if (failNextUpdate) {
      failNextUpdate = false;
      await route.fulfill({ status: 409, json: { detail: 'version conflict' } });
      return;
    }
    const payload = request.postDataJSON();
    assert.equal(payload.expectedVersion, room.version);
    const updated = { ...room, version: room.version + 1, config: payload.config, updatedAt: new Date().toISOString() };
    rooms.set(id.replace('autosave-test-', ''), updated);
    updates.push(updated);
    await route.fulfill({ json: updated });
    return;
  }
  await route.fulfill({ status: 404, json: { detail: 'not found' } });
});

try {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/icon.svg`);
  await page.evaluate(async (background) => {
    const templates = [1, 2].map((number) => ({
      id: `custom-template-test-${number}`,
      name: `自定义模板 ${number}`,
      image: background,
      layers: [{ id: `background-test-${number}`, kind: 'image', value: '模板背景', sceneKey: 'templateBackground',
        preview: background, x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 }],
    }));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('synlive.studio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('settings', 'readwrite');
        transaction.objectStore('settings').put(JSON.stringify(templates), 'synlive.customTemplates.v1');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, sourceRoom.config.layers.find((item) => item.sceneKey === 'templateBackground')?.preview ?? '/assets/live/scenes/nature-live-background.webp');
  await page.goto(`${baseUrl}/live?studio=1`);
  await page.locator('.xlRoomPicker strong').getByText('自动保存测试-first').waitFor();
  await page.waitForTimeout(1300);
  assert.equal(updates.length, 0, 'Opening a room must not create a new version');

  await page.getByRole('button', { name: '开播编排' }).click();
  const platformDialog = page.getByRole('dialog', { name: '开播编排' });
  await platformDialog.waitFor({ timeout: 5000 });
  const modalFrame = await platformDialog.boundingBox();
  assert.ok(modalFrame && modalFrame.width > 100 && modalFrame.height > 100);
  await page.getByRole('button', { name: '关闭开播编排' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '开播编排' }).click();
  await platformDialog.waitFor({ timeout: 5000 });
  const mobileFrame = await platformDialog.boundingBox();
  assert.ok(mobileFrame && mobileFrame.width > 100 && mobileFrame.x >= 0 && mobileFrame.x + mobileFrame.width <= 390);
  await page.getByRole('button', { name: '关闭开播编排' }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator('.xlStudioNav').getByRole('button', { name: '装修' }).click();
  await page.locator('.xlTemplateGrid').getByText('自定义模板 1', { exact: true }).waitFor();
  assert.equal(await page.locator('.xlTemplateGrid').getByText('自定义模板 2', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('synlive.customTemplateTwoCleanup.v1')), '1');
  const savedTemplates = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('synlive.studio', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('settings', 'readonly');
      const entry = transaction.objectStore('settings').get('synlive.customTemplates.v1');
      entry.onsuccess = () => { resolve(JSON.parse(entry.result)); database.close(); };
      entry.onerror = () => reject(entry.error);
    };
  }));
  assert.deepEqual(savedTemplates.map((item) => item.name), ['自定义模板 1']);
  await page.locator('.xlTemplateGrid').getByRole('button', { name: '自定义模板 1' }).click();
  await page.locator('.xlTemplateActions').getByRole('button', { name: '更换背景' }).click();
  await page.locator('input[accept="image/jpeg,image/png,image/webp"]').first()
    .setInputFiles({ name: 'replacement.webp', mimeType: 'image/webp', buffer: sampleBackground });
  await page.waitForFunction(() => {
    const image = document.querySelector('.xlSceneBackground');
    return image?.getAttribute('src')?.startsWith('data:image/webp') && image.naturalWidth === 768 && image.naturalHeight === 768;
  });
  await page.locator('.xlTemplateActions').getByRole('button', { name: '更新' }).click();
  await page.waitForFunction(async () => new Promise((resolve) => {
    const request = indexedDB.open('synlive.studio', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      const entry = database.transaction('settings', 'readonly').objectStore('settings').get('synlive.customTemplates.v1');
      entry.onsuccess = () => {
        resolve(JSON.parse(entry.result)[0]?.image?.startsWith('data:image/webp') === true);
        database.close();
      };
      entry.onerror = () => resolve(false);
    };
  }), null, { timeout: 6000 });
  await page.locator('.xlStudioNav').getByRole('button', { name: '脚本' }).click();

  await page.locator('.xlRoomPicker').click();
  await assert.equal(await page.locator('.xlRoomMenu').isVisible(), true);
  await page.locator('.xlLiveBrand').click();
  await assert.equal(await page.locator('.xlRoomMenu').count(), 0);

  await page.getByRole('button', { name: '写片段' }).click();
  await page.getByRole('textbox', { name: '主播口播脚本' }).fill('第一版未入分镜的编辑稿');
  await page.waitForFunction(() => document.querySelector('.xlRoomSubline')?.textContent?.includes('已自动保存'), null, { timeout: 6000 }).catch(async (error) => {
    console.error('Autosave status:', await page.locator('.xlRoomSubline').textContent(), 'mocked updates:', updates.length,
      'notice:', await page.locator('.xlToast').allTextContents());
    throw error;
  });
  assert.equal(rooms.get('first').config.editorDraft, '第一版未入分镜的编辑稿');
  assert.equal(rooms.get('first').config.scripts.length, originalScriptCount);

  await page.reload();
  await page.locator('.xlRoomPicker strong').getByText('自动保存测试-first').waitFor();
  await assert.equal(await page.getByRole('textbox', { name: '主播口播脚本' }).inputValue(), '第一版未入分镜的编辑稿');

  failNextUpdate = true;
  await page.getByRole('textbox', { name: '主播口播脚本' }).fill('保存冲突时保留编辑稿');
  await page.locator('.xlRoomPicker').click();
  await page.getByRole('menuitem', { name: /自动保存测试-second/ }).click();
  await page.getByText('已取消切换').waitFor();
  await page.locator('.xlRoomPicker strong').getByText('自动保存测试-first').waitFor();
  await assert.equal(await page.getByRole('textbox', { name: '主播口播脚本' }).inputValue(), '保存冲突时保留编辑稿');

  await page.getByRole('textbox', { name: '主播口播脚本' }).fill('保存成功后可切换');
  if (await page.locator('.xlRoomMenu').count() === 0) await page.locator('.xlRoomPicker').click();
  await page.getByRole('menuitem', { name: /自动保存测试-second/ }).click();
  await page.locator('.xlRoomPicker strong').getByText('自动保存测试-second').waitFor({ timeout: 6000 }).catch(async (error) => {
    console.error('Switch status:', await page.locator('.xlRoomPicker strong').textContent(),
      await page.locator('.xlRoomSubline').textContent(), await page.locator('.xlToast').allTextContents(),
      'updates:', updates.map((item) => [item.version, item.config.editorDraft]));
    throw error;
  });
  assert.equal(rooms.get('first').config.editorDraft, '保存成功后可切换');
  await page.reload();
  await page.locator('.xlRoomPicker strong').getByText('自动保存测试-second').waitFor();
  await page.locator('.xlRoomPicker').click();
  await page.getByRole('menuitem', { name: /自动保存测试-first/ }).click();
  await page.waitForFunction((text) => document.querySelector('[aria-label="主播口播脚本"]')?.value === text,
    '保存成功后可切换', { timeout: 6000 });
  console.log(`Live-room UI passed: ${updates.length} mocked saves, restore, outside click, conflict, switch`);
} finally {
  await browser.close();
}
