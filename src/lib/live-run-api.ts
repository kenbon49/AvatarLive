import { API_BASE } from '@/lib/api';

export type LiveRunStatus = 'preparing' | 'ready' | 'starting' | 'live' | 'stopping' | 'stopped' | 'failed';
export type LiveRunTargetStatus = 'pending' | 'starting' | 'live' | 'stopping' | 'stopped' | 'failed';
export type LiveRunMediaSourceKind = 'browser_ingest' | 'test_pattern';

export type LiveRunMediaSource = {
  kind: LiveRunMediaSourceKind;
  sourceId?: string;
};

export type LiveRunPreflightCheck = {
  code: string;
  label: string;
  passed: boolean;
  message: string;
};

export type LiveRunPreflightResponse = {
  ready: boolean;
  liveRoomId: string;
  roomVersion?: number;
  mediaSourceKind: LiveRunMediaSourceKind;
  targetCount: number;
  checks: LiveRunPreflightCheck[];
  checkedAt: string;
};

export type LiveRunTarget = {
  id: string;
  platformConnectionId: string;
  connectionVersion: number;
  connectionName: string;
  platformLabel: string;
  streamKeyLast4: string;
  status: LiveRunTargetStatus;
  retryCount: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  stoppedAt?: string;
};

export type LiveRun = {
  id: string;
  requestId: string;
  liveRoomId: string;
  status: LiveRunStatus;
  roomVersion: number;
  mediaSourceKind: LiveRunMediaSourceKind;
  mediaSourceId?: string;
  legalSourceConfirmed: boolean;
  errorCode?: string;
  errorMessage?: string;
  heartbeatAt?: string;
  startedAt?: string;
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
  targets: LiveRunTarget[];
  ingest?: {
    protocol: 'whip';
    url: string;
    streamName: string;
  };
};

export class LiveRunApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LiveRunApiError';
  }
}

async function runFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: string | Array<{ msg?: string }> };
      detail = typeof body.detail === 'string'
        ? body.detail
        : body.detail?.map((item) => item.msg).filter(Boolean).join('；') || detail;
    } catch {
      // Keep the HTTP status when the upstream did not return JSON.
    }
    throw new LiveRunApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export function preflightLiveRun(input: {
  liveRoomId: string;
  expectedRoomVersion: number;
  legalSourceConfirmed: boolean;
  mediaSource?: LiveRunMediaSource;
}): Promise<LiveRunPreflightResponse> {
  return runFetch('/api/v1/live-runs/preflight', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      mediaSource: input.mediaSource ?? { kind: 'browser_ingest' },
    }),
  });
}

export function createLiveRun(input: {
  requestId: string;
  liveRoomId: string;
  expectedRoomVersion: number;
  legalSourceConfirmed: boolean;
  mediaSource?: LiveRunMediaSource;
}): Promise<LiveRun> {
  return runFetch('/api/v1/live-runs', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      mediaSource: input.mediaSource ?? { kind: 'browser_ingest' },
    }),
  });
}

export function getLiveRun(runId: string): Promise<LiveRun> {
  return runFetch(`/api/v1/live-runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
}

export function startLiveRun(runId: string): Promise<LiveRun> {
  return runFetch(`/api/v1/live-runs/${encodeURIComponent(runId)}/start`, { method: 'POST' });
}

export function stopLiveRun(runId: string): Promise<LiveRun> {
  return runFetch(`/api/v1/live-runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}
