import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const baseUrl = process.env.LIVE_STUDIO_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route(/\/api\/v1\/live-rooms(?:\/|\?|$)/, route => route.fulfill({ json: [] }));

try {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/live?studio=1`);
  await page.locator('.xlStudioNav').getByRole('button', { name: '装修' }).click();
  await page.locator('.xlMaterialTabs').getByRole('button', { name: '文字' }).click();

  const materialText = page.locator('.xlTextMaterial textarea');
  await materialText.fill('第一条');
  await page.getByRole('button', { name: '添加到直播画面' }).click();
  const firstRow = page.locator('.xlLayerRow').filter({ has: page.getByRole('textbox', { name: '修改第一条图层文本' }) });
  const firstId = await firstRow.getAttribute('data-layer-id');
  assert.ok(firstId);

  await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).dblclick({ force: true });
  const inlineEditor = page.getByRole('textbox', { name: '编辑画面文本：第一条' });
  await inlineEditor.waitFor();
  await inlineEditor.fill('双击已修改');
  await inlineEditor.press('Enter');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"] input`).inputValue(), '双击已修改');

  await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).dblclick({ force: true });
  await page.getByRole('textbox', { name: '编辑画面文本：双击已修改' }).fill('取消这次修改');
  await page.getByRole('textbox', { name: '编辑画面文本：双击已修改' }).press('Escape');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"] input`).inputValue(), '双击已修改');

  await page.locator(`.xlLayerRow[data-layer-id="${firstId}"] input`).focus();
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 1, 'Delete/Backspace must not delete while editing text');
  await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).click({ force: true });
  await page.keyboard.press('Delete');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 0, 'Delete after selecting on the canvas must remove that layer');
  await page.getByRole('button', { name: '撤回上一步画面编辑' }).click();
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 1);
  if (await page.getByRole('button', { name: '完成编辑' }).count()) await page.getByRole('button', { name: '完成编辑' }).click();
  await materialText.fill('第二条');
  await page.getByRole('button', { name: '添加到直播画面' }).click();
  const secondRow = page.locator('.xlLayerRow').filter({ has: page.getByRole('textbox', { name: '修改第二条图层文本' }) });
  const secondId = await secondRow.getAttribute('data-layer-id');
  assert.ok(secondId);

  await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.xlLayerMultiOutline').count(), 2);
  assert.equal(await page.locator('.xlCanvasSelectionCount').textContent(), '已选 2');
  assert.equal(await page.locator('.xlLayerRow.selected').count(), 2);
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const header = await page.locator('.xlPreviewHeader').boundingBox();
    const actions = await page.locator('.xlPreviewHeaderActions').boundingBox();
    assert.ok(header && actions && actions.x + actions.width <= header.x + header.width + 1, `Preview toolbar overflows at ${width}px`);
    if (process.env.CANVAS_SCREENSHOT_DIR) await page.locator('.xlPreviewPanel').screenshot({ path: `${process.env.CANVAS_SCREENSHOT_DIR}/canvas-select-${width}.png` });
  }

  await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).focus();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 0);
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${secondId}"]`).count(), 0);
  await page.getByRole('button', { name: '撤回上一步画面编辑' }).click();
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 1);
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${secondId}"]`).count(), 1);

  await page.getByRole('button', { name: '多选图层' }).click();
  await page.locator(`.xlLayerRow[data-layer-id="${secondId}"]`).click();
  await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).click();
  assert.equal(await page.locator('.xlLayerMultiOutline').count(), 2, 'Multi-select mode should work without a keyboard');
  await page.getByRole('button', { name: '多选图层' }).click();
  const before = await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).evaluate(element => Number.parseFloat(element.style.top));
  const secondBefore = await page.locator(`.xlLayerHitTarget[data-layer-hit="${secondId}"]`).evaluate(element => Number.parseFloat(element.style.top));
  const hit = await page.locator(`.xlLayerHitTarget[data-layer-hit="${secondId}"]`).boundingBox();
  assert.ok(hit);
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(hit.x + hit.width / 2, hit.y - 25, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).evaluate(element => Number.parseFloat(element.style.top));
  const secondAfter = await page.locator(`.xlLayerHitTarget[data-layer-hit="${secondId}"]`).evaluate(element => Number.parseFloat(element.style.top));
  assert.notEqual(after, before, 'Dragging one selected element must move the group');
  assert.ok(Math.abs((after - before) - (secondAfter - secondBefore)) < 0.02);
  await page.getByRole('button', { name: '撤回上一步画面编辑' }).click();
  assert.equal(await page.locator(`.xlLayerHitTarget[data-layer-hit="${firstId}"]`).evaluate(element => Number.parseFloat(element.style.top)), before);
  await page.locator('.xlPortraitCanvas').focus();
  await page.keyboard.press('ControlOrMeta+a');
  assert.equal(await page.locator('.xlLayerMultiOutline').count(), 3, 'Select-all must include visible elements but not the backdrop');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.xlLayerMultiOutline').count(), 0);
  await page.getByRole('button', { name: '多选图层' }).click();
  await page.locator(`.xlLayerRow[data-layer-id="${secondId}"]`).click();
  await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).click();
  await page.getByRole('button', { name: '批量删除选中图层' }).click();
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${firstId}"]`).count(), 0);
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${secondId}"]`).count(), 0);

  await page.locator('.xlMaterialTabs').getByRole('button', { name: '组件' }).click();
  await page.locator('.xlComponentCard').first().click();
  const componentText = page.locator('.xlLayerRow input').first();
  await componentText.waitFor();
  const componentTextId = await componentText.evaluate(input => input.closest('.xlLayerRow')?.getAttribute('data-layer-id'));
  assert.ok(componentTextId);
  await page.locator(`.xlLayerHitTarget[data-layer-hit="${componentTextId}"]`).dblclick({ force: true });
  await page.locator('.xlCanvasInlineText').waitFor();
  await page.locator('.xlCanvasInlineText').fill('更新标题');
  await page.locator('.xlCanvasInlineText').press('Enter');
  assert.equal(await page.locator(`.xlLayerRow[data-layer-id="${componentTextId}"] input`).inputValue(), '更新标题');
  const componentRows = page.locator('.xlLayerRow[data-layer-id^="component-"]');
  const componentCount = await componentRows.count();
  assert.ok(componentCount > 1);
  await page.getByRole('button', { name: '多选图层' }).click();
  await componentRows.filter({ has: page.locator('em') }).first().click();
  assert.equal(await page.locator('.xlLayerRow.component-selected').count(), componentCount);
  await page.locator('.xlPortraitCanvas').focus();
  await page.keyboard.press('Delete');
  assert.equal(await componentRows.count(), 0, 'Deleting a selected component must remove all of its layers');
  await page.getByRole('button', { name: '撤回上一步画面编辑' }).click();
  assert.equal(await componentRows.count(), componentCount);
} finally {
  await browser.close();
}
