import {
  assertAvatarVideoOwner,
  publicAvatarVideoJob,
  publishAvatarVideoJob,
  readAvatarVideoJob,
} from '@/lib/avatar-video-server';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const user = requireRequestUser(request);
  try {
    const saved = await readAvatarVideoJob(jobId);
    assertAvatarVideoOwner(saved, user);
    const job = await publishAvatarVideoJob(saved);
    return Response.json(publicAvatarVideoJob(job), { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '动态素材应用失败';
    return Response.json({ message }, { status: 409, headers: { 'cache-control': 'no-store' } });
  }
}
