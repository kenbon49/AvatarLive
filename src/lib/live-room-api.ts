import { API_BASE } from '@/lib/api';

export type LiveRoomGoodsItem = {
  id: string | number;
  name: string;
  source: string;
  selectionId?: string;
  sourceType?: 'self_built' | 'platform' | 'script_library';
  platform?: string;
  platformAccountId?: string;
  platformStatus?: string;
  sku?: string;
  imageUrl?: string;
  price?: number;
  originalPrice?: number;
  sellingPoints?: string[];
  stockMessage?: string;
  afterSales?: string;
  platformProductId?: string;
  riskWords?: string[];
};

export type LiveRoomLibraryScript = {
  id: string;
  liveRoomId: string;
  productId?: string;
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
  tags: string[];
};

export type ProductCatalogItem = Omit<LiveRoomGoodsItem, 'id' | 'source' | 'selectionId'> & {
  id: string;
  sourceType: 'self_built' | 'platform' | 'script_library';
  platformStatus: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
};

export type LiveRoomProduct = ProductCatalogItem & {
  liveRoomId: string;
  selectionId: string;
  sortOrder: number;
  enabled: boolean;
  cardMode: 'visual' | 'native' | 'both';
};

export type ProductInput = Omit<ProductCatalogItem, 'id' | 'sourceType' | 'platform' | 'platformAccountId' | 'platformStatus' | 'createdAt' | 'updatedAt' | 'lastSyncedAt'>;

export type LiveRoomScriptItem = {
  id: number;
  productId?: string | number;
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
  chromaKeyEnabled?: boolean;
  chromaKeyColor?: string;
  chromaKeyTolerance?: number;
  chromaKeySoftness?: number;
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
  loopPlayback?: boolean;
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
  activeGoodsId: string | number;
  scripts: LiveRoomScriptItem[];
  qaItems: LiveRoomQaItem[];
  selectedTemplateId: string;
  layers: LiveRoomLayerItem[];
  liveOptions: LiveRoomOptions;
  outputConfig: LiveRoomOutputConfig;
  selectedPlatforms: string[];
  selectedPlatformConnectionIds: string[];
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

export async function listLiveRoomScripts(roomId: string): Promise<LiveRoomLibraryScript[]> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/scripts`, { cache: 'no-store' });
}

export async function createLiveRoomScript(roomId: string, script: Omit<LiveRoomLibraryScript, 'id' | 'liveRoomId'>): Promise<LiveRoomLibraryScript> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/scripts`, {
    method: 'POST',
    body: JSON.stringify(script),
  });
}

export async function listProductScripts(productId: string): Promise<LiveRoomLibraryScript[]> {
  return roomFetch(`/api/v1/products/${encodeURIComponent(productId)}/scripts`, { cache: 'no-store' });
}

export async function listLiveRoomProducts(roomId: string): Promise<LiveRoomProduct[]> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/products`, { cache: 'no-store' });
}

export async function createLiveRoomProduct(roomId: string, product: ProductInput): Promise<LiveRoomProduct> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/products`, {
    method: 'POST',
    body: JSON.stringify(product),
  });
}

export async function listProductCatalog(options: {
  query?: string;
  sourceType?: ProductCatalogItem['sourceType'];
  hasScripts?: boolean;
  offset?: number;
  limit?: number;
} = {}): Promise<ProductCatalogItem[]> {
  const params = new URLSearchParams({
    query: options.query ?? '',
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 100),
  });
  if (options.sourceType) params.set('sourceType', options.sourceType);
  if (options.hasScripts) params.set('hasScripts', 'true');
  return roomFetch(`/api/v1/products?${params.toString()}`, { cache: 'no-store' });
}

export async function createCatalogProduct(product: ProductInput): Promise<ProductCatalogItem> {
  return roomFetch('/api/v1/products', {
    method: 'POST',
    body: JSON.stringify({ ...product, sourceType: 'self_built' }),
  });
}

export async function attachLiveRoomProducts(roomId: string, productIds: string[]): Promise<LiveRoomProduct[]> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/product-selections`, {
    method: 'POST',
    body: JSON.stringify({ productIds }),
  });
}

export async function reorderLiveRoomProducts(roomId: string, selectionIds: string[]): Promise<LiveRoomProduct[]> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/product-selections/order`, {
    method: 'PUT',
    body: JSON.stringify({ selectionIds }),
  });
}

export async function updateLiveRoomProduct(roomId: string, productId: string, product: ProductInput): Promise<LiveRoomProduct> {
  return roomFetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: JSON.stringify(product),
  });
}

export async function detachLiveRoomProduct(roomId: string, productId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/live-rooms/${encodeURIComponent(roomId)}/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new LiveRoomApiError(`HTTP ${response.status}`, response.status);
}
