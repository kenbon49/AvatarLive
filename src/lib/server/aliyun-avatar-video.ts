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
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createLingMouVariables,
  normalizeLingMouVideoStatus,
  validateLingMouTemplateVariables,
} from '@/lib/aliyun-avatar-video-config';

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const credentialNames = ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET'] as const;
const lingMouSettingNames = ['ALIYUN_LINGMOU_TEMPLATE_ID'] as const;
const cacheTasks = new Map<string, Promise<string>>();

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
  return path.join(process.cwd(), 'runtime', 'aliyun-avatar-videos');
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

function trustedArtifactUrl(value: string) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || !(
    url.hostname === 'aliyuncs.com'
    || url.hostname.endsWith('.aliyuncs.com')
    || url.hostname.endsWith('.alicdn.com')
  )) {
    throw new Error('阿里云返回了不受信任的视频地址');
  }
  return url.toString();
}

async function downloadVideo(taskId: string, remoteUrl: string) {
  const existing = await cachedVideoUrl(taskId);
  if (existing) return existing;
  const pending = cacheTasks.get(taskId);
  if (pending) return pending;

  const task = (async () => {
    const response = await fetch(trustedArtifactUrl(remoteUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(240_000),
    });
    if (!response.ok) throw new Error(`透明数字人视频下载失败（HTTP ${response.status}）`);
    const advertisedLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertisedLength) && advertisedLength > MAX_VIDEO_BYTES) {
      throw new Error('透明数字人视频超过 200 MB 上限');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1_024 || bytes.length > MAX_VIDEO_BYTES) throw new Error('透明数字人视频大小无效');
    if (!bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      throw new Error('阿里云没有返回预期的透明 WebM 视频');
    }

    const directory = videoDirectory();
    await mkdir(directory, { recursive: true });
    const destination = videoFile(taskId);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, destination);
    } catch (cause) {
      await unlink(temporary).catch(() => undefined);
      throw cause;
    }
    return videoAssetUrl(taskId);
  })().finally(() => cacheTasks.delete(taskId));
  cacheTasks.set(taskId, task);
  return task;
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
  console.info('[avatar-video] submitted', JSON.stringify({ taskId: result.id, status: result.status, characterCount: input.text.length }));
  return result;
}

export async function getAliyunAvatarVideo(taskId: string) {
  const id = assertTaskId(taskId);
  const localUrl = await cachedVideoUrl(id);
  if (localUrl) {
    return {
      ...cloudVideo({ id, status: 'SUCCESS' }, id)!,
      videoUrl: localUrl,
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
    result.videoUrl = await downloadVideo(id, result.videoUrl);
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
