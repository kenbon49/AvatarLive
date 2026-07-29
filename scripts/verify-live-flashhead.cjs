#!/usr/bin/env node
/*
 * Production browser smoke test for the FlashHead mode.
 *
 * Example:
 *   NODE_PATH=/path/to/node_modules \
 *   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome \
 *   node scripts/verify-live-flashhead.cjs
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const targetUrl = process.env.SYNLIVE_TEST_URL || 'http://127.0.0.1:8018/app/live';
const baseUrl = new URL(targetUrl).origin;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const desktopShot = process.env.SYNLIVE_DESKTOP_SHOT || '/tmp/synlive-flashhead-desktop.png';
const mobileShot = process.env.SYNLIVE_MOBILE_SHOT || '/tmp/synlive-flashhead-mobile.png';

async function peerStats(page) {
  return page.evaluate(async () => {
    const rows = [];
    for (const pc of window.__synlivePeerConnections || []) {
      const report = await pc.getStats();
      report.forEach((item) => {
        if (item.type !== 'inbound-rtp' || item.isRemote) return;
        rows.push({
          kind: item.kind || item.mediaType,
          bytesReceived: item.bytesReceived || 0,
          packetsReceived: item.packetsReceived || 0,
          framesDecoded: item.framesDecoded || 0,
          framesPerSecond: item.framesPerSecond || 0,
        });
      });
    }
    return rows;
  });
}

async function videoSignature(page) {
  return page.locator('video').evaluate((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
      .filter((_, index) => index % 4 !== 3);
  });
}

function signatureDistance(left, right) {
  assert.equal(left.length, right.length);
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length;
}

async function waitForCompletedSpeech(request, previousId) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const response = await request.get('/flashhead-api/health');
    assert.equal(response.ok(), true, `FlashHead health returned ${response.status()}`);
    const body = await response.json();
    const timing = body.last_timing;
    if (timing && timing.request_id !== previousId && timing.state === 'completed') {
      return { health: body, timing };
    }
    if (timing && timing.request_id !== previousId && timing.state === 'failed') {
      throw new Error(`FlashHead speech failed: ${JSON.stringify(timing)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for FlashHead speech completion');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const browserErrors = [];
  const httpErrors = [];

  try {
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1050 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__synlivePeerConnections = [];
      const NativePeerConnection = window.RTCPeerConnection;
      function TrackedPeerConnection(...args) {
        const pc = new NativePeerConnection(...args);
        window.__synlivePeerConnections.push(pc);
        return pc;
      }
      TrackedPeerConnection.prototype = NativePeerConnection.prototype;
      Object.setPrototypeOf(TrackedPeerConnection, NativePeerConnection);
      window.RTCPeerConnection = TrackedPeerConnection;
    });
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });
    page.on('response', (item) => {
      if (item.status() >= 400) httpErrors.push(`${item.status()} ${item.url()}`);
    });

    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert(response && response.ok(), `Live page returned ${response && response.status()}`);
    await page.getByText('直播中控台', { exact: true }).waitFor({ timeout: 15000 });

    const realtimeTab = page.getByRole('tab', { name: /实时高保真/ });
    const liveActTab = page.getByRole('tab', { name: /LiveAct 高质量/ });
    const fallbackTab = page.getByRole('tab', { name: /兼容模式/ });
    await realtimeTab.waitFor();
    assert.equal(await realtimeTab.getAttribute('aria-selected'), 'true');
    await liveActTab.waitFor();
    await fallbackTab.waitFor();

    await page.getByRole('button', { name: /连接 FlashHead/ }).click();
    await page.getByText(/FlashHead 已连接 · 实时(口型 \+ 真人肢体| WebRTC 画面)/).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused);
    }, null, { timeout: 15000 });

    const firstMedia = await page.locator('video').evaluate((video) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
    }));
    assert.deepEqual([firstMedia.width, firstMedia.height], [360, 624]);
    await page.waitForTimeout(1600);
    const laterFrames = await page.locator('video').evaluate(
      (video) => video.getVideoPlaybackQuality().totalVideoFrames,
    );
    assert(laterFrames - firstMedia.frames >= 24, 'Video did not advance near 20 FPS');

    const avatarResponse = await context.request.get('/flashhead-api/avatars');
    assert.equal(avatarResponse.ok(), true, `Avatar list returned ${avatarResponse.status()}`);
    const initialAvatarState = await avatarResponse.json();
    assert(initialAvatarState.avatars.length >= 5, 'Expected at least five FlashHead avatars');
    assert(initialAvatarState.active_avatar, 'FlashHead did not report an active avatar');
    assert.equal(initialAvatarState.active_avatar, 'motion-host');
    assert.equal(initialAvatarState.body_enabled, true);

    const actionResponse = await context.request.get('/flashhead-api/actions');
    assert.equal(actionResponse.ok(), true, `Action list returned ${actionResponse.status()}`);
    const initialActionState = await actionResponse.json();
    assert.equal(initialActionState.available, true);
    assert.equal(initialActionState.enabled, true);
    assert.deepEqual(
      initialActionState.actions.map((action) => action.id),
      ['auto', 'idle', 'talk_subtle', 'welcome', 'point', 'thank'],
    );

    await page.getByRole('radio', { name: '指向' }).click();
    const beforeActionSignature = await videoSignature(page);
    await page.getByRole('button', { name: '单独预览' }).click();
    await page.waitForFunction(async () => {
      const response = await fetch('/flashhead-api/actions', { cache: 'no-store' });
      const state = await response.json();
      return state.state?.action === 'point';
    }, null, { timeout: 5000 });
    await page.waitForTimeout(900);
    const actionSignature = await videoSignature(page);
    assert(
      signatureDistance(beforeActionSignature, actionSignature) >= 2,
      'Point action did not visibly change the body frame',
    );
    await page.getByRole('radio', { name: '自动匹配' }).click();

    const initialAvatarId = initialAvatarState.active_avatar;
    const switchOrder = [
      ...initialAvatarState.avatars.filter((avatar) => avatar.id !== initialAvatarId),
      initialAvatarState.avatars.find((avatar) => avatar.id === initialAvatarId),
    ].filter(Boolean);
    const avatarSwitches = [];
    let previousSignature = await videoSignature(page);

    for (const avatar of switchOrder) {
      const option = page.locator('.fhAvatarOption').filter({ hasText: avatar.label });
      await option.waitFor({ timeout: 10000 });
      await option.click();
      await page.getByText(`当前 · ${avatar.label}`, { exact: true }).waitFor({ timeout: 15000 });

      const switchedResponse = await context.request.get('/flashhead-api/avatars');
      assert.equal(switchedResponse.ok(), true);
      const switchedState = await switchedResponse.json();
      assert.equal(switchedState.active_avatar, avatar.id);
      assert.equal(switchedState.switching, false);
      assert.equal(
        await page.evaluate(() => window.__synlivePeerConnections.length),
        1,
        'Avatar switching rebuilt the WebRTC peer connection',
      );

      await page.waitForTimeout(600);
      const signature = await videoSignature(page);
      const visualDistance = signatureDistance(previousSignature, signature);
      assert(visualDistance >= 3, `Avatar ${avatar.id} did not visibly replace the prior person`);

      const beforeSpeechResponse = await context.request.get('/flashhead-api/health');
      const beforeSpeech = await beforeSpeechResponse.json();
      const priorSpeechId = beforeSpeech.last_timing?.request_id ?? null;
      const broadcastPanel = page.locator('.livePanel').filter({ hasText: 'FlashHead Lite · 实时直播' });
      await broadcastPanel.locator('textarea').first().fill(`你好，我是${avatar.label}。`);
      await page.getByRole('button', { name: '实时播报' }).click();
      const speech = await waitForCompletedSpeech(context.request, priorSpeechId);
      assert.equal(speech.health.active_avatar, avatar.id);
      assert(speech.timing.frames > 0, `Avatar ${avatar.id} generated no speaking frames`);
      assert(speech.timing.av_start_skew_ms <= 100, `Avatar ${avatar.id} A/V skew exceeded 100ms`);

      avatarSwitches.push({
        id: avatar.id,
        label: avatar.label,
        visualDistance: Math.round(visualDistance * 10) / 10,
        frames: speech.timing.frames,
        firstVideoMs: speech.timing.first_video_ms,
        firstAudioMs: speech.timing.first_audio_ms,
        avStartSkewMs: speech.timing.av_start_skew_ms,
      });
      previousSignature = signature;
    }

    const initialHealthResponse = await context.request.get('/flashhead-api/health');
    const initialHealth = await initialHealthResponse.json();
    const previousId = initialHealth.last_timing?.request_id ?? null;
    const broadcastPanel = page.locator('.livePanel').filter({ hasText: 'FlashHead Lite · 实时直播' });
    await broadcastPanel.locator('textarea').first().fill('你好，这是实时高保真数字人的浏览器验证。');
    await page.getByRole('button', { name: '实时播报' }).click();
    await page.getByText(/已发送给 FlashHead/).waitFor({ timeout: 10000 });

    const completed = await waitForCompletedSpeech(context.request, previousId);
    assert.equal(completed.health.fps, 20);
    assert(completed.timing.av_start_skew_ms <= 100, 'Audio/video start skew exceeded 100ms');
    const stats = await peerStats(page);
    const videoStats = stats.find((item) => item.kind === 'video');
    const audioStats = stats.find((item) => item.kind === 'audio');
    assert(videoStats && videoStats.framesDecoded > 0, 'No decoded inbound video frames');
    assert(audioStats && audioStats.packetsReceived > 0, 'No inbound audio packets');

    const qaHealthResponse = await context.request.get('/flashhead-api/health');
    const qaHealth = await qaHealthResponse.json();
    const qaPreviousId = qaHealth.last_timing?.request_id ?? null;
    const qaPanel = page.locator('.livePanel').filter({ hasText: '弹幕问答 · FlashHead 实时回复' });
    await qaPanel.locator('textarea').fill('请用不超过十个字回答：你是谁？');
    await page.getByRole('button', { name: '提问（GPT 回答）' }).click();
    await page.getByText(/AI 回答已发送给 FlashHead/).waitFor({ timeout: 60000 });
    const qaAnswer = await qaPanel.locator('.qaAnswer').innerText();
    assert(qaAnswer.trim().length > 0, 'LLM returned an empty answer');
    const qaCompleted = await waitForCompletedSpeech(context.request, qaPreviousId);
    assert(qaCompleted.timing.av_start_skew_ms <= 100, 'Q&A audio/video skew exceeded 100ms');
    await page.screenshot({ path: desktopShot, fullPage: true });

    await liveActTab.click();
    assert.equal(await liveActTab.getAttribute('aria-selected'), 'true');
    await page.getByText('LiveAct · 高质量生成').waitFor();
    await fallbackTab.click();
    assert.equal(await fallbackTab.getAttribute('aria-selected'), 'true');
    await realtimeTab.click();
    assert.equal(await realtimeTab.getAttribute('aria-selected'), 'true');

    assert.deepEqual(browserErrors, [], `Browser console errors: ${browserErrors.join('\n')}`);
    assert.deepEqual(httpErrors, [], `Browser HTTP errors: ${httpErrors.join('\n')}`);
    await context.close();

    const mobileContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    const mobileResponse = await mobilePage.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    assert(mobileResponse && mobileResponse.ok());
    await mobilePage.getByRole('tab', { name: /实时高保真/ }).waitFor();
    assert.equal(
      await mobilePage.getByRole('tab', { name: /实时高保真/ }).getAttribute('aria-selected'),
      'true',
    );
    await mobilePage.screenshot({ path: mobileShot, fullPage: true });
    await mobileContext.close();

    console.log(JSON.stringify({
      ok: true,
      targetUrl,
      firstMedia,
      framesIn1600ms: laterFrames - firstMedia.frames,
      avatarSwitches,
      peerStats: stats,
      speechTiming: completed.timing,
      qaAnswer,
      qaSpeechTiming: qaCompleted.timing,
      browserErrors,
      httpErrors,
      screenshots: [desktopShot, mobileShot],
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
