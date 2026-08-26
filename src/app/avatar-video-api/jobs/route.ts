import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AVATAR_MOTION_INTENSITIES,
  AVATAR_MOTION_MODES,
  DEFAULT_AVATAR_MOTION_DURATION,
  DEFAULT_AVATAR_MOTION_INTENSITY,
  DEFAULT_AVATAR_MOTION_MODE,
  DEFAULT_AVATAR_MOTION_PROMPT,
  MAX_AVATAR_MOTION_DURATION,
  MAX_AVATAR_MOTION_PROMPT_LENGTH,
  MIN_AVATAR_MOTION_DURATION,
  buildAvatarMotionGenerationPrompt,
  cleanAvatarMotionPrompt,
  type AvatarMotionIntensity,
  type AvatarMotionMode,
} from '@/lib/avatar-motion';
import {
  AVATAR_ID_PATTERN,
  HAPPYHORSE_VIDEO_MODEL,
  MAX_AVATAR_IMAGE_BYTES,
  SEEDANCE_FALLBACK_VIDEO_MODEL,
  avatarBaseVideo,
  avatarVersionDirectory,
  imageMimeType,
  publicAvatarVideoJob,
  writeAvatarVideoJob,
  type AvatarVideoJob,
} from '@/lib/avatar-video-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status, headers: { 'cache-control': 'no-store' } });
}

async function responsePayload(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const seoUpstream = (process.env.SEO_VIDEO_API_BASE_URL || process.env.SEO_IMAGE_API_BASE_URL || '').replace(/\/$/, '');
  const seoApiKey = process.env.SEO_VIDEO_API_KEY || process.env.SEO_IMAGE_API_KEY || '';
  if (!seoUpstream || !seoApiKey) return errorResponse('动态形象视频服务尚未配置', 503);

  let job: AvatarVideoJob | null = null;
  try {
    const form = await request.formData();
    const primaryModel = process.env.SEO_VIDEO_MODEL || HAPPYHORSE_VIDEO_MODEL;
    const fallbackModel = process.env.SEO_VIDEO_FALLBACK_MODEL || SEEDANCE_FALLBACK_VIDEO_MODEL;
    const model = String(form.get('model') || primaryModel).trim();
    const supportedModels = new Set([HAPPYHORSE_VIDEO_MODEL, SEEDANCE_FALLBACK_VIDEO_MODEL]);
    if (!supportedModels.has(primaryModel) || !supportedModels.has(fallbackModel)) {
      return errorResponse('动态形象视频模型配置无效', 503);
    }
    if (!supportedModels.has(model) || !new Set([primaryModel, fallbackModel]).has(model)) {
      return errorResponse('不允许使用当前视频编辑模型', 400);
    }
    const avatarId = String(form.get('avatar_id') || '').trim().toLowerCase();
    const avatarName = String(form.get('avatar_name') || '').trim();
    const baseProfile = String(form.get('base_profile') || '').trim();
    const requestedMotionPrompt = cleanAvatarMotionPrompt(form.get('motion_prompt'));
    const motionPrompt = requestedMotionPrompt || DEFAULT_AVATAR_MOTION_PROMPT;
    const motionModeValue = String(form.get('motion_mode') || DEFAULT_AVATAR_MOTION_MODE);
    const motionIntensityValue = String(form.get('motion_intensity') || DEFAULT_AVATAR_MOTION_INTENSITY);
    const motionDurationValue = String(form.get('motion_duration') || DEFAULT_AVATAR_MOTION_DURATION);
    const motionDuration = Number(motionDurationValue);
    const image = form.get('image');
    if (!AVATAR_ID_PATTERN.test(avatarId)) return errorResponse('自定义形象编号无效', 400);
    if (!avatarName || avatarName.length > 80) return errorResponse('形象名称长度必须在 1 到 80 个字符之间', 400);
    if (motionPrompt.length > MAX_AVATAR_MOTION_PROMPT_LENGTH) {
      return errorResponse(`动作描述不能超过 ${MAX_AVATAR_MOTION_PROMPT_LENGTH} 个字符`, 400);
    }
    if (!AVATAR_MOTION_MODES.some((value) => value === motionModeValue)) {
      return errorResponse('动作方式无效', 400);
    }
    if (!AVATAR_MOTION_INTENSITIES.some((value) => value === motionIntensityValue)) {
      return errorResponse('动作幅度无效', 400);
    }
    if (!Number.isInteger(motionDuration)
      || motionDuration < MIN_AVATAR_MOTION_DURATION
      || motionDuration > MAX_AVATAR_MOTION_DURATION) {
      return errorResponse(`动作节奏必须在 ${MIN_AVATAR_MOTION_DURATION} 到 ${MAX_AVATAR_MOTION_DURATION} 秒之间`, 400);
    }
    if (!(image instanceof File)) return errorResponse('请上传最终形象图片', 400);
    if (!image.size || image.size > MAX_AVATAR_IMAGE_BYTES) return errorResponse('形象图片大小必须在 20 MB 以内', 400);

    const imageBytes = Buffer.from(await image.arrayBuffer());
    const imageType = imageMimeType(imageBytes);
    if (!imageType) return errorResponse('形象图片仅支持 JPG、PNG 或 WebP', 400);
    const sourceVideo = avatarBaseVideo(baseProfile);
    const sourceDetails = await stat(/*turbopackIgnore: true*/ sourceVideo);
    if (!sourceDetails.isFile()) throw new Error('基础动作模板不存在');

    const jobId = randomUUID();
    const version = jobId;
    const profileId = `${avatarId}_${jobId.slice(0, 8)}`;
    const directory = avatarVersionDirectory(avatarId, version);
    const imageFile = `image.${imageType.extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, imageFile), imageBytes, { mode: 0o600 });

    const now = new Date().toISOString();
    job = {
      id: jobId,
      avatarId,
      avatarName,
      baseProfile,
      profileId,
      status: 'submitted',
      progress: '正在上传动作模板',
      model,
      seoTaskId: '',
      version,
      imageFile,
      imageMime: imageType.mime,
      motion: {
        prompt: motionPrompt,
        mode: motionModeValue as AvatarMotionMode,
        intensity: motionIntensityValue as AvatarMotionIntensity,
        duration: motionDuration,
      },
      createdAt: now,
      updatedAt: now,
    };
    await writeAvatarVideoJob(job);

    const sourceBytes = await readFile(/*turbopackIgnore: true*/ sourceVideo);
    const sourceUpload = new FormData();
    sourceUpload.append('file', new Blob([sourceBytes], { type: 'video/mp4' }), path.basename(sourceVideo));
    if (model === SEEDANCE_FALLBACK_VIDEO_MODEL) sourceUpload.append('model', model);
    const sourceUploadPath = model === HAPPYHORSE_VIDEO_MODEL
      ? '/api/ai/bailian/edit-video'
      : '/api/ai/seedance/reference-video';
    const uploadResponse = await fetch(`${seoUpstream}${sourceUploadPath}`, {
      method: 'POST',
      headers: { 'X-API-Key': seoApiKey },
      body: sourceUpload,
      cache: 'no-store',
      signal: AbortSignal.timeout(180_000),
    });
    const uploadPayload = await responsePayload(uploadResponse);
    if (!uploadResponse.ok || typeof uploadPayload.url !== 'string') {
      throw new Error(typeof uploadPayload.message === 'string' ? uploadPayload.message : `动作模板上传 HTTP ${uploadResponse.status}`);
    }

    const prompt = buildAvatarMotionGenerationPrompt(job.motion);
    let generationPath = '/api/ai/generate-bailian-video';
    let generationBody: Record<string, unknown> = {
      model,
      prompt,
      resolution: '720P',
      source_video: uploadPayload.url,
      reference_images: [`data:${imageType.mime};base64,${imageBytes.toString('base64')}`],
      audio_setting: 'origin',
      watermark: false,
      seed: -1,
    };
    if (model === SEEDANCE_FALLBACK_VIDEO_MODEL) {
      job.progress = '正在上传 Seedance 形象参考图';
      await writeAvatarVideoJob(job);
      const imageUpload = new FormData();
      imageUpload.append('file', new Blob([imageBytes], { type: imageType.mime }), imageFile);
      imageUpload.append('model', model);
      imageUpload.append('media_type', 'image');
      const imageUploadResponse = await fetch(`${seoUpstream}/api/ai/seedance/reference-media`, {
        method: 'POST',
        headers: { 'X-API-Key': seoApiKey },
        body: imageUpload,
        cache: 'no-store',
        signal: AbortSignal.timeout(180_000),
      });
      const imageUploadPayload = await responsePayload(imageUploadResponse);
      if (!imageUploadResponse.ok || typeof imageUploadPayload.url !== 'string') {
        throw new Error(typeof imageUploadPayload.message === 'string'
          ? imageUploadPayload.message
          : `形象参考图上传 HTTP ${imageUploadResponse.status}`);
      }
      generationPath = '/api/ai/generate-video';
      generationBody = {
        model,
        mode: 'edit',
        prompt,
        aspect_ratio: 'adaptive',
        resolution: '720p',
        duration_seconds: '-1',
        output_format: 'mp4',
        reference_videos: [uploadPayload.url],
        images_with_roles: [{ url: imageUploadPayload.url, role: 'reference_image' }],
        watermark: false,
        camera_fixed: true,
        generate_audio: false,
        draft: false,
        seed: -1,
      };
    }

    job.progress = model === HAPPYHORSE_VIDEO_MODEL
      ? '正在提交 HappyHorse 视频编辑任务'
      : '正在提交 Seedance 2.5 视频编辑任务';
    await writeAvatarVideoJob(job);
    const generationResponse = await fetch(`${seoUpstream}${generationPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-API-Key': seoApiKey,
      },
      body: JSON.stringify(generationBody),
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
    const generationPayload = await responsePayload(generationResponse);
    if (!generationResponse.ok || typeof generationPayload.task_id !== 'string') {
      throw new Error(typeof generationPayload.message === 'string' ? generationPayload.message : `视频任务提交 HTTP ${generationResponse.status}`);
    }
    job.seoTaskId = generationPayload.task_id;
    job.status = 'processing';
    job.progress = model === HAPPYHORSE_VIDEO_MODEL
      ? 'HappyHorse 正在保持形象身份并生成动作底片'
      : 'Seedance 2.5 正在使用参考图替换人物并保持原动作';
    await writeAvatarVideoJob(job);
    return Response.json(publicAvatarVideoJob(job), { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '动态素材任务创建失败';
    if (job) {
      job.status = 'failed';
      job.progress = '动态素材任务创建失败';
      job.error = message;
      await writeAvatarVideoJob(job).catch(() => undefined);
    }
    return errorResponse(message, 502);
  }
}
