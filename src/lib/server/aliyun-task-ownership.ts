import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from '@/lib/avatar-video-server';
import { aliyunAvatarVideoConfiguration } from '@/lib/server/aliyun-avatar-video';

function ownerFile(taskId: string) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(taskId)) throw new Error('任务不存在');
  return path.join(process.cwd(), 'runtime', 'aliyun-avatar-videos', 'owners', `${taskId}.json`);
}

export async function recordAliyunVideoOwner(taskId: string, ownerId: string) {
  await writeJsonAtomic(ownerFile(taskId), { ownerId });
}

export async function assertAliyunVideoOwner(taskId: string, user: { id: string; role: string }) {
  if (taskId === aliyunAvatarVideoConfiguration().featuredVideoId) return;
  try {
    const owner = JSON.parse(await readFile(/*turbopackIgnore: true*/ ownerFile(taskId), 'utf8')) as { ownerId?: string };
    if (owner.ownerId === user.id) return;
  } catch {
    // Existing unowned cached media remains accessible only to the administrator.
  }
  if (user.role === 'admin') {
    try {
      await readFile(/*turbopackIgnore: true*/ ownerFile(taskId));
    } catch { return; }
  }
  throw new Error('任务不存在');
}
