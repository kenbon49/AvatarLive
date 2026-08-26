import 'server-only';

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AvatarMotionSettings } from '@/lib/avatar-motion';

const execFileAsync = promisify(execFile);

export const MAX_AVATAR_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_AVATAR_VIDEO_BYTES = 150 * 1024 * 1024;
export const AVATAR_ID_PATTERN = /^custom-[a-z0-9][a-z0-9-]{0,63}$/;
export const JOB_ID_PATTERN = /^[a-f0-9-]{36}$/;
export const HAPPYHORSE_VIDEO_MODEL = 'happyhorse-1.0-video-edit';
export const SEEDANCE_FALLBACK_VIDEO_MODEL = 'doubao-seedance-2-5-260628';

export type AvatarVideoJobStatus =
  | 'submitted'
  | 'processing'
  | 'finalizing'
  | 'review'
  | 'ready'
  | 'failed';

export type AvatarVideoJob = {
  id: string;
  avatarId: string;
  avatarName: string;
  baseProfile: string;
  profileId: string;
  status: AvatarVideoJobStatus;
  progress: string;
  model: string;
  seoTaskId: string;
  version: string;
  imageFile: string;
  imageMime: string;
  motion: AvatarMotionSettings;
  createdAt: string;
  updatedAt: string;
  finalizingAt?: string;
  error?: string;
  idleVideo?: string;
  talkVideo?: string;
  imageUrl?: string;
  quality?: {
    duration: number;
    width: number;
    height: number;
    frames: number;
    fps: number;
  };
};

type ProbeResult = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;
  format?: { duration?: string; size?: string };
};

const BASE_VIDEO_BY_PROFILE: Readonly<Record<string, string>> = {
  chinese: 'chinese2.mp4',
  business_male_1: '商务男确定.mp4',
  chen_yu: '陈屿.mp4',
};

export function avatarAssetRoot() {
  return path.join(process.cwd(), 'runtime', 'avatar-assets');
}

export function avatarBaseVideo(profile: string) {
  const filename = BASE_VIDEO_BY_PROFILE[profile];
  if (!filename) throw new Error('当前基础形象没有可用的动作模板');
  return path.join(process.cwd(), 'runtime', 'avatar-base-videos', filename);
}

export function avatarVersionDirectory(avatarId: string, version: string) {
  if (!AVATAR_ID_PATTERN.test(avatarId) || !JOB_ID_PATTERN.test(version)) {
    throw new Error('形象素材路径无效');
  }
  return path.join(avatarAssetRoot(), 'avatars', avatarId, version);
}

export function avatarAssetUrl(avatarId: string, version: string, filename: string) {
  return `/avatar-video-api/assets/${encodeURIComponent(avatarId)}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`;
}

function jobPath(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error('动态素材任务编号无效');
  return path.join(avatarAssetRoot(), 'jobs', `${jobId}.json`);
}

export async function writeJsonAtomic(filename: string, value: unknown) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filename);
}

export async function readAvatarVideoJob(jobId: string): Promise<AvatarVideoJob> {
  const payload = JSON.parse(await readFile(/*turbopackIgnore: true*/ jobPath(jobId), 'utf8')) as AvatarVideoJob;
  if (!payload || payload.id !== jobId || !AVATAR_ID_PATTERN.test(payload.avatarId)) {
    throw new Error('动态素材任务数据无效');
  }
  return payload;
}

export async function writeAvatarVideoJob(job: AvatarVideoJob) {
  job.updatedAt = new Date().toISOString();
  await writeJsonAtomic(jobPath(job.id), job);
}

export function publicAvatarVideoJob(job: AvatarVideoJob) {
  return {
    jobId: job.id,
    avatarId: job.avatarId,
    profile: job.profileId,
    status: job.status,
    progress: job.progress,
    model: job.model,
    error: job.error || '',
    image: job.imageUrl || '',
    idleVideo: job.idleVideo || '',
    talkVideo: job.talkVideo || '',
    quality: job.quality || null,
    motion: job.motion || null,
  };
}

export function imageMimeType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

async function probeVideo(filename: string, minimumDuration = 3) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
    '-of', 'json',
    filename,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout) as ProbeResult;
  const stream = result.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(result.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!stream || !Number.isFinite(duration) || duration < minimumDuration || duration > 60) {
    throw new Error(`视频时长必须在 ${minimumDuration} 到 60 秒之间`);
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 300 || height < 300) {
    throw new Error('模型返回的视频分辨率不足');
  }
  return { duration, width, height };
}

async function normalizeTalkVideo(input: string, output: string) {
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', "scale='trunc(iw*min(1,720/ih)/2)*2':'trunc(ih*min(1,720/ih)/2)*2',fps=25",
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
}

async function createIdleLoop(input: string, output: string, duration: number) {
  const halfLoop = Math.min(1, Math.max(0.5, duration / 4));
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-filter_complex',
    `[0:v]trim=start=0:end=${halfLoop.toFixed(3)},setpts=PTS-STARTPTS,split[forward][copy];[copy]reverse[backward];[forward][backward]concat=n=2:v=1:a=0,format=yuv420p[idle]`,
    '-map', '[idle]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-movflags', '+faststart', output,
  ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
}

function resolveSeoVideoArtifact(videoUrl: string, upstream: string) {
  if (/^https?:\/\//i.test(videoUrl)) {
    const resolved = new URL(videoUrl);
    return { url: resolved.toString(), sendApiKey: resolved.origin === new URL(upstream).origin };
  }
  if (!/^\/(?:data|media)\/generated\/[A-Za-z0-9_./-]+$/.test(videoUrl)) {
    throw new Error('视频模型返回了不受信任的素材地址');
  }
  return { url: new URL(videoUrl, `${upstream}/`).toString(), sendApiKey: true };
}

async function prepareMuseTalkProfile(profileId: string) {
  const museTalkUpstream = (process.env.MUSETALK_ADMIN_UPSTREAM || process.env.MUSETALK_UPSTREAM || '').replace(/\/$/, '');
  const registryKey = process.env.AVATAR_REGISTRY_KEY || '';
  if (!museTalkUpstream || !registryKey) throw new Error('MuseTalk 动态注册服务尚未配置');
  const response = await fetch(`${museTalkUpstream}/v1/avatars/prepare`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Avatar-Registry-Key': registryKey,
    },
    body: JSON.stringify({ profile_id: profileId }),
    cache: 'no-store',
    signal: AbortSignal.timeout(300_000),
  });
  const payload = await response.json() as { detail?: unknown; frames?: unknown; fps?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.detail === 'string' ? payload.detail : `MuseTalk 预处理 HTTP ${response.status}`);
  }
  return { frames: Number(payload.frames), fps: Number(payload.fps) };
}

export async function finalizeAvatarVideoJob(job: AvatarVideoJob) {
  const seoUpstream = (process.env.SEO_VIDEO_API_BASE_URL || process.env.SEO_IMAGE_API_BASE_URL || '').replace(/\/$/, '');
  const seoApiKey = process.env.SEO_VIDEO_API_KEY || process.env.SEO_IMAGE_API_KEY || '';
  if (!seoUpstream || !seoApiKey) {
    throw new Error('动态形象服务尚未完整配置');
  }

  const statusResponse = await fetch(`${seoUpstream}/api/ai/video-status/${encodeURIComponent(job.seoTaskId)}`, {
    headers: { 'X-API-Key': seoApiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const status = await statusResponse.json() as {
    done?: unknown;
    status?: unknown;
    progress?: unknown;
    error?: unknown;
    video_url?: unknown;
  };
  if (!statusResponse.ok) throw new Error(typeof status.error === 'string' ? status.error : `视频任务查询 HTTP ${statusResponse.status}`);
  if (status.status === 'failed') throw new Error(typeof status.error === 'string' ? status.error : '视频模型生成失败');
  if (status.status !== 'completed' || status.done !== true) {
    job.status = status.status === 'processing' ? 'processing' : 'submitted';
    job.progress = typeof status.progress === 'string' && status.progress ? status.progress : '视频模型正在生成动作底片';
    await writeAvatarVideoJob(job);
    return job;
  }
  if (typeof status.video_url !== 'string' || !status.video_url) throw new Error('视频模型没有返回生成结果');

  job.status = 'finalizing';
  job.progress = '视频已生成，正在标准化并执行 MuseTalk 人脸预处理';
  job.finalizingAt = new Date().toISOString();
  await writeAvatarVideoJob(job);

  const directory = avatarVersionDirectory(job.avatarId, job.version);
  await mkdir(directory, { recursive: true });
  const providerVideo = path.join(directory, 'provider.mp4');
  const talkVideo = path.join(directory, 'talk.mp4');
  const idleVideo = path.join(directory, 'idle.mp4');
  const artifactLocation = resolveSeoVideoArtifact(status.video_url, seoUpstream);
  const artifact = await fetch(artifactLocation.url, {
    headers: artifactLocation.sendApiKey ? { 'X-API-Key': seoApiKey } : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(180_000),
  });
  if (!artifact.ok) throw new Error(`生成视频下载失败（HTTP ${artifact.status}）`);
  const advertisedLength = Number(artifact.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_AVATAR_VIDEO_BYTES) {
    throw new Error('生成视频超过 150 MB 上限');
  }
  const bytes = Buffer.from(await artifact.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AVATAR_VIDEO_BYTES) throw new Error('生成视频大小无效');
  await writeFile(providerVideo, bytes, { mode: 0o600 });
  await probeVideo(providerVideo);
  await normalizeTalkVideo(providerVideo, talkVideo);
  const normalized = await probeVideo(talkVideo);
  await unlink(providerVideo).catch(() => undefined);
  if (normalized.height <= normalized.width) {
    throw new Error('模型返回的视频不是竖屏，不能作为当前数字人底片');
  }
  await createIdleLoop(talkVideo, idleVideo, normalized.duration);
  await probeVideo(idleVideo, 0.8);

  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = {
    schema_version: 1,
    avatar_id: job.avatarId,
    profile_id: job.profileId,
    name: job.avatarName,
    version: job.version,
    status: 'review',
    source_video: 'talk.mp4',
    idle_video: 'idle.mp4',
    image: job.imageFile,
    model: job.model,
    motion: job.motion || null,
    created_at: job.createdAt,
  };
  await writeJsonAtomic(manifestPath, manifest);

  const prepared = await prepareMuseTalkProfile(job.profileId);
  const { frames, fps } = prepared;
  if (!Number.isFinite(frames) || frames < 25 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('MuseTalk 预处理结果不完整');
  }

  job.status = 'review';
  job.progress = '动作底片和静息循环已通过检脸预处理，请预览后应用';
  job.imageUrl = avatarAssetUrl(job.avatarId, job.version, job.imageFile);
  job.talkVideo = avatarAssetUrl(job.avatarId, job.version, 'talk.mp4');
  job.idleVideo = avatarAssetUrl(job.avatarId, job.version, 'idle.mp4');
  job.quality = {
    duration: Number(normalized.duration.toFixed(3)),
    width: normalized.width,
    height: normalized.height,
    frames,
    fps,
  };
  await writeAvatarVideoJob(job);
  return job;
}

export async function publishAvatarVideoJob(job: AvatarVideoJob) {
  if (job.status !== 'review') throw new Error('只有已通过预处理的候选视频可以应用');
  const directory = avatarVersionDirectory(job.avatarId, job.version);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(/*turbopackIgnore: true*/ manifestPath, 'utf8')) as Record<string, unknown>;
  await prepareMuseTalkProfile(job.profileId);
  manifest.status = 'ready';
  manifest.published_at = new Date().toISOString();
  await writeJsonAtomic(manifestPath, manifest);
  job.status = 'ready';
  job.progress = '动态形象已应用，可以进入实时互动';
  await writeAvatarVideoJob(job);
  return job;
}

export async function avatarAssetFile(segments: string[]) {
  if (segments.length !== 3) throw new Error('素材路径无效');
  const [avatarId, version, filename] = segments;
  if (!AVATAR_ID_PATTERN.test(avatarId) || !JOB_ID_PATTERN.test(version)) throw new Error('素材路径无效');
  if (!/^(?:image\.(?:jpg|png|webp)|idle\.mp4|talk\.mp4)$/.test(filename)) throw new Error('素材类型不允许访问');
  const directory = avatarVersionDirectory(avatarId, version);
  const filepath = path.join(directory, filename);
  const details = await stat(/*turbopackIgnore: true*/ filepath);
  if (!details.isFile()) throw new Error('素材不存在');
  return {
    filepath,
    details,
    stream: (start?: number, end?: number) => createReadStream(/*turbopackIgnore: true*/ filepath, { start, end }),
  };
}
