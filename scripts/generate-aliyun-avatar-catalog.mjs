#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = resolve(process.argv[2] ?? '/tmp/aliyun-public-avatars.json');
const outputPath = resolve(process.argv[3] ?? 'src/data/aliyun-public-avatars.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));

const catalog = source.map((avatar) => {
  return {
    id: avatar.id,
    name: avatar.name,
    gender: avatar.gender,
    sourceType: avatar.type,
    businessType: avatar.bizType,
    aspectRatio: avatar.ratio ?? null,
    transparent: avatar.transparent,
    image: `/assets/aliyun-avatars/covers/${avatar.id}.webp`,
    previewVideo: avatar.displayVideoURL
      ? `/assets/aliyun-avatars/videos/${avatar.id}.mp4`
      : null,
  };
});

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.length} public avatars to ${outputPath}`);
