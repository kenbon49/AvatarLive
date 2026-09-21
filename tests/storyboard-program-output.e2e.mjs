import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { scriptAvatarVideoInputSignature } from '../src/lib/script-avatar-video.ts';
import { firstStudioRoom, loginStudio } from './studio-auth.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const baseUrl = process.env.LIVE_STUDIO_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await loginStudio(context, baseUrl);
const source = await firstStudioRoom(context, baseUrl);
const initial = source.config.scripts[0];
assert.ok(initial);
const voice = source.config.voice;
// Older rooms can store retired voice IDs; hydration then selects the current default.
const voiceId = voice.voiceId === 'professional' ? 'longbaizhi' : voice.voiceId;
const room = {
  ...structuredClone(source), id: 'storyboard-window-test', name: '分镜窗口测试', version: 1,
  config: { ...structuredClone(source.config), scripts: [
    { ...initial, id: 1101, title: '片段一', text: '片段一' },
    { ...initial, id: 1102, title: '片段二', text: '片段二' },
    { ...initial, id: 1103, title: '过期片段', text: '过期片段' },
  ] },
};
const sample = spawnSync('ffmpeg', [
  '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=192x340:rate=15',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '12', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
  '-b:v', '250k', '-c:a', 'libopus', '-f', 'webm', '-',
], { maxBuffer: 5 * 1024 * 1024 });
assert.equal(sample.status, 0, sample.stderr?.toString());
const videoUrl = '/storyboard-program-test.webm';
await context.addInitScript(() => localStorage.setItem('synlive.activeLiveRoom.v1', 'storyboard-window-test'));
await context.route(`**${videoUrl}`, (route) => route.fulfill({ body: sample.stdout, contentType: 'video/webm' }));
await context.route(/\/api\/v1\/live-rooms(?:\/|\?|$)/, async (route) => {
  if (route.request().method() === 'PUT') {
    const payload = route.request().postDataJSON();
    room.config = payload.config;
    room.version += 1;
    await route.fulfill({ json: room });
    return;
  }
  await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/live-rooms') ? [room] : room });
});
await context.route(/\/aliyun-avatar-video-api\/videos\/storyboard-test-\d+$/, async (route) => {
  const taskId = new URL(route.request().url()).pathname.split('/').at(-1);
  await route.fulfill({ json: { video: { id: taskId, name: taskId, status: 'SUCCESS', videoUrl, coverUrl: '', download: { status: 'ready', downloadedBytes: 1, totalBytes: 1 } } } });
});

try {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/live?studio=1`);
  await page.locator('.xlRoomPicker strong').getByText('分镜窗口测试').waitFor();
  await page.getByRole('button', { name: '开播编排' }).click();
  const dialog = page.getByRole('dialog', { name: '开播编排' });
  await dialog.getByRole('group', { name: '选择节目窗口模式' }).getByRole('button', { name: '普通窗口' }).click();
  const open = dialog.getByRole('button', { name: '打开节目输出窗口' });
  assert.equal(await open.isEnabled(), true, 'Static output must work before any storyboard is synthesized');
  const staticPopupPromise = page.waitForEvent('popup');
  await open.click();
  const staticPopup = await staticPopupPromise;
  await page.getByRole('button', { name: '结束直播' }).waitFor({ timeout: 20000 });
  await page.getByText('直播间静态画面（静音）').waitFor();
  assert.equal(await page.locator('.xlProgramStoryboardStatus button').count(), 0);
  await staticPopup.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.videoWidth === 1080 && video.videoHeight === 1920 && video.srcObject?.getAudioTracks().length === 1;
  }, null, { timeout: 20000 });
  await staticPopup.waitForFunction(() => {
    const video = document.querySelector('video');
    if (!video?.videoWidth || video.readyState < 2) return false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 16) colors.add(`${pixels[index] >> 3}:${pixels[index + 1] >> 3}:${pixels[index + 2] >> 3}`);
    return colors.size > 3;
  }, null, { timeout: 15000 });
  const staticClosed = staticPopup.waitForEvent('close', { timeout: 10000 });
  await page.getByRole('button', { name: '结束直播' }).click();
  await staticClosed;

  room.config.scripts = room.config.scripts.map((script) => ({
    ...script,
    avatarVideo: {
      taskId: `storyboard-test-${script.id}`,
      inputSignature: script.id === 1103 ? 'outdated' : scriptAvatarVideoInputSignature({
        text: script.text, avatarId: room.config.avatarId, voiceId,
        speechRate: voice.speed, pitchRate: voice.pitch,
      }),
    },
  }));
  await page.reload();
  await page.locator('.xlSynthesisOverview').getByText('2/3').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '开播编排' }).click();
  await dialog.getByRole('group', { name: '选择节目窗口模式' }).getByRole('button', { name: '普通窗口' }).click();
  await dialog.getByText('可播分镜').waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: '循环播放' }).isChecked(), true);
  assert.equal(await open.isEnabled(), true);
  const popupPromise = page.waitForEvent('popup');
  await open.click();
  const popup = await popupPromise;
  await popup.locator('video[aria-label="AvatarLive 直播节目画面"]').waitFor({ timeout: 20000 });
  try {
    await page.getByRole('button', { name: '结束直播' }).waitFor({ timeout: 20000 });
  } catch (error) {
    console.error('Window output diagnostics:', {
      platform: await dialog.locator('.xlPlatformError').allTextContents(),
      preview: await page.locator('.xlPreviewError').allTextContents(),
      popup: popup.isClosed() ? 'closed' : await popup.locator('.liveProgramError').allTextContents(),
      capture: await page.locator('.xlCaptureWindowState').allTextContents(),
    });
    throw error;
  }
  await page.getByText('正在播出：').waitFor();
  assert.match(await page.locator('.xlProgramStoryboardStatus').innerText(), /片段一/);
  await popup.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.videoWidth === 1080 && video.videoHeight === 1920 && video.srcObject?.getAudioTracks().length === 1;
  }, null, { timeout: 20000 });
  await popup.waitForFunction(() => {
    const video = document.querySelector('video');
    if (!video?.videoWidth || video.readyState < 2) return false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 16) colors.add(`${pixels[index] >> 3}:${pixels[index + 1] >> 3}:${pixels[index + 2] >> 3}`);
    return colors.size > 3;
  }, null, { timeout: 15000 });
  const audioLevel = await popup.evaluate(async () => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(document.querySelector('video').srcObject);
    const analyser = context.createAnalyser();
    source.connect(analyser);
    await context.resume();
    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }
    await context.close();
    return peak;
  });
  assert.ok(audioLevel > 0.001, `Expected audible program audio, peak=${audioLevel}`);
  await page.getByRole('button', { name: '播放下一条分镜' }).click();
  await page.locator('.xlProgramStoryboardStatus').getByText('片段二').waitFor();
  await page.getByRole('button', { name: '播放下一条分镜' }).click();
  await page.locator('.xlProgramStoryboardStatus').getByText('片段一').waitFor();
  await page.getByRole('button', { name: '暂停播放分镜' }).click();
  await page.getByRole('button', { name: '继续播放分镜' }).click();
  const closed = popup.waitForEvent('close', { timeout: 10000 });
  await page.getByRole('button', { name: '结束直播' }).click();
  await closed;
  assert.equal(await page.locator('.xlProgramStoryboardStatus').count(), 0);

  await page.getByRole('button', { name: '开播编排' }).click();
  await dialog.getByRole('group', { name: '选择节目窗口模式' }).getByRole('button', { name: '置顶画中画' }).click();
  await open.click();
  await page.waitForFunction(() => {
    const video = document.pictureInPictureElement;
    return video?.videoWidth === 1080 && video.videoHeight === 1920
      && video.srcObject?.getAudioTracks().length === 1;
  }, null, { timeout: 20000 });
  const pictureInPictureAudio = await page.evaluate(async () => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(document.pictureInPictureElement.srcObject);
    const analyser = context.createAnalyser();
    source.connect(analyser);
    await context.resume();
    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }
    await context.close();
    return peak;
  });
  assert.ok(pictureInPictureAudio > 0.001, `Expected picture-in-picture audio, peak=${pictureInPictureAudio}`);
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => !document.pictureInPictureElement);
  await page.getByRole('button', { name: '开播编排' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '结束直播' }).count(), 0);
  console.log('Program output: full-resolution direct window and always-on-top picture-in-picture; static and storyboard audio, skip/loop/pause/stop passed');
} finally {
  await browser.close();
}
