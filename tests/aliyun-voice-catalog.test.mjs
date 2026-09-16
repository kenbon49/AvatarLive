import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALIYUN_PUBLIC_VOICES } from '../src/lib/aliyun-voice-catalog.ts';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('exposes all official Alibaba Cloud public voices with unique identifiers', () => {
  assert.equal(ALIYUN_PUBLIC_VOICES.length, 35);
  assert.equal(new Set(ALIYUN_PUBLIC_VOICES.map((voice) => voice.id)).size, 35);
  assert.equal(new Set(ALIYUN_PUBLIC_VOICES.map((voice) => voice.officialId)).size, 35);
  assert.equal(ALIYUN_PUBLIC_VOICES.filter((voice) => voice.gender === '男性').length, 15);
  assert.equal(ALIYUN_PUBLIC_VOICES.filter((voice) => voice.gender === '女性').length, 20);
});

test('keeps an on-disk MP3 preview for every public voice', () => {
  for (const voice of ALIYUN_PUBLIC_VOICES) {
    assert.match(voice.previewAudio, /^\/assets\/aliyun-voices\/[a-z0-9_]+\.mp3$/);
    const path = join(projectRoot, 'public', voice.previewAudio.slice(1));
    assert.equal(existsSync(path), true, `${voice.name}试听文件不存在：${path}`);
    assert.ok(statSync(path).size > 1_000, `${voice.name}试听文件内容异常`);
  }
});
