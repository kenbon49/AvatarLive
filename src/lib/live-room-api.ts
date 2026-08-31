import { API_BASE } from '@/lib/api';

export type LiveRoomGoodsItem = {
  id: number;
  name: string;
  source: string;
};

export type LiveRoomScriptItem = {
  id: number;
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
  state: 'ready' | 'playing' | 'done';
};

export type LiveRoomQaItem = { id: number; question: string; answer: string };

export type LiveRoomAssetItem = {
  id: string;
  kind: 'image' | 'video';
  name: string;
  preview?: string;
};

export type LiveRoomLayerItem = {
  id: string;
  kind: 'text' | 'image' | 'video' | 'host';
  value: string;
  sceneKey?: 'host' | 'custom' | 'templateBackground' | 'templateTitle' | 'templateTag' | 'templateFooter';
  preview?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  letterSpacing?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  strokeEnabled?: boolean;
  strokeColor?: string;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
};

export type LiveRoomOutputConfig = {
  resolution: string;
  frameRate: string;
  codec: string;
  protocol: string;
};

export type LiveRoomOptions = {
  qa: boolean;
  dynamic: boolean;
  ambience: boolean;
  product: boolean;
  replyLimit: number;
  replyMode: 'hybrid' | 'library';
};

export type LiveRoomConfig = {
  schemaVersion: 1;
  avatarId: string;
  voice: {
    voiceId: string;
    speed: number;
    pitch: number;
  };
  playbackMode: 'sequence' | 'random';
  goods: LiveRoomGoodsItem[];
  activeGoodsId: number;
  scripts: LiveRoomScriptItem[];
  qaItems: LiveRoomQaItem[];
  selectedTemplateId: string;
  layers: LiveRoomLayerItem[];
  liveOptions: LiveRoomOptions;
  outputConfig: LiveRoomOutputConfig;
  selectedPlatforms: string[];
  assets: Record<'image' | 'video', LiveRoomAssetItem[]>;
};

export type LiveRoom = {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'published';
  version: number;
  config: LiveRoomConfig;
  createdAt: string;
  updatedAt: string;
};

export class LiveRoomApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LiveRoomApiError';
  }
}

async function roomFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // Keep the HTTP status when the upstream did not return JSON.
    }
    throw new LiveRoomApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export function listLiveRooms(limit = 50): Promise<LiveRoom[]> {
  return roomFetch(`/api/v1/live-rooms?limit=${limit}`, { cache: 'no-store' });
}

export function createLiveRoom(name: string, config: LiveRoomConfig): Promise<LiveRoom> {
  return roomFetch('/api/v1/live-rooms', {
    method: 'POST',
    body: JSON.stringify({ name, config }),
  });
}

export function updateLiveRoom(room: LiveRoom, config: LiveRoomConfig, name = room.name): Promise<LiveRoom> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(room.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      expectedVersion: room.version,
      config,
    }),
  });
}

export function copyLiveRoom(room: LiveRoom, name?: string): Promise<LiveRoom> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(room.id)}/copy`, {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
}

export function publishLiveRoom(room: LiveRoom): Promise<LiveRoom> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(room.id)}/publish`, {
    method: 'POST',
  });
}
