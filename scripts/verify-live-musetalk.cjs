#!/usr/bin/env node
/* End-to-end browser smoke test for the MuseTalk action-avatar mode. */

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const targetUrl = process.env.SYNLIVE_TEST_URL || 'http://127.0.0.1:8018/app/live';
const baseUrl = new URL(targetUrl).origin;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const desktopShot = process.env.SYNLIVE_DESKTOP_SHOT || '/tmp/synlive-musetalk-desktop.png';
const mobileShot = process.env.SYNLIVE_MOBILE_SHOT || '/tmp/synlive-musetalk-mobile.png';

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

async function markConnectedPeer(page) {
  return page.evaluate(() => {
    const peers = window.__synlivePeerConnections || [];
    const live = peers.filter((pc) => pc.connectionState !== 'closed');
    if (peers.length !== 1 || live.length !== 1) {
      throw new Error(`expected one connected peer, got ${peers.length} created / ${live.length} live`);
    }
    window.__synliveMuseTalkPeerConnection = live[0];
    return {
      created: peers.length,
      live: live.length,
      connectionState: live[0].connectionState,
    };
  });
}

async function assertConnectedPeerUnchanged(page, step) {
  const state = await page.evaluate(() => {
    const peers = window.__synlivePeerConnections || [];
    const live = peers.filter((pc) => pc.connectionState !== 'closed');
    return {
      created: peers.length,
      live: live.length,
      same: live.length === 1 && live[0] === window.__synliveMuseTalkPeerConnection,
      connectionState: live[0]?.connectionState || null,
    };
  });
  assert.equal(state.created, 1, `${step} created another PeerConnection: ${JSON.stringify(state)}`);
  assert.equal(state.live, 1, `${step} did not retain one live PeerConnection: ${JSON.stringify(state)}`);
  assert.equal(state.same, true, `${step} replaced the original PeerConnection`);
  return state;
}

async function videoSignature(page) {
  return page.locator('video').evaluate((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 12;
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

async function readHealth(request) {
  const response = await request.get('/musetalk-api/health');
  assert.equal(response.ok(), true, `MuseTalk health returned ${response.status()}`);
  return response.json();
}

async function readAvatars(request) {
  const response = await request.get('/musetalk-api/avatars');
  assert.equal(response.ok(), true, `MuseTalk avatars returned ${response.status()}`);
  return response.json();
}

async function waitForAvatar(request, expectedId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readAvatars(request);
    if (state.active_avatar === expectedId && state.switching === false) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for MuseTalk avatar ${expectedId}`);
}

async function selectAvatar(page, request, avatar) {
  const current = await readAvatars(request);
  if (current.active_avatar !== avatar.id) {
    const option = page.locator('.fhAvatarOption').filter({ hasText: avatar.label }).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
  }
  await page.getByText(`当前 · ${avatar.label}`, { exact: true }).waitFor({ timeout: 15000 });
  return waitForAvatar(request, avatar.id);
}

async function waitForSpeech(request, previousId, expectedStates, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readHealth(request);
    const timing = health.last_timing;
    if (timing && timing.request_id !== previousId && expectedStates.includes(timing.state)) {
      return { health, timing };
    }
    if (timing && timing.request_id !== previousId && timing.state === 'failed') {
      throw new Error(`MuseTalk speech failed: ${JSON.stringify(timing)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for speech state ${expectedStates.join(', ')}`);
}

async function waitForIdle(request, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readHealth(request);
    if (
      health.active_id === null &&
      health.queued === 0 &&
      health.actions &&
      health.actions.state &&
      health.actions.state.action === 'idle'
    ) return health;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('MuseTalk did not return to idle after interrupt');
}

async function verifyPlainTextAvatarError(browser) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.route('**/musetalk-api/avatars', (route) => route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'Internal Server Error',
    }));
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('tab', { name: /动作主播 · MuseTalk 1.5/ }).click();
    const error = page.getByText(/无法读取 MuseTalk 人物列表：/).first();
    await error.waitFor({ timeout: 10000 });
    const message = await error.textContent();
    assert.match(message || '', /HTTP 500/);
    assert.doesNotMatch(message || '', /Unexpected token/);
    return message;
  } finally {
    await context.close();
  }
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
    const plainTextErrorMessage = await verifyPlainTextAvatarError(browser);
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
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
    page.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
    });

    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert(response && response.ok(), `Live page returned ${response && response.status()}`);
    await page.getByText('直播中控台', { exact: true }).waitFor({ timeout: 15000 });

    const museTalkTab = page.getByRole('tab', { name: /动作主播 · MuseTalk 1.5/ });
    await museTalkTab.click();
    await page.getByText('真人动作与口型编排', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText(/同源运动已启用/).waitFor({ timeout: 10000 });

    const initialHealth = await readHealth(context.request);
    assert.equal(initialHealth.ready, true);
    assert.equal(initialHealth.renderer, 'musetalk');
    assert.equal(initialHealth.model_version, '1.5');
    assert.equal(initialHealth.fps, 25);
    assert.deepEqual(initialHealth.resolution, { width: 360, height: 624 });

    const initialAvatarState = await readAvatars(context.request);
    assert.equal(initialAvatarState.multi_avatar_enabled, true);
    assert.equal(initialAvatarState.switching, false);
    assert.deepEqual(
      initialAvatarState.avatars.map((avatar) => avatar.id).sort(),
      ['blue-host', 'motion-host'],
    );
    const motionAvatar = initialAvatarState.avatars.find((avatar) => avatar.id === 'motion-host');
    const blueAvatar = initialAvatarState.avatars.find((avatar) => avatar.id === 'blue-host');
    assert(motionAvatar, 'motion-host is missing from the MuseTalk avatar catalog');
    assert(blueAvatar, 'blue-host is missing from the MuseTalk avatar catalog');
    assert.equal(motionAvatar.label, '暖色女主播');
    assert.equal(blueAvatar.label, '蓝衣男主播');
    const avatarOptions = page.getByRole('group', { name: '选择 MuseTalk 直播人物' })
      .locator('.fhAvatarOption');
    await assert.doesNotReject(() => avatarOptions.first().waitFor({ timeout: 10000 }));
    assert.equal(await avatarOptions.count(), 2, 'UI did not render both MuseTalk avatars');

    await page.getByRole('button', { name: '连接 MuseTalk' }).click();
    await page.getByText('MuseTalk 已连接 · 真人动作 + 嘴部重建', { exact: true })
      .waitFor({ timeout: 20000 });
    await page.locator('video').evaluate(async (video) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (video.readyState >= 2 && video.videoWidth === 360 && video.videoHeight === 624) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`video did not become ready: ${video.readyState} ${video.videoWidth}x${video.videoHeight}`);
    });

    const connectedPeer = await markConnectedPeer(page);
    const motionState = await selectAvatar(page, context.request, motionAvatar);
    assert.equal(motionState.active_avatar, 'motion-host');
    assert.equal(motionState.avatar_error, null);
    await assertConnectedPeerUnchanged(page, 'switching to motion-host');
    await page.waitForTimeout(600);

    const idleSignature = await videoSignature(page);
    await page.waitForTimeout(700);
    const movingSignature = await videoSignature(page);
    assert(signatureDistance(idleSignature, movingSignature) > 0.2, 'idle action video appears frozen');

    const welcome = page.getByRole('radio', { name: /Welcome|欢迎/ });
    await welcome.click();
    const beforePreview = await videoSignature(page);
    await page.getByRole('button', { name: '单独预览' }).click();
    await page.waitForTimeout(1200);
    const duringPreview = await videoSignature(page);
    assert(signatureDistance(beforePreview, duringPreview) > 0.5, 'preview action did not change the frame');

    await waitForIdle(context.request, 10000);
    const motionSignature = await videoSignature(page);
    const blueState = await selectAvatar(page, context.request, blueAvatar);
    assert.equal(blueState.active_avatar, 'blue-host');
    assert.equal(blueState.avatar_error, null);
    const peerAfterBlueSwitch = await assertConnectedPeerUnchanged(page, 'switching to blue-host');
    await page.waitForTimeout(700);
    const blueSignature = await videoSignature(page);
    const avatarVisualDistance = signatureDistance(motionSignature, blueSignature);
    assert(
      avatarVisualDistance >= 3,
      `blue-host did not visibly replace motion-host (signature distance ${avatarVisualDistance.toFixed(2)})`,
    );

    const beforeSpeechHealth = await readHealth(context.request);
    const previousId = beforeSpeechHealth.last_timing && beforeSpeechHealth.last_timing.request_id;
    const broadcast = page.locator('.liveField textarea').first();
    await broadcast.fill('你好，我是蓝衣男主播，欢迎来到今天的直播间。');
    await page.getByRole('button', { name: '实时播报' }).click();
    await page.getByText(/已发送给 MuseTalk/).waitFor({ timeout: 10000 });
    const completed = await waitForSpeech(context.request, previousId, ['completed']);
    assert.equal(completed.health.avatar.active_avatar, 'blue-host');
    assert.equal(completed.timing.avatar, 'blue-host');
    assert(completed.timing.frames >= 12, `too few generated frames: ${completed.timing.frames}`);
    assert(
      completed.timing.av_start_skew_ms <= 100,
      `A/V start skew too high: ${completed.timing.av_start_skew_ms}ms`,
    );

    await page.waitForTimeout(500);
    const stats = await peerStats(page);
    const videoStats = stats.find((item) => item.kind === 'video');
    const audioStats = stats.find((item) => item.kind === 'audio');
    assert(videoStats && videoStats.framesDecoded >= 12, `bad video stats: ${JSON.stringify(stats)}`);
    assert(audioStats && audioStats.packetsReceived > 0, `bad audio stats: ${JSON.stringify(stats)}`);

    const interruptPreviousId = completed.timing.request_id;
    await broadcast.fill(
      '这是一段用于验证立即打断的较长播报文本，系统应该清空旧音频、旧视频和动作状态，然后立即回到待机。',
    );
    await page.getByRole('button', { name: '实时播报' }).click();
    await waitForSpeech(context.request, interruptPreviousId, ['tts', 'first_video_batch', 'generating', 'playing']);
    await page.getByRole('button', { name: '停止播报' }).click();
    const idleHealth = await waitForIdle(context.request);
    assert.equal(idleHealth.actions.state.speaking, false);
    assert.equal(idleHealth.actions.state.action, 'idle');
    assert.equal(idleHealth.actions.profile_avatar, 'blue-host');
    assert.equal(idleHealth.avatar.active_avatar, 'blue-host');
    assert.notEqual(idleHealth.last_timing.request_id, interruptPreviousId);
    assert.equal(idleHealth.last_timing.state, 'interrupted');
    await assertConnectedPeerUnchanged(page, 'stopping blue-host speech');

    await page.screenshot({ path: desktopShot, fullPage: true });
    const restoredState = await selectAvatar(page, context.request, motionAvatar);
    assert.equal(restoredState.active_avatar, 'motion-host');
    await assertConnectedPeerUnchanged(page, 'restoring motion-host');

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', (error) => browserErrors.push(`mobile pageerror: ${error.message}`));
    mobilePage.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`mobile console: ${message.text()}`);
    });
    mobilePage.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
    });
    await mobilePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mobilePage.getByText('直播中控台', { exact: true }).waitFor({ timeout: 15000 });
    await mobilePage.getByRole('tab', { name: /动作主播 · MuseTalk 1.5/ }).click();
    await mobilePage.getByText('真人动作与口型编排', { exact: true }).waitFor({ timeout: 10000 });
    await mobilePage.locator('.fhAvatarOption').filter({ hasText: motionAvatar.label })
      .waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('.fhAvatarOption').filter({ hasText: blueAvatar.label })
      .waitFor({ state: 'visible', timeout: 10000 });
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `mobile layout overflows horizontally by ${overflow}px`);
    await mobilePage.screenshot({ path: mobileShot, fullPage: true });
    await mobile.close();

    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    assert.deepEqual(httpErrors, [], `HTTP errors: ${httpErrors.join('\n')}`);
    console.log(JSON.stringify({
      result: 'PASS',
      targetUrl,
      plainTextErrorMessage,
      avatars: initialAvatarState.avatars,
      avatarSwitch: {
        from: motionAvatar.id,
        to: blueAvatar.id,
        visualDistance: Math.round(avatarVisualDistance * 100) / 100,
        connectedPeer,
        peerAfterSwitch: peerAfterBlueSwitch,
      },
      timing: completed.timing,
      stats,
      screenshots: [desktopShot, mobileShot],
    }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
