import {
  finalizeAvatarVideoJob,
  publicAvatarVideoJob,
  readAvatarVideoJob,
  writeAvatarVideoJob,
} from '@/lib/avatar-video-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  try {
    let job = await readAvatarVideoJob(jobId);
    if (job.status === 'submitted' || job.status === 'processing') {
      job = await finalizeAvatarVideoJob(job);
    } else if (job.status === 'finalizing') {
      const started = Date.parse(job.finalizingAt || '');
      if (!Number.isFinite(started) || Date.now() - started > 10 * 60_000) {
        job.status = 'processing';
        job.progress = '正在恢复中断的素材预处理';
        await writeAvatarVideoJob(job);
        job = await finalizeAvatarVideoJob(job);
      }
    }
    return Response.json(publicAvatarVideoJob(job), { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '动态素材任务查询失败';
    try {
      const job = await readAvatarVideoJob(jobId);
      job.status = 'failed';
      job.progress = '动态素材生成或预处理失败';
      job.error = message;
      await writeAvatarVideoJob(job);
      return Response.json(publicAvatarVideoJob(job), { status: 502, headers: { 'cache-control': 'no-store' } });
    } catch {
      return Response.json({ message }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
  }
}
