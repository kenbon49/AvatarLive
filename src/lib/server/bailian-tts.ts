import 'server-only';

import path from 'node:path';

import { ALIYUN_PUBLIC_VOICES } from '@/lib/aliyun-voice-catalog';
import { BailianTtsError, createBailianTtsClient, type BailianProviderOutput } from './bailian-tts-client';

export { BailianTtsError } from './bailian-tts-client';

const API_UPSTREAM = (process.env.API_UPSTREAM || 'http://127.0.0.1:8000').replace(/\/$/, '');
const voiceTasks = new Map<string, Promise<string>>();
const storage = {
  runtimeDirectory: path.join(/*turbopackIgnore: true*/ process.cwd(), 'runtime', 'bailian-tts'),
  publicDirectory: path.join(/*turbopackIgnore: true*/ process.cwd(), 'public'),
  voices: ALIYUN_PUBLIC_VOICES,
};

// Reading existing audio does not require a configured provider or API connection.
export const bailianAudio = createBailianTtsClient(storage);

async function apiRequest(request: Request, endpoint: string, body?: object) {
  let response: Response;
  try {
    response = await fetch(`${API_UPSTREAM}/api/v1/tts/bailian/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { cookie: request.headers.get('cookie') || '', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(body ? 130_000 : 5000),
    });
  } catch {
    throw new BailianTtsError('连接本项目语音服务失败或超时，请稍后重试');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BailianTtsError(
      typeof payload?.detail === 'string' ? payload.detail : '本项目语音服务暂不可用',
      response.status,
      response.headers.get('x-bailian-provider-accepted') === 'true',
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BailianTtsError('本项目语音服务返回格式无效', 502, Boolean(body));
  }
  return payload;
}

export async function getBailianTts(request: Request) {
  const configuration = await apiRequest(request, 'configuration');
  if (!configuration.configured || !/^[a-f0-9]{64}$/.test(configuration.credential_id)) {
    throw new BailianTtsError('请在管理员系统设置的“接口密钥”中配置百炼语音 API Key（BAILIAN_TTS_API_KEY）', 503);
  }
  // Each client retains only this request's session; configuration is never cached.
  return createBailianTtsClient({
    ...storage,
    credentialId: configuration.credential_id,
    voiceTasks,
    providerRequest: async (body) => {
      const payload = await apiRequest(request, 'request', { ...body, credential_id: configuration.credential_id });
      if (!payload.output || typeof payload.output !== 'object' || Array.isArray(payload.output)) {
        throw new BailianTtsError('百炼语音返回格式无效', 502, true);
      }
      return payload.output as BailianProviderOutput;
    },
  });
}
