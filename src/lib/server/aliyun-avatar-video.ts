import 'server-only';

import LingMouClient, {
  CreateBroadcastVideoFromTemplateRequest,
  CreateBroadcastVideoFromTemplateRequestVideoOptions,
  GetBroadcastTemplateRequest,
  ListBroadcastVideosByIdRequest,
  TemplateVariable,
} from '@alicloud/lingmou20250527';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

import {
  createLingMouVariables,
  normalizeLingMouVideoStatus,
  validateLingMouTemplateVariables,
} from '@/lib/aliyun-avatar-video-config';
import { cacheAliyunWebm } from '@/lib/server/aliyun-avatar-video-cache';

const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const credentialNames = ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET'] as const;
const lingMouSettingNames = ['ALIYUN_LINGMOU_TEMPLATE_ID'] as const;
type DownloadState = { status: 'downloading' | 'failed'; downloadedBytes: number; totalBytes: number; error?: string };
const cacheTasks = new Map<string, DownloadState>();

export type AliyunAvatarVideo = {
  id: string;
  name: string;
  status: string;
  videoUrl: string;
  coverUrl: string;
  captionUrl: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  download?: DownloadState | { status: 'ready'; downloadedBytes: number; totalBytes: number };
};

export type CreateAliyunAvatarVideoInput = {
  name: string;
  text: string;
  voiceKey: string;
  voiceOfficialId: string;
  avatarOfficialId: string;
  aspectRatio?: string;
  speechRate?: number;
  pitchRate?: number;
};

type CloudVideo = {
  id?: string;
  name?: string;
  status?: string;
  videoURL?: string;
  coverURL?: string;
  captionURL?: string;
  createTime?: string;
  modifiedTime?: string;
};

const env = (name: string) => process.env[name]?.trim() || '';

function assertTaskId(taskId: string) {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error('数字人口播任务 ID 无效');
  return taskId;
}

function featuredVideoId() {
  const value = env('ALIYUN_LINGMOU_FEATURED_VIDEO_ID');
  return value && TASK_ID_PATTERN.test(value) ? value : '';
}

export function aliyunAvatarVideoConfiguration() {
  const required = [...credentialNames, ...lingMouSettingNames];
  const missing = required.filter((name) => !env(name));
  return {
    configured: missing.length === 0,
    credentialsConfigured: credentialNames.every((name) => Boolean(env(name))),
    missing,
    mode: 'direct-alpha' as const,
    provider: 'lingmou-2025-05-27' as const,
    regionId: env('ALIYUN_LINGMOU_REGION_ID') || 'cn-beijing',
    endpoint: env('ALIYUN_LINGMOU_ENDPOINT') || 'lingmou.cn-beijing.aliyuncs.com',
    templateConfigured: Boolean(env('ALIYUN_LINGMOU_TEMPLATE_ID')),
    featuredVideoId: featuredVideoId(),
  };
}

function client() {
  const configuration = aliyunAvatarVideoConfiguration();
  if (!configuration.configured) {
    throw new Error(`灵眸透明数字人成片服务尚未配置：${configuration.missing.join(', ')}`);
  }
  return new LingMouClient(new $OpenApiUtil.Config({
    accessKeyId: env('ALIYUN_ACCESS_KEY_ID'),
    accessKeySecret: env('ALIYUN_ACCESS_KEY_SECRET'),
    regionId: configuration.regionId,
    endpoint: configuration.endpoint,
  }));
}

function videoDirectory() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'runtime', 'aliyun-avatar-videos');
}

function videoFile(taskId: string) {
  return path.join(videoDirectory(), `${assertTaskId(taskId)}.webm`);
}

function videoAssetUrl(taskId: string) {
  return `/aliyun-avatar-video-api/videos/${encodeURIComponent(assertTaskId(taskId))}/media`;
}

async function cachedVideoUrl(taskId: string) {
  try {
    const details = await stat(/*turbopackIgnore: true*/ videoFile(taskId));
    return details.isFile() && details.size > 1_024 ? videoAssetUrl(taskId) : '';
  } catch {
    return '';
  }
}

function maxVideoBytes() {
  const configured = Number(env('ALIYUN_AVATAR_VIDEO_MAX_MIB'));
  return (Number.isSafeInteger(configured) && configured >= 64 && configured <= 4096 ? configured : 1024) * 1048576;
}

function startVideoDownload(taskId: string, remoteUrl: string, retry: boolean) {
  const existing = cacheTasks.get(taskId);
  if (existing && (existing.status === 'downloading' || !retry)) return existing;
  const state: DownloadState = { status: 'downloading', downloadedBytes: 0, totalBytes: 0 };
  cacheTasks.set(taskId, state);
  void cacheAliyunWebm({
    url: remoteUrl,
    destination: videoFile(taskId),
    maxBytes: maxVideoBytes(),
    onProgress(received, total) {
      state.downloadedBytes = received;
      state.totalBytes = total;
    },
  }).then(() => {
    cacheTasks.delete(taskId);
    console.info('[avatar-video] cached', JSON.stringify({ taskId, bytes: state.downloadedBytes }));
  }).catch((cause) => {
    state.status = 'failed';
    state.error = cause instanceof Error ? cause.message : '透明数字人视频下载失败';
    console.warn('[avatar-video] cache failed', JSON.stringify({ taskId, message: state.error }));
  });
  return state;
}

function cloudVideo(value: CloudVideo | undefined, fallbackId?: string): AliyunAvatarVideo | null {
  const id = value?.id || fallbackId;
  if (!id) return null;
  return {
    id: assertTaskId(id),
    name: value?.name || '',
    status: normalizeLingMouVideoStatus(value?.status),
    videoUrl: value?.videoURL || '',
    coverUrl: value?.coverURL || '',
    captionUrl: value?.captionURL || '',
    createdAt: value?.createTime || '',
    updatedAt: value?.modifiedTime || '',
    error: normalizeLingMouVideoStatus(value?.status) === 'ERROR' ? '灵眸透明数字人口播生成失败' : '',
  };
}

function assertSuccess(body: { success?: boolean; message?: string; code?: string } | undefined, fallback: string) {
  if (!body?.success) throw new Error(body?.message || body?.code || fallback);
}

function variableName(setting: string, fallback: string) {
  return env(setting) || fallback;
}

export async function createAliyunAvatarVideo(input: CreateAliyunAvatarVideoInput) {
  if (!input.avatarOfficialId) throw new Error('数字人口播缺少形象 ID');
  if (!input.voiceOfficialId) throw new Error('数字人口播缺少音色 ID');
  const names = {
    text: variableName('ALIYUN_LINGMOU_TEXT_VARIABLE_NAME', 'text'),
  };
  const lingMouClient = client();
  const templateId = env('ALIYUN_LINGMOU_TEMPLATE_ID');
  const templateResponse = await lingMouClient.getBroadcastTemplate(new GetBroadcastTemplateRequest({ templateId }));
  assertSuccess(templateResponse.body, '灵眸模板配置读取失败');
  validateLingMouTemplateVariables(templateResponse.body?.data?.variables, names);
  const variables = createLingMouVariables({
    text: input.text,
    voiceOfficialId: input.voiceOfficialId,
    avatarOfficialId: input.avatarOfficialId,
    names,
  }).map((item) => new TemplateVariable(item));
  const response = await lingMouClient.createBroadcastVideoFromTemplate(new CreateBroadcastVideoFromTemplateRequest({
    name: input.name.slice(0, 64),
    templateId,
    variables,
    videoOptions: new CreateBroadcastVideoFromTemplateRequestVideoOptions({
      mode: 'ONLY_AVATAR',
      resolution: '1080p',
      fps: 30,
      watermark: false,
      languageHints: ['zh'],
    }),
  }));
  assertSuccess(response.body, '灵眸透明数字人口播提交失败');
  const result = cloudVideo(response.body?.data);
  if (!result) throw new Error('阿里云没有返回数字人口播任务 ID');
  if (result.status === 'SUCCESS' && result.videoUrl) {
    result.download = { ...startVideoDownload(result.id, result.videoUrl, false) };
    result.videoUrl = '';
  }
  console.info('[avatar-video] submitted', JSON.stringify({ taskId: result.id, status: result.status, characterCount: input.text.length }));
  return result;
}

export async function getAliyunAvatarVideo(taskId: string, { retryDownload = false } = {}) {
  const id = assertTaskId(taskId);
  const localUrl = await cachedVideoUrl(id);
  if (localUrl) {
    const size = (await stat(videoFile(id))).size;
    return {
      ...cloudVideo({ id, status: 'SUCCESS' }, id)!,
      videoUrl: localUrl,
      download: { status: 'ready' as const, downloadedBytes: size, totalBytes: size },
    };
  }

  const response = await client().listBroadcastVideosById(new ListBroadcastVideosByIdRequest({ videoIds: [id] }));
  assertSuccess(response.body, '灵眸数字人口播状态查询失败');
  const result = cloudVideo(response.body?.data?.find((item) => item.id === id), id);
  if (!result || !response.body?.data?.some((item) => item.id === id)) {
    throw new Error('阿里云没有返回数字人口播任务');
  }
  if (result.status === 'SUCCESS') {
    if (!result.videoUrl) throw new Error('阿里云任务成功但没有返回透明视频地址');
    result.download = { ...startVideoDownload(id, result.videoUrl, retryDownload) };
    result.videoUrl = '';
  }
  return result;
}

export async function aliyunAvatarVideoFile(taskId: string) {
  const filepath = videoFile(taskId);
  const details = await stat(/*turbopackIgnore: true*/ filepath);
  if (!details.isFile() || details.size < 1_024) throw new Error('透明数字人视频不存在');
  return {
    filepath,
    details,
    stream: (start?: number, end?: number) => createReadStream(/*turbopackIgnore: true*/ filepath, { start, end }),
  };
}

export async function aliyunAvatarVideoDuration(taskId: string) {
  const filepath = videoFile(assertTaskId(taskId));
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', filepath],
      { timeout: 30_000, encoding: 'utf8' },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取透明数字人成片时长');
  return duration;
}
