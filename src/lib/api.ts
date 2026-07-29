// 后端 API 客户端（浏览器端 fetch）。
// - 本地开发：不设 NEXT_PUBLIC_API_BASE_URL → 默认 http://localhost:8000
// - 单机反代部署：构建时设 NEXT_PUBLIC_API_BASE_URL="" → 同源相对路径（经 Caddy :8018 转发）
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

// LiveTalking WebRTC 地址：浏览器直连（LiveTalking 侧 aiohttp_cors 已对 8018 放开）。
// 默认用页面同主机名 + :8028（单机部署时 SynLive 在 :8018、LiveTalking 在 :8028）。
// 跨机/自定义时用 NEXT_PUBLIC_LIVETALKING_URL 覆盖。
const LT_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
export const LIVETALKING_URL =
  process.env.NEXT_PUBLIC_LIVETALKING_URL ?? `http://${LT_HOST}:8028`;

// FlashHead Lite 独立运行在 :8030。信令和控制请求走同源 /flashhead-api/*，
// 由 Next rewrite 转发，避免占用或替换现有 LiveTalking :8028。
// 这个 URL 仅用于状态说明；浏览器不会直接 fetch 它。
export const FLASHHEAD_URL =
  process.env.NEXT_PUBLIC_FLASHHEAD_URL || `http://${LT_HOST}:8030`;

// MuseTalk 1.5 动作主播独立运行在 :8031；浏览器请求统一走同源代理，
// 该地址只用于界面状态说明，不参与 fetch。
export const MUSETALK_URL =
  process.env.NEXT_PUBLIC_MUSETALK_URL || `http://${LT_HOST}:8031`;

// UE5 Pixel Streaming 信令地址（浏览器直连 UE SignalingServer）。
// 单机部署时 SynLive 在 :8018、UE SignalingServer 在 :8888；跨机用 NEXT_PUBLIC_PIXELSTREAMING_URL 覆盖。
// 切回 LiveTalking 时前端走 LIVETALKING_URL 的 /offer，本变量不用。
export const PIXELSTREAMING_URL =
  process.env.NEXT_PUBLIC_PIXELSTREAMING_URL ?? `ws://${LT_HOST}:8888`;

// 当前渲染后端（与后端 /health/ready 的 renderer_backend 对齐）。
// 'unreal' = UE5 MetaHuman(走 PIXELSTREAMING_URL 信令)；'livetalking' = 2D(走 LIVETALKING_URL /offer)。
export const RENDERER_BACKEND =
  process.env.NEXT_PUBLIC_RENDERER_BACKEND ?? 'unreal';

// LiveAct 生成式数字人 demo 地址（仅状态栏展示，不参与 fetch）。
// 浏览器实际请求走同源 /liveact-api/*，由 next.config.ts rewrite 代理到 demo.py，绕过 CORS + 混合内容。
export const LIVEACT_DEMO_URL =
  process.env.NEXT_PUBLIC_LIVEACT_DEMO_URL ?? 'http://localhost:5071';

// LiveAct demo.py 的任务状态字段（对齐 demo.py task_status_map）。
// stage 流转：queued → starting → preparing → audio_ready → ffmpeg_ready → generating → finalizing → finished/failed
export interface LiveActTaskStatus {
  status: string; // queued | running | finished | failed | not_found
  stage: string;
  message: string;
  total_chunks: number | null;
  generated_chunks: number;
  is_done: boolean;
  stream_ready: boolean; // live.m3u8 首切片就绪 → 可挂 hls.js
  error: string | null;
  final_video_path?: string;
}

export interface FlashHeadAvatar {
  id: string;
  label: string;
  thumbnail: string;
}

export interface FlashHeadAvatarState {
  avatars: FlashHeadAvatar[];
  active_avatar: string;
  switching: boolean;
  body_enabled?: boolean;
  body_profile_avatar?: string;
}

export interface FlashHeadAction {
  id: string;
  label: string;
}

export interface FlashHeadActionState {
  available: boolean;
  enabled: boolean;
  profile_avatar: string;
  actions: FlashHeadAction[];
  state: {
    action: string;
    speaking: boolean;
    generation: number;
    active_generation?: number | null;
    frame_index?: number;
    direction?: number;
  } | null;
  config_error?: string | null;
}

export type MuseTalkActionState = FlashHeadActionState;

export interface MuseTalkAvatar {
  id: string;
  label: string;
  thumbnail: string;
}

export interface MuseTalkAvatarState {
  avatars: MuseTalkAvatar[];
  active_avatar: string;
  switching: boolean;
  multi_avatar_enabled: boolean;
  avatar_config_error: string | null;
  avatar_error: string | null;
}

export interface MuseTalkHealth {
  status: string;
  ready: boolean;
  renderer: string;
  model_version: string;
  fps: number;
  resolution: string | number[] | { width: number; height: number };
  connected: boolean;
  active_id: number | null;
  queued: number;
  actions: MuseTalkActionState;
  last_timing: Record<string, unknown> | null;
}

export interface ReadyInfo {
  status: string;
  azure_configured: boolean;
  azure_region: string;
  llm_configured: boolean;
  llm_default_model_id: string;
  livetalking_enabled: boolean;
  livetalking_url: string;
}

export interface VoiceItem {
  id: string;
  name: string;
  gender: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  avatar: string | null;
  voice: string | null;
  lang: string;
  livetalking_session_id: string | null;
  status: string;
}

export interface SayResult {
  session_id: string;
  text: string;
  livetalking: LiveTalkingState;
}

export interface AnswerResult {
  session_id: string;
  question: string;
  answer: string;
  model_id: string;
  llm_latency_ms: number;
  livetalking: LiveTalkingState | null;
}

export interface LiveTalkingState {
  ok: boolean;
  degraded: boolean;
  latency_ms: number;
  url: string;
  detail: string;
  audio?: string; // verbatim 后端合成的 Azure TTS 音频（mp3 base64），前端经 datachannel 发 UE
}

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// LiveTalking WebRTC 信令：POST /offer（浏览器 → LiveTalking 直连，跨源已 CORS 放开）
export async function offerLiveTalking(
  sdp: string,
  type: string,
): Promise<{ sdp: string; type: string }> {
  const res = await fetch(`${LIVETALKING_URL}/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp, type }),
  });
  if (!res.ok) throw new Error(`LiveTalking /offer HTTP ${res.status}`);
  return (await res.json()) as { sdp: string; type: string };
}

// 探测 LiveTalking 是否可达。使用镜像自带静态页，避免 GET / 的预期 403 污染浏览器控制台。
export async function pingLiveTalking(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVETALKING_URL}/webrtcapi.html`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// —— FlashHead Lite 实时数字人（独立 :8030，同源代理）——

function isFlashHeadAvatarState(value: unknown): value is FlashHeadAvatarState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<FlashHeadAvatarState>;
  if (!Array.isArray(state.avatars) || !state.avatars.length) return false;
  if (typeof state.active_avatar !== 'string' || !state.active_avatar) return false;
  if (typeof state.switching !== 'boolean') return false;
  const avatarsValid = state.avatars.every(
    (avatar) =>
      !!avatar &&
      typeof avatar === 'object' &&
      typeof avatar.id === 'string' &&
      !!avatar.id &&
      typeof avatar.label === 'string' &&
      typeof avatar.thumbnail === 'string',
  );
  return avatarsValid && state.avatars.some((avatar) => avatar.id === state.active_avatar);
}

async function flashHeadFetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function pingFlashHead(): Promise<boolean> {
  try {
    const res = await flashHeadFetchWithTimeout(
      '/flashhead-api/health',
      { method: 'GET', cache: 'no-store' },
      4000,
      'FlashHead 探活超时（4 秒）',
    );
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    return (
      !!body &&
      typeof body === 'object' &&
      (body as { status?: unknown }).status === 'ok' &&
      isFlashHeadAvatarState(body)
    );
  } catch {
    return false;
  }
}

export async function offerFlashHead(
  sdp: string,
  type: string,
): Promise<{ sdp: string; type: string }> {
  const res = await fetch('/flashhead-api/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp, type }),
  });
  if (!res.ok) throw new Error(`FlashHead /offer HTTP ${res.status}`);
  return (await res.json()) as { sdp: string; type: string };
}

export async function speakFlashHead(
  text: string,
  interrupt = true,
  action = 'auto',
): Promise<{ code: number; action: string; latencyMs: number }> {
  const startedAt = performance.now();
  const res = await fetch('/flashhead-api/human', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'echo', text, interrupt, action }),
  });
  if (!res.ok) throw new Error(`FlashHead /human HTTP ${res.status}`);
  const body = (await res.json()) as { code?: number; msg?: string; action?: string };
  if ((body.code ?? 0) !== 0) throw new Error(body.msg || `FlashHead error ${body.code}`);
  return {
    code: body.code ?? 0,
    action: body.action || action,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

// 切走实时模式时尽力终止当前语音；短超时且永不抛错，不阻塞 UI 模式切换。
export async function interruptFlashHead(timeoutMs = 1200): Promise<boolean> {
  try {
    const res = await flashHeadFetchWithTimeout(
      '/flashhead-api/human',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'interrupt' }),
        keepalive: true,
      },
      timeoutMs,
      'FlashHead interrupt timeout',
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { code?: number };
    return (body.code ?? 0) === 0;
  } catch {
    return false;
  }
}

async function flashHeadAvatarResponse(res: Response): Promise<FlashHeadAvatarState> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string; message?: string; error?: string };
      detail = body.detail || body.message || body.error || detail;
    } catch {
      /* ignore malformed error bodies */
    }
    throw new Error(detail);
  }
  const body = (await res.json()) as unknown;
  if (!isFlashHeadAvatarState(body)) {
    throw new Error('FlashHead 人物响应格式无效');
  }
  return body;
}

export async function getFlashHeadAvatars(): Promise<FlashHeadAvatarState> {
  const res = await flashHeadFetchWithTimeout(
    '/flashhead-api/avatars',
    { method: 'GET', cache: 'no-store' },
    5000,
    '读取人物列表超时（5 秒）',
  );
  return flashHeadAvatarResponse(res);
}

export async function setFlashHeadAvatar(avatarId: string): Promise<FlashHeadAvatarState> {
  const res = await flashHeadFetchWithTimeout(
    '/flashhead-api/avatar',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_id: avatarId }),
    },
    15000,
    '人物切换超时（15 秒），请重新加载状态',
  );
  return flashHeadAvatarResponse(res);
}

function isFlashHeadActionState(value: unknown): value is FlashHeadActionState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<FlashHeadActionState>;
  return (
    typeof state.available === 'boolean' &&
    typeof state.enabled === 'boolean' &&
    typeof state.profile_avatar === 'string' &&
    Array.isArray(state.actions) &&
    state.actions.every(
      (action) =>
        !!action &&
        typeof action === 'object' &&
        typeof action.id === 'string' &&
        typeof action.label === 'string',
    )
  );
}

async function flashHeadActionResponse(res: Response): Promise<FlashHeadActionState> {
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const error = body as { detail?: string; error?: string };
    throw new Error(error.detail || error.error || `HTTP ${res.status}`);
  }
  if (!isFlashHeadActionState(body)) throw new Error('FlashHead 动作响应格式无效');
  return body;
}

export async function getFlashHeadActions(): Promise<FlashHeadActionState> {
  const res = await flashHeadFetchWithTimeout(
    '/flashhead-api/actions',
    { method: 'GET', cache: 'no-store' },
    5000,
    '读取动作列表超时（5 秒）',
  );
  return flashHeadActionResponse(res);
}

export async function triggerFlashHeadAction(
  action: string,
): Promise<FlashHeadActionState> {
  const res = await flashHeadFetchWithTimeout(
    '/flashhead-api/action',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, interrupt: true }),
    },
    5000,
    '触发动作超时（5 秒）',
  );
  return flashHeadActionResponse(res);
}

// —— MuseTalk 1.5 动作主播（独立 :8031，同源代理）——

async function museTalkFetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isMuseTalkHealth(value: unknown): value is MuseTalkHealth {
  if (!value || typeof value !== 'object') return false;
  const health = value as Partial<MuseTalkHealth>;
  return (
    typeof health.status === 'string' &&
    typeof health.ready === 'boolean' &&
    typeof health.renderer === 'string'
  );
}

function isMuseTalkAvatarState(value: unknown): value is MuseTalkAvatarState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<MuseTalkAvatarState>;
  if (
    !Array.isArray(state.avatars) ||
    typeof state.active_avatar !== 'string' ||
    typeof state.switching !== 'boolean' ||
    typeof state.multi_avatar_enabled !== 'boolean' ||
    !(state.avatar_config_error === null || typeof state.avatar_config_error === 'string') ||
    !(state.avatar_error === null || typeof state.avatar_error === 'string')
  ) {
    return false;
  }

  const profilePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const ids = new Set<string>();
  for (const avatar of state.avatars) {
    if (
      !avatar ||
      typeof avatar !== 'object' ||
      typeof avatar.id !== 'string' ||
      !profilePattern.test(avatar.id) ||
      typeof avatar.label !== 'string' ||
      !avatar.label.trim() ||
      typeof avatar.thumbnail !== 'string' ||
      ids.has(avatar.id)
    ) {
      return false;
    }
    ids.add(avatar.id);
  }

  if (state.multi_avatar_enabled !== (state.avatars.length > 1)) return false;
  if (!state.avatars.length) return state.active_avatar === '';
  return profilePattern.test(state.active_avatar) && ids.has(state.active_avatar);
}

export async function getMuseTalkHealth(): Promise<MuseTalkHealth> {
  const res = await museTalkFetchWithTimeout(
    '/musetalk-api/health',
    { method: 'GET', cache: 'no-store' },
    4000,
    'MuseTalk 探活超时（4 秒）',
  );
  if (!res.ok) throw new Error(`MuseTalk /health HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!isMuseTalkHealth(body)) throw new Error('MuseTalk 健康状态响应格式无效');
  return body;
}

export async function pingMuseTalk(): Promise<boolean> {
  try {
    return (await getMuseTalkHealth()).ready;
  } catch {
    return false;
  }
}

async function museTalkAvatarResponse(res: Response): Promise<MuseTalkAvatarState> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as unknown;
      if (body && typeof body === 'object') {
        const error = body as Record<string, unknown>;
        for (const key of ['detail', 'avatar_error', 'error', 'message']) {
          if (typeof error[key] === 'string' && error[key]) {
            detail = error[key];
            break;
          }
        }
      }
    } catch {
      /* Upstream proxy errors can be plain text rather than JSON. */
    }
    throw new Error(detail);
  }
  const body = (await res.json()) as unknown;
  if (!isMuseTalkAvatarState(body)) {
    throw new Error('MuseTalk 人物响应格式无效');
  }
  return body;
}

export async function getMuseTalkAvatars(): Promise<MuseTalkAvatarState> {
  const res = await museTalkFetchWithTimeout(
    '/musetalk-api/avatars',
    { method: 'GET', cache: 'no-store' },
    5000,
    '读取 MuseTalk 人物列表超时（5 秒）',
  );
  return museTalkAvatarResponse(res);
}

export async function setMuseTalkAvatar(avatarId: string): Promise<MuseTalkAvatarState> {
  const res = await museTalkFetchWithTimeout(
    '/musetalk-api/avatar',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_id: avatarId }),
    },
    15000,
    'MuseTalk 人物切换超时（15 秒），请重新加载状态',
  );
  return museTalkAvatarResponse(res);
}

export async function offerMuseTalk(
  sdp: string,
  type: string,
): Promise<{ sdp: string; type: string }> {
  const res = await fetch('/musetalk-api/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp, type }),
  });
  if (!res.ok) throw new Error(`MuseTalk /offer HTTP ${res.status}`);
  return (await res.json()) as { sdp: string; type: string };
}

export async function speakMuseTalk(
  text: string,
  interrupt = true,
  action = 'auto',
): Promise<{ code: number; requestId: string; queued: number; action: string; latencyMs: number }> {
  const startedAt = performance.now();
  const res = await fetch('/musetalk-api/human', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'echo', text, interrupt, action }),
  });
  if (!res.ok) throw new Error(`MuseTalk /human HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    request_id?: string;
    queued?: number;
    action?: string;
  };
  if ((body.code ?? 0) !== 0) throw new Error(body.msg || `MuseTalk error ${body.code}`);
  return {
    code: body.code ?? 0,
    requestId: body.request_id || '',
    queued: body.queued ?? 0,
    action: body.action || action,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export async function interruptMuseTalk(timeoutMs = 1200): Promise<boolean> {
  try {
    const res = await museTalkFetchWithTimeout(
      '/musetalk-api/human',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'interrupt' }),
        keepalive: true,
      },
      timeoutMs,
      'MuseTalk interrupt timeout',
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { code?: number };
    return (body.code ?? 0) === 0;
  } catch {
    return false;
  }
}

async function museTalkActionResponse(res: Response): Promise<MuseTalkActionState> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as unknown;
      if (body && typeof body === 'object') {
        const error = body as Record<string, unknown>;
        for (const key of ['detail', 'error', 'message']) {
          if (typeof error[key] === 'string' && error[key]) {
            detail = error[key];
            break;
          }
        }
      }
    } catch {
      /* Upstream proxy errors can be plain text rather than JSON. */
    }
    throw new Error(detail);
  }
  const body = (await res.json()) as unknown;
  if (!isFlashHeadActionState(body)) throw new Error('MuseTalk 动作响应格式无效');
  return body;
}

export async function getMuseTalkActions(): Promise<MuseTalkActionState> {
  const res = await museTalkFetchWithTimeout(
    '/musetalk-api/actions',
    { method: 'GET', cache: 'no-store' },
    5000,
    '读取 MuseTalk 动作列表超时（5 秒）',
  );
  return museTalkActionResponse(res);
}

export async function triggerMuseTalkAction(action: string): Promise<MuseTalkActionState> {
  const res = await museTalkFetchWithTimeout(
    '/musetalk-api/action',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, interrupt: true }),
    },
    5000,
    '触发 MuseTalk 动作超时（5 秒）',
  );
  return museTalkActionResponse(res);
}

// —— LiveAct 生成式数字人（demo.py，全部走同源 /liveact-api/* 经 next rewrite 代理）——

// 探测 demo.py 是否就绪。demo 加载 50GB 模型 + warmup 需几分钟，期间端口未开 → false。
export async function pingLiveActDemo(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch('/liveact-api', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

// 提交生成任务（multipart）。注意：不要设 Content-Type，让浏览器带 multipart/form-data boundary。
// demo.py 单任务全局锁，繁忙时返回 429 → 抛 Error('HTTP 429 ...')，调用方据此提示。
export async function startLiveAct(form: FormData): Promise<{
  status: string;
  task_id: string;
  stream_with_audio: boolean;
}> {
  const res = await fetch('/liveact-api/start_stream', { method: 'POST', body: form });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.message || body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<{ status: string; task_id: string; stream_with_audio: boolean }>;
}

// 轮询任务状态（demo.py GET /task_status/<task_id>）。
export async function getLiveActTaskStatus(taskId: string): Promise<LiveActTaskStatus> {
  const res = await fetch(`/liveact-api/task_status/${taskId}`, { method: 'GET' });
  if (!res.ok) throw new Error(`LiveAct task_status HTTP ${res.status}`);
  return res.json() as Promise<LiveActTaskStatus>;
}

// HLS 播放地址（demo.py serve_hls：/stream/<task_id>/<filename>）。
export function liveactStreamUrl(taskId: string): string {
  return `/liveact-api/stream/${taskId}/live.m3u8`;
}

export const api = {
  ready: () => jfetch<ReadyInfo>('/health/ready'),
  voices: (lang: string) =>
    jfetch<VoiceItem[]>(`/api/v1/tts/voices?lang=${encodeURIComponent(lang)}`),
  languages: () => jfetch<{ code: string; label: string }[]>('/api/v1/tts/languages'),
  createSession: (body: { title?: string; voice?: string; lang?: string }) =>
    jfetch<SessionInfo>('/api/v1/live/sessions', { method: 'POST', body: JSON.stringify(body) }),
  say: (sid: string, body: { text: string; voice?: string; lang?: string }) =>
    jfetch<SayResult>(`/api/v1/live/sessions/${sid}/say`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  answer: (
    sid: string,
    body: { question: string; voice?: string; lang?: string; context?: string; speak?: boolean },
  ) =>
    jfetch<AnswerResult>(`/api/v1/live/sessions/${sid}/answer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // 合成 mp3，返回可直接播放的 blob URL + TTS 延迟
  synthesize: async (body: {
    text: string;
    lang: string;
    voice: string;
  }): Promise<{ url: string; latencyMs: number; bytes: number }> => {
    const res = await fetch(`${API_BASE}/api/v1/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail || detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const blob = await res.blob();
    return {
      url: URL.createObjectURL(blob),
      latencyMs: Number(res.headers.get('X-TTS-Latency-Ms') || 0),
      bytes: blob.size,
    };
  },
};
