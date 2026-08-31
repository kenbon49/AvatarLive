import { API_BASE } from '@/lib/api';

export type PlatformConnection = {
  id: string;
  kind: 'manual_rtmp';
  name: string;
  platformLabel: string;
  serverUrl: string;
  streamKeyLast4: string;
  status: 'enabled' | 'disabled';
  testStatus: 'untested' | 'passed' | 'failed';
  testMessage?: string;
  lastTestedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlatformConnectionInput = {
  name: string;
  platformLabel: string;
  serverUrl: string;
  streamKey: string;
};

export type UpdatePlatformConnectionInput = {
  name: string;
  platformLabel: string;
  serverUrl: string;
  streamKey?: string;
  status: PlatformConnection['status'];
};

export class PlatformConnectionApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PlatformConnectionApiError';
  }
}

async function connectionFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new PlatformConnectionApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export function listPlatformConnections(): Promise<PlatformConnection[]> {
  return connectionFetch('/api/v1/platform-connections', { cache: 'no-store' });
}

export function createPlatformConnection(
  input: CreatePlatformConnectionInput,
): Promise<PlatformConnection> {
  return connectionFetch('/api/v1/platform-connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePlatformConnection(
  connection: PlatformConnection,
  input: UpdatePlatformConnectionInput,
): Promise<PlatformConnection> {
  return connectionFetch(`/api/v1/platform-connections/${encodeURIComponent(connection.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, expectedVersion: connection.version }),
  });
}

export function testPlatformConnection(connection: PlatformConnection): Promise<PlatformConnection> {
  return connectionFetch(`/api/v1/platform-connections/${encodeURIComponent(connection.id)}/test`, {
    method: 'POST',
  });
}
