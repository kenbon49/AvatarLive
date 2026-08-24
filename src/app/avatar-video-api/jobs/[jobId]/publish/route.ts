import {
  publicAvatarVideoJob,
  publishAvatarVideoJob,
  readAvatarVideoJob,
} from '@/lib/avatar-video-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  try {
    const job = await publishAvatarVideoJob(await readAvatarVideoJob(jobId));
    return Response.json(publicAvatarVideoJob(job), { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '动态素材应用失败';
    return Response.json({ message }, { status: 409, headers: { 'cache-control': 'no-store' } });
  }
}
