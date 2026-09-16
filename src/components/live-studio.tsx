'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  CheckSquare,
  ChevronDown,
  CircleStop,
  Copy,
  Cpu,
  FileSpreadsheet,
  FileText,
  FileUp,
  HardDrive,
  HelpCircle,
  GripVertical,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  Link2,
  LoaderCircle,
  Mic,
  MessageCircleQuestion,
  Pause,
  PackageOpen,
  Play,
  Plus,
  Pencil,
  Radio,
  RotateCcw,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SkipForward,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserRound,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  MuseTalkAvatarProfile,
  MuseTalkTotalStream,
  prepareMuseTalkSpeech,
  prepareMuseTalkVideos,
  lookupMuseTalkVideos,
} from '@/lib/musetalk-total-stream';
import { getPregeneratedLiveVideo } from '@/lib/pre-generated-live-videos';
import { ALIYUN_PUBLIC_VOICES, type AliyunVoiceLanguage } from '@/lib/aliyun-voice-catalog';
import {
  BrowserLivePublisher,
  layerChromaKeySettings,
  SceneCompositor,
  type BroadcastSceneSnapshot,
  type BrowserPublisherState,
} from '@/lib/browser-live-publisher';
import { ChromaKeyRenderer, type ChromaKeySettings } from '@/lib/chroma-key';
import {
  openWindowCaptureWindow,
  WindowCaptureSession,
  type WindowCaptureState,
} from '@/lib/window-capture-session';
import { ProductShell } from '@/components/product-shell';
import { PersonSegmentedImagePreview, type PersonImageSegmentationState } from '@/components/person-segmented-image-preview';
import { API_BASE } from '@/lib/api';
import {
  copyLiveRoom,
  createLiveRoom,
  deleteLiveRoom,
  listLiveRooms,
  listProductScripts,
  createLiveRoomScript,
  listLiveRoomProducts,
  listProductCatalog,
  createCatalogProduct,
  deleteCatalogProduct,
  attachLiveRoomProducts,
  reorderLiveRoomProducts,
  detachLiveRoomProduct,
  publishLiveRoom,
  updateLiveRoom,
  type LiveRoom,
  type LiveRoomConfig,
  type LiveRoomGoodsItem,
  type LiveRoomProduct,
  type ProductCatalogItem,
  type ProductInput,
} from '@/lib/live-room-api';
import {
  createLiveRun,
  getLiveRun,
  preflightLiveRun,
  startLiveRun,
  stopLiveRun,
  type LiveRun,
  type LiveRunPreflightResponse,
} from '@/lib/live-run-api';
import {
  createPlatformConnection,
  listPlatformConnections,
  runLocalRtmpSelfTest,
  testPlatformConnection,
  updatePlatformConnection,
  type LocalRtmpSelfTestResult,
  type PlatformConnection,
} from '@/lib/platform-connection-api';
import { LivePlaybackQueue, type PlaybackQueueStatus } from '@/lib/live-playback-queue';
import { MuseTalkMicrophoneStream } from '@/lib/musetalk-microphone';
import { buildDynamicScriptPrompt, DYNAMIC_SCRIPT_SYSTEM_PROMPT, dynamicScriptComparisonTexts, normalizeGeneratedScript, validateDynamicScript, type DynamicScriptOperation } from '@/lib/live-dynamic-script';
import { readLiveAiText } from '@/lib/live-ai-stream';
import { buildProductStarterScripts } from '@/lib/live-product-scripts';
import {
  buildProductScriptMessageContent,
  buildProductScriptPrompt,
  PRODUCT_SCRIPT_STYLES,
  PRODUCT_SCRIPT_SYSTEM_PROMPT,
  parseProductScripts,
  type ProductScriptDraft,
  type ProductScriptStyle,
} from '@/lib/live-product-ai';
import { layerZIndex } from '@/lib/live-layer-order';
import { ALIYUN_PUBLIC_AVATARS, LIVE_AVATARS as AVATARS, aliyunAvatarForCloudVideo } from '@/lib/live-avatar-catalog';
import { readStudioSetting, writeStudioSetting } from '@/lib/browser-studio-storage';
import { scriptAvatarVideoInputSignature, scriptAvatarVideoIsBusy } from '@/lib/script-avatar-video';
import { StoryboardScenePreview } from '@/components/storyboard-scene-preview';
import { SCRIPT_EDITOR_LIMIT, duplicateStoryboardScript, estimateScriptSeconds, formatScriptDuration, reviseStoryboardScript } from '@/lib/live-script-editor';
import { loadScriptPreviewAudio } from '@/lib/live-script-preview';
import { applyTemplateLayersPreservingHost, repairLegacyTemplateBackground } from '@/lib/live-template-layers';
import { waitForAvatarVideo } from '@/lib/live-video-batch';
import yijingTemplateCatalog from '@/data/yijing-template-catalog.json';
import yijingFontCatalog from '@/data/yijing-font-catalog.json';

type ScriptItem = {
  id: number;
  productId?: string | number;
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
  state: 'ready' | 'playing' | 'done';
  avatarVideo?: {
    taskId: string;
    inputSignature: string;
  };
};

type LayerItem = {
  id: string;
  kind: 'text' | 'image' | 'video' | 'host';
  value: string;
  sceneKey?: 'host' | 'custom' | 'templateBackground' | 'templateElement' | 'templateTitle' | 'templateTag' | 'templateFooter';
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
  strokeWidth?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundRadius?: number;
  chromaKeyEnabled?: boolean;
  chromaKeyColor?: string;
  chromaKeyTolerance?: number;
  chromaKeySoftness?: number;
};

const TEXT_RENDER_KEYS = new Set<keyof LayerItem>([
  'value', 'fontSize', 'color', 'fontFamily', 'letterSpacing', 'fontWeight', 'fontStyle',
  'textDecoration', 'textAlign', 'lineHeight', 'strokeEnabled', 'strokeColor', 'strokeWidth',
  'shadowEnabled', 'shadowColor', 'shadowBlur', 'shadowX', 'shadowY',
  'backgroundEnabled', 'backgroundColor', 'backgroundOpacity', 'backgroundRadius',
]);

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

type CanvasGesture = {
  mode: 'move' | 'resize' | 'rotate';
  pointerId: number;
  layerId: string;
  handle?: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  centerClientX: number;
  centerClientY: number;
  startPointerAngle: number;
};

type AssetItem = {
  id: string;
  kind: 'image' | 'video';
  name: string;
  preview?: string;
};

type QaItem = { id: number; question: string; answer: string };
type ImportedScriptItem = Omit<ScriptItem, 'id' | 'state'>;
type ImportedMaterialImage = { name: string; dataUrl: string };
type ScriptEditDraft = Pick<ScriptItem, 'title' | 'category' | 'text'>;
type ProductReferenceImage = { id: string; name: string; dataUrl: string };
type VoiceOption = {
  id: string;
  officialId: string;
  name: string;
  gender: '男性' | '女性';
  language: AliyunVoiceLanguage;
  description: string;
  supportSsml: boolean;
  sampleText: string;
  scope: 'public' | 'mine';
  providerName: string;
  previewAudio: string;
};

type AliyunVideoResult = {
  id: string;
  name: string;
  status: string;
  videoUrl: string;
  coverUrl: string;
  error?: string;
};

type ScriptVideoBatch = {
  scriptIds: number[];
  submitted: number;
  total: number;
  waiting?: boolean;
};

const ALIYUN_VIDEO_READY_STATES = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED']);
const ALIYUN_VIDEO_FAILED_STATES = new Set(['FAIL', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'EXPIRED']);

function aliyunVideoState(status: string) {
  const normalized = status.trim().toUpperCase();
  if (ALIYUN_VIDEO_READY_STATES.has(normalized)) return 'ready';
  if (ALIYUN_VIDEO_FAILED_STATES.has(normalized)) return 'failed';
  return 'processing';
}

type CloneVoiceDraft = {
  name: string;
  transcript: string;
  file: File | null;
  previewAudio: string;
};

type DialogName = 'settings' | 'voice' | 'livePlatform' | 'productPicker' | 'scriptImport' | null;
type SettingsTab = 'qa' | 'dynamic' | 'ambience' | 'product' | 'output' | 'environment';
type OutputConfig = { resolution: string; frameRate: string; codec: string; protocol: string };
type ProductPickerTab = 'platform' | 'script_library' | 'self_built';

const EMPTY_PRODUCT_DRAFT: ProductInput = {
  name: '',
  sku: '',
  imageUrl: undefined,
  price: undefined,
  originalPrice: undefined,
  sellingPoints: [],
  stockMessage: '',
  afterSales: '',
  platformProductId: '',
  riskWords: [],
};

function productSourceLabel(product: Pick<ProductCatalogItem, 'sourceType' | 'platform'>): string {
  if (product.sourceType === 'platform') return product.platform || '平台商品';
  if (product.sourceType === 'script_library') return '脚本库商品';
  return '自建商品';
}

function selectedProductToGoods(product: LiveRoomProduct): LiveRoomGoodsItem {
  return {
    id: product.id,
    selectionId: product.selectionId,
    source: productSourceLabel(product),
    sourceType: product.sourceType,
    platform: product.platform,
    platformAccountId: product.platformAccountId,
    platformStatus: product.platformStatus,
    name: product.name,
    sku: product.sku,
    imageUrl: product.imageUrl,
    price: product.price,
    originalPrice: product.originalPrice,
    sellingPoints: product.sellingPoints,
    stockMessage: product.stockMessage,
    afterSales: product.afterSales,
    platformProductId: product.platformProductId,
    riskWords: product.riskWords,
  };
}

export type LiveStudioInitialState = {
  autoDetectEnvironment?: boolean;
  dialog?: Extract<DialogName, 'settings' | 'voice'> | null;
  entered?: boolean;
  outputConfig?: OutputConfig;
  settingsTab?: SettingsTab;
};

const STUDIO_WORKSPACES = [
  { id: 'script', label: '脚本', icon: FileText },
  { id: 'host', label: '数字人', icon: UserRound },
  { id: 'decorate', label: '装修', icon: Layers3 },
] as const;

const DECORATION_TABS = [
  { id: 'template', label: '模板', icon: Layers3 },
  { id: 'image', label: '图片', icon: ImageIcon },
  { id: 'text', label: '文字', icon: Type },
] as const;

type StudioWorkspace = (typeof STUDIO_WORKSPACES)[number]['id'];
type MaterialTab = (typeof DECORATION_TABS)[number]['id'] | 'host';

type StudioTemplate = {
  id: string;
  name: string;
  image: string;
  category: string;
  color: string;
  title: string;
  tag: string;
  footer: string;
  custom?: boolean;
  source?: '百度一镜';
  layers?: LayerItem[];
  layersUrl?: string;
  pageCount?: number;
  categories?: string[];
  avatarId?: string;
  voice?: {
    voiceId: string;
    speed: number;
    pitch: number;
  };
};

type TemplateLayerDocument = {
  sourceId: number;
  pages: Array<{
    index: number;
    pageId: string;
    layers: LayerItem[];
  }>;
};

type ProductDemoStage = 'idle' | 'analyzing' | 'rendering' | 'ready' | 'failed';

const yijingPageCache = new Map<string, Promise<LayerItem[][]>>();

async function loadTemplatePages(template: StudioTemplate): Promise<LayerItem[][]> {
  if (template.layers?.length) return [template.layers];
  if (!template.layersUrl) return [];
  const cached = yijingPageCache.get(template.layersUrl);
  if (cached) return cached;
  const request = fetch(template.layersUrl).then(async (response) => {
    if (!response.ok) throw new Error(`模板图层读取失败（HTTP ${response.status}）`);
    const document = await response.json() as TemplateLayerDocument;
    if (!Array.isArray(document.pages) || !document.pages.length) throw new Error('模板不包含可用画布');
    return document.pages.map((page) => page.layers);
  }).catch((cause) => {
    yijingPageCache.delete(template.layersUrl!);
    throw cause;
  });
  yijingPageCache.set(template.layersUrl, request);
  return request;
}

const LIVE_TEMPLATES: StudioTemplate[] = [
  ...(yijingTemplateCatalog as Array<{
    id: string;
    name: string;
    image: string;
    category: string;
    categories: string[];
    color: string;
    pageCount: number;
    layersUrl: string;
  }>).map((template) => ({
    ...template,
    title: '',
    tag: '',
    footer: '',
    source: '百度一镜' as const,
  })),
];

const DEFAULT_LIVE_TEMPLATE = LIVE_TEMPLATES[0];
const DEFAULT_LIVE_TEMPLATE_ID = DEFAULT_LIVE_TEMPLATE.id;
const LEGACY_TEMPLATE_IDS = new Set(['home', 'sale', 'spring', 'food', 'study', 'snack', 'fruit', 'fashion']);

const CUSTOM_TEMPLATE_STORAGE_KEY = 'synlive.customTemplates.v1';
const ACTIVE_LIVE_ROOM_STORAGE_KEY = 'synlive.activeLiveRoom.v1';
const YIJING_BLANK_BACKGROUND = '/assets/xiling-live/yijing/blank.png';

const INITIAL_SCRIPTS: ScriptItem[] = [{
  id: 1,
  title: '主播口播 1',
  category: '开场',
  duration: '00:08',
  text: '欢迎来到直播间，今天为大家带来精选好物。',
  state: 'ready',
}];

const textLayerDefaults = {
  fontFamily: '默认字体',
  letterSpacing: 0,
  fontWeight: 'normal' as const,
  fontStyle: 'normal' as const,
  textDecoration: 'none' as const,
  textAlign: 'center' as const,
  lineHeight: 1.2,
  strokeEnabled: false,
  strokeColor: '#000000',
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowBlur: 8,
  shadowX: 4,
  shadowY: 4,
};

type TextMaterialStyle = {
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right';
  opacity: number;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
};

const DEFAULT_TEXT_MATERIAL_STYLE: TextMaterialStyle = {
  fontFamily: '默认字体',
  fontSize: 16,
  color: '#ffffff',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'center',
  opacity: 100,
  backgroundEnabled: true,
  backgroundColor: '#111827',
  backgroundOpacity: 72,
};

const LEGACY_FONT_FAMILIES: Record<string, string> = {
  '默认字体': "'Noto Sans SC', sans-serif",
  '思源黑体': "'SiYuanHeiTi', 'Noto Sans SC', sans-serif",
  '思源宋体': "'SiYuanSongTi', 'Noto Serif SC', serif",
  '站酷快乐体': "'Noto Sans SC', sans-serif",
};
const FONT_OPTIONS = [
  { value: '默认字体', label: '默认字体' },
  { value: '思源黑体', label: '思源黑体' },
  { value: '思源宋体', label: '思源宋体' },
  { value: '站酷快乐体', label: '站酷快乐体' },
  ...(yijingFontCatalog as Array<{ value: string; label: string; family: string; path: string | null }>),
];
const fontFamilyCss = (value = '默认字体') => {
  const legacy = LEGACY_FONT_FAMILIES[value];
  if (legacy) return legacy;
  const imported = (yijingFontCatalog as Array<{ value: string; family: string }>).find(font => font.value === value);
  const family = imported?.family ?? value;
  return `'${family.replaceAll("'", "\\'")}', 'Noto Sans SC', sans-serif`;
};
const FONT_FAMILIES = Object.fromEntries(FONT_OPTIONS.map(font => [font.value, fontFamilyCss(font.value)]));
const canvasFontSize = (value = 16) => `${roundCanvasValue(value / 3.78)}cqw`;

const roundCanvasValue = (value: number) => Math.round(value * 10) / 10;
const clampCanvasValue = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

const colorWithOpacity = (color: string, opacity = 100) => {
  const normalized = color.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(normalized)) return color;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clampCanvasValue(opacity, 0, 100) / 100})`;
};

function parseCustomTemplates(value: string | null): StudioTemplate[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StudioTemplate => {
      if (!item || typeof item !== 'object') return false;
      const template = item as Partial<StudioTemplate>;
      return typeof template.id === 'string'
        && typeof template.name === 'string'
        && typeof template.image === 'string'
        && Array.isArray(template.layers);
    }).map((template) => ({
      ...template,
      category: '自定义',
      color: '自定义',
      title: template.title || '',
      tag: template.tag || '',
      footer: template.footer || '',
      custom: true,
      layers: template.layers?.map((layer) => ({ ...layer })),
    }));
  } catch {
    return [];
  }
}

const fileAsDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
  reader.onerror = () => reject(new Error('图片读取失败'));
  reader.readAsDataURL(file);
});

async function imageSourceAsDataUrl(source: string): Promise<string> {
  if (source.startsWith('data:image/')) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error('当前商品图片读取失败');
  return fileAsDataUrl(await response.blob());
}

async function prepareProductReferenceImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 10 * 1024 * 1024) throw new Error('商品图片不能超过 10 MB');
  if (typeof createImageBitmap !== 'function') return fileAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  try {
    // Preserve readable package text whenever the original already fits the multimodal request limit.
    if (file.size <= 5.5 * 1024 * 1024 && Math.max(bitmap.width, bitmap.height) <= 2048) {
      return fileAsDataUrl(file);
    }
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return fileAsDataUrl(file);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return fileAsDataUrl(compressed ?? file);
  } finally {
    bitmap.close();
  }
}

async function prepareTemplateBackground(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 15 * 1024 * 1024) throw new Error('模板背景不能超过 15 MB');
  if (typeof createImageBitmap !== 'function') return fileAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  try {
    const targetWidth = 540;
    const targetHeight = 960;
    const scale = Math.max(targetWidth / bitmap.width, targetHeight / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return fileAsDataUrl(file);
    context.drawImage(bitmap, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
    const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    return fileAsDataUrl(compressed ?? file);
  } finally {
    bitmap.close();
  }
}

const formatSavedAt = (value: string) => new Date(value).toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const createTemplateLayers = (templateId: string, avatarName: string): LayerItem[] => {
  const template = LIVE_TEMPLATES.find((item) => item.id === templateId) ?? DEFAULT_LIVE_TEMPLATE;
  return [
    { id: `title-${template.id}`, kind: 'text', value: template.title, sceneKey: 'templateTitle', x: 50, y: 15, width: 76, height: 12, rotation: 0, opacity: 100, fontSize: 26, color: '#ffffff', ...textLayerDefaults, fontWeight: 'bold' },
    { id: `tag-${template.id}`, kind: 'text', value: template.tag, sceneKey: 'templateTag', x: 50, y: 23, width: 56, height: 7, rotation: 0, opacity: 100, fontSize: 13, color: '#ffffff', ...textLayerDefaults },
    { id: `footer-${template.id}`, kind: 'text', value: template.footer, sceneKey: 'templateFooter', x: 50, y: 91, width: 72, height: 8, rotation: 0, opacity: 100, fontSize: 18, color: '#ffffff', ...textLayerDefaults },
    {
      id: 'host',
      kind: 'host',
      value: avatarName,
      sceneKey: 'host',
      x: 50,
      y: 64,
      width: 76,
      height: 70,
      rotation: 0,
      opacity: 100,
      chromaKeyEnabled: false,
      chromaKeyColor: '#ffffff',
      chromaKeyTolerance: 4,
      chromaKeySoftness: 6,
    },
    { id: `background-${template.id}`, kind: 'image', value: '场景背景', sceneKey: 'templateBackground', preview: template.source === '百度一镜' ? YIJING_BLANK_BACKGROUND : template.image, x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 },
  ];
};

const INITIAL_LAYERS = createTemplateLayers(DEFAULT_LIVE_TEMPLATE_ID, '灵婉');

const SQUARE_ASSETS: Record<'image' | 'video', AssetItem[]> = {
  image: [
    { id: 'square-image-1', kind: 'image', name: '咖啡氛围图', preview: '/assets/xiling-live/product.jpg' },
    { id: 'square-image-2', kind: 'image', name: '直播装饰图', preview: DEFAULT_LIVE_TEMPLATE.image },
    { id: 'square-image-3', kind: 'image', name: '福利贴纸' },
    { id: 'square-image-4', kind: 'image', name: '新品推荐' },
  ],
  video: [
    { id: 'square-video-1', kind: 'video', name: '直播开场视频' },
    { id: 'square-video-2', kind: 'video', name: '商品展示视频' },
    { id: 'square-video-3', kind: 'video', name: '福利提醒视频' },
    { id: 'square-video-4', kind: 'video', name: '关注引导视频' },
  ],
};

const SETTINGS_TABS = [
  { id: 'qa', label: 'AI 弹幕问答', icon: MessageCircleQuestion },
  { id: 'dynamic', label: 'AI 动态话术', icon: WandSparkles },
  { id: 'ambience', label: 'AI 氛围互动', icon: Sparkles },
  { id: 'product', label: '随讲解弹商品卡', icon: ImageIcon },
  { id: 'output', label: '输出与画质', icon: Video },
  { id: 'environment', label: '环境检查', icon: ShieldCheck },
] as const;

const PLATFORMS = [
  { name: '抖音', logo: '/assets/brand-logos/douyin.svg', color: '#111111' },
  { name: '美团', logo: '/assets/brand-logos/meituan.svg', color: '#ffc72c' },
  { name: '快手', logo: '/assets/brand-logos/kuaishou.svg', color: '#ff4e22' },
  { name: '京东', logo: '/assets/brand-logos/jd.svg', color: '#e1251b' },
  { name: '淘宝', logo: '/assets/brand-logos/taobao.svg', color: '#ff5000' },
  { name: '拼多多', logo: '/assets/brand-logos/pinduoduo.svg', color: '#e02e24' },
  { name: '唯品会', logo: '/assets/brand-logos/vipshop.svg', color: '#d62f7f' },
  { name: '小红书', logo: '/assets/brand-logos/xiaohongshu.svg', color: '#ff2442' },
] as const;

const FEATURED_LIVE_AVATAR_ID = 'aliyun-M1xuUWr440XEDhA6QPRvRiDQ';
const FEATURED_LIVE_AVATAR_NAME = '灵婉';
const DEFAULT_VOICE_ID = 'longbaizhi';

const VOICES: VoiceOption[] = ALIYUN_PUBLIC_VOICES.map((voice) => ({
  ...voice,
  scope: 'public',
  providerName: '官方音色',
}));

const createDefaultRoomConfig = (selectedAvatarId = FEATURED_LIVE_AVATAR_ID): LiveRoomConfig => {
  const selectedAvatar = AVATARS.find((item) => item.id === selectedAvatarId)
    ?? AVATARS.find((item) => item.id === FEATURED_LIVE_AVATAR_ID)
    ?? AVATARS[0];
  return ({
  schemaVersion: 1,
  avatarId: selectedAvatar.id,
  voice: { voiceId: DEFAULT_VOICE_ID, speed: 1.1, pitch: 3 },
  playbackMode: 'sequence',
  goods: [{ id: 1, name: '未命名商品', source: '自建商品' }],
  activeGoodsId: 1,
  scripts: INITIAL_SCRIPTS.map((item) => ({ ...item, state: 'ready' })),
  qaItems: [],
  selectedTemplateId: DEFAULT_LIVE_TEMPLATE_ID,
  selectedTemplatePage: 0,
  layers: createTemplateLayers(DEFAULT_LIVE_TEMPLATE_ID, selectedAvatar.name),
  liveOptions: { qa: true, dynamic: true, ambience: false, product: false, replyLimit: 5, replyMode: 'hybrid', loopPlayback: true },
  outputConfig: { resolution: '1080p', frameRate: '25 fps', codec: 'H.264', protocol: 'RTMP' },
  selectedPlatforms: [],
  selectedPlatformConnectionIds: [],
  assets: { image: [], video: [] },
  importedMaterialImages: [],
  });
};

type RtmpConnectionDraft = {
  name: string;
  platformLabel: string;
  serverUrl: string;
  streamKey: string;
  status: PlatformConnection['status'];
};

const EMPTY_RTMP_DRAFT: RtmpConnectionDraft = {
  name: '',
  platformLabel: '通用 RTMP',
  serverUrl: 'rtmp://',
  streamKey: '',
  status: 'enabled',
};

function ChromaKeyHostPreview({
  src,
  settings,
  className,
  style,
  label,
}: {
  src: string;
  settings: ChromaKeySettings;
  className: string;
  style: CSSProperties;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ChromaKeyRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = rendererRef.current ?? new ChromaKeyRenderer(canvas);
    rendererRef.current = renderer;
    const image = new Image();
    let cancelled = false;
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      renderer.render(image, image.naturalWidth, image.naturalHeight, settings);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [settings.color, settings.enabled, settings.softness, settings.tolerance, src]);

  return <canvas ref={canvasRef} className={className} style={style} role="img" aria-label={label} />;
}

function ChromaKeyVideoPreview({
  src,
  poster,
  settings,
  autoDetectColor,
  trimBottom,
  className,
  style,
  label,
}: {
  src: string;
  poster?: string;
  settings: ChromaKeySettings;
  autoDetectColor: boolean;
  trimBottom?: number;
  className: string;
  style: CSSProperties;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const renderer = new ChromaKeyRenderer(canvas);
    const keyCanvases = Array.from({ length: 4 }, () => document.createElement('canvas'));
    const keyRenderers = [...keyCanvases.map((item) => new ChromaKeyRenderer(item)), renderer];
    let cancelled = false;
    let detectedColors = [settings.color, '#b8bbc8', '#b5b8c5', '#b1b4c1', '#f2f2f4'];
    let videoFrameHandle: number | null = null;
    let animationFrameHandle: number | null = null;
    const timedVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const renderSource = (source: HTMLImageElement | HTMLVideoElement, width: number, height: number) => {
      const scale = Math.min(1, 1920 / Math.max(width, height));
      const renderWidth = width * scale;
      const renderHeight = height * scale;
      if (autoDetectColor) {
        let inputSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement = source;
        detectedColors.forEach((color, index) => {
          keyRenderers[index].render(inputSource, renderWidth, renderHeight, {
            enabled: true,
            color,
            tolerance: index === detectedColors.length - 1 ? 6 : 3.5,
            softness: index === detectedColors.length - 1 ? 5 : 3.5,
          });
          if (index < keyCanvases.length) inputSource = keyCanvases[index];
        });
        if (trimBottom) {
          const context = canvas.getContext('2d');
          if (context) {
            const cleanupTop = Math.floor(canvas.height * 0.66);
            const cleanupBottom = Math.ceil(canvas.height * trimBottom);
            try {
              const image = context.getImageData(0, cleanupTop, canvas.width, cleanupBottom - cleanupTop);
              for (let index = 0; index < image.data.length; index += 4) {
                const red = image.data[index];
                const green = image.data[index + 1];
                const blue = image.data[index + 2];
                const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
                const brightness = (red + green + blue) / 3;
                if (brightness > 145 && spread < 26) image.data[index + 3] = 0;
              }
              context.putImageData(image, 0, cleanupTop);
            } catch {
              // Keep the keyed frame when a remote video blocks pixel reads.
            }
            context.clearRect(0, canvas.height * trimBottom, canvas.width, canvas.height * (1 - trimBottom));
          }
        }
        return;
      }
      renderer.render(source, renderWidth, renderHeight, settings);
    };
    const detectBackgroundColors = (source: HTMLImageElement | HTMLVideoElement, width: number, height: number) => {
      if (!autoDetectColor || !width || !height) return;
      const sample = document.createElement('canvas');
      sample.width = 32;
      sample.height = 2;
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      try {
        const sampleStrip = (sourceY: number) => {
          context.clearRect(0, 0, sample.width, sample.height);
          const edgeWidth = Math.max(1, width * 0.025);
          const stripHeight = Math.max(1, height * 0.02);
          context.drawImage(source, 0, sourceY, edgeWidth, stripHeight, 0, 0, sample.width / 2, sample.height);
          context.drawImage(source, width - edgeWidth, sourceY, edgeWidth, stripHeight, sample.width / 2, 0, sample.width / 2, sample.height);
          const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
          let red = 0;
          let green = 0;
          let blue = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            red += pixels[index];
            green += pixels[index + 1];
            blue += pixels[index + 2];
          }
          const count = pixels.length / 4;
          return `#${[red, green, blue].map((value) => Math.round(value / count).toString(16).padStart(2, '0')).join('')}`;
        };
        detectedColors = [0.02, 0.24, 0.46, 0.68, 0.97].map((position) => sampleStrip(height * position));
      } catch {
        // Cross-origin generated videos fall back to the catalog background color.
      }
    };
    const scheduleFrame = () => {
      if (cancelled || video.paused || video.ended || videoFrameHandle !== null || animationFrameHandle !== null) return;
      if (timedVideo.requestVideoFrameCallback) {
        videoFrameHandle = timedVideo.requestVideoFrameCallback(() => {
          videoFrameHandle = null;
          drawFrame();
        });
      } else {
        animationFrameHandle = window.requestAnimationFrame(() => {
          animationFrameHandle = null;
          drawFrame();
        });
      }
    };
    const drawFrame = () => {
      if (cancelled) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        renderSource(video, video.videoWidth, video.videoHeight);
      }
      scheduleFrame();
    };
    const startPlayback = () => {
      detectBackgroundColors(video, video.videoWidth, video.videoHeight);
      drawFrame();
      void video.play().catch(() => undefined);
    };

    if (poster) {
      const image = new Image();
      image.decoding = 'async';
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (!cancelled) {
          detectBackgroundColors(image, image.naturalWidth, image.naturalHeight);
          renderSource(image, image.naturalWidth, image.naturalHeight);
        }
      };
      image.src = poster;
    }
    video.addEventListener('loadeddata', startPlayback);
    video.addEventListener('play', scheduleFrame);
    video.src = src;
    video.load();
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) startPlayback();

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', startPlayback);
      video.removeEventListener('play', scheduleFrame);
      if (videoFrameHandle !== null) timedVideo.cancelVideoFrameCallback?.(videoFrameHandle);
      if (animationFrameHandle !== null) window.cancelAnimationFrame(animationFrameHandle);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [autoDetectColor, poster, settings.color, settings.enabled, settings.softness, settings.tolerance, src, trimBottom]);

  return <>
    <video ref={videoRef} muted loop playsInline crossOrigin="anonymous" aria-hidden="true" style={{ position: 'fixed', left: '-2px', top: '-2px', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    <canvas ref={canvasRef} className={className} style={style} role="img" aria-label={label} />
  </>;
}

function validateRtmpDraft(draft: RtmpConnectionDraft, editing: boolean): string | null {
  if (!draft.name.trim()) return '请填写连接名称';
  if (!draft.platformLabel.trim()) return '请填写平台备注';
  if (!draft.serverUrl.trim() || draft.serverUrl.trim() === 'rtmp://') return '请填写完整的 RTMP 服务器地址';
  try {
    const parsed = new URL(draft.serverUrl.trim());
    if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)) return 'RTMP 服务器地址必须以 rtmp:// 或 rtmps:// 开头';
    if (!parsed.hostname) return 'RTMP 服务器地址缺少主机名';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return '服务器地址不能包含账号、密码、查询参数或推流密钥；请将密钥单独填写在下方';
    }
  } catch {
    return 'RTMP 服务器地址格式不正确，例如 rtmp://push.example.com/live';
  }
  if (!editing && !draft.streamKey.trim()) return '新建连接时必须填写推流密钥';
  return null;
}

const ACTIVE_LIVE_RUN_STORAGE_KEY = 'synlive.activeLiveRunId';

export function LiveStudio({
  autoDetectEnvironment = false,
  dialog: initialDialog = null,
  entered: initialEntered = false,
  outputConfig: initialOutputConfig,
  settingsTab: initialSettingsTab = 'qa',
}: LiveStudioInitialState = {}) {
  const [entered, setEntered] = useState(initialEntered);
  const [avatarId, setAvatarId] = useState(FEATURED_LIVE_AVATAR_ID);
  const avatar = AVATARS.find((item) => item.id === avatarId) ?? AVATARS[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const canvasGestureRef = useRef<CanvasGesture | null>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const playbackQueueRef = useRef<LivePlaybackQueue<number> | null>(null);
  const microphoneRef = useRef<MuseTalkMicrophoneStream | null>(null);
  const resumeQueueAfterMicrophoneRef = useRef(false);
  const browserPublisherRef = useRef<BrowserLivePublisher | null>(null);
  const captureCompositorRef = useRef<SceneCompositor | null>(null);
  const windowCaptureSessionRef = useRef<WindowCaptureSession | null>(null);
  const capturePopupRef = useRef<Window | null>(null);
  const broadcastSceneRef = useRef<BroadcastSceneSnapshot | null>(null);
  const runRecoveryAttemptedRef = useRef(false);
  const [mediaActive, setMediaActive] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [stage, setStage] = useState('idle');
  const [preparedVideoProgress, setPreparedVideoProgress] = useState<{ ready: number; total: number } | null>(null);
  const [onAir, setOnAir] = useState(false);
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [liveRunPreflight, setLiveRunPreflight] = useState<LiveRunPreflightResponse | null>(null);
  const [liveRunBusy, setLiveRunBusy] = useState(false);
  const [browserPublisherState, setBrowserPublisherState] = useState<BrowserPublisherState>('stopped');
  const [browserPublisherMessage, setBrowserPublisherMessage] = useState('');
  const [publishMode, setPublishMode] = useState<'window_capture' | 'manual_rtmp'>('window_capture');
  const [captureOrientation, setCaptureOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [windowCaptureState, setWindowCaptureState] = useState<WindowCaptureState>('stopped');
  const [windowCaptureMessage, setWindowCaptureMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomSaving, setRoomSaving] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [roomActionBusy, setRoomActionBusy] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [landingCreateOpen, setLandingCreateOpen] = useState(false);
  const [landingRoomName, setLandingRoomName] = useState('');
  const [landingAvatarId, setLandingAvatarId] = useState(FEATURED_LIVE_AVATAR_ID);
  const [landingAvatarQuery, setLandingAvatarQuery] = useState('');
  const [landingRoomCreating, setLandingRoomCreating] = useState(false);
  const [landingRoomError, setLandingRoomError] = useState('');
  const [renameRoomName, setRenameRoomName] = useState('');
  const [editingRoomName, setEditingRoomName] = useState(false);
  const [savedConfigSignature, setSavedConfigSignature] = useState('');
  const roomInitializationRef = useRef(false);
  const [dialog, setDialog] = useState<DialogName>(initialEntered ? initialDialog : null);
  const [studioWorkspace, setStudioWorkspace] = useState<StudioWorkspace>('script');
  const [materialTab, setMaterialTab] = useState<MaterialTab>('template');
  const [scripts, setScripts] = useState<ScriptItem[]>(INITIAL_SCRIPTS);
  const [draft, setDraft] = useState('');
  const [storyboardScriptId, setStoryboardScriptId] = useState<number | null>(null);
  const newScriptDraftRef = useRef('');
  const [batchMode, setBatchMode] = useState(false);
  const [selectedScriptIds, setSelectedScriptIds] = useState<number[]>([]);
  const [voiceTab, setVoiceTab] = useState<'public' | 'mine'>('public');
  const [voices, setVoices] = useState<VoiceOption[]>(VOICES);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [voiceGender, setVoiceGender] = useState<'全部性别' | VoiceOption['gender']>('全部性别');
  const [voiceLanguage, setVoiceLanguage] = useState<'全部语言' | AliyunVoiceLanguage>('全部语言');
  const [selectedVoiceId, setSelectedVoiceId] = useState(DEFAULT_VOICE_ID);
  const [pendingVoiceId, setPendingVoiceId] = useState(DEFAULT_VOICE_ID);
  const [voiceSpeed, setVoiceSpeed] = useState(1.1);
  const [voicePitch, setVoicePitch] = useState(3);
  const [pendingVoiceSpeed, setPendingVoiceSpeed] = useState(1.1);
  const [pendingVoicePitch, setPendingVoicePitch] = useState(3);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [previewVoiceLoadingId, setPreviewVoiceLoadingId] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewGenerationRef = useRef(0);
  const generatedVideoRef = useRef<HTMLVideoElement | null>(null);
  const generatedVideoPlaybackRequestRef = useRef<string | null>(null);
  const generatedVideoCaptureRef = useRef<MediaStream | null>(null);
  const [aliyunVideo, setAliyunVideo] = useState<AliyunVideoResult | null>(null);
  const [aliyunVideoSubmitting, setAliyunVideoSubmitting] = useState(false);
  const [aliyunVideoError, setAliyunVideoError] = useState('');
  const [scriptVideoResults, setScriptVideoResults] = useState<Record<number, AliyunVideoResult>>({});
  const [scriptVideoSubmissionErrors, setScriptVideoSubmissionErrors] = useState<Record<number, string>>({});
  const [scriptVideoBatch, setScriptVideoBatch] = useState<ScriptVideoBatch | null>(null);
  const scriptVideoBatchAbortRef = useRef<AbortController | null>(null);
  const [productDemoStage, setProductDemoStage] = useState<ProductDemoStage>('idle');
  const [productDemoMessage, setProductDemoMessage] = useState('');
  const [generatedVideoVisible, setGeneratedVideoVisible] = useState(false);
  const [generatedVideoPlaying, setGeneratedVideoPlaying] = useState(false);
  const cloneVoiceInputRef = useRef<HTMLInputElement>(null);
  const [cloneVoice, setCloneVoice] = useState<CloneVoiceDraft>({ name: '', transcript: '', file: null, previewAudio: '' });
  const [cloneProgress, setCloneProgress] = useState<'idle' | 'cloning' | 'ready'>('idle');
  const [cloneError, setCloneError] = useState('');
  const [playbackMode, setPlaybackMode] = useState<'sequence' | 'random'>('sequence');
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [playbackLoop, setPlaybackLoop] = useState(true);
  const [personImageState, setPersonImageState] = useState<PersonImageSegmentationState>('loading');
  const [playbackQueueStatus, setPlaybackQueueStatus] = useState<PlaybackQueueStatus>('idle');
  const [currentPlaybackScriptId, setCurrentPlaybackScriptId] = useState<number | null>(null);
  const [microphoneState, setMicrophoneState] = useState<'idle' | 'connecting' | 'recording' | 'submitting'>('idle');
  const [goods, setGoods] = useState<LiveRoomConfig['goods']>([{ id: 1, name: '清雷茉莉银针茶', source: '商品' }]);
  const [activeGoodsId, setActiveGoodsId] = useState<string | number>(1);
  const [productPickerTab, setProductPickerTab] = useState<ProductPickerTab>('self_built');
  const [productCatalog, setProductCatalog] = useState<ProductCatalogItem[]>([]);
  const [productCatalogResultIds, setProductCatalogResultIds] = useState<string[]>([]);
  const [productCatalogRefreshVersion, setProductCatalogRefreshVersion] = useState(0);
  const [productCatalogLoading, setProductCatalogLoading] = useState(false);
  const [productCatalogError, setProductCatalogError] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [selectedCatalogProductIds, setSelectedCatalogProductIds] = useState<string[]>([]);
  const [productDraft, setProductDraft] = useState<ProductInput>(EMPTY_PRODUCT_DRAFT);
  const [productDraftSellingPoints, setProductDraftSellingPoints] = useState('');
  const [productDraftRiskWords, setProductDraftRiskWords] = useState('');
  const [productReferenceDocumentName, setProductReferenceDocumentName] = useState('');
  const [productReferenceText, setProductReferenceText] = useState('');
  const [productReferenceImages, setProductReferenceImages] = useState<ProductReferenceImage[]>([]);
  const [productGeneratedScripts, setProductGeneratedScripts] = useState<ProductScriptDraft[]>([]);
  const [productScriptCount, setProductScriptCount] = useState(3);
  const [productScriptMaxCharacters, setProductScriptMaxCharacters] = useState(180);
  const [productScriptStyle, setProductScriptStyle] = useState<ProductScriptStyle>('自然亲切');
  const [productScriptDirection, setProductScriptDirection] = useState('');
  const [pendingProductScripts, setPendingProductScripts] = useState<Record<string, ProductScriptDraft[]>>({});
  const [productDraftGenerating, setProductDraftGenerating] = useState(false);
  const [productDraftSaving, setProductDraftSaving] = useState(false);
  const [productSelectionSaving, setProductSelectionSaving] = useState(false);
  const [productRemovingId, setProductRemovingId] = useState<string | number | null>(null);
  const [catalogProductToDelete, setCatalogProductToDelete] = useState<ProductCatalogItem | null>(null);
  const [catalogProductDeleting, setCatalogProductDeleting] = useState(false);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateCategory, setTemplateCategory] = useState('全部');
  const [templateColor, setTemplateColor] = useState('全部');
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_LIVE_TEMPLATE_ID);
  const [selectedTemplatePage, setSelectedTemplatePage] = useState(0);
  const [templateLoadingId, setTemplateLoadingId] = useState('');
  const [templateLoadError, setTemplateLoadError] = useState('');
  const [visibleTemplateCount, setVisibleTemplateCount] = useState(80);
  const templateRequestIdRef = useRef(0);
  const [customTemplates, setCustomTemplates] = useState<StudioTemplate[]>([]);
  const [customTemplatesLoaded, setCustomTemplatesLoaded] = useState(false);
  const [templateDraftMode, setTemplateDraftMode] = useState<'new' | null>(null);
  const [templateDraftName, setTemplateDraftName] = useState('');
  const [templateDraftBackground, setTemplateDraftBackground] = useState('');
  const [templateDraftBusy, setTemplateDraftBusy] = useState(false);
  const [templateStorageError, setTemplateStorageError] = useState('');
  const [hostFilters, setHostFilters] = useState({ gender: '全部', scene: '全部场景' });
  const [assetScope, setAssetScope] = useState<'mine' | 'square'>('mine');
  const [assetQuery, setAssetQuery] = useState('');
  const [assets, setAssets] = useState<Record<'image' | 'video', AssetItem[]>>({ image: [], video: [] });
  const [assetBatchMode, setAssetBatchMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const productDocumentInputRef = useRef<HTMLInputElement>(null);
  const productImageInputRef = useRef<HTMLInputElement>(null);
  const materialsScrollRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLDivElement>(null);
  const [customText, setCustomText] = useState('直播间专属福利');
  const [customTextStyle, setCustomTextStyle] = useState<TextMaterialStyle>(DEFAULT_TEXT_MATERIAL_STYLE);
  const [layers, setLayers] = useState<LayerItem[]>(INITIAL_LAYERS);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [inspectorLayerId, setInspectorLayerId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [layerDropTarget, setLayerDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [canvasGestureMode, setCanvasGestureMode] = useState<CanvasGesture['mode'] | null>(null);
  const [previewHelp, setPreviewHelp] = useState(false);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [dynamicGenerating, setDynamicGenerating] = useState(false);
  const [scriptRewriteMode, setScriptRewriteMode] = useState<DynamicScriptOperation>('expand');
  const [draftPreviewState, setDraftPreviewState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const draftPreviewing = draftPreviewState !== 'idle';
  const draftPreviewStateRef = useRef(draftPreviewState);
  const draftPreviewControlBusyRef = useRef(false);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const draftPreviewGenerationRef = useRef(0);
  const draftPreviewAbortRef = useRef<AbortController | null>(null);
  const draftAudioContextRef = useRef<AudioContext | null>(null);
  const draftAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const draftAudioResolveRef = useRef<(() => void) | null>(null);
  const [editingScriptId, setEditingScriptId] = useState<number | null>(null);
  const [scriptEditDraft, setScriptEditDraft] = useState<ScriptEditDraft>({ title: '', category: '讲品', text: '' });
  const [settingsTab, setSettingsTab] = useState<(typeof SETTINGS_TABS)[number]['id']>(initialSettingsTab);
  const [liveOptions, setLiveOptions] = useState<LiveRoomConfig['liveOptions']>({ qa: true, dynamic: true, ambience: false, product: false, replyLimit: 5, replyMode: 'hybrid', loopPlayback: true });
  const [outputConfig, setOutputConfig] = useState<OutputConfig>(initialOutputConfig ?? { resolution: '1080p', frameRate: '25 fps', codec: 'H.264', protocol: 'RTMP' });
  const [environmentCheckedAt, setEnvironmentCheckedAt] = useState('尚未检测');
  const [environmentInfo, setEnvironmentInfo] = useState({ browser: '待检测', cpu: '待检测', gpu: '待检测' });
  const autoEnvironmentChecked = useRef(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedPlatformConnectionIds, setSelectedPlatformConnectionIds] = useState<string[]>([]);
  const [mediaSourceKind, setMediaSourceKind] = useState<'browser_ingest' | 'test_pattern'>('browser_ingest');
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformConnectionsLoading, setPlatformConnectionsLoading] = useState(false);
  const [platformActionId, setPlatformActionId] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState('');
  const [localRtmpSelfTestResult, setLocalRtmpSelfTestResult] = useState<LocalRtmpSelfTestResult | null>(null);
  const [localRtmpSelfTestError, setLocalRtmpSelfTestError] = useState('');
  const [rtmpFormOpen, setRtmpFormOpen] = useState(false);
  const [editingPlatformConnectionId, setEditingPlatformConnectionId] = useState<string | null>(null);
  const [rtmpDraft, setRtmpDraft] = useState<RtmpConnectionDraft>(EMPTY_RTMP_DRAFT);
  const [streamKeyVisible, setStreamKeyVisible] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [importedDocumentName, setImportedDocumentName] = useState('');
  const [importedDocumentText, setImportedDocumentText] = useState('');
  const [importedMaterialImages, setImportedMaterialImages] = useState<ImportedMaterialImage[]>([]);
  const [importedScripts, setImportedScripts] = useState<ImportedScriptItem[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    if (storyboardScriptId === null || scripts.some(item => item.id === storyboardScriptId)) return;
    const next = scripts[0];
    setStoryboardScriptId(next?.id ?? null);
    setDraft(next?.text ?? newScriptDraftRef.current);
    setGeneratedVideoVisible(false);
  }, [scripts, storyboardScriptId]);

  const activeGoods = goods.find((item) => item.id === activeGoodsId) ?? goods[0];
  const activeProductScripts = scripts.filter((item) => item.productId === undefined || item.productId === activeGoods?.id);
  const visibleCatalogProducts = productCatalogResultIds.flatMap((id) => {
    const product = productCatalog.find((item) => item.id === id);
    return product ? [product] : [];
  });
  const selectedProductSummary: Array<ProductCatalogItem | LiveRoomGoodsItem> = selectedCatalogProductIds.map((id) => {
    const catalogProduct = productCatalog.find((item) => item.id === id);
    if (catalogProduct) return catalogProduct;
    return goods.find((item) => item.id === id);
  }).filter((product): product is ProductCatalogItem | LiveRoomGoodsItem => Boolean(product));
  const allTemplates = useMemo(() => [...LIVE_TEMPLATES, ...customTemplates], [customTemplates]);
  const selectedTemplate = allTemplates.find((item) => item.id === selectedTemplateId) ?? DEFAULT_LIVE_TEMPLATE;
  const matchingTemplates = useMemo(() => allTemplates.filter((item) => (
    item.name.includes(templateQuery.trim())
    && (templateCategory === '全部' || item.category === templateCategory || item.categories?.includes(templateCategory))
    && (templateColor === '全部' || item.color === templateColor)
  )), [allTemplates, templateCategory, templateColor, templateQuery]);
  const filteredTemplates = matchingTemplates.slice(0, visibleTemplateCount);
  const templateCategories = useMemo(() => ['全部', ...new Set(['自定义', ...allTemplates.flatMap((item) => item.categories ?? [item.category])])], [allTemplates]);
  const templateColors = useMemo(() => ['全部', ...new Set(['自定义', ...allTemplates.map((item) => item.color)])], [allTemplates]);
  const selectedVoice = voices.find((item) => item.id === selectedVoiceId) ?? VOICES[0];
  const cloudVideoAvatar = aliyunAvatarForCloudVideo(avatar);
  const scriptVideoInputSignatureFor = useCallback((text: string) => scriptAvatarVideoInputSignature({
    text,
    avatarId,
    voiceId: selectedVoiceId,
    speechRate: voiceSpeed,
    pitchRate: voicePitch,
  }), [avatarId, selectedVoiceId, voicePitch, voiceSpeed]);
  const scriptVideoState = (script: ScriptItem) => {
    if (!script.avatarVideo) return scriptVideoSubmissionErrors[script.id] ? 'failed' as const : 'missing' as const;
    if (script.avatarVideo.inputSignature !== scriptVideoInputSignatureFor(script.text)) return 'stale' as const;
    const result = scriptVideoResults[script.id];
    if (result?.id === script.avatarVideo.taskId && aliyunVideoState(result.status) === 'ready') return 'ready' as const;
    if (scriptVideoSubmissionErrors[script.id]) return 'failed' as const;
    if (!result || result.id !== script.avatarVideo.taskId) return 'processing' as const;
    return aliyunVideoState(result.status);
  };
  const scriptVideosReady = scripts.filter((script) => (
    !scriptVideoBatch?.scriptIds.includes(script.id)
    && scriptVideoState(script) === 'ready'
  )).length;
  const scriptsNeedingVideo = scripts.filter((script) => ['missing', 'stale', 'failed'].includes(scriptVideoState(script)));
  const scriptVideosProcessing = scripts.filter((script) => scriptVideoState(script) === 'processing').length;
  const scriptVideoBatchBusy = scriptVideoBatch !== null;
  const scriptVideoTaskSignature = useMemo(() => scripts.map((script) => [
    script.id,
    script.avatarVideo?.taskId ?? '',
    script.avatarVideo?.inputSignature ?? '',
    scriptVideoInputSignatureFor(script.text),
  ].join(':')).join('|'), [scriptVideoInputSignatureFor, scripts]);
  const landingAvatar = ALIYUN_PUBLIC_AVATARS.find((item) => item.id === landingAvatarId)
    ?? ALIYUN_PUBLIC_AVATARS[0];
  const landingAvatars = useMemo(() => {
    const query = landingAvatarQuery.trim().toLowerCase();
    return ALIYUN_PUBLIC_AVATARS.filter((item) => !query || `${item.name}${item.role}`.toLowerCase().includes(query));
  }, [landingAvatarQuery]);
  const filteredVoices = useMemo(() => voices.filter((item) => (
    item.scope === voiceTab
    && (voiceGender === '全部性别' || item.gender === voiceGender)
    && (voiceLanguage === '全部语言' || item.language === voiceLanguage)
    && `${item.name}${item.description}${item.language}`.toLowerCase().includes(voiceQuery.trim().toLowerCase())
  )), [voiceGender, voiceLanguage, voiceQuery, voiceTab, voices]);
  const visibleHosts = useMemo(() => AVATARS.filter((item) => {
    const matchesGender = hostFilters.gender === '全部' || item.gender === hostFilters.gender;
    const matchesScene = hostFilters.scene === '全部场景'
      || (hostFilters.scene === '播报' && (item.businessType === 'BROADCAST' || item.businessType === 'BROADCAST_CHAT'))
      || (hostFilters.scene === '对话' && (item.businessType === 'CHAT' || item.businessType === 'BROADCAST_CHAT'))
      || (hostFilters.scene === '直播' && item.businessType === 'LIVE');
    const matchesFilters = matchesGender && matchesScene;
    return matchesFilters;
  }), [hostFilters]);
  const selectedLayer = layers.find((item) => item.id === selectedLayerId) ?? null;
  const selectedTextLayer = selectedLayer?.kind === 'text' ? selectedLayer : null;
  const canvasProductImage = layers.find((item) => item.kind === 'image' && item.sceneKey === 'custom' && Boolean(item.preview));
  const productDemoImage = importedMaterialImages[0]
    ?? (canvasProductImage?.preview ? { name: canvasProductImage.value, dataUrl: canvasProductImage.preview } : null);
  const productDemoBusy = productDemoStage === 'analyzing' || productDemoStage === 'rendering';
  const textMaterialValue = selectedTextLayer?.value ?? customText;
  const textMaterialStyle: TextMaterialStyle = selectedTextLayer ? {
    fontFamily: selectedTextLayer.fontFamily ?? '默认字体',
    fontSize: selectedTextLayer.fontSize ?? 16,
    color: selectedTextLayer.color ?? '#ffffff',
    fontWeight: selectedTextLayer.fontWeight ?? 'normal',
    fontStyle: selectedTextLayer.fontStyle ?? 'normal',
    textDecoration: selectedTextLayer.textDecoration ?? 'none',
    textAlign: selectedTextLayer.textAlign ?? 'center',
    opacity: selectedTextLayer.opacity,
    backgroundEnabled: Boolean(selectedTextLayer.backgroundEnabled),
    backgroundColor: selectedTextLayer.backgroundColor ?? '#111827',
    backgroundOpacity: selectedTextLayer.backgroundOpacity ?? 72,
  } : customTextStyle;
  const inspectedLayerCandidate = layers.find((item) => item.id === inspectorLayerId) ?? null;
  const inspectorLayer = inspectedLayerCandidate?.kind === 'host' ? null : inspectedLayerCandidate;
  const hostLayer = layers.find((item) => item.sceneKey === 'host') ?? null;
  const hostLayerZIndex = hostLayer ? layerZIndex(layers, hostLayer.id) : undefined;
  const hostChromaKey = layerChromaKeySettings(hostLayer);
  const automaticPublicChromaKey = avatar.scope === 'aliyun' && avatar.transparent === true && !hostChromaKey.enabled;
  const previewHostChromaKey: ChromaKeySettings = automaticPublicChromaKey
    ? { enabled: true, color: '#b9bcc9', tolerance: 9, softness: 10 }
    : hostChromaKey;
  const backgroundLayer = layers.find((item) => item.sceneKey === 'templateBackground') ?? null;
  const previewBackground = backgroundLayer?.preview ?? selectedTemplate.image;
  const speakingScript = scripts.find((item) => item.id === currentPlaybackScriptId)
    ?? scripts.find((item) => item.state === 'playing');
  const speakingGoods = speakingScript?.productId === undefined
    ? activeGoods
    : goods.find((item) => item.id === speakingScript.productId) ?? activeGoods;
  const visibleProductCard = liveOptions.product && speakingScript ? speakingGoods : undefined;
  broadcastSceneRef.current = {
    layers: layers.map((layer) => ({
      ...layer,
      fontFamily: fontFamilyCss(layer.fontFamily),
    })),
    backgroundUrl: previewBackground,
    hostUrl: avatar.image,
    hostVideoElement: generatedVideoVisible
      && aliyunVideo?.videoUrl
      && aliyunVideoState(aliyunVideo.status) === 'ready'
      ? generatedVideoRef.current
      : null,
    mediaActive,
    productCard: visibleProductCard ? {
      title: visibleProductCard.name,
      price: visibleProductCard.price,
      originalPrice: visibleProductCard.originalPrice,
      sellingPoints: visibleProductCard.sellingPoints,
    } : undefined,
  };
  const estimatedTime = formatScriptDuration(scripts.reduce((total, item) => total + estimateScriptSeconds(item.text, voiceSpeed), 0));
  const draftEstimatedDuration = formatScriptDuration(estimateScriptSeconds(draft, voiceSpeed));
  const currentAssets = materialTab === 'image'
    ? (assetScope === 'mine' ? assets.image : SQUARE_ASSETS.image).filter((item) => item.name.includes(assetQuery.trim()))
    : [];

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      const legacyTemplates = window.localStorage.getItem(CUSTOM_TEMPLATE_STORAGE_KEY);
      try {
        const storedTemplates = await readStudioSetting(CUSTOM_TEMPLATE_STORAGE_KEY);
        if (cancelled) return;
        setCustomTemplates(parseCustomTemplates(storedTemplates ?? legacyTemplates));
        if (!storedTemplates && legacyTemplates) {
          await writeStudioSetting(CUSTOM_TEMPLATE_STORAGE_KEY, legacyTemplates);
        }
        window.localStorage.removeItem(CUSTOM_TEMPLATE_STORAGE_KEY);
        setTemplateStorageError('');
      } catch (cause) {
        if (!cancelled) {
          setCustomTemplates(parseCustomTemplates(legacyTemplates));
          setTemplateStorageError(cause instanceof Error ? cause.message : '自定义模板读取失败');
        }
      } finally {
        if (!cancelled) setCustomTemplatesLoaded(true);
      }
    };
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customTemplatesLoaded) return;
    void writeStudioSetting(CUSTOM_TEMPLATE_STORAGE_KEY, JSON.stringify(customTemplates))
      .then(() => {
        window.localStorage.removeItem(CUSTOM_TEMPLATE_STORAGE_KEY);
        setTemplateStorageError('');
      })
      .catch((cause: unknown) => {
        setTemplateStorageError(cause instanceof Error ? cause.message : '自定义模板保存失败');
      });
  }, [customTemplates, customTemplatesLoaded]);

  const buildRoomConfig = useCallback((): LiveRoomConfig => ({
    schemaVersion: 1,
    avatarId,
    voice: {
      voiceId: selectedVoiceId,
      speed: voiceSpeed,
      pitch: voicePitch,
    },
    playbackMode,
    goods,
    activeGoodsId,
    scripts: scripts.map((item) => item.state === 'playing' ? { ...item, state: 'ready' } : item),
    qaItems,
    selectedTemplateId,
    selectedTemplatePage,
    layers,
    liveOptions: { ...liveOptions, loopPlayback: playbackLoop },
    outputConfig,
    selectedPlatforms,
    selectedPlatformConnectionIds,
    assets,
    importedMaterialImages,
  }), [
    activeGoodsId,
    assets,
    importedMaterialImages,
    avatarId,
    goods,
    layers,
    liveOptions,
    outputConfig,
    playbackLoop,
    playbackMode,
    qaItems,
    scripts,
    selectedPlatformConnectionIds,
    selectedPlatforms,
    selectedTemplateId,
    selectedTemplatePage,
    selectedVoiceId,
    voicePitch,
    voiceSpeed,
  ]);

  const roomConfigSignature = useMemo(() => JSON.stringify(buildRoomConfig()), [buildRoomConfig]);
  useEffect(() => {
    const templateFonts = new Set(layers.flatMap((layer) => layer.kind === 'text' && layer.fontFamily
      ? [`${layer.fontStyle ?? 'normal'} ${layer.fontWeight ?? 'normal'} ${layer.fontSize ?? 16}px ${fontFamilyCss(layer.fontFamily)}`]
      : []));
    for (const font of templateFonts) void document.fonts.load(font).catch(() => undefined);
  }, [layers]);
  const speechWarmupSignature = useMemo(() => JSON.stringify({
    texts: avatar.rendererProfile ? scripts.map((item) => item.text.trim()).filter(Boolean) : [],
    rendererProfile: avatar.rendererProfile,
    voiceId: selectedVoiceId,
    speed: voiceSpeed,
  }), [avatar.rendererProfile, scripts, selectedVoiceId, voiceSpeed]);
  const roomDirty = Boolean(room && savedConfigSignature && (roomConfigSignature !== savedConfigSignature || (storyboardScriptId === null && draft.trim())));
  const selectedPlatformConnections = platformConnections.filter((connection) => (
    selectedPlatformConnectionIds.includes(connection.id)
  ));
  const windowCaptureMode = publishMode === 'window_capture';
  const playbackBusy = draftPreviewing || ['llm_start', 'speak_start', 'tts_start', 'playing'].includes(stage);
  useEffect(() => {
    if (!entered) scriptVideoBatchAbortRef.current?.abort();
    return () => scriptVideoBatchAbortRef.current?.abort();
  }, [entered]);
  const platformPreflightChecks = windowCaptureMode
    ? [
      { label: '节目输出窗口比例已选择', passed: true },
      { label: '直播间画面已初始化', passed: Boolean(!roomLoading && streamReady) },
    ]
    : [
      { label: '直播间配置已保存', passed: Boolean(room && !roomDirty && !roomSaving) },
      { label: '直播间已发布', passed: Boolean(room?.status === 'published' && !roomDirty && !roomSaving) },
      { label: '已选择至少一个推流目标', passed: selectedPlatformConnectionIds.length > 0 },
      {
        label: '所选目标已启用且连接测试通过',
        passed: selectedPlatformConnectionIds.length > 0
          && selectedPlatformConnections.length === selectedPlatformConnectionIds.length
          && selectedPlatformConnections.every((connection) => connection.status === 'enabled' && connection.testStatus === 'passed'),
      },
      { label: '输出协议为 RTMP / H.264', passed: outputConfig.protocol === 'RTMP' && outputConfig.codec === 'H.264' },
    ];
  const platformPreflightReady = platformPreflightChecks.every((check) => check.passed);
  const rtmpFormBusy = platformActionId !== null;

  const stopBrowserPublisher = useCallback(async () => {
    const publisher = browserPublisherRef.current;
    browserPublisherRef.current = null;
    if (publisher) await publisher.stop();
    setBrowserPublisherState('stopped');
    setBrowserPublisherMessage('');
  }, []);

  const stopWindowCapture = useCallback(() => {
    streamRef.current?.setMonitorMuted(false);
    windowCaptureSessionRef.current?.stop();
    windowCaptureSessionRef.current = null;
    captureCompositorRef.current?.stop();
    captureCompositorRef.current = null;
    capturePopupRef.current = null;
    setWindowCaptureState('stopped');
    setWindowCaptureMessage('');
  }, []);

  const startWindowCapture = useCallback(async () => {
    if (windowCaptureSessionRef.current) return;
    const sourceCanvas = canvasRef.current;
    const avatarStream = streamRef.current;
    const scene = broadcastSceneRef.current;
    if (!sourceCanvas || !avatarStream || !scene) throw new Error('直播最终画面尚未初始化完成');
    const sessionId = globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Open synchronously from the button event so the browser does not block it.
    const popup = openWindowCaptureWindow(sessionId, captureOrientation);
    if (!popup) throw new Error('节目输出窗口被浏览器拦截，请允许本站打开弹窗后重试');
    capturePopupRef.current = popup;
    setWindowCaptureState('connecting');
    setWindowCaptureMessage('正在连接节目输出窗口');
    let compositor: SceneCompositor | null = null;
    try {
      await avatarStream.startLive();
      const rate = Number.parseInt(outputConfig.frameRate, 10) || 25;
      compositor = new SceneCompositor(
        sourceCanvas,
        outputConfig.resolution,
        rate,
        () => broadcastSceneRef.current ?? scene,
        captureOrientation,
      );
      const mediaStream = compositor.start();
      const audioTrack = avatarStream.getOutputAudioTrack();
      if (audioTrack?.readyState === 'live') mediaStream.addTrack(audioTrack);
      const session = new WindowCaptureSession({
        popup,
        sessionId,
        onState: (state, message) => {
          setWindowCaptureState(state);
          setWindowCaptureMessage(message || '');
          if (state === 'failed') {
            setOnAir(false);
            setError(message || '节目输出窗口连接失败');
            stopWindowCapture();
          }
        },
      });
      captureCompositorRef.current = compositor;
      windowCaptureSessionRef.current = session;
      try {
        await session.start(mediaStream);
        avatarStream.setMonitorMuted(true);
      } catch (caught) {
        avatarStream.setMonitorMuted(false);
        session.stop();
        compositor.stop();
        compositor = null;
        windowCaptureSessionRef.current = null;
        captureCompositorRef.current = null;
        throw caught;
      }
    } catch (caught) {
      avatarStream.setMonitorMuted(false);
      if (!popup.closed) popup.close();
      compositor?.stop();
      compositor = null;
      await avatarStream.stopLive().catch(() => undefined);
      capturePopupRef.current = null;
      setWindowCaptureState('failed');
      throw caught;
    }
  }, [captureOrientation, outputConfig.frameRate, outputConfig.resolution, stopWindowCapture]);

  const startBrowserPublisher = useCallback(async (run: LiveRun) => {
    if (browserPublisherRef.current) return;
    if (!run.ingest?.url) throw new Error('服务端未返回浏览器 WHIP 推流地址');
    const sourceCanvas = canvasRef.current;
    const avatarStream = streamRef.current;
    const scene = broadcastSceneRef.current;
    if (!sourceCanvas || !avatarStream || !scene) throw new Error('直播最终画面尚未初始化完成');
    await avatarStream.startLive();
    const rate = Number.parseInt(outputConfig.frameRate, 10) || 25;
    const publisher = new BrowserLivePublisher({
      endpoint: run.ingest.url,
      sourceCanvas,
      resolution: outputConfig.resolution,
      frameRate: rate,
      audioTrack: avatarStream.getOutputAudioTrack(),
      getScene: () => broadcastSceneRef.current ?? scene,
      onState: (state, message) => {
        setBrowserPublisherState(state);
        setBrowserPublisherMessage(message || '');
        if (state === 'failed') setError(message || '浏览器媒体推流失败');
      },
    });
    browserPublisherRef.current = publisher;
    try {
      await publisher.start();
    } catch (caught) {
      if (browserPublisherRef.current === publisher) browserPublisherRef.current = null;
      await publisher.stop();
      throw caught;
    }
  }, [outputConfig.frameRate, outputConfig.resolution]);

  const applyRoom = useCallback((loadedRoom: LiveRoom) => {
    const config = loadedRoom.config;
    const restoredAvatar = AVATARS.find((item) => item.id === config.avatarId)
      ?? AVATARS.find((item) => item.id === FEATURED_LIVE_AVATAR_ID)
      ?? AVATARS[0];
    setAvatarId(restoredAvatar.id);
    const restoredVoiceId = VOICES.some((voice) => voice.id === config.voice.voiceId) ? config.voice.voiceId : DEFAULT_VOICE_ID;
    setSelectedVoiceId(restoredVoiceId);
    setPendingVoiceId(restoredVoiceId);
    setVoiceSpeed(config.voice.speed);
    setVoicePitch(config.voice.pitch);
    setPendingVoiceSpeed(config.voice.speed);
    setPendingVoicePitch(config.voice.pitch);
    setPlaybackMode(config.playbackMode);
    setPlaybackLoop(Boolean(config.liveOptions.loopPlayback));
    setGoods(config.goods);
    setActiveGoodsId(config.goods.some((item) => item.id === config.activeGoodsId) ? config.activeGoodsId : config.goods[0].id);
    setScripts(config.scripts.map((item) => item.state === 'playing' ? { ...item, state: 'ready' } : item));
    setStoryboardScriptId(config.scripts[0]?.id ?? null);
    setDraft(config.scripts[0]?.text ?? '');
    newScriptDraftRef.current = '';
    setScriptVideoResults({});
    setScriptVideoSubmissionErrors({});
    setScriptVideoBatch(null);
    setAliyunVideo(null);
    setGeneratedVideoVisible(false);
    setQaItems(config.qaItems);
    const templateRequestId = ++templateRequestIdRef.current;
    setTemplateLoadingId('');
    setTemplateLoadError('');
    const migratingLegacyTemplate = LEGACY_TEMPLATE_IDS.has(config.selectedTemplateId);
    const restoredTemplateId = migratingLegacyTemplate ? DEFAULT_LIVE_TEMPLATE_ID : config.selectedTemplateId;
    const restoredTemplatePage = migratingLegacyTemplate ? 0 : config.selectedTemplatePage ?? 0;
    setSelectedTemplateId(restoredTemplateId);
    setSelectedTemplatePage(restoredTemplatePage);
    const builtInTemplate = LIVE_TEMPLATES.find((template) => template.id === restoredTemplateId);
    const restoredBackground = config.layers.find((layer) => layer.sceneKey === 'templateBackground');
    const shouldUpgradeFlattenedTemplate = Boolean(
      builtInTemplate?.source === '百度一镜'
      && builtInTemplate.layersUrl
      && (migratingLegacyTemplate || !config.layers.some((layer) => layer.sceneKey === 'templateElement')),
    );
    const shouldRepairLegacyBackground = Boolean(
      builtInTemplate?.source === '百度一镜'
      && builtInTemplate.layersUrl
      && restoredBackground?.preview
      && [YIJING_BLANK_BACKGROUND, builtInTemplate.image].includes(restoredBackground.preview),
    );
    const restoredLayers = config.layers.map((layer) => layer.sceneKey === 'host'
      ? { ...layer, value: restoredAvatar.name }
      : layer);
    setLayers(restoredLayers);
    if ((shouldUpgradeFlattenedTemplate || shouldRepairLegacyBackground) && builtInTemplate) {
      setTemplateLoadingId(builtInTemplate.id);
      setTemplateLoadError('');
      void loadTemplatePages(builtInTemplate).then((pages) => {
        if (templateRequestIdRef.current !== templateRequestId) return;
        const pageIndex = Math.min(restoredTemplatePage, pages.length - 1);
        const templateLayers = pages[pageIndex].map((layer) => ({ ...layer }));
        setSelectedTemplatePage(pageIndex);
        setLayers(shouldUpgradeFlattenedTemplate
          ? applyTemplateLayersPreservingHost(templateLayers, restoredLayers, restoredAvatar.name)
          : repairLegacyTemplateBackground(
            templateLayers,
            restoredLayers,
            [YIJING_BLANK_BACKGROUND, builtInTemplate.image],
          ));
      }).catch((cause: unknown) => {
        if (templateRequestIdRef.current === templateRequestId) {
          setTemplateLoadError(cause instanceof Error ? cause.message : '模板图层读取失败');
        }
      }).finally(() => {
        if (templateRequestIdRef.current === templateRequestId) setTemplateLoadingId('');
      });
    }
    setLiveOptions(config.liveOptions);
    setOutputConfig(config.outputConfig);
    setSelectedPlatforms(config.selectedPlatforms);
    setSelectedPlatformConnectionIds(config.selectedPlatformConnectionIds ?? []);
    setAssets(config.assets);
    const restoredMaterialImages = config.importedMaterialImages ?? [];
    setImportedMaterialImages(restoredMaterialImages);
    setImportedDocumentName(restoredMaterialImages[0]?.name ?? '');
    setImportedDocumentText('');
    setImportedScripts([]);
    setRoom(loadedRoom);
    setLiveRun(null);
    setLiveRunPreflight(null);
    setRenameRoomName(loadedRoom.name);
    setSavedAt(formatSavedAt(loadedRoom.updatedAt));
    setSavedConfigSignature(JSON.stringify({ ...config, selectedTemplatePage: config.selectedTemplatePage ?? 0 }));
    setRoomError('');
    window.localStorage.setItem(ACTIVE_LIVE_ROOM_STORAGE_KEY, loadedRoom.id);
  }, []);

  useEffect(() => {
    if (!entered || room || roomInitializationRef.current) return;
    roomInitializationRef.current = true;
    setRoomLoading(true);
    setRoomError('');
    const initializeRoom = async () => {
      try {
        const existingRooms = await listLiveRooms();
        const activeRoomId = window.localStorage.getItem(ACTIVE_LIVE_ROOM_STORAGE_KEY);
        const loadedRoom = existingRooms.find((item) => item.id === activeRoomId)
          ?? existingRooms[0]
          ?? await createLiveRoom(
          `直播间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          buildRoomConfig(),
        );
        setRooms(existingRooms.length ? existingRooms : [loadedRoom]);
        applyRoom(loadedRoom);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : '未知错误';
        setRoomError(message);
        setNotice(`直播间配置加载失败：${message}`);
        roomInitializationRef.current = false;
      } finally {
        setRoomLoading(false);
      }
    };
    void initializeRoom();
  }, [applyRoom, buildRoomConfig, entered, room]);

  useEffect(() => {
    if (!liveRun || !['preparing', 'ready', 'starting', 'live', 'stopping'].includes(liveRun.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getLiveRun(liveRun.id);
        if (cancelled) return;
        setLiveRun(next);
        if (next.status === 'live') {
          setOnAir(true);
          setError('');
          setStartedAt(next.startedAt ? Date.parse(next.startedAt) : Date.now());
        } else if (['stopped', 'failed'].includes(next.status)) {
          setOnAir(false);
          setStartedAt(null);
          window.localStorage.removeItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
          if (next.mediaSourceKind === 'browser_ingest') {
            void stopBrowserPublisher();
            void streamRef.current?.stopLive();
          }
          if (next.status === 'failed' && next.errorMessage) setError(next.errorMessage);
        } else {
          setOnAir(false);
          if (next.errorCode === 'ingest_reconnecting' && next.errorMessage) setError(next.errorMessage);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '直播状态同步失败');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveRun?.id, liveRun?.status, stopBrowserPublisher]);

  useEffect(() => {
    // Keep the media source alive while editing Q&A or other controls; both
    // workspace views keep the source canvas mounted for window capture.
    const rendererProfile = avatar.rendererProfile;
    if (!entered || !canvasRef.current || !rendererProfile) {
      setStreamReady(false);
      return;
    }
    const stream = new MuseTalkTotalStream(canvasRef.current, {
      avatarId: rendererProfile,
      profile: rendererProfile,
      language: 'ZH',
      voice: selectedVoiceId,
      speed: voiceSpeed,
      getChromaKey: () => {
        const host = broadcastSceneRef.current?.layers.find((layer) => layer.sceneKey === 'host');
        return layerChromaKeySettings(host);
      },
      onStage: setStage,
      onMediaActive: setMediaActive,
    });
    streamRef.current = stream;
    setStreamReady(true);
    return () => {
      setStreamReady(false);
      void stream.stopLive();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [avatar.rendererProfile, entered, selectedVoiceId, voiceSpeed]);

  useEffect(() => {
    if (!entered || !room) return;
    const warmup = JSON.parse(speechWarmupSignature) as {
      texts: string[];
      rendererProfile?: MuseTalkAvatarProfile;
      voiceId: string;
      speed: number;
    };
    if (!warmup.texts.length || !warmup.rendererProfile) {
      setPreparedVideoProgress(null);
      return;
    }
    let cancelled = false;
    const customVideoTexts = warmup.texts.filter((text) => Boolean(getPregeneratedLiveVideo(text)));
    const fallbackTexts = warmup.texts.filter((text) => !getPregeneratedLiveVideo(text));
    setPreparedVideoProgress({ ready: customVideoTexts.length, total: warmup.texts.length });
    if (!fallbackTexts.length) return () => {
      cancelled = true;
    };
    const options = {
      profile: warmup.rendererProfile,
      language: 'ZH' as const,
      voiceId: warmup.voiceId,
      speed: warmup.speed,
      sourceTimeSeconds: 0,
    };
    void (async () => {
      const speech = await prepareMuseTalkSpeech(fallbackTexts, options);
      if (speech.failed) console.warn('Some live-script audio units could not be prepared.', speech);
      let videos = await prepareMuseTalkVideos(fallbackTexts, options);
      while (!cancelled) {
        const ready = videos.filter((item) => item.status === 'ready').length;
        setPreparedVideoProgress({ ready: customVideoTexts.length + ready, total: warmup.texts.length });
        if (ready === videos.length || videos.every((item) => item.status !== 'preparing')) return;
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
        if (cancelled) return;
        videos = await lookupMuseTalkVideos(fallbackTexts, options);
      }
    })().catch((cause) => {
      // Pre-generation is optional; speak() falls back to live TTS and rendering on a miss.
      console.warn('Live-script media pre-generation failed.', cause);
    });
    return () => {
      cancelled = true;
    };
  }, [entered, room?.id, speechWarmupSignature]);

  useEffect(() => {
    if (!entered) return;
    const queue = new LivePlaybackQueue<number>({
      speak: async (item) => {
        const stream = streamRef.current;
        if (!stream) throw new Error('数字人媒体流尚未准备好');
        await stream.speak(item.text, { preparedVideoUrl: getPregeneratedLiveVideo(item.text) });
      },
      cancel: () => streamRef.current?.cancel(),
      retryCount: 1,
      onState: (status, currentId) => {
        setPlaybackQueueStatus(status);
        setCurrentPlaybackScriptId(currentId);
      },
      onItemState: (id, state) => {
        if (state === 'playing') setCurrentPlaybackScriptId(id);
        else setCurrentPlaybackScriptId((current) => current === id ? null : current);
        setScripts((items) => items.map((item) => item.id === id ? { ...item, state } : item));
      },
      onError: (_id, error, attempt) => {
        if (attempt > 1) return;
        setNotice(`话术播报失败，正在重试：${error instanceof Error ? error.message : '未知错误'}`);
      },
    });
    playbackQueueRef.current = queue;
    return () => {
      playbackQueueRef.current = null;
      void queue.stop();
      setPlaybackQueueStatus('idle');
      setCurrentPlaybackScriptId(null);
    };
  }, [entered]);

  useEffect(() => {
    if (currentPlaybackScriptId === null) return;
    const productId = scripts.find((item) => item.id === currentPlaybackScriptId)?.productId;
    if (productId !== undefined && goods.some((item) => item.id === productId)) setActiveGoodsId(productId);
  }, [currentPlaybackScriptId, goods, scripts]);

  useEffect(() => {
    if (!entered || !room || liveRun || runRecoveryAttemptedRef.current) return;
    runRecoveryAttemptedRef.current = true;
    const runId = window.localStorage.getItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
    if (!runId) return;
    let cancelled = false;
    const recover = async () => {
      try {
        const recovered = await getLiveRun(runId);
        if (cancelled) return;
        if (!['preparing', 'ready', 'starting', 'live', 'stopping'].includes(recovered.status)) {
          window.localStorage.removeItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
          return;
        }
        setLiveRun(recovered);
        if (recovered.mediaSourceKind === 'browser_ingest' && recovered.status !== 'stopping') {
          await startBrowserPublisher(recovered);
          if (!cancelled) setNotice('已恢复浏览器最终画面推流');
        }
        if (['preparing', 'ready'].includes(recovered.status)) {
          const started = await startLiveRun(recovered.id);
          if (!cancelled) setLiveRun(started);
        }
      } catch (caught) {
        window.localStorage.removeItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
        if (!cancelled) setError(caught instanceof Error ? caught.message : '恢复直播运行失败');
      }
    };
    void recover();
    return () => {
      cancelled = true;
    };
  }, [entered, liveRun, room, startBrowserPublisher]);

  useEffect(() => () => {
    stopWindowCapture();
    void stopBrowserPublisher();
  }, [stopBrowserPublisher, stopWindowCapture]);

  useEffect(() => {
    setLayers((items) => items.map((item) => item.sceneKey === 'host' ? { ...item, value: avatar.name } : item));
  }, [avatar.name]);

  const stopVoicePreview = useCallback((updateState = true) => {
    voicePreviewGenerationRef.current += 1;
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = '';
      voiceAudioRef.current = null;
    }
    if (updateState) {
      setPreviewVoiceId(null);
      setPreviewVoiceLoadingId(null);
    }
  }, []);

  useEffect(() => () => stopVoicePreview(false), [stopVoicePreview]);

  const stopDraftPreview = useCallback((updateState = true) => {
    draftPreviewGenerationRef.current += 1;
    draftPreviewAbortRef.current?.abort();
    draftPreviewAbortRef.current = null;
    try {
      draftAudioSourceRef.current?.stop();
    } catch {
      // The source may already have completed naturally.
    }
    draftAudioSourceRef.current = null;
    draftAudioResolveRef.current?.();
    draftAudioResolveRef.current = null;
    const context = draftAudioContextRef.current;
    draftAudioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close();
    draftPreviewStateRef.current = 'idle';
    draftPreviewControlBusyRef.current = false;
    if (updateState) setDraftPreviewState('idle');
  }, []);

  useEffect(() => () => stopDraftPreview(false), [stopDraftPreview]);

  useEffect(() => {
    materialsScrollRef.current?.scrollTo({ top: 0 });
  }, [inspectorLayerId, materialTab]);

  useEffect(() => {
    if (!selectedLayerId) return;
    layerListRef.current?.querySelector<HTMLElement>(`[data-layer-id="${selectedLayerId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedLayerId, layers]);

  useEffect(() => {
    if (!startedAt) {
      setElapsed('00:00:00');
      return;
    }
    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const rest = String(seconds % 60).padStart(2, '0');
      setElapsed(`${hours}:${minutes}:${rest}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const play = async (item: ScriptItem) => {
    if (!avatar.rendererProfile) {
      setNotice(`已选择“${avatar.name}”；绑定播报模板后可合成话术视频`);
      return;
    }
    if (playbackBusy || playbackQueueStatus !== 'idle' || !streamRef.current || item.state === 'playing') return;
    setError('');
    if (item.productId !== undefined && goods.some((product) => product.id === item.productId)) {
      setActiveGoodsId(item.productId);
    }
    setCurrentPlaybackScriptId(item.id);
    setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'playing' } : candidate));
    try {
      await streamRef.current!.speak(item.text, { preparedVideoUrl: getPregeneratedLiveVideo(item.text) });
      setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'done' } : candidate));
      setNotice(onAir ? '本条话术播报完成' : '话术试听完成');
    } catch (cause) {
      setStage('idle');
      setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'ready' } : candidate));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCurrentPlaybackScriptId((current) => current === item.id ? null : current);
    }
  };

  const previewDraftSpeech = async () => {
    if (draftPreviewStateRef.current === 'loading' || draftPreviewControlBusyRef.current) return;
    if (draftPreviewStateRef.current !== 'idle') {
      const context = draftAudioContextRef.current;
      if (!context) return;
      const generation = draftPreviewGenerationRef.current;
      const nextState = draftPreviewStateRef.current === 'playing' ? 'paused' : 'playing';
      draftPreviewControlBusyRef.current = true;
      try {
        if (nextState === 'paused') await context.suspend();
        else await context.resume();
        if (draftPreviewGenerationRef.current !== generation) return;
        draftPreviewStateRef.current = nextState;
        setDraftPreviewState(nextState);
      } catch (cause) {
        if (draftPreviewGenerationRef.current === generation) {
          stopDraftPreview();
          setError(cause instanceof Error ? cause.message : '试听播放控制失败');
        }
      } finally {
        if (draftPreviewGenerationRef.current === generation) draftPreviewControlBusyRef.current = false;
      }
      return;
    }
    const text = draft.trim();
    if (!text || playbackBusy || playbackQueueStatus !== 'idle') return;

    const generation = draftPreviewGenerationRef.current + 1;
    draftPreviewGenerationRef.current = generation;
    const controller = new AbortController();
    draftPreviewAbortRef.current = controller;
    draftPreviewStateRef.current = 'loading';
    setDraftPreviewState('loading');
    stopVoicePreview();
    generatedVideoRef.current?.pause();
    setGeneratedVideoVisible(false);
    setError('');
    try {
      const audioContext = new AudioContext();
      draftAudioContextRef.current = audioContext;
      await audioContext.resume();
      const buffers = await loadScriptPreviewAudio({
        text, voiceId: selectedVoice.id, speed: voiceSpeed, signal: controller.signal,
        decode: bytes => audioContext.decodeAudioData(bytes),
      });
      for (const buffer of buffers) {
        if (draftPreviewGenerationRef.current !== generation) return;
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = voiceSpeed;
        source.connect(audioContext.destination);
        draftAudioSourceRef.current = source;
        await new Promise<void>((resolve) => {
          draftAudioResolveRef.current = resolve;
          source.onended = () => resolve();
          source.start();
          if (draftPreviewStateRef.current === 'loading') {
            draftPreviewStateRef.current = 'playing';
            setDraftPreviewState('playing');
          }
        });
        draftAudioResolveRef.current = null;
        if (draftAudioSourceRef.current === source) draftAudioSourceRef.current = null;
      }
      if (draftPreviewGenerationRef.current === generation) setNotice(`已用“${selectedVoice.name}”完成当前文本试听`);
    } catch (cause) {
      if (draftPreviewGenerationRef.current === generation && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (draftPreviewGenerationRef.current === generation) stopDraftPreview();
    }
  };

  const startScriptQueue = () => {
    if (!avatar.rendererProfile) {
      setNotice(`已选择“${avatar.name}”；绑定播报模板后可合成话术视频`);
      return;
    }
    if (playbackBusy || playbackQueueStatus !== 'idle' || !scripts.length) return;
    const queue = playbackQueueRef.current;
    if (!queue) {
      setError('自动播报队列尚未初始化');
      return;
    }
    setError('');
    void queue.start(
      scripts.map((item) => ({ id: item.id, text: item.text })),
      { mode: playbackMode, loop: playbackLoop },
    ).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const pauseScriptQueue = () => playbackQueueRef.current?.pause();
  const resumeScriptQueue = () => playbackQueueRef.current?.resume();
  const skipScriptQueue = () => { void playbackQueueRef.current?.skip(); };
  const stopScriptQueue = () => { void playbackQueueRef.current?.stop(); };

  const replaceOutputAudio = async (track: MediaStreamTrack) => {
    if (browserPublisherRef.current) {
      await browserPublisherRef.current.replaceAudioTrack(track);
    } else if (windowCaptureSessionRef.current) {
      await windowCaptureSessionRef.current.replaceAudioTrack(track);
    }
  };

  const toggleMicrophoneTakeover = async () => {
    const active = microphoneRef.current;
    if (active) {
      setMicrophoneState('submitting');
      const avatarTrack = streamRef.current?.getOutputAudioTrack();
      try {
        await active.stop();
        microphoneRef.current = null;
        if (avatarTrack?.readyState === 'live') await replaceOutputAudio(avatarTrack);
        setMicrophoneState('idle');
        setNotice('真人接管已结束，已恢复数字人播报音频');
        if (resumeQueueAfterMicrophoneRef.current) {
          resumeQueueAfterMicrophoneRef.current = false;
          resumeScriptQueue();
        }
      } catch (cause) {
        microphoneRef.current = null;
        setMicrophoneState('idle');
        setError(`真人接管提交失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
      return;
    }
    setMicrophoneState('connecting');
    setError('');
    resumeQueueAfterMicrophoneRef.current = playbackQueueStatus !== 'idle';
    if (resumeQueueAfterMicrophoneRef.current) playbackQueueRef.current?.pause();
    await streamRef.current?.cancel();
    const next = new MuseTalkMicrophoneStream();
    microphoneRef.current = next;
    try {
      await next.start('auto');
      const track = next.getInputAudioTrack();
      if (!track) throw new Error('未获取到麦克风音频轨');
      if (browserPublisherRef.current || windowCaptureSessionRef.current) await replaceOutputAudio(track);
      setMicrophoneState('recording');
      setNotice('真人接管中：麦克风音频已接入输出，点击按钮结束接管');
    } catch (cause) {
      microphoneRef.current = null;
      await next.cancel();
      setMicrophoneState('idle');
      setError(`真人接管启动失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const requestAliyunVideo = async (text: string, name: string) => {
    if (text.length < 8) {
      throw new Error('口播至少需要 3 秒，请输入不少于 8 个字符的完整文案');
    }
    if (text.length > 1000) {
      throw new Error('云端数字人口播单条脚本不能超过 1000 个字符');
    }
    if (selectedVoice.scope !== 'public') {
      throw new Error('云端成片只能使用已接入的公共音色');
    }
    if (!cloudVideoAvatar?.officialId) {
      throw new Error('云端成片需要使用阿里云公共数字人形象');
    }

    const response = await fetch('/aliyun-avatar-video-api/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        text,
        voiceKey: selectedVoice.id,
        avatarOfficialId: cloudVideoAvatar.officialId,
        aspectRatio: cloudVideoAvatar.aspectRatio,
        speechRate: voiceSpeed,
        pitchRate: voicePitch,
      }),
    });
    const payload = await response.json() as { video?: AliyunVideoResult; message?: string };
    if (!response.ok || !payload.video) throw new Error(payload.message || '数字人口播提交失败');
    return payload.video;
  };

  const submitAliyunVideo = async (text: string) => {
    if (aliyunVideoSubmitting) return;
    setAliyunVideo(null);
    setAliyunVideoError('');
    setGeneratedVideoVisible(false);
    void restoreAvatarOutputAudio().catch(() => undefined);
    setAliyunVideoSubmitting(true);
    try {
      const video = await requestAliyunVideo(
        text,
        `${avatar.name}-${selectedVoice.name}-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      );
      const payload = { video };
      setAliyunVideo(payload.video);
      const state = aliyunVideoState(payload.video.status);
      if (state === 'ready') {
        setAliyunVideoSubmitting(false);
      } else if (state === 'failed') {
        setAliyunVideoSubmitting(false);
        throw new Error('数字人口播生成失败，请检查形象、音色和应用配置');
      }
      return payload.video;
    } catch (cause) {
      setAliyunVideoSubmitting(false);
      const message = cause instanceof Error ? cause.message : '数字人口播提交失败';
      setAliyunVideoError(message);
      throw new Error(message);
    }
  };

  const synthesizeScriptVideos = async (targets: ScriptItem[]) => {
    if (scriptVideoBatchAbortRef.current || scriptVideoBatchBusy || roomSaving || roomLoading || playbackBusy || onAir || !targets.length) return;
    if (selectedVoice.scope !== 'public') {
      setError('批量合成只能使用已接入的公共音色');
      return;
    }
    if (!cloudVideoAvatar?.officialId) {
      setError('云端成片需要使用阿里云公共数字人形象');
      return;
    }

    const targetIds = new Set(targets.map((item) => item.id));
    const controller = new AbortController();
    scriptVideoBatchAbortRef.current = controller;
    setScriptVideoSubmissionErrors((items) => Object.fromEntries(
      Object.entries(items).filter(([id]) => !targetIds.has(Number(id))),
    ));
    setScriptVideoBatch({ scriptIds: [...targetIds], submitted: 0, total: targets.length });
    setError('');
    setNotice(`正在提交 ${targets.length} 条透明数字人口播任务`);
    let nextScripts = scripts;
    let activeRoom = room;
    let succeeded = 0;
    let failed = 0;
    try {
      for (const [index, script] of targets.entries()) {
        if (controller.signal.aborted) break;
        setScriptVideoBatch(batch => batch ? { ...batch, waiting: false } : batch);
        try {
          const video = await requestAliyunVideo(script.text.trim(), `${script.title}-${avatar.name}-${index + 1}`);
          const avatarVideo = {
            taskId: video.id,
            inputSignature: scriptVideoInputSignatureFor(script.text),
          };
          nextScripts = nextScripts.map((item) => item.id === script.id ? { ...item, avatarVideo } : item);
          setScripts(nextScripts);
          setScriptVideoResults((items) => ({ ...items, [script.id]: video }));
          succeeded += 1;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : '数字人口播提交失败';
          setScriptVideoSubmissionErrors((items) => ({ ...items, [script.id]: message }));
          failed += 1;
        } finally {
          setScriptVideoBatch((batch) => batch ? { ...batch, submitted: index + 1 } : batch);
        }
        if (succeeded && activeRoom) {
          setRoomSaving(true);
          setRoomError('');
          try {
            const config = {
              ...buildRoomConfig(),
              scripts: nextScripts.map((item) => item.state === 'playing' ? { ...item, state: 'ready' as const } : item),
            };
            const savedRoom = await updateLiveRoom(activeRoom, config);
            activeRoom = savedRoom;
            setRoom(savedRoom);
            setRooms((items) => items.map((item) => item.id === savedRoom.id ? savedRoom : item));
            setSavedConfigSignature(JSON.stringify(savedRoom.config));
            setSavedAt(formatSavedAt(savedRoom.updatedAt));
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : '视频任务关联保存失败';
            setRoomError(message);
            setNotice(`合成任务已提交，但直播间保存失败：${message}`);
            return;
          } finally {
            setRoomSaving(false);
          }
        }
        if (controller.signal.aborted) break;
        if (failed) break;
        if (targets.length > 1 && index < targets.length - 1) {
          setScriptVideoBatch(batch => batch ? { ...batch, waiting: true } : batch);
          try {
            await waitForAvatarVideo(nextScripts.find(item => item.id === script.id)!.avatarVideo!.taskId, { signal: controller.signal });
          } catch (cause) {
            if (!controller.signal.aborted) {
              setError(cause instanceof Error ? cause.message : '当前分镜合成异常，已停止后续合成');
              failed += 1;
            }
            break;
          }
        }
      }
      if (controller.signal.aborted) {
        setNotice(`已停止后续合成，保留已提交的 ${succeeded} 条任务；已提交任务会继续完成`);
        return;
      }
      setNotice(failed
        ? `已提交 ${succeeded} 条，合成或提交异常，已停止后续分镜；可查看状态中的原因`
        : `已提交 ${succeeded} 条透明数字人口播，生成完成后可逐条预览`);
    } finally {
      if (scriptVideoBatchAbortRef.current === controller) scriptVideoBatchAbortRef.current = null;
      setScriptVideoBatch(null);
    }
  };

  const stopRemainingScriptVideos = () => {
    scriptVideoBatchAbortRef.current?.abort();
    setNotice('已停止后续合成；已提交的数字人任务会继续完成');
  };

  useEffect(() => {
    if (!entered || !scriptVideoTaskSignature) return;
    const tasks = scripts.filter((script) => (
      script.avatarVideo
      && script.avatarVideo.inputSignature === scriptVideoInputSignatureFor(script.text)
    )).map((script) => ({ scriptId: script.id, taskId: script.avatarVideo!.taskId }));
    if (!tasks.length) return;

    let cancelled = false;
    let timer: number | null = null;
    const refresh = async () => {
      let shouldRetry = false;
      const updates = await Promise.all(tasks.map(async (task) => {
        try {
          const response = await fetch(`/aliyun-avatar-video-api/videos/${encodeURIComponent(task.taskId)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => ({})) as { video?: AliyunVideoResult; message?: unknown };
          if (!response.ok || !payload.video) {
            throw new Error(typeof payload.message === 'string' ? payload.message : '数字人口播状态读取失败');
          }
          if (aliyunVideoState(payload.video.status) === 'processing') shouldRetry = true;
          return { ...task, video: payload.video };
        } catch {
          shouldRetry = true;
          return null;
        }
      }));
      if (cancelled) return;
      const completedUpdates = updates.filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (completedUpdates.length) {
        setScriptVideoResults((items) => {
          const next = { ...items };
          completedUpdates.forEach((item) => {
            next[item.scriptId] = item.video;
          });
          return next;
        });
        setAliyunVideo((current) => {
          const update = completedUpdates.find((item) => item.video.id === current?.id);
          return update?.video ?? current;
        });
      }
      if (shouldRetry) timer = window.setTimeout(() => void refresh(), 4_000);
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [entered, scriptVideoInputSignatureFor, scriptVideoTaskSignature]);

  useEffect(() => {
    if (!aliyunVideo?.id || aliyunVideoState(aliyunVideo.status) !== 'processing') return;
    let cancelled = false;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const response = await fetch(`/aliyun-avatar-video-api/videos/${encodeURIComponent(aliyunVideo.id)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({})) as { video?: AliyunVideoResult; message?: unknown };
        if (!response.ok || !payload.video) throw new Error(typeof payload.message === 'string' ? payload.message : '数字人口播状态读取失败');
        if (cancelled) return;
        setAliyunVideo(payload.video);
        const state = aliyunVideoState(payload.video.status);
        if (state === 'ready') {
          setAliyunVideoSubmitting(false);
          setProductDemoStage('ready');
          setProductDemoMessage(`已用“${avatar.name}”和“${selectedVoice.name}”生成数字人口播，可手动预览`);
          setNotice('数字人口播成片已生成，可手动预览');
        } else if (state === 'failed') {
          setAliyunVideoSubmitting(false);
          const message = payload.video.error || '数字人口播生成失败，请检查形象、音色和应用配置';
          setAliyunVideoError(message);
          setProductDemoStage('failed');
          setProductDemoMessage(message);
        } else {
          timer = window.setTimeout(() => void refresh(), 4_000);
        }
      } catch (cause) {
      if (!cancelled) {
          setAliyunVideoError(cause instanceof Error ? cause.message : '数字人口播状态读取失败');
          setProductDemoMessage('数字人口播仍在生成，状态暂时无法读取，正在重试');
          timer = window.setTimeout(() => void refresh(), 6_000);
        }
      }
    };
    timer = window.setTimeout(() => void refresh(), 4_000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [aliyunVideo?.id, aliyunVideo?.status]);

  const restoreAvatarOutputAudio = async () => {
    generatedVideoCaptureRef.current?.getTracks().forEach((track) => track.stop());
    generatedVideoCaptureRef.current = null;
    const avatarTrack = streamRef.current?.getOutputAudioTrack();
    if ((browserPublisherRef.current || windowCaptureSessionRef.current) && avatarTrack?.readyState === 'live') {
      await replaceOutputAudio(avatarTrack);
    }
  };

  const useGeneratedVideoOutputAudio = async (video: HTMLVideoElement) => {
    if (!browserPublisherRef.current && !windowCaptureSessionRef.current) return;
    const capturable = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture = capturable.captureStream?.() ?? capturable.mozCaptureStream?.();
    const track = capture?.getAudioTracks()[0];
    if (!capture || !track) return;
    generatedVideoCaptureRef.current?.getTracks().forEach((candidate) => candidate.stop());
    generatedVideoCaptureRef.current = capture;
    await replaceOutputAudio(track);
  };

  const playRequestedGeneratedVideo = (video: HTMLVideoElement) => {
    if (generatedVideoPlaybackRequestRef.current !== video.getAttribute('src')) return;
    // Consume only explicit preview clicks, never restored tasks or polling updates.
    generatedVideoPlaybackRequestRef.current = null;
    video.currentTime = 0;
    void video.play().catch((cause) => {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '成片播放失败');
    });
  };

  const toggleGeneratedVideoPreview = async () => {
    if (generatedVideoVisible) {
      generatedVideoPlaybackRequestRef.current = null;
      generatedVideoRef.current?.pause();
      setGeneratedVideoVisible(false);
      await restoreAvatarOutputAudio().catch(() => undefined);
      return;
    }
    generatedVideoPlaybackRequestRef.current = aliyunVideo?.videoUrl || null;
    setGeneratedVideoPlaying(false);
    setGeneratedVideoVisible(true);
    if (generatedVideoRef.current) playRequestedGeneratedVideo(generatedVideoRef.current);
  };

  const previewScriptAvatarVideo = (script: ScriptItem) => {
    const video = scriptVideoResults[script.id];
    if (!video || scriptVideoState(script) !== 'ready') return;
    selectStoryboardScript(script);
    generatedVideoPlaybackRequestRef.current = video.videoUrl;
    setAliyunVideo(video);
    setAliyunVideoError('');
    setProductDemoStage('idle');
    setGeneratedVideoVisible(true);
    setGeneratedVideoPlaying(false);
    setNotice(`正在预览“${script.title}”的透明数字人口播`);
    if (generatedVideoRef.current) playRequestedGeneratedVideo(generatedVideoRef.current);
    requestAnimationFrame(() => previewCanvasRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const selectStoryboardScript = (script: ScriptItem) => {
    generatedVideoPlaybackRequestRef.current = null;
    stopDraftPreview();
    if (storyboardScriptId === null) newScriptDraftRef.current = draft;
    setStoryboardScriptId(script.id);
    setDraft(script.text);
    setProductDemoStage('idle');
    generatedVideoRef.current?.pause();
    setGeneratedVideoVisible(false);
    void restoreAvatarOutputAudio().catch(() => undefined);
  };

  const startNewScriptDraft = () => {
    stopDraftPreview();
    setStoryboardScriptId(null);
    setDraft(newScriptDraftRef.current);
    setGeneratedVideoVisible(false);
    setProductDemoStage('idle');
    requestAnimationFrame(() => draftTextareaRef.current?.focus());
  };

  const updateScriptDraft = (text: string) => {
    const value = text.slice(0, SCRIPT_EDITOR_LIMIT);
    setDraft(value);
    if (storyboardScriptId === null) newScriptDraftRef.current = value;
    else {
      setScripts(items => items.map(item => item.id === storyboardScriptId ? reviseStoryboardScript(item, value, voiceSpeed) : item));
      setGeneratedVideoVisible(false);
      setProductDemoStage('idle');
    }
  };

  const openScriptEditor = (script: ScriptItem) => {
    setEditingScriptId(script.id);
    setScriptEditDraft({ title: script.title, category: script.category, text: script.text });
  };

  const saveEditedScript = (event: FormEvent) => {
    event.preventDefault();
    const text = scriptEditDraft.text.trim();
    const title = scriptEditDraft.title.trim();
    if (editingScriptId === null || !title || !text) return;
    const textChanged = scripts.find((item) => item.id === editingScriptId)?.text !== text;
    const seconds = estimateScriptSeconds(text, voiceSpeed);
    setScripts((items) => items.map((item) => item.id === editingScriptId ? {
      ...item,
      title,
      category: scriptEditDraft.category,
      text,
      duration: formatScriptDuration(seconds),
      state: 'ready',
      avatarVideo: textChanged ? undefined : item.avatarVideo,
    } : item));
    if (editingScriptId === storyboardScriptId) setDraft(text);
    if (textChanged) {
      setScriptVideoResults((items) => Object.fromEntries(Object.entries(items).filter(([id]) => Number(id) !== editingScriptId)));
      setScriptVideoSubmissionErrors((items) => Object.fromEntries(Object.entries(items).filter(([id]) => Number(id) !== editingScriptId)));
    }
    setEditingScriptId(null);
    setNotice('话术已修改，请保存直播间配置');
  };

  const addDraftToScripts = () => {
    const text = draft.trim();
    if (!text) return;
    const seconds = estimateScriptSeconds(text, voiceSpeed);
    const scriptId = Date.now();
    setScripts((items) => [...items, {
      id: scriptId,
      productId: activeGoods?.id,
      title: `主播口播 ${items.length + 1}`,
      category: '讲品',
      duration: formatScriptDuration(seconds),
      text,
      state: 'ready',
    }]);
    setStoryboardScriptId(scriptId);
    newScriptDraftRef.current = '';
    setDraft(text);
    setNotice('已加入直播脚本，请保存直播间配置');
  };

  const deleteScript = (scriptId: number) => {
    setSelectedScriptIds((ids) => ids.filter(id => id !== scriptId));
    setScripts((items) => items.filter((candidate) => candidate.id !== scriptId));
    setScriptVideoResults((items) => Object.fromEntries(Object.entries(items).filter(([id]) => Number(id) !== scriptId)));
    setScriptVideoSubmissionErrors((items) => Object.fromEntries(Object.entries(items).filter(([id]) => Number(id) !== scriptId)));
    if (storyboardScriptId === scriptId) {
      const next = scripts.find(item => item.id !== scriptId);
      if (next) selectStoryboardScript(next);
      else startNewScriptDraft();
    }
    setNotice('话术已删除');
  };

  const duplicateScript = (script: ScriptItem) => {
    const id = Math.max(Date.now(), ...scripts.map(item => item.id + 1));
    const copied = duplicateStoryboardScript(script, id);
    setScripts(items => items.flatMap(item => item.id === script.id ? [item, copied] : [item]));
    if (scriptVideoResults[script.id]) setScriptVideoResults(items => ({ ...items, [id]: items[script.id] }));
    selectStoryboardScript(copied);
    setNotice('分镜已复制，请保存直播间');
  };

  const generateDynamicScript = async (mode: DynamicScriptOperation = 'expand') => {
    if (dynamicGenerating) return;
    const originalDraft = draft;
    const draftText = draft.trim();
    const comparisonTexts = dynamicScriptComparisonTexts(activeProductScripts, storyboardScriptId);
    const uploadedMaterials = importedDocumentText.trim()
      ? [{ name: importedDocumentName || '上传文档', content: importedDocumentText }]
      : [];
    const uploadedImages = importedMaterialImages.map((image) => image.name);
    if (!draftText && !uploadedMaterials.length && !uploadedImages.length) {
      setError('请先输入需要扩写的内容，或上传文档、图片素材');
      return;
    }
    if ((mode === 'condense' || mode === 'polish') && !draftText) {
      setError(mode === 'condense' ? '请先输入需要精简的脚本' : '请先输入需要润色的脚本');
      return;
    }
    setScriptRewriteMode(mode);
    const actionLabel = mode === 'condense' ? '精简' : mode === 'polish' ? '润色' : '扩写';
    setDynamicGenerating(true);
    setError('');
    try {
      const imageDataUrls = await Promise.all(
        importedMaterialImages.map((image) => imageSourceAsDataUrl(image.dataUrl)),
      );
      const response = await fetch('/live-ai-api/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildDynamicScriptPrompt({
            operation: mode,
            productName: activeGoods?.name || '未命名商品',
            productSellingPoints: activeGoods?.sellingPoints,
            currentScripts: comparisonTexts,
            draftText,
            uploadedMaterials,
            uploadedImages,
          }),
          systemPrompt: DYNAMIC_SCRIPT_SYSTEM_PROMPT,
          imageDataUrls,
          maxTokens: mode === 'expand' ? 8_000 : mode === 'condense' ? 800 : 2_000,
          stream: true,
        }),
      });
      const streamedText = await readLiveAiText(response, {
        onText: (text) => {
          setDraft(text.slice(0, SCRIPT_EDITOR_LIMIT));
          requestAnimationFrame(() => {
            const textarea = draftTextareaRef.current;
            if (textarea) textarea.scrollTop = textarea.scrollHeight;
          });
        },
      });
      const text = normalizeGeneratedScript(streamedText);
      if (!text) throw new Error('LLM 未返回有效话术');
      const validation = validateDynamicScript(text, comparisonTexts, activeGoods?.riskWords);
      if (!validation.ok) {
        if (validation.riskWords.length) throw new Error(`命中风险词：${validation.riskWords.join('、')}`);
      }
      updateScriptDraft(text);
      setNotice(validation.duplicate
        ? `AI 已完成${actionLabel}，内容与已有分镜较接近，请确认后使用`
        : `AI 已根据当前输入${uploadedMaterials.length || uploadedImages.length ? '和上传素材' : ''}完成${actionLabel}`);
    } catch (cause) {
      setDraft(originalDraft);
      setError(`AI 话术${actionLabel}失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDynamicGenerating(false);
    }
  };

  const generateProductDemo = async () => {
    if (!productDemoImage || productDemoBusy || playbackBusy || playbackQueueStatus !== 'idle') return;
    setProductDemoStage('analyzing');
    setProductDemoMessage(`正在识别“${productDemoImage.name}”并生成直播卖货脚本`);
    setAliyunVideo(null);
    setAliyunVideoError('');
    setGeneratedVideoVisible(false);
    setError('');
    try {
      const imageDataUrl = await imageSourceAsDataUrl(productDemoImage.dataUrl);
      const prompt = [
        PRODUCT_SCRIPT_SYSTEM_PROMPT,
        buildProductScriptPrompt({
          name: '请从商品图片中识别准确品名',
          referenceImageCount: 1,
          scriptCount: 1,
          maxCharactersPerScript: 180,
          style: '自然亲切',
          creativeDirection: '生成一段约 15 至 25 秒、可直接用于测试数字人口播的卖货话术。优先读出包装上清晰可见的品名与规格，不虚构价格、功效、产地或优惠。',
        }),
      ].join('\n\n');
      const response = await fetch('/live-ai-api/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageDataUrls: [imageDataUrl], maxTokens: 700 }),
      });
      const payload = await response.json().catch(() => ({})) as { content?: unknown; message?: unknown };
      if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : `商品图片识别失败（HTTP ${response.status}）`);
      const [generated] = parseProductScripts(payload.content, { count: 1, maxCharactersPerScript: 180 });
      setStoryboardScriptId(null);
      newScriptDraftRef.current = generated.text;
      setDraft(generated.text);
      setScripts((items) => [...items, {
        id: Date.now(),
        productId: activeGoods?.id,
        title: generated.title || '商品图片试播',
        category: '讲品',
        duration: generated.duration,
        text: generated.text,
        state: 'ready',
      }]);
      setProductDemoStage('rendering');
      setProductDemoMessage(`脚本已生成，正在用“${selectedVoice.name}”合成语音并驱动“${avatar.name}”`);

      if (avatar.rendererProfile) {
        const stream = streamRef.current;
        if (!stream) throw new Error('当前数字人实时渲染服务尚未准备好');
        await stream.speak(generated.text, { preparedVideoUrl: getPregeneratedLiveVideo(generated.text) });
        setProductDemoStage('ready');
        setProductDemoMessage(`试播完成：已用“${avatar.name}”和“${selectedVoice.name}”在当前画面中完成口播`);
        setNotice('商品图片脚本与数字人试播已完成');
        return;
      }

      const video = await submitAliyunVideo(generated.text);
      if (!video) throw new Error('数字人口播任务未能提交');
      if (aliyunVideoState(video.status) === 'ready') {
        setProductDemoStage('ready');
        setProductDemoMessage(`已用“${avatar.name}”和“${selectedVoice.name}”生成数字人口播，可手动预览`);
        setNotice('商品图片脚本与数字人口播成片已生成');
      } else {
        setProductDemoMessage('脚本和语音配置已提交，云端正在合成数字人口播成片');
        setNotice('已生成商品脚本，正在合成数字人口播成片');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '商品图片试播生成失败';
      setProductDemoStage('failed');
      setProductDemoMessage(message);
      setError(`商品图片试播未完成：${message}`);
    }
  };

  const importDocument = async (file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('上传素材不能超过 20 MB');
      return;
    }
    setError('');
    try {
      if (file.type.startsWith('image/')) {
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
          throw new Error('图片仅支持 JPG、PNG、WebP 或 GIF');
        }
        const dataUrl = await prepareProductReferenceImage(file);
        setImportedDocumentName(file.name);
        setImportedDocumentText('');
        setImportedMaterialImages([{ name: file.name, dataUrl }]);
        setImportedScripts([]);
        setNotice(`已上传图片“${file.name}”，AI 扩写时会读取画面和文字`);
        return;
      }
      let plainText = '';
      if (/\.(txt|md|csv|json)$/i.test(file.name)) {
        plainText = await file.text();
      } else {
        const form = new FormData();
        form.append('file', file, file.name);
        const response = await fetch('/live-ai-api/extract', { method: 'POST', body: form });
        const payload = await response.json().catch(() => ({})) as { text?: unknown; filename?: unknown; message?: unknown };
        if (!response.ok || typeof payload.text !== 'string') {
          throw new Error(typeof payload.message === 'string' ? payload.message : '文件内容提取失败');
        }
        plainText = payload.text;
      }
      plainText = plainText.trim().slice(0, 8_000);
      if (!plainText) throw new Error('上传素材中没有可读取的文本');
      const sections = plainText.split(/\n{2,}|(?<=[。！？])\s+/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
      const next = sections.map<ImportedScriptItem>((text, index) => ({
        title: index === 0 ? '文档开场' : index === sections.length - 1 ? '文档收尾' : `内容节点 ${index + 1}`,
        category: index === 0 ? '开场' : index === sections.length - 1 ? '促单' : '讲品',
        duration: `00:${String(Math.min(58, Math.max(20, Math.round(text.length * 0.45)))).padStart(2, '0')}`,
        text,
      }));
      setImportedDocumentName(file.name);
      setImportedDocumentText(plainText);
      setImportedMaterialImages([]);
      setImportedScripts(next);
      setDialog('scriptImport');
    } catch (cause) {
      setError(`素材读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const clearImportedMaterial = () => {
    setImportedDocumentName('');
    setImportedDocumentText('');
    setImportedMaterialImages([]);
    setImportedScripts([]);
  };

  const removeImportedMaterialImage = (index: number) => {
    const nextImages = importedMaterialImages.filter((_, imageIndex) => imageIndex !== index);
    setImportedMaterialImages(nextImages);
    setImportedDocumentName(nextImages[0]?.name ?? '');
    if (!nextImages.length) {
      setImportedDocumentText('');
      setImportedScripts([]);
    }
  };

  const applyImportedScripts = () => {
    const baseId = Date.now();
    setScripts((items) => [...items, ...importedScripts.map((item, index) => ({ ...item, id: baseId + index, productId: activeGoods?.id, state: 'ready' as const }))]);
    setDialog(null);
    setNotice(`已从“${importedDocumentName}”加入 ${importedScripts.length} 个话术节点`);
  };

  const detectEnvironment = () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '浏览器未开放 GPU 信息';
    const platform = /Windows/i.test(navigator.userAgent) ? 'Windows' : /Mac/i.test(navigator.userAgent) ? 'macOS' : '其他系统';
    setEnvironmentInfo({
      browser: `${platform} · ${navigator.userAgent.includes('Chrome') ? 'Chromium' : '现代浏览器'}`,
      cpu: `${navigator.hardwareConcurrency || '未知'} 线程`,
      gpu: renderer.replace(/ANGLE \(|\)/g, '').slice(0, 54),
    });
    setEnvironmentCheckedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
    setNotice('当前浏览器环境已检测，服务器规格仍需部署节点核验');
  };

  useEffect(() => {
    if (!autoDetectEnvironment || autoEnvironmentChecked.current || !entered || dialog !== 'settings' || settingsTab !== 'environment') return;
    autoEnvironmentChecked.current = true;
    detectEnvironment();
  }, [autoDetectEnvironment, dialog, entered, settingsTab]);

  const loadPlatformConnectionOptions = useCallback(async () => {
    setPlatformConnectionsLoading(true);
    setPlatformError('');
    try {
      const connections = await listPlatformConnections();
      setPlatformConnections(connections);
    } catch (caught) {
      setPlatformError(caught instanceof Error ? caught.message : '平台连接加载失败');
    } finally {
      setPlatformConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dialog !== 'livePlatform') return;
    void loadPlatformConnectionOptions();
  }, [dialog, loadPlatformConnectionOptions]);

  useEffect(() => {
    if (!room?.id) return;
    let cancelled = false;
    void listLiveRoomProducts(room.id).then((items) => {
      if (cancelled || !items.length) return;
      const selected = items.map(selectedProductToGoods);
      setGoods(selected);
      setActiveGoodsId((current) => selected.some((item) => item.id === current) ? current : selected[0].id);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [room?.id]);

  useEffect(() => {
    if (dialog !== 'productPicker') return;
    let cancelled = false;
    setProductCatalogLoading(true);
    setProductCatalogError('');
    const options = productPickerTab === 'platform'
      ? { query: productQuery, sourceType: 'platform' as const }
      : productPickerTab === 'script_library'
        ? { query: productQuery, hasScripts: true }
        : { query: productQuery, sourceType: 'self_built' as const };
    void listProductCatalog(options).then((items) => {
      if (cancelled) return;
      setProductCatalogResultIds(items.map((item) => item.id));
      setProductCatalog((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        items.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
    }).catch((cause) => {
      if (!cancelled) setProductCatalogError(cause instanceof Error ? cause.message : '商品库加载失败');
    }).finally(() => {
      if (!cancelled) setProductCatalogLoading(false);
    });
    return () => { cancelled = true; };
  }, [dialog, productCatalogRefreshVersion, productPickerTab, productQuery]);

  const openNewRtmpConnection = () => {
    setEditingPlatformConnectionId(null);
    setRtmpDraft(EMPTY_RTMP_DRAFT);
    setStreamKeyVisible(false);
    setPlatformError('');
    setRtmpFormOpen(true);
  };

  const editRtmpConnection = (connection: PlatformConnection) => {
    setEditingPlatformConnectionId(connection.id);
    setRtmpDraft({
      name: connection.name,
      platformLabel: connection.platformLabel,
      serverUrl: connection.serverUrl,
      streamKey: '',
      status: connection.status,
    });
    setStreamKeyVisible(false);
    setPlatformError('');
    setRtmpFormOpen(true);
  };

  const saveRtmpConnection = async (event: FormEvent) => {
    event.preventDefault();
    const editing = platformConnections.find((item) => item.id === editingPlatformConnectionId);
    const validationError = validateRtmpDraft(rtmpDraft, Boolean(editing));
    if (validationError) {
      setPlatformError(validationError);
      return;
    }
    const actionId = editing?.id ?? 'new';
    setPlatformActionId(actionId);
    setPlatformError('');
    try {
      const saved = editing
        ? await updatePlatformConnection(editing, {
            name: rtmpDraft.name.trim(),
            platformLabel: rtmpDraft.platformLabel.trim(),
            serverUrl: rtmpDraft.serverUrl.trim(),
            streamKey: rtmpDraft.streamKey.trim() || undefined,
            status: rtmpDraft.status,
          })
        : await createPlatformConnection({
            name: rtmpDraft.name.trim(),
            platformLabel: rtmpDraft.platformLabel.trim(),
            serverUrl: rtmpDraft.serverUrl.trim(),
            streamKey: rtmpDraft.streamKey.trim(),
          });
      setPlatformConnections((items) => items.some((item) => item.id === saved.id)
        ? items.map((item) => item.id === saved.id ? saved : item)
        : [...items, saved]);
      if (saved.status === 'disabled') {
        setSelectedPlatformConnectionIds((items) => items.filter((id) => id !== saved.id));
      }
      setRtmpFormOpen(false);
      setEditingPlatformConnectionId(null);
      setRtmpDraft(EMPTY_RTMP_DRAFT);
      setNotice(`推流目标“${saved.name}”已安全保存`);
    } catch (caught) {
      setPlatformError(caught instanceof Error ? caught.message : '推流目标保存失败');
    } finally {
      setPlatformActionId(null);
    }
  };

  const runLocalMediaSelfTest = async () => {
    setPlatformActionId('local-rtmp-self-test');
    setLocalRtmpSelfTestResult(null);
    setLocalRtmpSelfTestError('');
    try {
      const result = await runLocalRtmpSelfTest();
      setLocalRtmpSelfTestResult(result);
      setNotice('本机 RTMP 媒体链路自检通过');
    } catch (caught) {
      setLocalRtmpSelfTestError(caught instanceof Error ? caught.message : '本机 RTMP 推流自检失败');
    } finally {
      setPlatformActionId(null);
    }
  };

  const runPlatformConnectionTest = async (connection: PlatformConnection) => {
    setPlatformActionId(connection.id);
    setPlatformError('');
    try {
      const tested = await testPlatformConnection(connection);
      setPlatformConnections((items) => items.map((item) => item.id === tested.id ? tested : item));
      setNotice(tested.testStatus === 'passed' ? `“${tested.name}”服务器可达` : `“${tested.name}”连接测试失败`);
    } catch (caught) {
      setPlatformError(caught instanceof Error ? caught.message : '连接测试失败');
    } finally {
      setPlatformActionId(null);
    }
  };

  const togglePlatformConnectionStatus = async (connection: PlatformConnection) => {
    setPlatformActionId(connection.id);
    setPlatformError('');
    const nextStatus = connection.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      const updated = await updatePlatformConnection(connection, {
        name: connection.name,
        platformLabel: connection.platformLabel,
        serverUrl: connection.serverUrl,
        status: nextStatus,
      });
      setPlatformConnections((items) => items.map((item) => item.id === updated.id ? updated : item));
      if (nextStatus === 'disabled') {
        setSelectedPlatformConnectionIds((items) => items.filter((id) => id !== updated.id));
      }
      setNotice(`“${updated.name}”已${nextStatus === 'enabled' ? '启用' : '停用'}`);
    } catch (caught) {
      setPlatformError(caught instanceof Error ? caught.message : '状态更新失败');
    } finally {
      setPlatformActionId(null);
    }
  };

  const togglePlatformConnectionSelection = (connection: PlatformConnection) => {
    if (connection.status !== 'enabled') return;
    setSelectedPlatformConnectionIds((items) => items.includes(connection.id)
      ? items.filter((id) => id !== connection.id)
      : [...items, connection.id]);
  };

  const openVoiceDialog = () => {
    stopDraftPreview();
    stopVoicePreview();
    setPendingVoiceId(selectedVoiceId);
    setPendingVoiceSpeed(voiceSpeed);
    setPendingVoicePitch(voicePitch);
    setDialog('voice');
  };

  const closeVoiceDialog = () => {
    stopVoicePreview();
    setPendingVoiceId(selectedVoiceId);
    setPendingVoiceSpeed(voiceSpeed);
    setPendingVoicePitch(voicePitch);
    setDialog(null);
  };

  const auditionVoice = async (voice: VoiceOption) => {
    if (previewVoiceId === voice.id || previewVoiceLoadingId === voice.id) {
      stopVoicePreview();
      return;
    }

    stopVoicePreview();
    setPendingVoiceId(voice.id);
    setPreviewVoiceLoadingId(voice.id);
    const generation = voicePreviewGenerationRef.current;
    const finish = () => {
      if (generation !== voicePreviewGenerationRef.current) return;
      setPreviewVoiceId(null);
      setPreviewVoiceLoadingId(null);
      voiceAudioRef.current = null;
    };

    const audio = new Audio(voice.previewAudio);
    voiceAudioRef.current = audio;
    audio.preload = 'auto';
    audio.playbackRate = pendingVoiceSpeed;
    audio.preservesPitch = true;
    audio.onplaying = () => {
      if (generation !== voicePreviewGenerationRef.current) return;
      setPreviewVoiceLoadingId(null);
      setPreviewVoiceId(voice.id);
    };
    audio.onended = finish;
    const fail = () => {
      if (generation !== voicePreviewGenerationRef.current) return;
      finish();
      setNotice(`“${voice.name}”试听音频加载失败`);
    };
    audio.onerror = fail;
    try {
      await audio.play();
    } catch {
      fail();
    }
  };

  const chooseCloneVoiceFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setCloneError('请上传 MP3、WAV、M4A、AAC 或 OGG 音频文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setCloneError('音频文件不能超过 20 MB');
      return;
    }
    if (cloneVoice.previewAudio && !voices.some((voice) => voice.previewAudio === cloneVoice.previewAudio)) URL.revokeObjectURL(cloneVoice.previewAudio);
    setCloneVoice((draft) => ({
      ...draft,
      file,
      name: draft.name || `${file.name.replace(/\.[^.]+$/, '')}的声音`,
      previewAudio: URL.createObjectURL(file),
    }));
    setCloneProgress('idle');
    setCloneError('');
  };

  const startVoiceClone = async () => {
    if (!cloneVoice.file) {
      setCloneError('请先上传一段清晰的参考语音');
      return;
    }
    if (cloneVoice.transcript.trim().length < 5) {
      setCloneError('请输入与参考语音完全一致的原文，至少 5 个字');
      return;
    }
    if (!cloneVoice.name.trim()) {
      setCloneError('请为克隆语音命名');
      return;
    }
    setCloneError('');
    setCloneProgress('cloning');
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    setCloneProgress('ready');
  };

  const saveCloneVoice = () => {
    if (cloneProgress !== 'ready' || !cloneVoice.previewAudio) return;
    const clonedVoice: VoiceOption = {
      id: `clone-${Date.now()}`,
      officialId: `local-${Date.now().toString(36)}`,
      name: cloneVoice.name.trim(),
      gender: '女性',
      language: '中英文',
      description: '本地克隆声音',
      supportSsml: false,
      sampleText: cloneVoice.transcript.trim(),
      scope: 'mine',
      providerName: '克隆语音',
      previewAudio: cloneVoice.previewAudio,
    };
    setVoices((items) => [clonedVoice, ...items]);
    setPendingVoiceId(clonedVoice.id);
    setVoiceTab('mine');
    setVoiceQuery('');
    setCloneVoice({ name: '', transcript: '', file: null, previewAudio: '' });
    setCloneProgress('idle');
    setNotice(`“${clonedVoice.name}”已保存到克隆语音，请选中后点击应用`);
  };

  const applyVoice = (scope: 'current' | 'all') => {
    stopVoicePreview();
    const nextVoice = voices.find((item) => item.id === pendingVoiceId) ?? VOICES[0];
    setSelectedVoiceId(nextVoice.id);
    setVoiceSpeed(pendingVoiceSpeed);
    setVoicePitch(pendingVoicePitch);
    setDialog(null);
    const target = scope === 'all' ? '全部商品' : activeGoods.name;
    setNotice(`已将“${nextVoice.name}”应用到${target}`);
  };

  const stopLive = async () => {
    setError('');
    try {
      await playbackQueueRef.current?.stop();
      const microphone = microphoneRef.current;
      microphoneRef.current = null;
      await microphone?.cancel();
      setMicrophoneState('idle');
      stopWindowCapture();
      await stopBrowserPublisher();
      await streamRef.current?.stopLive();
      if (liveRun && ['preparing', 'ready', 'starting', 'live', 'stopping'].includes(liveRun.status)) {
        const stopped = await stopLiveRun(liveRun.id);
        setLiveRun(stopped);
      }
      window.localStorage.removeItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '停止直播失败';
      setError(message);
      setNotice(`停止直播失败：${message}`);
    } finally {
      setStage('idle');
      setMediaActive(false);
      setOnAir(false);
      setStartedAt(null);
      setScripts((items) => items.map((item) => item.state === 'playing' ? { ...item, state: 'ready' } : item));
    }
  };

  const completeLivePreflight = async () => {
    if (!platformPreflightReady || (!windowCaptureMode && (!termsAccepted || !room)) || liveRunBusy) return;
    setLiveRunBusy(true);
    setPlatformError('');
    setLiveRunPreflight(null);
    if (windowCaptureMode) {
      try {
        await startWindowCapture();
        setOnAir(true);
        setStartedAt(Date.now());
        setDialog(null);
        setNotice('节目输出窗口已打开，请在平台官方直播伴侣中捕获该窗口并点击开播');
      } catch (caught) {
        setPlatformError(caught instanceof Error ? caught.message : '节目输出窗口启动失败');
      } finally {
        setLiveRunBusy(false);
      }
      return;
    }
    if (!room) return;
    const input = {
      liveRoomId: room.id,
      expectedRoomVersion: room.version,
      legalSourceConfirmed: termsAccepted,
      mediaSource: { kind: mediaSourceKind },
    };
    let createdRun: LiveRun | null = null;
    try {
      const result = await preflightLiveRun(input);
      setLiveRunPreflight(result);
      if (!result.ready) {
        const failed = result.checks.filter((check) => !check.passed).map((check) => check.message);
        setPlatformError(`服务端开播预检未通过：${failed.join('；')}`);
        return;
      }
      const requestId = globalThis.crypto?.randomUUID?.() ?? `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      createdRun = await createLiveRun({ ...input, requestId });
      setLiveRun(createdRun);
      window.localStorage.setItem(ACTIVE_LIVE_RUN_STORAGE_KEY, createdRun.id);
      if (createdRun.mediaSourceKind === 'browser_ingest') {
        await startBrowserPublisher(createdRun);
      }
      const started = await startLiveRun(createdRun.id);
      setLiveRun(started);
      if (started.status === 'live') {
        setOnAir(true);
        setStartedAt(started.startedAt ? Date.parse(started.startedAt) : Date.now());
      }
      setDialog(null);
      setNotice(started.status === 'live'
        ? `已开播（${started.targets.filter((target) => target.status === 'live').length} 个 RTMP 目标）`
        : '开播请求已提交，正在等待媒体 supervisor 确认');
    } catch (caught) {
      await stopBrowserPublisher();
      if (createdRun) {
        try {
          await stopLiveRun(createdRun.id);
        } catch {
          // The server-side ingest timeout still guarantees eventual cleanup.
        }
      }
      window.localStorage.removeItem(ACTIVE_LIVE_RUN_STORAGE_KEY);
      setPlatformError(caught instanceof Error ? caught.message : '服务端开播预检失败');
    } finally {
      setLiveRunBusy(false);
    }
  };

  const saveLiveRoom = async () => {
    if (roomSaving || roomLoading || scriptVideoBatchBusy) return;
    setRoomSaving(true);
    setRoomError('');
    try {
      const config = buildRoomConfig();
      if (config.scripts.some(item => !item.text.trim())) throw new Error('分镜正文不能为空，请填写内容或删除空分镜');
      if (storyboardScriptId === null && draft.trim()) {
        const item: ScriptItem = { id: Date.now(), title: `主播口播 ${scripts.length + 1}`, category: '讲品', text: draft.trim(), duration: draftEstimatedDuration, state: 'ready', productId: activeGoods?.id };
        config.scripts = [...config.scripts, item];
      }
      let activeRoom = room;
      if (!activeRoom) {
        const existingRooms = await listLiveRooms(1);
        activeRoom = existingRooms[0] ?? null;
      }
      const savedRoom = activeRoom
        ? await updateLiveRoom(activeRoom, config)
        : await createLiveRoom(
            `直播间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            config,
          );
      setRoom(savedRoom);
      if (storyboardScriptId === null && draft.trim()) {
        setScripts(savedRoom.config.scripts);
        setStoryboardScriptId(savedRoom.config.scripts.at(-1)?.id ?? null);
        newScriptDraftRef.current = '';
      }
      setRooms((items) => items.some((item) => item.id === savedRoom.id)
        ? items.map((item) => item.id === savedRoom.id ? savedRoom : item)
        : [...items, savedRoom]);
      setRenameRoomName(savedRoom.name);
      setSavedConfigSignature(JSON.stringify(savedRoom.config));
      setSavedAt(formatSavedAt(savedRoom.updatedAt));
      roomInitializationRef.current = true;
      setNotice(`直播间配置已保存（版本 ${savedRoom.version}）`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '未知错误';
      setRoomError(message);
      setNotice(`直播间保存失败：${message}`);
    } finally {
      setRoomSaving(false);
    }
  };

  const selectLiveRoom = (nextRoom: LiveRoom) => {
    if (nextRoom.id === room?.id) {
      setRoomMenuOpen(false);
      return;
    }
    if (scriptVideoBatchAbortRef.current) {
      setNotice('请先停止后续合成，再切换直播间');
      return;
    }
    if (onAir) {
      setNotice('直播进行中不能切换直播间，请先结束直播');
      return;
    }
    if (roomSaving || roomDirty) {
      setNotice('当前直播间有未保存修改，请保存后再切换');
      return;
    }
    stopVoicePreview();
    applyRoom(nextRoom);
    setRoomMenuOpen(false);
    setEditingRoomName(false);
    setNotice(`已切换到“${nextRoom.name}”`);
  };

  const createNewLiveRoom = async (event: FormEvent) => {
    event.preventDefault();
    const name = newRoomName.trim();
    if (!name || roomActionBusy || roomSaving || roomLoading) return;
    if (onAir) {
      setNotice('直播进行中不能新建并切换直播间');
      return;
    }
    if (roomDirty) {
      setNotice('当前直播间有未保存修改，请保存后再新建');
      return;
    }
    setRoomActionBusy(true);
    try {
      const createdRoom = await createLiveRoom(name, createDefaultRoomConfig(avatarId));
      setRooms((items) => [...items, createdRoom]);
      applyRoom(createdRoom);
      setNewRoomName('');
      setRoomMenuOpen(false);
      setNotice(`已创建直播间“${createdRoom.name}”`);
    } catch (caught) {
      setNotice(`新建直播间失败：${caught instanceof Error ? caught.message : '未知错误'}`);
    } finally {
      setRoomActionBusy(false);
    }
  };

  const createLandingLiveRoom = async (event: FormEvent) => {
    event.preventDefault();
    const name = landingRoomName.trim();
    if (!name || landingRoomCreating) return;
    setLandingRoomCreating(true);
    setLandingRoomError('');
    try {
      const createdRoom = await createLiveRoom(name, createDefaultRoomConfig(landingAvatar.id));
      let existingRooms: LiveRoom[] = [];
      try {
        existingRooms = await listLiveRooms();
      } catch {
        // The newly created room is still usable when refreshing the list fails.
      }
      setRooms([...existingRooms.filter((item) => item.id !== createdRoom.id), createdRoom]);
      applyRoom(createdRoom);
      roomInitializationRef.current = true;
      setLandingCreateOpen(false);
      setLandingRoomName('');
      setEntered(true);
      setNotice(`已创建直播间“${createdRoom.name}”`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '未知错误';
      setLandingRoomError(message);
    } finally {
      setLandingRoomCreating(false);
    }
  };

  const copyCurrentLiveRoom = async () => {
    if (!room || roomActionBusy || roomSaving || roomLoading) return;
    if (onAir) {
      setNotice('直播进行中不能复制并切换直播间');
      return;
    }
    if (roomDirty) {
      setNotice('当前直播间有未保存修改，请保存后再复制');
      return;
    }
    setRoomActionBusy(true);
    try {
      const copiedRoom = await copyLiveRoom(room);
      setRooms((items) => [...items, copiedRoom]);
      applyRoom(copiedRoom);
      setRoomMenuOpen(false);
      setNotice(`已复制为“${copiedRoom.name}”`);
    } catch (caught) {
      setNotice(`复制直播间失败：${caught instanceof Error ? caught.message : '未知错误'}`);
    } finally {
      setRoomActionBusy(false);
    }
  };

  const deleteCurrentLiveRoom = async () => {
    if (!room || roomActionBusy || roomSaving || roomLoading) return;
    if (onAir) {
      setNotice('直播进行中不能删除直播间，请先结束直播');
      return;
    }
    setRoomActionBusy(true);
    try {
      await deleteLiveRoom(room.id);
      const remainingRooms = rooms.filter((item) => item.id !== room.id);
      const nextRoom = remainingRooms[0] ?? await createLiveRoom(
        `直播间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        createDefaultRoomConfig(),
      );
      const nextRooms = remainingRooms.length ? remainingRooms : [nextRoom];
      setRooms(nextRooms);
      stopVoicePreview();
      applyRoom(nextRoom);
      setRoomMenuOpen(false);
      setEditingRoomName(false);
      setNotice(`已删除“${room.name}”`);
    } catch (caught) {
      setNotice(`删除直播间失败：${caught instanceof Error ? caught.message : '未知错误'}`);
    } finally {
      setRoomActionBusy(false);
    }
  };

  const renameCurrentLiveRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || roomActionBusy || roomSaving || roomLoading) return;
    if (onAir) {
      setNotice('直播进行中不能重命名直播间');
      return;
    }
    const name = renameRoomName.trim();
    if (!name) {
      setNotice('直播间名称不能为空');
      return;
    }
    setRoomActionBusy(true);
    try {
      const renamedRoom = await updateLiveRoom(room, buildRoomConfig(), name);
      setRooms((items) => items.map((item) => item.id === renamedRoom.id ? renamedRoom : item));
      applyRoom(renamedRoom);
      setEditingRoomName(false);
      setNotice(`直播间已重命名为“${renamedRoom.name}”`);
    } catch (caught) {
      setNotice(`重命名失败：${caught instanceof Error ? caught.message : '未知错误'}`);
    } finally {
      setRoomActionBusy(false);
    }
  };

  const publishCurrentLiveRoom = async () => {
    if (!room || roomActionBusy || roomSaving || roomLoading) return;
    if (onAir) {
      setNotice('直播进行中不能发布配置');
      return;
    }
    if (roomDirty) {
      setNotice('请先保存当前修改，再发布直播间');
      return;
    }
    setRoomActionBusy(true);
    try {
      const publishedRoom = await publishLiveRoom(room);
      setRooms((items) => items.map((item) => item.id === publishedRoom.id ? publishedRoom : item));
      applyRoom(publishedRoom);
      setRoomMenuOpen(false);
      setNotice(`“${publishedRoom.name}”已发布（版本 ${publishedRoom.version}）`);
    } catch (caught) {
      setNotice(`发布失败：${caught instanceof Error ? caught.message : '未知错误'}`);
    } finally {
      setRoomActionBusy(false);
    }
  };

  const openProductPicker = () => {
    if (!room?.id) {
      setNotice('请先保存直播间，再从商品库选品');
      return;
    }
    setSelectedCatalogProductIds(goods.flatMap((item) => typeof item.id === 'string' ? [item.id] : []));
    setProductPickerTab('self_built');
    setProductQuery('');
    setProductCatalogError('');
    setDialog('productPicker');
  };

  const toggleCatalogProduct = (productId: string) => {
    setSelectedCatalogProductIds((items) => items.includes(productId)
      ? items.filter((item) => item !== productId)
      : [...items, productId]);
  };

  const moveSelectedCatalogProduct = (productId: string, direction: -1 | 1) => {
    setSelectedCatalogProductIds((items) => {
      const index = items.indexOf(productId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const loadProductReferenceFiles = async (input?: FileList) => {
    const files = Array.from(input ?? []);
    if (!files.length) return;
    setProductCatalogError('');
    try {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const documentFiles = files.filter((file) => !file.type.startsWith('image/'));
      const unsupported = documentFiles.find((file) => !/\.(txt|md|csv|json)$/i.test(file.name));
      if (unsupported) throw new Error(`不支持“${unsupported.name}”，请选择 TXT、Markdown、CSV、JSON 或图片`);
      if (documentFiles.some((file) => file.size > 2 * 1024 * 1024)) throw new Error('单个商品资料文档不能超过 2 MB');
      if (productReferenceImages.length + imageFiles.length > 6) throw new Error('商品参考图最多上传 6 张');

      if (documentFiles.length) {
        const documents = await Promise.all(documentFiles.map(async (file) => {
          const text = (await file.text()).trim();
          if (!text) throw new Error(`“${file.name}”中没有可读取的文字`);
          return `[${file.name}]\n${text}`;
        }));
        setProductReferenceDocumentName(documentFiles.map((file) => file.name).join('、'));
        setProductReferenceText(documents.join('\n\n').slice(0, 20_000));
      }
      if (imageFiles.length) {
        const prepared = await Promise.all(imageFiles.map(async (file, index) => ({
          id: `${file.name}-${file.lastModified}-${Date.now()}-${index}`,
          name: file.name,
          dataUrl: await prepareProductReferenceImage(file),
        })));
        setProductReferenceImages((items) => [...items, ...prepared]);
      }
      setProductGeneratedScripts([]);
    } catch (cause) {
      setProductCatalogError(cause instanceof Error ? cause.message : '商品资料读取失败');
    }
  };

  const loadProductReferenceImages = async (input?: FileList) => {
    const files = Array.from(input ?? []);
    if (!files.length) return;
    setProductCatalogError('');
    try {
      if (productReferenceImages.length + files.length > 6) throw new Error('商品参考图最多上传 6 张');
      const prepared = await Promise.all(files.map(async (file, index) => ({
        id: `${file.name}-${file.lastModified}-${Date.now()}-${index}`,
        name: file.name,
        dataUrl: await prepareProductReferenceImage(file),
      })));
      setProductReferenceImages((items) => [...items, ...prepared]);
      setProductGeneratedScripts([]);
    } catch (cause) {
      setProductCatalogError(cause instanceof Error ? cause.message : '商品图片读取失败');
    }
  };

  const generateProductDraftScripts = async () => {
    if ((!productDraft.name.trim() && !productReferenceText && !productReferenceImages.length) || productDraftGenerating) return;
    setProductDraftGenerating(true);
    setProductCatalogError('');
    try {
      const sellingPoints = productDraftSellingPoints.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
      const riskWords = productDraftRiskWords.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
      const prompt = buildProductScriptPrompt({
        ...productDraft,
        name: productDraft.name.trim(),
        sellingPoints,
        riskWords,
        referenceText: productReferenceText,
        referenceImageCount: productReferenceImages.length,
        scriptCount: productScriptCount,
        maxCharactersPerScript: productScriptMaxCharacters,
        style: productScriptStyle,
        creativeDirection: productScriptDirection,
        previousScripts: productGeneratedScripts,
      });
      const content = buildProductScriptMessageContent(prompt, productReferenceImages.map((image) => image.dataUrl));
      const response = await fetch(`${API_BASE}/api/v1/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: 'llm-gpt',
          messages: [{ role: 'user', content }],
          system_prompt: PRODUCT_SCRIPT_SYSTEM_PROMPT,
          max_tokens: Math.min(12_000, Math.max(800, Math.ceil(productScriptCount * productScriptMaxCharacters * 1.8))),
          temperature: 1,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        content?: unknown;
        detail?: unknown;
        model?: unknown;
        latency_ms?: unknown;
      };
      if (!response.ok) {
        throw new Error(typeof payload.detail === 'string' ? payload.detail : `LiteLLM 请求失败（HTTP ${response.status}）`);
      }
      const generated = parseProductScripts(payload.content, {
        count: productScriptCount,
        maxCharactersPerScript: productScriptMaxCharacters,
      });
      const hitRiskWords = riskWords.filter((word) => generated.some((script) => script.text.includes(word)));
      if (hitRiskWords.length) throw new Error(`生成结果命中风险词：${hitRiskWords.join('、')}`);
      setProductGeneratedScripts(generated);
      const model = typeof payload.model === 'string' ? payload.model : 'LiteLLM';
      const latency = typeof payload.latency_ms === 'number' ? `，${payload.latency_ms} ms` : '';
      setNotice(`${model} 已生成 ${productScriptCount} 段商品话术${latency}`);
    } catch (cause) {
      setProductCatalogError(`AI 生成失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setProductDraftGenerating(false);
    }
  };

  const updateProductGeneratedScript = (index: number, values: Partial<ProductScriptDraft>) => {
    setProductGeneratedScripts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item));
  };

  const updateProductDraft = (values: Partial<ProductInput>) => {
    setProductDraft((draft) => ({ ...draft, ...values }));
    setProductGeneratedScripts([]);
  };

  const confirmDeleteCatalogProduct = async () => {
    const product = catalogProductToDelete;
    if (!product || catalogProductDeleting) return;
    setCatalogProductDeleting(true);
    setProductCatalogError('');
    try {
      await deleteCatalogProduct(product.id);
      setProductCatalog((items) => items.filter((item) => item.id !== product.id));
      setProductCatalogResultIds((items) => items.filter((id) => id !== product.id));
      setSelectedCatalogProductIds((items) => items.filter((id) => id !== product.id));
      setPendingProductScripts((items) => {
        const next = { ...items };
        delete next[product.id];
        return next;
      });
      setCatalogProductToDelete(null);
      setNotice(`已永久删除自建商品“${product.name}”`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '商品删除失败';
      setProductCatalogError(message.includes('still selected') ? '该商品仍在直播间中，请先从所有直播间移除后再删除' : message);
      setCatalogProductToDelete(null);
    } finally {
      setCatalogProductDeleting(false);
    }
  };

  const saveSelfBuiltProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!productDraft.name.trim() || productDraftSaving || productDraftGenerating) return;
    if (!productGeneratedScripts.length) {
      await generateProductDraftScripts();
      return;
    }
    setProductDraftSaving(true);
    setProductCatalogError('');
    try {
      const product = await createCatalogProduct({
        ...productDraft,
        name: productDraft.name.trim(),
        sku: (productDraft.sku ?? '').trim(),
        sellingPoints: productDraftSellingPoints.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean),
        riskWords: productDraftRiskWords.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean),
      });
      setProductCatalog((items) => [product, ...items]);
      setProductCatalogResultIds((items) => [product.id, ...items.filter((id) => id !== product.id)]);
      setSelectedCatalogProductIds((items) => items.includes(product.id) ? items : [...items, product.id]);
      if (productGeneratedScripts.length) {
        setPendingProductScripts((items) => ({ ...items, [product.id]: productGeneratedScripts }));
      }
      setProductDraft(EMPTY_PRODUCT_DRAFT);
      setProductDraftSellingPoints('');
      setProductDraftRiskWords('');
      setProductReferenceDocumentName('');
      setProductReferenceText('');
      setProductReferenceImages([]);
      setProductGeneratedScripts([]);
      setProductScriptStyle('自然亲切');
      setProductScriptDirection('');
      setNotice(`自建商品已保存并加入待选商品单${productGeneratedScripts.length ? '，AI 话术将在确认时保存' : ''}`);
    } catch (cause) {
      setProductCatalogError(cause instanceof Error ? cause.message : '自建商品保存失败');
    } finally {
      setProductDraftSaving(false);
    }
  };

  const applyProductSelection = async () => {
    if (!room?.id || productSelectionSaving) return;
    const selectedIds = [...new Set(selectedCatalogProductIds)];
    if (!selectedIds.length) {
      setProductCatalogError('直播间至少需要选择一个商品');
      return;
    }
    setProductSelectionSaving(true);
    setProductCatalogError('');
    try {
      const existingIds = goods.flatMap((item) => typeof item.id === 'string' ? [item.id] : []);
      const addedIds = selectedIds.filter((id) => !existingIds.includes(id));
      const removedIds = existingIds.filter((id) => !selectedIds.includes(id));
      await attachLiveRoomProducts(room.id, selectedIds);
      await Promise.all(removedIds.map((productId) => detachLiveRoomProduct(room.id, productId)));
      const currentSelections = await listLiveRoomProducts(room.id);
      const selectionIds = selectedIds.map((productId) => currentSelections.find((item) => item.id === productId)?.selectionId).filter((id): id is string => Boolean(id));
      const selectedProducts = await reorderLiveRoomProducts(room.id, selectionIds);
      const nextGoods = selectedProducts.map(selectedProductToGoods);
      const savedScriptGroups = await Promise.all(addedIds.map(async (productId) => {
        let saved = await listProductScripts(productId).catch(() => []);
        const generated = pendingProductScripts[productId];
        if (!saved.length && generated?.length) {
          saved = await Promise.all(generated.map((script) => createLiveRoomScript(room.id, {
            productId,
            title: script.title,
            category: script.category,
            duration: script.duration,
            text: script.text,
            tags: ['AI生成'],
          })));
        }
        return { productId, saved };
      }));
      const nextActiveGoodsId = nextGoods.some((item) => item.id === activeGoodsId)
        ? activeGoodsId
        : (addedIds[0] ?? nextGoods[0].id);
      const selectedSet = new Set(selectedIds);
      const retained = scripts.filter((item) => typeof item.productId !== 'string' || selectedSet.has(item.productId));
      const keys = new Set(retained.map((item) => `${item.productId ?? ''}\u0000${item.title}\u0000${item.text}`));
      const additions: ScriptItem[] = [];
      savedScriptGroups.forEach(({ productId, saved }) => {
        if (saved.length) {
          saved.forEach((script) => {
            const key = `${productId}\u0000${script.title}\u0000${script.text}`;
            if (keys.has(key)) return;
            keys.add(key);
            additions.push({
              id: Date.now() + additions.length,
              productId,
              title: script.title,
              category: script.category,
              duration: script.duration,
              text: script.text,
              state: 'ready',
            });
          });
          return;
        }
        const product = nextGoods.find((item) => item.id === productId);
        if (product) additions.push(...buildProductStarterScripts(product, Date.now() + additions.length));
      });
      const nextScripts = [...retained, ...additions];
      setGoods(nextGoods);
      setActiveGoodsId(nextActiveGoodsId);
      setScripts(nextScripts);
      const nextConfig = {
        ...buildRoomConfig(),
        goods: nextGoods,
        activeGoodsId: nextActiveGoodsId,
        scripts: nextScripts,
      };
      const savedRoom = await updateLiveRoom(room, nextConfig);
      setRoom(savedRoom);
      setRooms((items) => items.map((item) => item.id === savedRoom.id ? savedRoom : item));
      setSavedConfigSignature(JSON.stringify(savedRoom.config));
      setSavedAt(formatSavedAt(savedRoom.updatedAt));
      setPendingProductScripts((items) => {
        const next = { ...items };
        addedIds.forEach((id) => delete next[id]);
        return next;
      });
      setDialog(null);
      setNotice(`直播商品单已更新：${nextGoods.length} 件商品${addedIds.length ? `，新增 ${addedIds.length} 件并生成/恢复关联话术` : ''}`);
    } catch (cause) {
      setProductCatalogError(cause instanceof Error ? cause.message : '直播商品单更新失败');
    } finally {
      setProductSelectionSaving(false);
    }
  };

  const removeProductFromRoom = async (product: LiveRoomGoodsItem) => {
    if (productRemovingId !== null) return;
    if (onAir) {
      setNotice('直播进行中不能移除商品');
      return;
    }
    if (goods.length <= 1) {
      setNotice('直播商品单至少需要保留一个商品');
      return;
    }
    setProductRemovingId(product.id);
    try {
      const nextGoods = goods.filter((item) => item.id !== product.id);
      const nextScripts = scripts.filter((item) => item.productId !== product.id);
      const nextActiveGoodsId = activeGoodsId === product.id ? nextGoods[0].id : activeGoodsId;
      if (room && typeof product.id === 'string') await detachLiveRoomProduct(room.id, product.id);
      if (room) {
        const savedRoom = await updateLiveRoom(room, {
          ...buildRoomConfig(),
          goods: nextGoods,
          activeGoodsId: nextActiveGoodsId,
          scripts: nextScripts,
        });
        setRoom(savedRoom);
        setRooms((items) => items.map((item) => item.id === savedRoom.id ? savedRoom : item));
        setSavedConfigSignature(JSON.stringify(savedRoom.config));
        setSavedAt(formatSavedAt(savedRoom.updatedAt));
      }
      setGoods(nextGoods);
      setScripts(nextScripts);
      setActiveGoodsId(nextActiveGoodsId);
      setNotice(`已从当前直播间移除“${product.name}”，商品库数据仍保留`);
    } catch (cause) {
      setNotice(`移除商品失败：${cause instanceof Error ? cause.message : '未知错误'}`);
    } finally {
      setProductRemovingId(null);
    }
  };

  const shuffleScripts = () => {
    setScripts((items) => {
      const next = [...items];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [next[index], next[target]] = [next[target], next[index]];
      }
      return next;
    });
    setNotice('话术顺序已随机调整');
  };

  const toggleBatchMode = () => {
    setBatchMode((value) => !value);
    setSelectedScriptIds([]);
  };

  const toggleScriptSelection = (id: number) => {
    setSelectedScriptIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const deleteSelectedScripts = () => {
    if (!selectedScriptIds.length) return;
    const selectedIds = new Set(selectedScriptIds);
    setScripts((items) => items.filter((item) => !selectedIds.has(item.id)));
    if (storyboardScriptId !== null && selectedIds.has(storyboardScriptId)) {
      const next = scripts.find(item => !selectedIds.has(item.id));
      if (next) selectStoryboardScript(next);
      else startNewScriptDraft();
    }
    setScriptVideoResults((items) => Object.fromEntries(Object.entries(items).filter(([id]) => !selectedIds.has(Number(id)))));
    setScriptVideoSubmissionErrors((items) => Object.fromEntries(Object.entries(items).filter(([id]) => !selectedIds.has(Number(id)))));
    setNotice(`已删除 ${selectedScriptIds.length} 条话术`);
    setSelectedScriptIds([]);
    setBatchMode(false);
  };

  const openLayerInspector = (id: string) => {
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    setSelectedLayerId(id);
    if (layer.kind === 'host') {
      setInspectorLayerId(null);
      setStudioWorkspace('host');
      setMaterialTab('host');
      return;
    }
    setInspectorLayerId(id);
    setStudioWorkspace('decorate');
    if (layer.kind === 'text') setMaterialTab('text');
    if (layer.kind === 'image' && layer.sceneKey !== 'templateBackground') setMaterialTab('image');
    if (layer.sceneKey === 'templateBackground') setMaterialTab('template');
  };

  const selectCanvasLayer = (layer: LayerItem) => {
    openLayerInspector(layer.id);
  };

  const closeLayerInspector = () => {
    setSelectedLayerId(null);
    setInspectorLayerId(null);
  };

  const openStudioWorkspace = (workspace: StudioWorkspace) => {
    setStudioWorkspace(workspace);
    closeLayerInspector();
    setAssetQuery('');
    setAssetBatchMode(false);
    setSelectedAssetIds([]);
    if (workspace === 'host') setMaterialTab('host');
    if (workspace === 'decorate' && materialTab === 'host') setMaterialTab('template');
  };

  const updateLayer = (id: string, values: Partial<LayerItem>) => {
    setGeneratedVideoVisible(false);
    const changesTextRendering = Object.keys(values).some((key) => TEXT_RENDER_KEYS.has(key as keyof LayerItem));
    setLayers((items) => items.map((item) => item.id === id
      ? { ...item, ...values, ...(item.kind === 'text' && changesTextRendering ? { preview: undefined } : {}) }
      : item));
  };

  const updateTextMaterialValue = (value: string) => {
    if (selectedTextLayer) updateLayer(selectedTextLayer.id, { value });
    else setCustomText(value);
  };

  const updateTextMaterialStyle = (values: Partial<TextMaterialStyle>) => {
    if (selectedTextLayer) updateLayer(selectedTextLayer.id, values);
    else setCustomTextStyle((style) => ({ ...style, ...values }));
  };

  const beginCanvasGesture = (event: ReactPointerEvent<HTMLElement>, layer: LayerItem, mode: CanvasGesture['mode'], handle?: ResizeHandle) => {
    if (event.button !== 0 || !previewCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    selectCanvasLayer(layer);
    const canvasBounds = previewCanvasRef.current.getBoundingClientRect();
    const centerClientX = canvasBounds.left + (layer.x / 100) * canvasBounds.width;
    const centerClientY = canvasBounds.top + (layer.y / 100) * canvasBounds.height;
    canvasGestureRef.current = {
      mode,
      pointerId: event.pointerId,
      layerId: layer.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: layer.x,
      startY: layer.y,
      startWidth: layer.width,
      startHeight: layer.height,
      startRotation: layer.rotation,
      centerClientX,
      centerClientY,
      startPointerAngle: Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX) * 180 / Math.PI,
    };
    try {
      previewCanvasRef.current.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events used by automated UI checks do not own an active pointer.
    }
    setCanvasGestureMode(mode);
  };

  const beginSelectionGesture = (event: ReactPointerEvent<HTMLDivElement>, layer: LayerItem) => {
    const target = event.target as HTMLElement;
    const handle = target.dataset.resizeHandle as ResizeHandle | undefined;
    beginCanvasGesture(event, layer, target.dataset.rotateHandle === 'true' ? 'rotate' : handle ? 'resize' : 'move', handle);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = canvasGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    if (!canvasBounds.width || !canvasBounds.height) return;
    const deltaX = (event.clientX - gesture.startClientX) / canvasBounds.width * 100;
    const deltaY = (event.clientY - gesture.startClientY) / canvasBounds.height * 100;

    if (gesture.mode === 'move') {
      updateLayer(gesture.layerId, {
        x: roundCanvasValue(clampCanvasValue(gesture.startX + deltaX, -100, 200)),
        y: roundCanvasValue(clampCanvasValue(gesture.startY + deltaY, -100, 200)),
      });
      return;
    }

    if (gesture.mode === 'resize' && gesture.handle) {
      let left = gesture.startX - gesture.startWidth / 2;
      let right = gesture.startX + gesture.startWidth / 2;
      let top = gesture.startY - gesture.startHeight / 2;
      let bottom = gesture.startY + gesture.startHeight / 2;
      if (gesture.handle.includes('w')) left = Math.min(right - 4, left + deltaX);
      if (gesture.handle.includes('e')) right = Math.max(left + 4, right + deltaX);
      if (gesture.handle.includes('n')) top = Math.min(bottom - 3, top + deltaY);
      if (gesture.handle.includes('s')) bottom = Math.max(top + 3, bottom + deltaY);
      const width = clampCanvasValue(right - left, 4, 200);
      const height = clampCanvasValue(bottom - top, 3, 200);
      updateLayer(gesture.layerId, {
        x: roundCanvasValue((left + right) / 2),
        y: roundCanvasValue((top + bottom) / 2),
        width: roundCanvasValue(width),
        height: roundCanvasValue(height),
      });
      return;
    }

    if (gesture.mode === 'rotate') {
      const pointerAngle = Math.atan2(event.clientY - gesture.centerClientY, event.clientX - gesture.centerClientX) * 180 / Math.PI;
      const rawRotation = gesture.startRotation + pointerAngle - gesture.startPointerAngle;
      const rotation = ((rawRotation + 180) % 360 + 360) % 360 - 180;
      updateLayer(gesture.layerId, { rotation: Math.round(rotation) });
    }
  };

  const finishCanvasGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = canvasGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    canvasGestureRef.current = null;
    setCanvasGestureMode(null);
  };

  const alignLayer = (layer: LayerItem, alignment: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    if (alignment === 'left') updateLayer(layer.id, { x: layer.width / 2 });
    if (alignment === 'centerX') updateLayer(layer.id, { x: 50 });
    if (alignment === 'right') updateLayer(layer.id, { x: 100 - layer.width / 2 });
    if (alignment === 'top') updateLayer(layer.id, { y: layer.height / 2 });
    if (alignment === 'centerY') updateLayer(layer.id, { y: 50 });
    if (alignment === 'bottom') updateLayer(layer.id, { y: 100 - layer.height / 2 });
  };

  const addAssetToCanvas = (asset: AssetItem) => {
    const replaceableLayer = selectedLayer?.kind === asset.kind
      && selectedLayer.sceneKey !== 'templateBackground'
      && selectedLayer.sceneKey !== 'host'
      ? selectedLayer
      : null;
    if (replaceableLayer) {
      updateLayer(replaceableLayer.id, { value: asset.name, preview: asset.preview });
      setNotice(`${asset.kind === 'image' ? '图片' : '视频'}图层已替换`);
      return;
    }
    const id = `${asset.kind}-${Date.now()}`;
    const layer: LayerItem = {
      id,
      kind: asset.kind,
      value: asset.name,
      preview: asset.preview,
      sceneKey: 'custom',
      x: 50,
      y: 54,
      width: 34,
      height: 14,
      rotation: 0,
      opacity: 100,
    };
    setLayers((items) => [layer, ...items]);
    setGeneratedVideoVisible(false);
    setSelectedLayerId(id);
    setInspectorLayerId(null);
    setMaterialTab('image');
    setNotice(`${asset.kind === 'image' ? '图片' : '视频'}素材已添加到画面`);
  };

  const addTextToCanvas = () => {
    if (!textMaterialValue.trim() || selectedTextLayer) return;
    const id = `text-${Date.now()}`;
    setLayers((items) => [{
      id,
      kind: 'text',
      value: textMaterialValue.trim(),
      sceneKey: 'custom',
      x: 50,
      y: 70,
      width: 52,
      height: 8,
      fontSize: textMaterialStyle.fontSize,
      color: textMaterialStyle.color,
      ...textLayerDefaults,
      fontFamily: textMaterialStyle.fontFamily,
      fontWeight: textMaterialStyle.fontWeight,
      fontStyle: textMaterialStyle.fontStyle,
      textDecoration: textMaterialStyle.textDecoration,
      textAlign: textMaterialStyle.textAlign,
      backgroundEnabled: textMaterialStyle.backgroundEnabled,
      backgroundColor: textMaterialStyle.backgroundColor,
      backgroundOpacity: textMaterialStyle.backgroundOpacity,
      backgroundRadius: 6,
      rotation: 0,
      opacity: textMaterialStyle.opacity,
    }, ...items]);
    setGeneratedVideoVisible(false);
    setSelectedLayerId(id);
    setInspectorLayerId(null);
    setMaterialTab('text');
    setNotice('文本素材已添加到画面');
  };

  const importAssets = async (kind: 'image' | 'video', files: FileList | null) => {
    if (!files?.length) return;
    const imported = await Promise.all(Array.from(files).map((file, index) => new Promise<AssetItem>((resolve) => {
      if (kind === 'video') {
        resolve({ id: `${kind}-${Date.now()}-${index}`, kind, name: file.name });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ id: `${kind}-${Date.now()}-${index}`, kind, name: file.name, preview: typeof reader.result === 'string' ? reader.result : undefined });
      reader.onerror = () => resolve({ id: `${kind}-${Date.now()}-${index}`, kind, name: file.name });
      reader.readAsDataURL(file);
    })));
    setAssets((items) => ({ ...items, [kind]: [...imported, ...items[kind]] }));
    setAssetScope('mine');
    if (kind === 'image' && selectedLayer?.kind === 'image' && imported[0]?.preview) {
      updateLayer(selectedLayer.id, { value: imported[0].name, preview: imported[0].preview });
      setNotice(`已替换“${selectedLayer.value}”图片图层`);
      return;
    }
    setNotice(`已导入 ${imported.length} 个${kind === 'image' ? '图片' : '视频'}素材，点击素材可添加到画面`);
  };

  const toggleAssetSelection = (id: string) => {
    setSelectedAssetIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const deleteSelectedAssets = () => {
    if (!selectedAssetIds.length || materialTab !== 'image') return;
    setAssets((items) => ({ ...items, image: items.image.filter((item) => !selectedAssetIds.includes(item.id)) }));
    setNotice(`已删除 ${selectedAssetIds.length} 个素材`);
    setSelectedAssetIds([]);
    setAssetBatchMode(false);
  };

  const deleteAsset = (id: string) => {
    const asset = assets.image.find((item) => item.id === id);
    if (!asset) return;
    setAssets((items) => ({ ...items, image: items.image.filter((item) => item.id !== id) }));
    setSelectedAssetIds((ids) => ids.filter((item) => item !== id));
    setNotice(`已删除图片“${asset.name}”`);
  };

  const moveLayer = (id: string, action: 'forward' | 'backward' | 'front' | 'back') => {
    setLayers((items) => {
      const currentIndex = items.findIndex((item) => item.id === id);
      if (currentIndex < 0 || items[currentIndex].sceneKey === 'templateBackground') return items;
      const backgroundIndex = items.findIndex((item) => item.sceneKey === 'templateBackground');
      const lastMovableIndex = backgroundIndex < 0 ? items.length - 1 : Math.max(0, backgroundIndex - 1);
      const targetIndex = action === 'front' ? 0 : action === 'back' ? lastMovableIndex : action === 'forward' ? Math.max(0, currentIndex - 1) : Math.min(lastMovableIndex, currentIndex + 1);
      if (targetIndex === currentIndex) return items;
      const next = [...items];
      const [current] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, current);
      return next;
    });
  };

  const reorderLayer = (draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (draggedId === targetId) return;
    setLayers((items) => {
      const dragged = items.find((item) => item.id === draggedId);
      const target = items.find((item) => item.id === targetId);
      if (!dragged || !target || dragged.sceneKey === 'templateBackground') return items;
      const withoutDragged = items.filter((item) => item.id !== draggedId);
      let targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return items;
      if (target.sceneKey === 'templateBackground' || position === 'before') {
        withoutDragged.splice(targetIndex, 0, dragged);
      } else {
        withoutDragged.splice(targetIndex + 1, 0, dragged);
      }
      return withoutDragged;
    });
    setNotice('图层顺序已更新');
  };

  const deleteLayer = (id: string) => {
    setLayers((items) => items.filter((item) => item.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
    if (inspectorLayerId === id) setInspectorLayerId(null);
    setNotice('图层已删除');
  };

  const templateLayersWithBackground = (background: string) => {
    const snapshot = layers.map((layer) => ({ ...layer }));
    const backgroundIndex = snapshot.findIndex((layer) => layer.sceneKey === 'templateBackground');
    const backgroundLayer: LayerItem = backgroundIndex >= 0
      ? { ...snapshot[backgroundIndex], value: '模板背景', preview: background }
      : { id: `background-custom-${Date.now()}`, kind: 'image', value: '模板背景', sceneKey: 'templateBackground', preview: background, x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 };
    if (backgroundIndex >= 0) snapshot[backgroundIndex] = backgroundLayer;
    else snapshot.push(backgroundLayer);
    return snapshot;
  };

  const openTemplateDraft = () => {
    setTemplateDraftMode('new');
    setTemplateDraftName(`自定义模板 ${customTemplates.length + 1}`);
    setTemplateDraftBackground('');
    setTemplateStorageError('');
  };

  const chooseTemplateBackground = async (file?: File) => {
    if (!file) return;
    setTemplateDraftBusy(true);
    setTemplateStorageError('');
    try {
      setTemplateDraftBackground(await prepareTemplateBackground(file));
    } catch (cause) {
      setTemplateStorageError(cause instanceof Error ? cause.message : '模板背景读取失败');
    } finally {
      setTemplateDraftBusy(false);
    }
  };

  const saveCustomTemplate = () => {
    const name = templateDraftName.trim();
    const background = templateDraftBackground;
    if (!name || !background) return;
    const id = `custom-template-${Date.now()}`;
    const template: StudioTemplate = {
      id,
      name,
      image: background,
      category: '自定义',
      color: '自定义',
      title: '',
      tag: '',
      footer: '',
      custom: true,
      layers: templateLayersWithBackground(background),
      avatarId,
      voice: { voiceId: selectedVoiceId, speed: voiceSpeed, pitch: voicePitch },
    };
    templateRequestIdRef.current += 1;
    setTemplateLoadingId('');
    setTemplateLoadError('');
    setCustomTemplates((items) => [...items, template]);
    setSelectedTemplateId(id);
    setSelectedTemplatePage(0);
    setLayers(template.layers!.map((layer) => ({ ...layer })));
    setTemplateDraftMode(null);
    setTemplateDraftBackground('');
    setNotice(`已保存并应用“${name}”`);
  };

  const updateSelectedCustomTemplate = () => {
    const template = customTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    const next = {
      ...template,
      image: previewBackground,
      layers: templateLayersWithBackground(previewBackground),
      avatarId,
      voice: { voiceId: selectedVoiceId, speed: voiceSpeed, pitch: voicePitch },
    };
    setCustomTemplates((items) => items.map((item) => item.id === template.id ? next : item));
    setNotice(`已更新“${template.name}”`);
  };

  const deleteSelectedCustomTemplate = () => {
    const template = customTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    setCustomTemplates((items) => items.filter((item) => item.id !== template.id));
    void applyTemplate(DEFAULT_LIVE_TEMPLATE_ID);
    setNotice(`已删除“${template.name}”`);
  };

  const applyTemplate = async (templateId: string, requestedPage = 0) => {
    if (roomLoading) return;
    const template = allTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const requestId = ++templateRequestIdRef.current;
    setTemplateLoadingId(template.id);
    setTemplateLoadError('');
    try {
      const pages = await loadTemplatePages(template);
      if (templateRequestIdRef.current !== requestId) return;
      const pageIndex = pages.length ? clampCanvasValue(Math.floor(requestedPage), 0, pages.length - 1) : 0;
      const templateLayers = pages[pageIndex]?.map((item) => ({ ...item })) ?? createTemplateLayers(template.id, avatar.name);
      setSelectedTemplateId(template.id);
      setSelectedTemplatePage(pageIndex);
      setLayers((currentLayers) => applyTemplateLayersPreservingHost(templateLayers, currentLayers, avatar.name));
      setGeneratedVideoVisible(false);
      void restoreAvatarOutputAudio().catch(() => undefined);
      closeLayerInspector();
      const pageLabel = pages.length > 1 ? `第 ${pageIndex + 1} 页` : '';
      setNotice(template.custom ? `已恢复“${template.name}”场景` : `已应用“${template.name}”模板${pageLabel}`);
    } catch (cause) {
      if (templateRequestIdRef.current !== requestId) return;
      const message = cause instanceof Error ? cause.message : '模板图层读取失败';
      setTemplateLoadError(message);
      setNotice(`模板应用失败：${message}`);
    } finally {
      if (templateRequestIdRef.current === requestId) setTemplateLoadingId('');
    }
  };

  const applyAvatar = (nextAvatarId: string) => {
    const nextAvatar = AVATARS.find((item) => item.id === nextAvatarId);
    if (!nextAvatar) return;
    setAvatarId(nextAvatar.id);
    setGeneratedVideoVisible(false);
    setAliyunVideo(null);
    setAliyunVideoError('');
    void restoreAvatarOutputAudio().catch(() => undefined);
    setLayers((items) => items.map((item) => item.sceneKey === 'host' ? {
      ...item,
      value: nextAvatar.name,
    } : item));
    setNotice(nextAvatar.scope === 'aliyun'
      ? `已选择公共形象“${nextAvatar.name}”`
      : '主播形象已更换');
  };

  if (!entered) {
    return (
      <ProductShell>
        <main className="liveLanding">
          <section className="liveLandingCopy">
            <span className="liveLandingKicker"><i />AI DIGITAL HOST</span>
            <h1>欢迎体验数字人直播间</h1>
            <p>选择数字人主播、编排直播话术并配置推流目标，在原有工作台中完成直播准备与实时驱动预览。</p>
            <div className="liveLandingActions">
              <button className="primaryAction" type="button" onClick={() => { setLandingCreateOpen(false); setEntered(true); }}><Sparkles size={17} />进入直播控制台</button>
              <button className="secondaryAction" type="button" onClick={() => { setLandingCreateOpen(true); setLandingRoomError(''); setLandingAvatarQuery(''); }}><FileText size={17} />新建直播间<ArrowRight size={16} /></button>
            </div>
            <div className="liveLandingMeta"><span><strong>{ALIYUN_PUBLIC_AVATARS.length}</strong> 个公共形象</span><i /><span><strong>实时</strong> 话术播报</span><i /><span><strong>RTMP</strong> 输出预设</span></div>
          </section>

          <section className="liveLandingVisual" aria-label="数字人直播功能预览">
            <div className="liveWindow">
              <div className="liveWindowBar"><span><i /><i /><i /></span><em><b />LIVE</em></div>
              <video className="liveWindowVideo" src={ALIYUN_PUBLIC_AVATARS.find((item) => item.id === FEATURED_LIVE_AVATAR_ID)?.previewVideo} poster={ALIYUN_PUBLIC_AVATARS.find((item) => item.id === FEATURED_LIVE_AVATAR_ID)?.image} autoPlay muted loop playsInline aria-label="数字人主播静音演示" />
              <div className="liveWindowLower"><strong>{FEATURED_LIVE_AVATAR_NAME}</strong><span>官方公共数字人</span></div>
            </div>
            <article className="floatingScript"><span><FileText size={14} />话术编排</span><p>欢迎进入今天的数字人直播间，我们马上开始本期内容。</p></article>
            <article className="floatingScenes"><span><Video size={14} />直播画面</span><div><i /><i /><i /></div></article>
            <div className="landingGlow" />
          </section>

          {landingCreateOpen && <div className="liveCreateBackdrop" onMouseDown={() => !landingRoomCreating && setLandingCreateOpen(false)}>
            <form className="liveCreateWizard" role="dialog" aria-modal="true" aria-labelledby="live-create-title" onSubmit={createLandingLiveRoom} onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <div><span className="liveCreateStep">1</span><span><strong id="live-create-title">选择数字人</strong><small>新直播间将使用所选公共形象</small></span></div>
                <button type="button" aria-label="关闭创建直播间" disabled={landingRoomCreating} onClick={() => setLandingCreateOpen(false)}><X size={18} /></button>
              </header>
              <label className="liveCreateSearch"><Search size={16} /><input value={landingAvatarQuery} onChange={(event) => setLandingAvatarQuery(event.target.value)} placeholder="搜索数字人名称" autoFocus /></label>
              <div className="liveCreateAvatarGrid" role="radiogroup" aria-label="选择公共数字人">
                {landingAvatars.map((item) => <button className={item.id === landingAvatar.id ? 'selected' : ''} type="button" role="radio" aria-checked={item.id === landingAvatar.id} key={item.id} onClick={() => setLandingAvatarId(item.id)}>
                  <span><img src={item.image} alt="" /></span>
                  <strong>{item.name}</strong>
                  {item.id === landingAvatar.id && <i><Check size={13} /></i>}
                </button>)}
                {!landingAvatars.length && <div className="liveCreateNoResult">没有找到匹配的数字人</div>}
              </div>
              <footer>
                <div className="liveCreateSelected"><img src={landingAvatar.image} alt="" /><span><small>已选数字人</small><strong>{landingAvatar.name}</strong></span></div>
                <label><span>直播间名称</span><input value={landingRoomName} onChange={(event) => setLandingRoomName(event.target.value)} placeholder="例如：秋季新品专场" maxLength={120} aria-label="新直播间名称" /></label>
                <button type="submit" disabled={!landingRoomName.trim() || landingRoomCreating}>{landingRoomCreating ? <LoaderCircle className="landingSpinner" size={15} /> : <ArrowRight size={15} />}{landingRoomCreating ? '正在创建' : '创建并进入'}</button>
              </footer>
              {landingRoomError && <p className="liveLandingCreateError">{landingRoomError}</p>}
            </form>
          </div>}
        </main>
      </ProductShell>
    );
  }

  const previewHost = avatar.image;
  const selectedStoryboardScript = scripts.find(item => item.id === storyboardScriptId);
  const selectedStoryboardVideoState = selectedStoryboardScript
    ? scriptVideoState(selectedStoryboardScript)
    : 'missing';
  const selectedStoryboardSubmitting = Boolean(
    selectedStoryboardScript
    && scriptVideoBatch?.scriptIds.includes(selectedStoryboardScript.id),
  );
  const selectedStoryboardVideoBusy = scriptAvatarVideoIsBusy(
    selectedStoryboardVideoState,
    selectedStoryboardSubmitting,
  );
  const scriptVideoProgressTotal = scripts.length;
  const generatedVideoReady = Boolean(
    generatedVideoVisible
    && aliyunVideo?.videoUrl
    && aliyunVideoState(aliyunVideo.status) === 'ready',
  );
  const showStaticHost = !mediaActive
    && !generatedVideoReady
    && Boolean(hostLayer);

  return (
    <main className={`xilingLive xlYijingStudio workspace-${studioWorkspace}`}>
      <header className="xlTopbar">
        <div className="xlTitleGroup">
          <button type="button" className="xlBack" onClick={() => { void stopLive(); setEntered(false); }} aria-label="返回直播首页"><ArrowLeft size={17} /></button>
          <div className="xlLiveBrand" aria-label="灵境数字人直播"><span><Sparkles size={15} /></span><strong>灵境数字人</strong></div>
          <div className="xlRoomHeader">
            <div className="xlRoomPickerAnchor">
              <button
                type="button"
                className="xlRoomPicker"
                aria-expanded={roomMenuOpen}
                aria-haspopup="menu"
                onClick={() => setRoomMenuOpen((value) => !value)}
                title="点击切换直播间并管理房间"
              >
                <strong>{room?.name ?? '直播间控制台'}</strong><span className="xlRoomPickerHint">切换直播间</span><ChevronDown size={14} />
              </button>
              {roomMenuOpen && <div className="xlRoomMenu" role="menu" aria-label="直播间管理">
                <header className="xlRoomMenuHeader"><div><strong>我的直播间</strong><span>{rooms.length} 个直播间</span></div><span className={roomDirty ? 'dirty' : ''}>{roomDirty ? '有未保存修改' : room?.status === 'published' ? '已发布版本' : '草稿'}</span></header>
                <div className="xlRoomList">
                  {rooms.map((item) => <button type="button" role="menuitem" className={`xlRoomOption ${item.id === room?.id ? 'active' : ''}`} key={item.id} onClick={() => selectLiveRoom(item)} disabled={roomActionBusy || roomLoading}>
                    <span><strong>{item.name}</strong><small>版本 {item.version} · {item.status === 'published' ? '已发布' : '草稿'}</small></span>{item.id === room?.id && <Check size={14} />}
                  </button>)}
                  {!rooms.length && <div className="xlRoomEmpty">还没有直播间</div>}
                </div>
                <form className="xlRoomCreateForm" onSubmit={createNewLiveRoom}>
                  <input value={newRoomName} onChange={(event) => setNewRoomName(event.target.value)} placeholder="输入名称新建直播间" maxLength={120} aria-label="新直播间名称" />
                  <button type="submit" disabled={!newRoomName.trim() || roomActionBusy || roomLoading}><Plus size={14} />新建</button>
                </form>
                {room && <div className="xlRoomMenuActions">
                  <button type="button" onClick={() => { setRenameRoomName(room.name); setEditingRoomName((value) => !value); }} disabled={roomActionBusy || roomSaving || roomLoading || onAir}><Pencil size={13} />重命名</button>
                  <button type="button" onClick={() => void copyCurrentLiveRoom()} disabled={roomActionBusy || roomSaving || roomLoading || onAir}><Copy size={13} />复制</button>
                  <button type="button" onClick={() => void publishCurrentLiveRoom()} disabled={roomActionBusy || roomSaving || roomLoading || onAir || roomDirty || room.status === 'published'}><Check size={13} />发布</button>
                  <button className="danger" type="button" title="删除当前直播间" aria-label="删除当前直播间" onClick={() => void deleteCurrentLiveRoom()} disabled={roomActionBusy || roomSaving || roomLoading || onAir}><Trash2 size={13} /></button>
                </div>}
                {editingRoomName && room && <form className="xlRoomRenameForm" onSubmit={renameCurrentLiveRoom}>
                  <input value={renameRoomName} onChange={(event) => setRenameRoomName(event.target.value)} maxLength={120} aria-label="直播间名称" autoFocus />
                  <button type="submit" disabled={!renameRoomName.trim() || roomActionBusy}><Check size={14} /></button>
                </form>}
              </div>}
            </div>
            <span className="xlRoomSubline">{roomLoading ? '正在加载配置…' : roomError ? '配置尚未同步' : roomDirty ? '有未保存修改' : savedAt ? `保存于 ${savedAt}` : '尚未保存'}{room?.status === 'published' && !roomDirty && <em className="xlPublishedBadge">已发布</em>}</span>
          </div>
        </div>
        <div className="xlTopActions">
          <button type="button" className="xlDarkButton" title="保存直播间设置、全部分镜及数字人成片关联" aria-label="保存直播间" disabled={roomLoading || roomSaving || scriptVideoBatchBusy} onClick={() => void saveLiveRoom()}>{roomSaving || roomLoading ? <LoaderCircle className="xlVoiceSpinner" size={15} /> : <Save size={15} />}{roomSaving ? '正在保存' : roomLoading ? '正在加载' : '保存直播间'}</button>
          <button type="button" className="xlDarkButton" onClick={() => setDialog('settings')}><Settings2 size={15} />直播设置</button>
          {onAir || (liveRun && ['preparing', 'ready', 'starting', 'live', 'stopping'].includes(liveRun.status)) ? (
            <button className="xlLiveButton danger" type="button" disabled={liveRun?.status === 'stopping'} onClick={() => void stopLive()}><CircleStop size={16} />{liveRun?.status === 'stopping' ? '正在结束' : onAir ? '结束直播' : '取消开播'} {onAir && <span>{elapsed}</span>}</button>
          ) : (
            <button className="xlLiveButton" type="button" onClick={() => setDialog('livePlatform')}><Radio size={16} />开播编排</button>
          )}
        </div>
      </header>

      <div className="xlProgram">
        <section className="xlProgramContent">
          <>
            <div className="xlEditorGrid">
              <nav className="xlStudioNav" aria-label="直播间编辑导航">
                {STUDIO_WORKSPACES.map((workspace) => {
                  const Icon = workspace.icon;
                  return <button className={studioWorkspace === workspace.id ? 'active' : ''} type="button" aria-current={studioWorkspace === workspace.id ? 'page' : undefined} onClick={() => openStudioWorkspace(workspace.id)} key={workspace.id}><Icon size={20} /><span>{workspace.label}</span></button>;
                })}
              </nav>

              <section className="xlScriptPanel" hidden={studioWorkspace !== 'script'}>
                <div className="xlScriptAuthoringToolbar">
                  <button className="xlWriteSegmentButton active" type="button" onClick={startNewScriptDraft} disabled={scriptVideoBatchBusy || dynamicGenerating}><FileText size={14} /><span>写片段</span></button>
                  <span className="xlRewriteSegmented" aria-label="AI 文本处理">
                    {([['expand', '扩写'], ['condense', '精简'], ['polish', '润色']] as const).map(([mode, label]) => (
                      <button className={scriptRewriteMode === mode && dynamicGenerating ? 'active' : ''} type="button" key={mode} onClick={() => void generateDynamicScript(mode)} disabled={dynamicGenerating || (mode !== 'expand' && !draft.trim()) || (mode === 'expand' && !draft.trim() && !importedDocumentText.trim() && !importedMaterialImages.length)}>
                        {dynamicGenerating && scriptRewriteMode === mode ? <LoaderCircle className="xlVoiceSpinner" size={12} /> : label}
                      </button>
                    ))}
                  </span>
                  <button className={importedDocumentName ? 'active' : ''} type="button" title={importedDocumentName ? `更换素材：${importedDocumentName}` : '上传文档或图片素材'} aria-label="上传文档或图片素材" onClick={() => documentInputRef.current?.click()}><FileUp size={15} /></button>
                </div>

                <section className="xlPrimaryScriptComposer">
                  <div className="xlScriptEditorSurface">
                    <textarea ref={draftTextareaRef} value={draft} aria-label="主播口播脚本" onChange={(event) => updateScriptDraft(event.target.value)} placeholder="在这里输入主播口播脚本…" rows={20} maxLength={SCRIPT_EDITOR_LIMIT} disabled={scriptVideoBatchBusy || dynamicGenerating || draftPreviewing || playbackQueueStatus !== 'idle' || onAir} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && storyboardScriptId === null) { event.preventDefault(); addDraftToScripts(); } }} />
                    <div className="xlScriptEditorMeta"><span>{draft.length}/{SCRIPT_EDITOR_LIMIT}字</span><span>约{draftEstimatedDuration}</span><button type="button" title="重新估算时长" aria-label="重新估算时长" onClick={() => { if (storyboardScriptId !== null) setScripts(items => items.map(item => item.id === storyboardScriptId ? { ...item, duration: draftEstimatedDuration } : item)); }}><RefreshCw size={12} /></button>{storyboardScriptId === null && draft.trim() && <button type="button" title="加入分镜" aria-label="加入分镜" onClick={addDraftToScripts} disabled={scriptVideoBatchBusy}><Plus size={14} /></button>}</div>
                  </div>
                  {importedMaterialImages.length ? <div className="xlAttachedImageList" aria-label="已上传图片">
                    {importedMaterialImages.map((image, index) => <div className="xlAttachedImage" role="group" tabIndex={0} aria-label={`已上传图片：${image.name}`} key={`${image.name}-${index}`}>
                      <img className="xlAttachedImageThumb" src={image.dataUrl} alt={image.name} />
                      <span className="xlAttachedImageZoom" role="tooltip"><img src={image.dataUrl} alt="" /></span>
                      <button type="button" title={`移除“${image.name}”`} aria-label={`移除上传图片${image.name}`} onClick={() => removeImportedMaterialImage(index)}><X size={12} /></button>
                    </div>)}
                  </div> : importedDocumentName && <div className="xlAttachedMaterial"><FileUp size={13} /><span>{importedDocumentName}</span><button type="button" title="移除上传素材" aria-label="移除上传素材" onClick={clearImportedMaterial}><X size={13} /></button></div>}
                  <div className="xlScriptComposerDock">
                    <button className="xlComposerVoiceButton" type="button" title={`选择数字人声音，当前：${selectedVoice.name}`} onClick={openVoiceDialog}><span className="xlComposerAvatarAnchor"><img className="xlComposerAvatar" src={avatar.image} alt="" /><em>主播</em></span><span>{selectedVoice.name}</span><small>{voiceSpeed.toFixed(1)}x</small><ChevronDown size={12} /></button>
                    <button className={`xlDraftPreviewButton ${draftPreviewState === 'playing' ? 'playing' : ''}`} type="button" aria-label={draftPreviewState === 'loading' ? '正在合成试听声音' : draftPreviewState === 'playing' ? '暂停试听' : draftPreviewState === 'paused' ? '继续试听' : '试听脚本'} aria-busy={draftPreviewState === 'loading'} title={draftPreviewState === 'loading' ? '正在合成并加载试听声音' : draftPreviewState === 'playing' ? '暂停当前试听' : draftPreviewState === 'paused' ? '继续当前试听' : `用“${selectedVoice.name}”试听当前文本`} disabled={!draft.trim() || draftPreviewState === 'loading' || (!draftPreviewing && (playbackBusy || playbackQueueStatus !== 'idle'))} onClick={() => void previewDraftSpeech()}>{draftPreviewState === 'loading' ? <LoaderCircle className="xlVoiceSpinner" size={14} /> : draftPreviewState === 'playing' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}<span>{draftPreviewState === 'loading' ? '合成中' : draftPreviewState === 'playing' ? '暂停' : draftPreviewState === 'paused' ? '继续' : '试听脚本'}</span></button>
                  </div>
                </section>

                {productDemoStage !== 'idle' && <section className={`xlAliyunVideoStatus ${productDemoStage === 'failed' ? 'failed' : productDemoStage === 'ready' ? 'ready' : 'processing'}`} aria-live="polite" title={productDemoMessage || undefined}>
                  <span>{productDemoBusy || aliyunVideoSubmitting ? <LoaderCircle className="xlVoiceSpinner" size={16} /> : productDemoStage === 'failed' ? <X size={16} /> : <Check size={16} />}</span>
                  <div><strong>{productDemoStage === 'analyzing' ? '正在生成商品脚本' : productDemoStage === 'rendering' ? '正在合成数字人口播' : productDemoStage === 'ready' ? '商品试播已生成' : '商品试播未完成'}</strong><small>{productDemoMessage}</small></div>
                  {aliyunVideo?.videoUrl && aliyunVideoState(aliyunVideo.status) === 'ready' && <button type="button" title={generatedVideoVisible ? '返回场景编辑预览' : '播放数字人口播成片'} aria-label={generatedVideoVisible ? '返回场景编辑预览' : '播放数字人口播成片'} onClick={() => void toggleGeneratedVideoPreview()}>{generatedVideoVisible ? <EyeOff size={14} /> : <Play size={14} fill="currentColor" />}</button>}
                </section>}

              </section>

              <section className="xlPreviewPanel">
                <header className="xlPreviewHeader"><span>直播预览 <button type="button" aria-label="查看预览说明" onClick={() => setPreviewHelp((value) => !value)}><HelpCircle size={15} /></button></span><div className="xlPreviewHeaderActions"><span>预估时间 <strong>{estimatedTime}</strong></span></div></header>
                <div className="xlPreviewStage">
                  {previewHelp && <div className="xlPreviewHelp">预览会实时同步模板、主播、文本与图层显隐状态。</div>}
                  <div className={`xlPortraitCanvas ${canvasGestureMode ? `interacting ${canvasGestureMode}` : ''}`} ref={previewCanvasRef} onPointerMove={handleCanvasPointerMove} onPointerUp={finishCanvasGesture} onPointerCancel={finishCanvasGesture} onLostPointerCapture={finishCanvasGesture}>
                    {backgroundLayer && <img className="xlSceneBackground" src={previewBackground} alt={`${selectedTemplate.name}直播模板`} style={{ left: `${backgroundLayer.x}%`, top: `${backgroundLayer.y}%`, right: 'auto', bottom: 'auto', width: `${backgroundLayer.width}%`, height: `${backgroundLayer.height}%`, transform: `translate(-50%, -50%) rotate(${backgroundLayer.rotation}deg)`, opacity: backgroundLayer.opacity / 100 }} />}
                    {showStaticHost && hostLayer && <>
                      {personImageState !== 'ready' && <ChromaKeyHostPreview className="xlSceneHost" src={previewHost} settings={previewHostChromaKey} label={`${avatar.name}静态预览`} style={{ left: `${hostLayer.x}%`, top: `${hostLayer.y}%`, right: 'auto', bottom: 'auto', width: `${hostLayer.width}%`, height: `${hostLayer.height}%`, zIndex: hostLayerZIndex, opacity: hostLayer.opacity / 100, transform: `translate(-50%, -50%) rotate(${hostLayer.rotation}deg)` }} />}
                      <PersonSegmentedImagePreview className="xlAliyunHostPreview xlSegmentedHostPreview xlSceneHost" src={previewHost} onStateChange={setPersonImageState} label={`${avatar.name}透明静态人像`} style={{ left: `${hostLayer.x}%`, top: `${hostLayer.y}%`, right: 'auto', bottom: 'auto', width: `${hostLayer.width}%`, height: `${hostLayer.height}%`, zIndex: hostLayerZIndex, opacity: personImageState === 'ready' ? hostLayer.opacity / 100 : 0, transform: `translate(-50%, -50%) rotate(${hostLayer.rotation}deg)` }} />
                    </>}
                    <canvas
                      ref={canvasRef}
                      className={mediaActive ? 'xlStreamCanvas active' : 'xlStreamCanvas'}
                      style={hostLayer ? {
                        inset: 'auto',
                        left: `${hostLayer.x}%`,
                        top: `${hostLayer.y}%`,
                        right: 'auto',
                        bottom: 'auto',
                        width: `${hostLayer.width}%`,
                        height: `${hostLayer.height}%`,
                        zIndex: hostLayerZIndex,
                        opacity: generatedVideoReady ? 0 : mediaActive ? hostLayer.opacity / 100 : 0,
                        transform: `translate(-50%, -50%) rotate(${hostLayer.rotation}deg)`,
                      } : undefined}
                    />
                    {layers.map((item) => {
                      const layerStyle: CSSProperties = {
                        left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`,
                        zIndex: layerZIndex(layers, item.id), transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
                        opacity: item.opacity / 100,
                      };
                      if (item.kind === 'text') {
                        if (item.preview) return <span className="xlCanvasText xlCanvasRenderedText" style={layerStyle} key={item.id}><img src={item.preview} alt={item.value} /></span>;
                        return <span className={`xlCanvasText ${item.sceneKey === 'custom' ? 'custom' : item.sceneKey ?? ''}`} style={{
                          ...layerStyle, color: item.color,
                          background: item.backgroundEnabled ? colorWithOpacity(item.backgroundColor ?? '#111827', item.backgroundOpacity ?? 72) : item.sceneKey === 'custom' || item.sceneKey === 'templateElement' ? 'transparent' : undefined,
                          borderRadius: `${item.backgroundRadius ?? 6}px`, fontFamily: fontFamilyCss(item.fontFamily),
                          fontSize: canvasFontSize(item.fontSize), fontWeight: item.fontWeight, fontStyle: item.fontStyle,
                          textDecoration: item.textDecoration, textAlign: item.textAlign,
                          justifyContent: item.textAlign === 'left' ? 'flex-start' : item.textAlign === 'right' ? 'flex-end' : 'center',
                          letterSpacing: `${item.letterSpacing ?? 0}px`, lineHeight: item.lineHeight,
                          WebkitTextStroke: item.strokeEnabled ? `${roundCanvasValue((item.strokeWidth ?? 1) / 3.78)}cqw ${item.strokeColor ?? '#000000'}` : undefined,
                          textShadow: item.shadowEnabled ? `${item.shadowX ?? 4}px ${item.shadowY ?? 4}px ${item.shadowBlur ?? 8}px ${item.shadowColor ?? '#000000'}` : undefined,
                        }} key={item.id}>{item.value}</span>;
                      }
                      if ((item.sceneKey !== 'custom' && item.sceneKey !== 'templateElement') || item.kind === 'host') return null;
                      return <span className={`xlCustomSceneAsset ${item.kind} ${item.sceneKey === 'templateElement' ? 'templateElement' : ''}`} style={layerStyle} key={item.id}>
                        {item.kind === 'image' && item.preview ? <img src={item.preview} alt={item.value} /> : item.kind === 'image' ? <ImageIcon size={23} /> : <Video size={23} />}
                        {(item.kind !== 'image' || !item.preview) && <em>{item.value}</em>}
                      </span>;
                    })}
                    {visibleProductCard && <div className="xlProductCardOverlay"><strong>{visibleProductCard.name}</strong>{typeof visibleProductCard.price === 'number' && <b>¥{visibleProductCard.price.toFixed(2)}</b>}{visibleProductCard.sellingPoints?.length ? <small>{visibleProductCard.sellingPoints.slice(0, 2).join(' · ')}</small> : null}</div>}
                    {generatedVideoReady && hostLayer && <video
                      ref={(element) => {
                        generatedVideoRef.current = element;
                        if (broadcastSceneRef.current) broadcastSceneRef.current.hostVideoElement = element;
                        if (element) playRequestedGeneratedVideo(element);
                      }}
                      className="xlGeneratedProductVideo xlSceneHost"
                      src={aliyunVideo!.videoUrl}
                      poster={aliyunVideo!.coverUrl || undefined}
                      playsInline
                      preload="auto"
                      aria-label="生成的商品数字人口播预览"
                      onPlay={(event) => { setGeneratedVideoPlaying(true); void useGeneratedVideoOutputAudio(event.currentTarget).catch((cause) => setError(`数字人口播音频接入失败：${cause instanceof Error ? cause.message : String(cause)}`)); }}
                      onPause={() => setGeneratedVideoPlaying(false)}
                      onEnded={() => void restoreAvatarOutputAudio().catch(() => undefined)}
                      style={{ left: `${hostLayer.x}%`, top: `${hostLayer.y}%`, right: 'auto', bottom: 'auto', width: `${hostLayer.width}%`, height: `${hostLayer.height}%`, zIndex: hostLayerZIndex, opacity: hostLayer.opacity / 100, transform: `translate(-50%, -50%) rotate(${hostLayer.rotation}deg)` }}
                    />}
                    {generatedVideoReady && <div className="xlGeneratedPreviewControls">
                      <button className="xlCloseGeneratedPreview" type="button" title="返回静态画布" aria-label="返回静态画布" onClick={() => { generatedVideoPlaybackRequestRef.current = null; generatedVideoRef.current?.pause(); setGeneratedVideoVisible(false); void restoreAvatarOutputAudio().catch(() => undefined); }}><X size={16} /></button>
                    </div>}
                    {layers.map((item) => <button className={`xlLayerHitTarget ${item.sceneKey === 'templateBackground' ? 'background' : ''}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, zIndex: layerZIndex(layers, item.id, 30), transform: `translate(-50%, -50%) rotate(${item.rotation}deg)` }} type="button" aria-label={`选择并移动图层：${item.value}`} aria-pressed={selectedLayerId === item.id} data-layer-hit={item.id} key={`hit-${item.id}`} onPointerDown={(event) => beginCanvasGesture(event, item, 'move')} onClick={(event) => { event.stopPropagation(); selectCanvasLayer(item); }} />)}
                    {selectedLayer && <div className={`xlLayerSelectionBox ${selectedLayer.kind}`} style={{ left: `${selectedLayer.x}%`, top: `${selectedLayer.y}%`, width: `${selectedLayer.width}%`, height: `${selectedLayer.height}%`, transform: `translate(-50%, -50%) rotate(${selectedLayer.rotation}deg)` }} role="group" aria-label={`画布控制：${selectedLayer.value}`} onPointerDownCapture={(event) => beginSelectionGesture(event, selectedLayer)}>
                      {(['nw', 'ne', 'se', 'sw'] as const).map((handle) => <span className={`xlResizeHandle ${handle}`} role="button" aria-label={`${handle}方向缩放${selectedLayer.value}`} data-resize-handle={handle} key={handle} />)}
                      <span className="xlRotateHandle" role="button" aria-label={`旋转${selectedLayer.value}`} data-rotate-handle="true" />
                    </div>}
                    {onAir && <span className="xlOnAir">LIVE</span>}
                    {stage !== 'idle' && <span className="xlRenderState">{stage === 'error' ? '连接异常' : '数字人生成中'}</span>}
                  </div>
                  {liveRun?.mediaSourceKind === 'browser_ingest' && browserPublisherState !== 'stopped' && <div className={`xlPreviewIngestState ${browserPublisherState}`}><i />{browserPublisherState === 'live' ? '浏览器最终画面已接入媒体网关' : browserPublisherState === 'connecting' ? '正在连接 WHIP 媒体网关' : browserPublisherState === 'reconnecting' ? browserPublisherMessage || '媒体连接中断，正在重连' : browserPublisherMessage || '浏览器媒体推流失败'}</div>}
                  {error && <div className="xlPreviewError">{error}</div>}
                </div>
              </section>

              <aside className={`xlMaterialsPanel ${studioWorkspace}`} hidden={studioWorkspace === 'script'}>
                {studioWorkspace === 'decorate' && <nav className="xlMaterialTabs" aria-label="装修素材">{DECORATION_TABS.map((tabItem) => { const Icon = tabItem.icon; return <button className={materialTab === tabItem.id ? 'active' : ''} type="button" key={tabItem.id} onClick={() => { setMaterialTab(tabItem.id); closeLayerInspector(); setAssetQuery(''); setAssetBatchMode(false); setSelectedAssetIds([]); }}><Icon size={17} /><span>{tabItem.label}</span></button>; })}</nav>}
                <input ref={imageInputRef} className="xlHiddenInput" type="file" accept="image/*" multiple onChange={(event) => { void importAssets('image', event.currentTarget.files); event.currentTarget.value = ''; }} />
                <input ref={templateInputRef} className="xlHiddenInput" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void chooseTemplateBackground(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
                <input ref={documentInputRef} className="xlHiddenInput" type="file" accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json,image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { void importDocument(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
                <input ref={productDocumentInputRef} className="xlHiddenInput" type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json,image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => { void loadProductReferenceFiles(event.currentTarget.files ?? undefined); event.currentTarget.value = ''; }} />
                <input ref={productImageInputRef} className="xlHiddenInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => { void loadProductReferenceImages(event.currentTarget.files ?? undefined); event.currentTarget.value = ''; }} />
                <div className="xlMaterialsWorkspace">
                  <div className="xlMaterialsScroll" ref={materialsScrollRef}>
                  {studioWorkspace === 'decorate' && inspectorLayer ? (
                    <section className="xlLayerInspector">
                      <header className="xlInspectorHeader"><strong>调整</strong><button type="button" aria-label="关闭调整面板" onClick={closeLayerInspector}><X size={16} /></button></header>
                      <div className="xlInspectorBody">
                        <div className="xlInspectorSection"><strong>位置</strong><div className="xlInspectorPosition"><label><span>X</span><input aria-label="图层横向位置" type="number" min="-100" max="200" value={inspectorLayer.x} onChange={(event) => updateLayer(inspectorLayer.id, { x: Math.max(-100, Math.min(200, Number(event.target.value))) })} /></label><label><span>Y</span><input aria-label="图层纵向位置" type="number" min="-100" max="200" value={inspectorLayer.y} onChange={(event) => updateLayer(inspectorLayer.id, { y: Math.max(-100, Math.min(200, Number(event.target.value))) })} /></label></div></div>
                        <div className="xlInspectorSection"><strong>尺寸</strong><div className="xlInspectorPosition"><label><span>W</span><input aria-label="图层宽度" type="number" min="4" max="200" step="0.1" value={inspectorLayer.width} onChange={(event) => updateLayer(inspectorLayer.id, { width: clampCanvasValue(Number(event.target.value), 4, 200) })} /></label><label><span>H</span><input aria-label="图层高度" type="number" min="3" max="200" step="0.1" value={inspectorLayer.height} onChange={(event) => updateLayer(inspectorLayer.id, { height: clampCanvasValue(Number(event.target.value), 3, 200) })} /></label></div></div>
                        <div className="xlInspectorSection"><label className="xlInspectorField"><strong>旋转</strong><span><input aria-label="图层旋转角度" type="number" min="-180" max="180" value={inspectorLayer.rotation} onChange={(event) => updateLayer(inspectorLayer.id, { rotation: Math.max(-180, Math.min(180, Number(event.target.value))) })} /><em>°</em></span></label></div>
                        <div className="xlInspectorSection"><strong>层级</strong><div className="xlInspectorOrder"><button type="button" onClick={() => moveLayer(inspectorLayer.id, 'forward')}>向前</button><button type="button" onClick={() => moveLayer(inspectorLayer.id, 'backward')}>向后</button><button type="button" onClick={() => moveLayer(inspectorLayer.id, 'front')}>最前</button><button type="button" onClick={() => moveLayer(inspectorLayer.id, 'back')}>最后</button></div></div>
                        <div className="xlInspectorSection"><strong>对齐</strong><div className="xlInspectorAlign"><button type="button" aria-label="左对齐" onClick={() => alignLayer(inspectorLayer, 'left')}>左</button><button type="button" aria-label="水平居中" onClick={() => alignLayer(inspectorLayer, 'centerX')}>水平</button><button type="button" aria-label="右对齐" onClick={() => alignLayer(inspectorLayer, 'right')}>右</button><button type="button" aria-label="顶部对齐" onClick={() => alignLayer(inspectorLayer, 'top')}>上</button><button type="button" aria-label="垂直居中" onClick={() => alignLayer(inspectorLayer, 'centerY')}>垂直</button><button type="button" aria-label="底部对齐" onClick={() => alignLayer(inspectorLayer, 'bottom')}>下</button></div></div>
                        {inspectorLayer.kind === 'text' && <div className="xlInspectorSection xlInspectorTextStyle">
                          <strong>文本样式</strong>
                          <label className="xlInspectorWide"><span>文本内容</span><textarea aria-label="文本内容" rows={2} maxLength={80} value={inspectorLayer.value} onChange={(event) => updateLayer(inspectorLayer.id, { value: event.target.value })} /></label>
                          <label className="xlInspectorWide"><span>字体</span><select aria-label="字体" value={inspectorLayer.fontFamily ?? '默认字体'} onChange={(event) => updateLayer(inspectorLayer.id, { fontFamily: event.target.value })}>{FONT_OPTIONS.map(font => <option value={font.value} key={font.value}>{font.label}</option>)}</select></label>
                          <label><span>文字颜色</span><input aria-label="文字颜色" type="color" value={inspectorLayer.color ?? '#ffffff'} onChange={(event) => updateLayer(inspectorLayer.id, { color: event.target.value })} /></label>
                          <label><span>字号</span><input aria-label="文字字号" type="number" min="8" max="72" value={inspectorLayer.fontSize ?? 16} onChange={(event) => updateLayer(inspectorLayer.id, { fontSize: Math.max(8, Math.min(72, Number(event.target.value))) })} /></label>
                          <label><span>字距</span><input aria-label="文字字距" type="number" min="-10" max="30" value={inspectorLayer.letterSpacing ?? 0} onChange={(event) => updateLayer(inspectorLayer.id, { letterSpacing: Math.max(-10, Math.min(30, Number(event.target.value))) })} /></label>
                          <label><span>行距</span><input aria-label="文字行距" type="number" min="0.8" max="3" step="0.1" value={inspectorLayer.lineHeight ?? 1.2} onChange={(event) => updateLayer(inspectorLayer.id, { lineHeight: Math.max(0.8, Math.min(3, Number(event.target.value))) })} /></label>
                          <div className="xlTextStyleGroup"><span>修饰</span><div><button className={inspectorLayer.fontWeight === 'bold' ? 'active' : ''} type="button" aria-label="加粗" aria-pressed={inspectorLayer.fontWeight === 'bold'} onClick={() => updateLayer(inspectorLayer.id, { fontWeight: inspectorLayer.fontWeight === 'bold' ? 'normal' : 'bold' })}>B</button><button className={inspectorLayer.fontStyle === 'italic' ? 'active' : ''} type="button" aria-label="斜体" aria-pressed={inspectorLayer.fontStyle === 'italic'} onClick={() => updateLayer(inspectorLayer.id, { fontStyle: inspectorLayer.fontStyle === 'italic' ? 'normal' : 'italic' })}>I</button><button className={inspectorLayer.textDecoration === 'underline' ? 'active' : ''} type="button" aria-label="下划线" aria-pressed={inspectorLayer.textDecoration === 'underline'} onClick={() => updateLayer(inspectorLayer.id, { textDecoration: inspectorLayer.textDecoration === 'underline' ? 'none' : 'underline' })}>U</button><button className={inspectorLayer.textDecoration === 'line-through' ? 'active' : ''} type="button" aria-label="删除线" aria-pressed={inspectorLayer.textDecoration === 'line-through'} onClick={() => updateLayer(inspectorLayer.id, { textDecoration: inspectorLayer.textDecoration === 'line-through' ? 'none' : 'line-through' })}>S</button></div></div>
                          <div className="xlTextStyleGroup"><span>对齐方式</span><div>{(['left', 'center', 'right'] as const).map((alignment) => <button className={inspectorLayer.textAlign === alignment ? 'active' : ''} type="button" aria-label={`文本${alignment === 'left' ? '左' : alignment === 'center' ? '居中' : '右'}对齐`} aria-pressed={inspectorLayer.textAlign === alignment} key={alignment} onClick={() => updateLayer(inspectorLayer.id, { textAlign: alignment })}>{alignment === 'left' ? '左' : alignment === 'center' ? '中' : '右'}</button>)}</div></div>
                          <div className="xlEffectControl"><div><span>描边</span><button className={inspectorLayer.strokeEnabled ? 'on' : ''} type="button" role="switch" aria-label="描边开关" aria-checked={inspectorLayer.strokeEnabled} onClick={() => updateLayer(inspectorLayer.id, { strokeEnabled: !inspectorLayer.strokeEnabled })}><i /></button></div>{inspectorLayer.strokeEnabled && <input aria-label="描边颜色" type="color" value={inspectorLayer.strokeColor ?? '#000000'} onChange={(event) => updateLayer(inspectorLayer.id, { strokeColor: event.target.value })} />}</div>
                          <div className="xlEffectControl xlInspectorWide"><div><span>阴影</span><button className={inspectorLayer.shadowEnabled ? 'on' : ''} type="button" role="switch" aria-label="阴影开关" aria-checked={inspectorLayer.shadowEnabled} onClick={() => updateLayer(inspectorLayer.id, { shadowEnabled: !inspectorLayer.shadowEnabled })}><i /></button></div>{inspectorLayer.shadowEnabled && <div className="xlShadowFields"><input aria-label="阴影颜色" type="color" value={inspectorLayer.shadowColor ?? '#000000'} onChange={(event) => updateLayer(inspectorLayer.id, { shadowColor: event.target.value })} /><input aria-label="阴影模糊" title="模糊" type="number" min="0" max="30" value={inspectorLayer.shadowBlur ?? 8} onChange={(event) => updateLayer(inspectorLayer.id, { shadowBlur: Math.max(0, Math.min(30, Number(event.target.value))) })} /><input aria-label="阴影横向偏移" title="X" type="number" min="-30" max="30" value={inspectorLayer.shadowX ?? 4} onChange={(event) => updateLayer(inspectorLayer.id, { shadowX: Math.max(-30, Math.min(30, Number(event.target.value))) })} /><input aria-label="阴影纵向偏移" title="Y" type="number" min="-30" max="30" value={inspectorLayer.shadowY ?? 4} onChange={(event) => updateLayer(inspectorLayer.id, { shadowY: Math.max(-30, Math.min(30, Number(event.target.value))) })} /></div>}</div>
                          <div className="xlEffectControl xlInspectorWide"><div><span>文字背景</span><button className={inspectorLayer.backgroundEnabled ? 'on' : ''} type="button" role="switch" aria-label="文字背景开关" aria-checked={Boolean(inspectorLayer.backgroundEnabled)} onClick={() => updateLayer(inspectorLayer.id, { backgroundEnabled: !inspectorLayer.backgroundEnabled })}><i /></button></div>{inspectorLayer.backgroundEnabled && <div className="xlTextBackgroundFields"><input aria-label="文字背景颜色" type="color" value={inspectorLayer.backgroundColor ?? '#111827'} onChange={(event) => updateLayer(inspectorLayer.id, { backgroundColor: event.target.value })} /><label><span>透明度</span><input aria-label="文字背景透明度" type="range" min="0" max="100" value={inspectorLayer.backgroundOpacity ?? 72} onChange={(event) => updateLayer(inspectorLayer.id, { backgroundOpacity: Number(event.target.value) })} /><em>{inspectorLayer.backgroundOpacity ?? 72}%</em></label></div>}</div>
                        </div>}
                        {inspectorLayer.kind === 'image' && <div className="xlInspectorSection"><button className="xlInspectorReplaceImage" type="button" onClick={() => imageInputRef.current?.click()}><ImageIcon size={14} />替换图片</button></div>}
                        <div className="xlInspectorSection"><label className="xlOpacityField"><span><strong>不透明度</strong><em>{inspectorLayer.opacity}%</em></span><input aria-label="图层不透明度" type="range" min="0" max="100" value={inspectorLayer.opacity} onChange={(event) => updateLayer(inspectorLayer.id, { opacity: Number(event.target.value) })} /></label></div>
                        <button className="xlApplyAllGoods" type="button" onClick={() => setNotice(inspectorLayer.kind === 'host' ? '人像位置已同步到全部商品' : `“${inspectorLayer.value}”已添加至所有商品`)}>{inspectorLayer.kind === 'host' ? '同步人像位置' : '添加至所有商品'}</button>
                      </div>
                    </section>
                  ) : <div className="xlMaterialBrowser">
                    {studioWorkspace === 'decorate' && materialTab === 'template' && <div className="xlTemplateBrowser">
                      <label className="xlMaterialSearch"><input value={templateQuery} onChange={(event) => { setTemplateQuery(event.target.value); setVisibleTemplateCount(80); }} placeholder="搜索模板名称" /><Search size={15} /></label>
                      <div className="xlTemplateActions">
                        <button type="button" onClick={openTemplateDraft}><Plus size={13} />新建自定义模板</button>
                        {customTemplates.some((item) => item.id === selectedTemplateId) && <>
                          <button type="button" title="用当前画面覆盖所选模板" onClick={updateSelectedCustomTemplate}><RefreshCw size={13} />更新</button>
                          <button className="danger" type="button" title="删除所选自定义模板" onClick={deleteSelectedCustomTemplate}><Trash2 size={13} /></button>
                        </>}
                      </div>
                      {templateDraftMode && <section className="xlTemplateCreator">
                        <header><strong>新建自定义模板</strong><button type="button" aria-label="关闭自定义模板编辑" onClick={() => setTemplateDraftMode(null)}><X size={14} /></button></header>
                        <label><span>模板名称</span><input value={templateDraftName} onChange={(event) => setTemplateDraftName(event.target.value)} maxLength={24} placeholder="输入模板名称" /></label>
                        <button className={`xlTemplateBackgroundPicker ${templateDraftBackground ? 'hasImage' : ''}`} type="button" onClick={() => templateInputRef.current?.click()} disabled={templateDraftBusy}>
                          {templateDraftBackground ? <img src={templateDraftBackground} alt="自定义模板背景预览" /> : <span><Upload size={18} /><strong>{templateDraftBusy ? '正在处理背景' : '上传 9:16 背景图'}</strong><small>JPG、PNG 或 WebP，最大 15 MB</small></span>}
                          {templateDraftBackground && <em><Upload size={12} />更换背景</em>}
                        </button>
                        <button className="xlTemplateSaveButton" type="button" disabled={!templateDraftName.trim() || !templateDraftBackground || templateDraftBusy} onClick={saveCustomTemplate}><Save size={13} />保存并应用</button>
                      </section>}
                      {templateStorageError && <div className="xlTemplateStorageError">{templateStorageError}</div>}
                      {templateLoadError && <div className="xlTemplateStorageError">{templateLoadError}</div>}
                      {(selectedTemplate.pageCount ?? 1) > 1 && <div className="xlTemplatePages"><span>画布页面</span><div>{Array.from({ length: selectedTemplate.pageCount ?? 1 }, (_, pageIndex) => <button className={selectedTemplatePage === pageIndex ? 'active' : ''} type="button" disabled={roomLoading || templateLoadingId === selectedTemplate.id} aria-label={`切换到第 ${pageIndex + 1} 页`} aria-pressed={selectedTemplatePage === pageIndex} onClick={() => void applyTemplate(selectedTemplate.id, pageIndex)} key={pageIndex}>{pageIndex + 1}</button>)}</div></div>}
                      <div className="xlMaterialFilters"><label><select aria-label="模板类型" value={templateCategory} onChange={(event) => { setTemplateCategory(event.target.value); setVisibleTemplateCount(80); }}>{templateCategories.map((item) => <option value={item} key={item}>类型：{item}</option>)}</select><ChevronDown size={12} /></label><label><select aria-label="模板颜色" value={templateColor} onChange={(event) => { setTemplateColor(event.target.value); setVisibleTemplateCount(80); }}>{templateColors.map((item) => <option value={item} key={item}>颜色：{item}</option>)}</select><ChevronDown size={12} /></label></div>
                      <div className="xlTemplateGrid">{filteredTemplates.map((template) => <article className={`xlTemplateCard ${selectedTemplateId === template.id ? 'selected' : ''}`} key={template.id}><button type="button" disabled={roomLoading || templateLoadingId === template.id} aria-busy={templateLoadingId === template.id} onClick={() => void applyTemplate(template.id)}><span className="xlTemplateCover"><img src={template.image} alt={template.name} loading="lazy" decoding="async" />{template.custom ? <i>我的</i> : template.source && <i>{templateLoadingId === template.id ? '读取中' : '一镜'}</i>}{(template.pageCount ?? 1) > 1 && <small>{template.pageCount} 页</small>}</span><strong>{template.name}</strong></button></article>)}</div>
                      {filteredTemplates.length < matchingTemplates.length && <button className="xlTemplateLoadMore" type="button" onClick={() => setVisibleTemplateCount((count) => count + 80)}>加载更多（{filteredTemplates.length}/{matchingTemplates.length}）</button>}
                      {!filteredTemplates.length && <div className="xlMaterialNoResult">没有找到匹配模板</div>}
                    </div>}

                    {studioWorkspace === 'host' && materialTab === 'host' && <div className="xlHostPicker">
                      <div className="xlHostFilters" aria-label="数字人筛选">
                        <div className="xlHostGenderFilter"><span>性别</span>{(['全部', '女', '男'] as const).map((gender) => <button className={hostFilters.gender === gender ? 'active' : ''} type="button" aria-pressed={hostFilters.gender === gender} onClick={() => setHostFilters((filters) => ({ ...filters, gender }))} key={gender}>{gender}</button>)}</div>
                        <label><span>使用场景</span><span><select aria-label="主播使用场景" value={hostFilters.scene} onChange={(event) => setHostFilters((filters) => ({ ...filters, scene: event.target.value }))}><option>全部场景</option><option>播报</option><option>对话</option><option>直播</option></select><ChevronDown size={12} /></span></label>
                      </div>
                      <div className="xlHostGrid">
                        {visibleHosts.map((item) => <button className={`xlHostCard ${avatarId === item.id ? 'selected' : ''}`} type="button" key={item.id} disabled={roomLoading || onAir} aria-label={`选择数字人 ${item.name}`} aria-pressed={avatarId === item.id} onClick={() => { if (item.id === avatarId) { setNotice('当前已使用该主播'); return; } applyAvatar(item.id); }}><span className="xlHostPortrait"><img src={item.image} alt="" loading="lazy" decoding="async" />{avatarId === item.id && <i><Check size={13} /></i>}</span><span className="xlHostMeta"><strong>{item.name}</strong><small>{item.role}</small></span></button>)}
                      </div>
                      {!visibleHosts.length && <div className="xlMaterialNoResult">没有找到匹配主播</div>}
                    </div>}

                    {studioWorkspace === 'decorate' && materialTab === 'image' && <div className="xlAssetPanel"><label className="xlMaterialSearch"><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="搜索图片名称" /><Search size={15} /></label><div className="xlAssetToolbar"><div><button className={assetScope === 'mine' ? 'active' : ''} type="button" onClick={() => { setAssetScope('mine'); setSelectedAssetIds([]); }}>我的</button><button className={assetScope === 'square' ? 'active' : ''} type="button" onClick={() => { setAssetScope('square'); setSelectedAssetIds([]); }}>广场</button></div><span><button type="button" onClick={() => imageInputRef.current?.click()}><Upload size={13} />导入</button><button className={assetBatchMode ? 'active' : ''} type="button" onClick={() => { setAssetBatchMode((value) => !value); setSelectedAssetIds([]); }}>批量</button></span></div>{assetBatchMode && <div className="xlAssetBatchToolbar"><button type="button" onClick={() => setSelectedAssetIds(selectedAssetIds.length === currentAssets.length ? [] : currentAssets.map((item) => item.id))}>{currentAssets.length > 0 && selectedAssetIds.length === currentAssets.length ? <CheckSquare size={14} /> : <span className="xlEmptyCheck" />}全选</button><button type="button" disabled={!selectedAssetIds.length || assetScope !== 'mine'} onClick={deleteSelectedAssets}><Trash2 size={14} />删除已选</button></div>}{assetScope === 'mine' && currentAssets.length === 0 ? <div className="xlMaterialEmpty"><span><ImageIcon size={26} /></span><strong>暂无图片素材</strong><p>导入只会加入“我的素材”，点击素材卡片才会添加到直播画面。</p><button type="button" onClick={() => imageInputRef.current?.click()}><Plus size={14} />导入素材</button></div> : <div className="xlAssetCards">{currentAssets.map((asset) => { const selected = selectedAssetIds.includes(asset.id); return <article className="xlAssetCardWrap" key={asset.id}><button className={`xlAssetCard ${selected ? 'selected' : ''}`} type="button" onClick={() => assetBatchMode ? toggleAssetSelection(asset.id) : addAssetToCanvas(asset)}>{asset.preview ? <img src={asset.preview} alt="" /> : <span><ImageIcon size={22} /></span>}<strong>{asset.name}</strong>{assetBatchMode && <i>{selected ? <Check size={12} /> : null}</i>}</button>{assetScope === 'mine' && !assetBatchMode && <button className="xlAssetDelete" type="button" title={`删除图片“${asset.name}”`} aria-label={`删除图片“${asset.name}”`} onClick={() => deleteAsset(asset.id)}><Trash2 size={12} /></button>}</article>; })}</div>}</div>}

                    {studioWorkspace === 'decorate' && materialTab === 'text' && <div className="xlTextMaterial">
                      <h3>{selectedTextLayer ? '编辑文本' : '添加文本'}</h3>
                      <label><span>文本内容</span><textarea value={textMaterialValue} onChange={(event) => updateTextMaterialValue(event.target.value)} maxLength={80} rows={2} /></label>
                      <div className="xlTextMaterialGrid">
                        <label><span>字体</span><select value={textMaterialStyle.fontFamily} onChange={(event) => updateTextMaterialStyle({ fontFamily: event.target.value })}>{FONT_OPTIONS.map(font => <option value={font.value} key={font.value}>{font.label}</option>)}</select></label>
                        <label><span>字号</span><input aria-label="文字字号" type="number" min="8" max="72" value={textMaterialStyle.fontSize} onChange={(event) => updateTextMaterialStyle({ fontSize: clampCanvasValue(Number(event.target.value), 8, 72) })} /></label>
                        <label><span>文字颜色</span><input aria-label="文字颜色" type="color" value={textMaterialStyle.color} onChange={(event) => updateTextMaterialStyle({ color: event.target.value })} /></label>
                      </div>
                      <div className="xlTextFormatToolbar" aria-label="文本格式">
                        <button className={textMaterialStyle.fontWeight === 'bold' ? 'active' : ''} type="button" aria-label="加粗" aria-pressed={textMaterialStyle.fontWeight === 'bold'} onClick={() => updateTextMaterialStyle({ fontWeight: textMaterialStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}><strong>B</strong></button>
                        <button className={textMaterialStyle.fontStyle === 'italic' ? 'active' : ''} type="button" aria-label="斜体" aria-pressed={textMaterialStyle.fontStyle === 'italic'} onClick={() => updateTextMaterialStyle({ fontStyle: textMaterialStyle.fontStyle === 'italic' ? 'normal' : 'italic' })}><i>I</i></button>
                        <button className={textMaterialStyle.textDecoration === 'underline' ? 'active' : ''} type="button" aria-label="下划线" aria-pressed={textMaterialStyle.textDecoration === 'underline'} onClick={() => updateTextMaterialStyle({ textDecoration: textMaterialStyle.textDecoration === 'underline' ? 'none' : 'underline' })}><u>U</u></button>
                        {([['left', AlignLeft, '左对齐'], ['center', AlignCenter, '居中对齐'], ['right', AlignRight, '右对齐']] as const).map(([alignment, Icon, label]) => <button className={textMaterialStyle.textAlign === alignment ? 'active' : ''} type="button" aria-label={label} aria-pressed={textMaterialStyle.textAlign === alignment} onClick={() => updateTextMaterialStyle({ textAlign: alignment })} key={alignment}><Icon size={14} /></button>)}
                      </div>
                      <section className="xlTextBackgroundControl">
                        <header><span>文字背景</span><button className={textMaterialStyle.backgroundEnabled ? 'on' : ''} type="button" role="switch" aria-label="文字背景开关" aria-checked={textMaterialStyle.backgroundEnabled} onClick={() => updateTextMaterialStyle({ backgroundEnabled: !textMaterialStyle.backgroundEnabled })}><i /></button></header>
                        {textMaterialStyle.backgroundEnabled && <div><label><span>颜色</span><input aria-label="文字背景颜色" type="color" value={textMaterialStyle.backgroundColor} onChange={(event) => updateTextMaterialStyle({ backgroundColor: event.target.value })} /></label><label><span>透明度</span><input aria-label="文字背景透明度" type="range" min="0" max="100" value={textMaterialStyle.backgroundOpacity} onChange={(event) => updateTextMaterialStyle({ backgroundOpacity: Number(event.target.value) })} /><em>{textMaterialStyle.backgroundOpacity}%</em></label></div>}
                      </section>
                      <label className="xlTextOpacityControl"><span>整体透明度</span><input aria-label="文字整体透明度" type="range" min="0" max="100" value={textMaterialStyle.opacity} onChange={(event) => updateTextMaterialStyle({ opacity: Number(event.target.value) })} /><em>{textMaterialStyle.opacity}%</em></label>
                      <div className="xlTextPreview"><span style={{ opacity: textMaterialStyle.opacity / 100, color: textMaterialStyle.color, background: textMaterialStyle.backgroundEnabled ? colorWithOpacity(textMaterialStyle.backgroundColor, textMaterialStyle.backgroundOpacity) : 'transparent', fontFamily: fontFamilyCss(textMaterialStyle.fontFamily), fontSize: `${textMaterialStyle.fontSize}px`, fontWeight: textMaterialStyle.fontWeight, fontStyle: textMaterialStyle.fontStyle, textDecoration: textMaterialStyle.textDecoration, textAlign: textMaterialStyle.textAlign, justifyContent: textMaterialStyle.textAlign === 'left' ? 'flex-start' : textMaterialStyle.textAlign === 'right' ? 'flex-end' : 'center' }}>{textMaterialValue || '请输入文本内容'}</span></div>
                      {selectedTextLayer
                        ? <button type="button" onClick={() => { setSelectedLayerId(null); setInspectorLayerId(null); setNotice('文本样式已更新'); }}><Check size={14} />完成编辑</button>
                        : <button type="button" disabled={!textMaterialValue.trim()} onClick={addTextToCanvas}><Plus size={14} />添加到直播画面</button>}
                    </div>}
                  </div>}
                  </div>
                </div>
              </aside>

              <section className="xlLayers xlLayersPanel">
                <header><strong>图层</strong><span>{layers.length}</span></header>
                <div className="xlLayerList" ref={layerListRef} role="list" aria-label="直播画面图层，按从前到后排序">{layers.map((layer) => {
                    const Icon = layer.kind === 'text' ? Type : layer.kind === 'image' ? ImageIcon : layer.kind === 'video' ? Video : UserRound;
                    const background = layer.sceneKey === 'templateBackground';
                    const dropClass = layerDropTarget?.id === layer.id ? `drop-${layerDropTarget.position}` : '';
                    return <div className={`xlLayerRow ${selectedLayerId === layer.id ? 'selected' : ''} ${draggingLayerId === layer.id ? 'dragging' : ''} ${dropClass}`} role="listitem" tabIndex={0} data-layer-id={layer.id} key={layer.id} onClick={() => selectCanvasLayer(layer)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCanvasLayer(layer); } }} onDragOver={(event) => { if (!draggingLayerId || draggingLayerId === layer.id) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setLayerDropTarget({ id: layer.id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }); }} onDrop={(event) => { event.preventDefault(); if (draggingLayerId) { const rect = event.currentTarget.getBoundingClientRect(); reorderLayer(draggingLayerId, layer.id, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'); } setDraggingLayerId(null); setLayerDropTarget(null); }}>
                      <span className={`xlLayerDragHandle ${background ? 'locked' : ''}`} draggable={!background} role="button" tabIndex={background ? -1 : 0} title={background ? '模板背景固定在底层' : '拖动调整图层层级'} aria-label={background ? '模板背景固定在底层' : `拖动${layer.value}图层调整层级`} onClick={(event) => event.stopPropagation()} onDragStart={(event) => { if (background) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', layer.id); setDraggingLayerId(layer.id); }} onDragEnd={() => { setDraggingLayerId(null); setLayerDropTarget(null); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'ArrowUp') { event.preventDefault(); moveLayer(layer.id, 'forward'); } if (event.key === 'ArrowDown') { event.preventDefault(); moveLayer(layer.id, 'backward'); } }}><GripVertical size={14} /></span>
                      <span className="xlLayerThumb">{layer.preview && layer.kind === 'image' ? <img src={layer.preview} alt="" /> : <Icon size={14} />}</span>
                      {layer.kind === 'text' ? <input aria-label={`修改${layer.value}图层文本`} value={layer.value} maxLength={80} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => updateLayer(layer.id, { value: event.target.value })} /> : <em>{layer.value}</em>}
                      <button className="xlLayerDelete" type="button" aria-label={`删除${layer.value}图层`} onClick={(event) => { event.stopPropagation(); deleteLayer(layer.id); }}><Trash2 size={13} /></button>
                    </div>;
                  })}</div>
              </section>
            </div>
          <section className="xlStoryboardRail" aria-label="分镜">
            <header>
              <span className="xlSynthesisOverview" role="status" aria-live="polite" title="已完成成片数 / 分镜总数">{scriptVideosReady}/{scriptVideoProgressTotal}</span>
              <button className="xlSynthesizeSelected" type="button" title={selectedStoryboardVideoBusy ? '云端正在生成当前分镜' : '使用当前主播和音色合成选中分镜的数字人口播视频'} aria-label={selectedStoryboardVideoBusy ? '当前分镜合成中' : '合成选中分镜'} aria-busy={selectedStoryboardVideoBusy} disabled={!selectedStoryboardScript || scriptVideoBatchBusy || dynamicGenerating || roomSaving || roomLoading || playbackBusy || onAir || !selectedStoryboardScript.text.trim() || selectedStoryboardVideoBusy} onClick={() => { if (selectedStoryboardScript) void synthesizeScriptVideos([selectedStoryboardScript]); }}>{selectedStoryboardVideoBusy ? <LoaderCircle className="xlVoiceSpinner" size={15} /> : <Video size={15} />}<span>{selectedStoryboardVideoBusy ? '合成中' : '合成分镜'}</span></button>
            </header>
            <div className="xlStoryboardStrip">
              <div className="xlStoryboardFilm">
            {scripts.map((item, index) => {
              const selected = selectedScriptIds.includes(item.id);
              const focused = storyboardScriptId === item.id;
              const batchIndex = scriptVideoBatch?.scriptIds.indexOf(item.id) ?? -1;
              const storedVideoState = scriptVideoState(item);
              const videoState = batchIndex >= (scriptVideoBatch?.submitted ?? 0)
                ? (batchIndex === scriptVideoBatch?.submitted && !scriptVideoBatch?.waiting ? 'submitting' : 'queued')
                : storedVideoState;
              const videoStatusLabel = videoState === 'ready' ? '成片完成'
                : videoState === 'failed' ? '合成失败'
                  : videoState === 'stale' ? '需重新合成'
                    : videoState === 'missing' ? '未合成'
                      : videoState === 'queued' ? '待提交'
                        : videoState === 'submitting' ? '提交中'
                          : '生成中';
              const videoStatusTitle = scriptVideoSubmissionErrors[item.id]
                || (storedVideoState === 'failed' ? scriptVideoResults[item.id]?.error : '')
                || videoStatusLabel;
              const videoPreviewActive = Boolean(
                focused
                && generatedVideoVisible
                && aliyunVideo?.id === scriptVideoResults[item.id]?.id,
              );
              const videoPreviewPlaying = videoPreviewActive && generatedVideoPlaying;
              return <article className={`xlStoryboardItem ${focused ? 'focused' : ''} ${selected ? 'selected' : ''} ${item.state === 'playing' ? 'playing' : ''}`} key={item.id}>
                <button className="xlStoryboardPreview" type="button" title={`${item.title} · ${item.duration} · ${videoStatusTitle}`} aria-label={batchMode ? `${selected ? '取消选择' : '选择'}${item.title}` : `选择分镜 ${index + 1}：${item.title}`} aria-pressed={batchMode ? selected : focused} disabled={scriptVideoBatchBusy || dynamicGenerating || onAir} onClick={() => batchMode ? toggleScriptSelection(item.id) : selectStoryboardScript(item)}>
                  <StoryboardScenePreview layers={layers} background={previewBackground} host={avatar.image} fonts={FONT_FAMILIES} videoUrl={storedVideoState === 'ready' ? scriptVideoResults[item.id]?.videoUrl : undefined} />
                  <b>{index + 1}</b>
                  {batchMode && <i className="xlStoryboardCheck">{selected ? <Check size={12} /> : null}</i>}
                  <em className={`xlStoryboardStatus ${videoState}`} title={videoStatusTitle}>{['processing', 'submitting'].includes(videoState) && <LoaderCircle className="xlVoiceSpinner" size={9} />}{videoState === 'ready' ? '成片' : videoState === 'stale' ? '更新' : videoState === 'failed' ? '失败' : '待合成'}</em>
                </button>
                {storedVideoState === 'ready' && <button className={`xlStoryboardPlay ${videoPreviewPlaying ? 'playing' : ''}`} type="button" title={`${videoPreviewPlaying ? '暂停' : videoPreviewActive ? '继续播放' : '播放'}“${item.title}”成片`} aria-label={`${videoPreviewPlaying ? '暂停' : videoPreviewActive ? '继续播放' : '播放'}分镜 ${index + 1} 成片`} aria-pressed={videoPreviewPlaying} disabled={scriptVideoBatchBusy || dynamicGenerating || playbackBusy || playbackQueueStatus !== 'idle' || onAir || roomLoading} onClick={() => {
                  const element = generatedVideoRef.current;
                  if (!videoPreviewActive || !element) {
                    previewScriptAvatarVideo(item);
                    return;
                  }
                  if (element.paused || element.ended) {
                    if (element.ended) element.currentTime = 0;
                    void element.play().catch((cause) => setError(cause instanceof Error ? cause.message : '成片播放失败'));
                  } else element.pause();
                }}>{videoPreviewPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>}
                <span className="xlStoryboardActions">
                  <button type="button" title="复制该分镜" aria-label={`复制分镜 ${index + 1}`} disabled={scriptVideoBatchBusy || dynamicGenerating || playbackBusy || playbackQueueStatus !== 'idle' || onAir || roomLoading} onClick={() => duplicateScript(item)}><Copy size={14} /></button>
                  <button type="button" title="删除该分镜" aria-label={`删除分镜 ${index + 1}`} disabled={scriptVideoBatchBusy || dynamicGenerating || playbackBusy || playbackQueueStatus !== 'idle' || onAir || roomLoading} onClick={() => deleteScript(item.id)}><Trash2 size={14} /></button>
                </span>
              </article>;
            })}
              <div className="xlStoryboardCommands"><button className="xlStoryboardAdd" type="button" title={storyboardScriptId === null && draft.trim() ? '加入分镜' : '编写新分镜'} aria-label={storyboardScriptId === null && draft.trim() ? '加入分镜' : '编写新分镜'} disabled={scriptVideoBatchBusy || dynamicGenerating || onAir} onClick={() => storyboardScriptId === null && draft.trim() ? addDraftToScripts() : startNewScriptDraft()}><Plus size={20} /></button>
              </div></div>
            </div>
          </section>
          </>
        </section>
      </div>

      {notice && <div className="xlToast" role="status"><Check size={15} />{notice}</div>}

      {dialog === 'productPicker' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}>
        <section className="xlModal xlProductPickerModal" role="dialog" aria-modal="true" aria-label="选择直播商品" onMouseDown={(event) => event.stopPropagation()}>
          <header><span><ShoppingBag size={17} /><strong>选择直播商品</strong></span><button type="button" aria-label="关闭商品选择" onClick={() => setDialog(null)}><X size={17} /></button></header>
          <div className="xlProductPickerBody">
            <div className="xlProductPickerMain">
              <nav className="xlProductPickerTabs" aria-label="商品来源">{([['platform', '平台商品'], ['script_library', '脚本库'], ['self_built', '自建商品']] as const).map(([id, label]) => <button className={productPickerTab === id ? 'active' : ''} type="button" key={id} onClick={() => { setProductPickerTab(id); setProductQuery(''); }}>{label}</button>)}</nav>
              <div className="xlProductPickerToolbar"><button type="button" onClick={() => setProductCatalogRefreshVersion((value) => value + 1)} disabled={productCatalogLoading}><RefreshCw className={productCatalogLoading ? 'xlVoiceSpinner' : ''} size={14} />刷新数据</button><label><Search size={15} /><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="搜索商品名称或 SKU" /></label></div>

              {productPickerTab === 'self_built' && <form className="xlProductDraftForm" onSubmit={saveSelfBuiltProduct}>
                <div className="xlProductDraftTitle"><span><Plus size={15} /><strong>新建自建商品</strong></span><small>保存后进入商品库，可跨直播间重复选择</small></div>
                <div className="xlProductDraftGrid">
                  <label><span>商品名称 *</span><input value={productDraft.name} onChange={(event) => updateProductDraft({ name: event.target.value })} placeholder="例如：精品咖啡豆" maxLength={200} /></label>
                  <label><span>SKU</span><input value={productDraft.sku} onChange={(event) => updateProductDraft({ sku: event.target.value })} placeholder="内部商品编码" maxLength={160} /></label>
                  <label className="wide"><span>商品图片 URL</span><input value={productDraft.imageUrl ?? ''} onChange={(event) => updateProductDraft({ imageUrl: event.target.value || undefined })} placeholder="https://..." /></label>
                  <label><span>直播价</span><input type="number" min="0" step="0.01" value={productDraft.price ?? ''} onChange={(event) => updateProductDraft({ price: event.target.value ? Number(event.target.value) : undefined })} placeholder="0.00" /></label>
                  <label><span>原价</span><input type="number" min="0" step="0.01" value={productDraft.originalPrice ?? ''} onChange={(event) => updateProductDraft({ originalPrice: event.target.value ? Number(event.target.value) : undefined })} placeholder="0.00" /></label>
                  <label className="wide"><span>商品卖点</span><textarea value={productDraftSellingPoints} onChange={(event) => { setProductDraftSellingPoints(event.target.value); setProductGeneratedScripts([]); }} placeholder="每行一个卖点，或使用逗号分隔" rows={2} /></label>
                  <label><span>库存提示</span><input value={productDraft.stockMessage} onChange={(event) => updateProductDraft({ stockMessage: event.target.value })} placeholder="例如：现货 100 件" /></label>
                  <label><span>售后说明</span><input value={productDraft.afterSales} onChange={(event) => updateProductDraft({ afterSales: event.target.value })} placeholder="例如：七天无理由" /></label>
                  <label className="wide"><span>风险词</span><input value={productDraftRiskWords} onChange={(event) => { setProductDraftRiskWords(event.target.value); setProductGeneratedScripts([]); }} placeholder="多个风险词用逗号分隔" /></label>
                </div>
                <section className="xlProductAiSources" aria-label="AI 商品参考资料">
                  <div className="xlProductAiSourceHeader"><span><Sparkles size={14} /><strong>AI 参考资料</strong></span><small>可单独上传图片，也可同时结合文档与商品信息生成</small></div>
                  <div className="xlProductGenerationOptions">
                    <label><span>生成条数</span><input type="number" min="1" max="10" step="1" value={productScriptCount} onChange={(event) => { setProductScriptCount(Math.min(10, Math.max(1, Number(event.target.value) || 1))); setProductGeneratedScripts([]); }} /><small>条</small></label>
                    <label><span>单条文本上限</span><input type="number" min="40" max="1000" step="10" value={productScriptMaxCharacters} onChange={(event) => { setProductScriptMaxCharacters(Math.min(1000, Math.max(40, Number(event.target.value) || 40))); setProductGeneratedScripts([]); }} /><small>字</small></label>
                    <label><span>话术风格</span><select value={productScriptStyle} onChange={(event) => { setProductScriptStyle(event.target.value as ProductScriptStyle); setProductGeneratedScripts([]); }}>{PRODUCT_SCRIPT_STYLES.map((style) => <option value={style} key={style}>{style}</option>)}</select></label>
                  </div>
                  <label className="xlProductGenerationDirection"><span>受众与表达要求</span><input value={productScriptDirection} onChange={(event) => { setProductScriptDirection(event.target.value); setProductGeneratedScripts([]); }} placeholder="例如：面向办公室人群，语气自然，重点讲香气和冲泡便利" maxLength={500} /></label>
                  <div className="xlProductAiSourceGrid">
                    <div className="xlProductDocumentSource">
                      <header><span><FileText size={14} /><strong>商品文档与配图</strong></span><button type="button" onClick={() => productDocumentInputRef.current?.click()}><Upload size={13} />{productReferenceDocumentName || productReferenceImages.length ? '添加资料' : '上传资料'}</button></header>
                      {productReferenceDocumentName && <div className="xlProductSourceFile"><span title={productReferenceDocumentName}>{productReferenceDocumentName}</span><button type="button" aria-label="移除商品文档" onClick={() => { setProductReferenceDocumentName(''); setProductReferenceText(''); setProductGeneratedScripts([]); }}><X size={12} /></button></div>}
                      <textarea value={productReferenceText} onChange={(event) => { setProductReferenceText(event.target.value); setProductGeneratedScripts([]); }} placeholder="上传 TXT、MD、CSV、JSON 和配图，或直接粘贴商品规格、材质与使用说明" rows={4} maxLength={20000} />
                    </div>
                    <div className="xlProductImageSource">
                      <header><span><ImageIcon size={14} /><strong>商品参考图（{productReferenceImages.length}/6）</strong></span><button type="button" disabled={productReferenceImages.length >= 6} onClick={() => productImageInputRef.current?.click()}><Upload size={13} />{productReferenceImages.length ? '继续添加' : '多图上传'}</button></header>
                      {productReferenceImages.length ? <div className="xlProductImagePreviews">{productReferenceImages.map((image) => <div className="xlProductImagePreview" key={image.id}><img src={image.dataUrl} alt="商品 AI 参考预览" /><button type="button" aria-label={`移除参考图${image.name}`} onClick={() => { setProductReferenceImages((items) => items.filter((item) => item.id !== image.id)); setProductGeneratedScripts([]); }}><X size={13} /></button><span title={image.name}>{image.name}</span></div>)}</div> : <button className="xlProductImageDrop" type="button" onClick={() => productImageInputRef.current?.click()}><ImageIcon size={24} /><span>可一次选择多张 JPG、PNG、WebP 或 GIF</span><small>最多 6 张，单张最大 10 MB</small></button>}
                    </div>
                  </div>
                </section>
                {productGeneratedScripts.length > 0 && <section className="xlProductGeneratedScripts" aria-label="AI 生成话术">
                  <header><span><WandSparkles size={14} /><strong>生成结果</strong></span><small>保存商品前可直接修改标题、类型和正文</small></header>
                  <div>{productGeneratedScripts.map((script, index) => <article key={`${script.category}-${index}`}>
                    <div><input aria-label={`第${index + 1}段话术标题`} value={script.title} onChange={(event) => updateProductGeneratedScript(index, { title: event.target.value })} maxLength={200} /><select aria-label={`第${index + 1}段话术类型`} value={script.category} onChange={(event) => updateProductGeneratedScript(index, { category: event.target.value as ProductScriptDraft['category'] })}><option>开场</option><option>讲品</option><option>促单</option></select></div>
                    <textarea aria-label={`第${index + 1}段话术内容`} value={script.text} onChange={(event) => updateProductGeneratedScript(index, { text: event.target.value })} rows={5} maxLength={productScriptMaxCharacters} />
                  </article>)}</div>
                </section>}
                <div className="xlProductDraftActions">{productGeneratedScripts.length > 0 && <button className="secondary" type="button" disabled={productDraftGenerating} onClick={() => void generateProductDraftScripts()}><WandSparkles size={14} />重新生成</button>}<button type="submit" disabled={!productDraft.name.trim() || productDraftSaving || productDraftGenerating}>{productDraftGenerating || productDraftSaving ? <LoaderCircle className="xlVoiceSpinner" size={14} /> : productGeneratedScripts.length ? <Save size={14} /> : <WandSparkles size={14} />}{productDraftGenerating ? 'LiteLLM 生成中' : productDraftSaving ? '保存中' : productGeneratedScripts.length ? '确认保存并加入' : '确认并生成话术'}</button></div>
              </form>}

              {productCatalogError && <div className="xlProductPickerError">{productCatalogError}</div>}
              {productPickerTab === 'platform' && !productCatalogLoading && !visibleCatalogProducts.length && <div className="xlProductCatalogEmpty"><Link2 size={32} /><strong>还没有授权可读取商品的商家或达人账号</strong><p>RTMP 推流连接不能读取商品。配置平台开放应用并完成 OAuth 后，平台商品才会出现在这里。</p><button type="button" disabled>等待平台 App ID / Secret</button></div>}
              {productPickerTab === 'script_library' && !productCatalogLoading && !visibleCatalogProducts.length && <div className="xlProductCatalogEmpty"><BookOpenText size={32} /><strong>脚本库里还没有关联商品</strong><p>在直播控制台选中商品并点击“保存到脚本库”，下次即可从这里恢复商品和话术。</p></div>}
              {productPickerTab === 'self_built' && !productCatalogLoading && !visibleCatalogProducts.length && <div className="xlProductCatalogEmpty compact"><PackageOpen size={28} /><strong>还没有自建商品</strong><p>填写上方商品资料后保存，系统不会再创建空白占位商品。</p></div>}
              {productCatalogLoading ? <div className="xlProductCatalogLoading"><LoaderCircle className="xlVoiceSpinner" size={17} />正在加载商品库</div> : visibleCatalogProducts.length > 0 && <div className="xlProductCatalogGrid">{visibleCatalogProducts.map((product) => {
                const selected = selectedCatalogProductIds.includes(product.id);
                return <article className={selected ? 'selected' : ''} key={product.id}><button className="xlProductCatalogSelect" type="button" role="checkbox" aria-checked={selected} onClick={() => toggleCatalogProduct(product.id)}><span className="xlProductCatalogCheck">{selected && <Check size={13} />}</span><span className="xlProductCatalogImage">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageOpen size={24} />}</span><span className="xlProductCatalogCopy"><strong>{product.name}</strong><small>{product.sku || productSourceLabel(product)}</small>{typeof product.price === 'number' && <b>¥{product.price.toFixed(2)}</b>}</span></button>{product.sourceType === 'self_built' && <button className="xlProductCatalogDelete" type="button" title="永久删除自建商品" aria-label={`永久删除${product.name}`} onClick={() => setCatalogProductToDelete(product)}><Trash2 size={13} /></button>}</article>;
              })}</div>}
            </div>
            <aside className="xlSelectedProducts">
              <header><span><strong>直播商品单</strong><small>已选 {selectedCatalogProductIds.length} 件</small></span></header>
              <div>{selectedProductSummary.map((product, index) => <article key={String(product.id)}><span className="xlSelectedProductIndex">{index + 1}</span><span className="xlSelectedProductImage">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageOpen size={17} />}</span><span><strong>{product.name}</strong><small>{typeof product.price === 'number' ? `¥${product.price.toFixed(2)}` : ('source' in product ? product.source : productSourceLabel(product))}</small></span><span className="xlSelectedProductActions"><button type="button" aria-label={`上移${product.name}`} disabled={index === 0} onClick={() => moveSelectedCatalogProduct(String(product.id), -1)}><ArrowUp size={12} /></button><button type="button" aria-label={`下移${product.name}`} disabled={index === selectedProductSummary.length - 1} onClick={() => moveSelectedCatalogProduct(String(product.id), 1)}><ArrowDown size={12} /></button><button type="button" aria-label={`移除${product.name}`} onClick={() => toggleCatalogProduct(String(product.id))}><X size={13} /></button></span></article>)}</div>
              {!selectedProductSummary.length && <div className="xlSelectedProductsEmpty"><ShoppingBag size={28} /><span>从左侧选择直播商品</span></div>}
            </aside>
          </div>
          <footer className="xlProductPickerFooter"><span>确认后会保留完整商品资料，并为新增商品生成或恢复关联话术。</span><div><button type="button" onClick={() => setDialog(null)}>取消</button><button type="button" disabled={!selectedCatalogProductIds.length || productSelectionSaving} onClick={() => void applyProductSelection()}>{productSelectionSaving ? <LoaderCircle className="xlVoiceSpinner" size={14} /> : <Check size={14} />}{productSelectionSaving ? '正在更新' : '加入直播间'}</button></div></footer>
        </section>
      </div>}

      {dialog === 'voice' && <div className="xlModalBackdrop" onMouseDown={closeVoiceDialog}>
        <section className={`xlModal xlVoiceModal ${voiceTab === 'mine' ? 'cloneMode' : ''}`} role="dialog" aria-modal="true" aria-label="主播声音" onMouseDown={(event) => event.stopPropagation()}>
          <header><strong>主播声音</strong><button type="button" aria-label="关闭主播声音" onClick={closeVoiceDialog}><X size={17} /></button></header>
          <div className="xlPlatformNotice"><ShieldCheck size={15} /><span><strong>官方公共音色</strong><small>已同步 35 个官方音色与原声试听</small></span></div>
          <div className="xlVoiceToolbar">
            <div role="tablist" aria-label="声音来源"><button className={voiceTab === 'public' ? 'active' : ''} type="button" role="tab" aria-selected={voiceTab === 'public'} onClick={() => { stopVoicePreview(); setVoiceTab('public'); }}>公共音色</button><button className={voiceTab === 'mine' ? 'active' : ''} type="button" role="tab" aria-selected={voiceTab === 'mine'} onClick={() => { stopVoicePreview(); setVoiceTab('mine'); }}>克隆语音</button></div>
            {voiceTab !== 'mine' && <label><input aria-label="搜索主播声音" value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)} placeholder="搜索音色名称或特点" /><Search size={16} /></label>}
          </div>
          {voiceTab !== 'mine' ? <><div className="xlVoiceFilters">
            <div role="radiogroup" aria-label="声音性别">{(['全部性别', '男性', '女性'] as const).map((gender) => <button className={voiceGender === gender ? 'active' : ''} type="button" role="radio" aria-checked={voiceGender === gender} key={gender} onClick={() => setVoiceGender(gender)}>{gender}</button>)}</div>
            <div role="radiogroup" aria-label="声音语言">{(['全部语言', '中英文', '英文', '日文', '韩文'] as const).map((language) => <button className={voiceLanguage === language ? 'active' : ''} type="button" role="radio" aria-checked={voiceLanguage === language} key={language} onClick={() => setVoiceLanguage(language)}>{language}</button>)}</div>
          </div>
          <div className="xlVoiceGrid" role="tabpanel" aria-label={voiceTab === 'public' ? '公共声音' : '我的声音'}>
            {filteredVoices.map((voice) => {
              const playing = previewVoiceId === voice.id;
              const loading = previewVoiceLoadingId === voice.id;
              return <div className={`xlVoiceCard ${pendingVoiceId === voice.id ? 'selected' : ''} ${playing ? 'playing' : ''}`} role="radio" tabIndex={0} aria-label={`选择声音${voice.name}`} aria-checked={pendingVoiceId === voice.id} key={voice.id} onClick={() => setPendingVoiceId(voice.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPendingVoiceId(voice.id); } }}>
                <button className="xlVoiceListen" type="button" aria-label={playing || loading ? `停止试听${voice.name}` : `试听${voice.name}`} onClick={(event) => { event.stopPropagation(); void auditionVoice(voice); }}>
                  <span className="xlVoiceGlyph" aria-hidden="true"><Volume2 size={22} /></span>
                  <i aria-hidden="true">{loading ? <LoaderCircle className="xlVoiceSpinner" size={17} /> : playing ? <CircleStop size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</i>
                </button>
                <span title={`${voice.providerName} · ${voice.officialId}`}><strong>{voice.name}</strong><p>{voice.description}</p><small><em>{voice.language}</em><em>{voice.gender}</em>{voice.supportSsml && <em>SSML</em>}</small>{playing && <b aria-hidden="true"><i /><i /><i /></b>}</span>
              </div>;
            })}
            {!filteredVoices.length && <div className="xlVoiceEmpty"><UserRound size={34} /><strong>没有匹配的声音</strong><span>请调整关键词或筛选条件后重试</span></div>}
          </div>
          <footer className="xlVoiceFooter">
            <div className="xlVoiceTuning"><label><span>语速</span><input aria-label="主播语速" type="range" min="0.5" max="2" step="0.1" value={pendingVoiceSpeed} onChange={(event) => { stopVoicePreview(); setPendingVoiceSpeed(Number(event.target.value)); }} /><em>{pendingVoiceSpeed.toFixed(1)}x</em></label><label><span>语调</span><input aria-label="主播语调" type="range" min="0" max="5" step="1" value={pendingVoicePitch} onChange={(event) => { stopVoicePreview(); setPendingVoicePitch(Number(event.target.value)); }} /><em>{pendingVoicePitch}</em></label></div>
            <div><button type="button" onClick={closeVoiceDialog}>取消</button><button type="button" onClick={() => applyVoice('current')}>应用</button><button type="button" onClick={() => applyVoice('all')}>应用至全部</button></div>
          </footer>
          </> : <>
            <div className="xlVoiceClonePanel">
              <div className="xlVoiceCloneIntro"><span><Sparkles size={18} /></span><div><strong>创建你的专属声音</strong><p>上传一段清晰语音，并填写音频中完全一致的文字。建议使用 10–30 秒、无噪声和背景音乐的录音。</p></div><em>约 1 分钟</em></div>
              <div className="xlVoiceCloneForm">
                <section>
                  <label className={`xlVoiceDropzone ${cloneVoice.file ? 'hasFile' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseCloneVoiceFile(event.dataTransfer.files[0]); }}>
                    <input ref={cloneVoiceInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg" onChange={(event) => chooseCloneVoiceFile(event.target.files?.[0])} />
                    <span>{cloneVoice.file ? <Check size={22} /> : <Upload size={22} />}</span>
                    <strong>{cloneVoice.file ? cloneVoice.file.name : '上传参考语音'}</strong>
                    <small>{cloneVoice.file ? `${(cloneVoice.file.size / 1024 / 1024).toFixed(2)} MB · 点击可重新选择` : '点击选择或拖入音频，最大 20 MB'}</small>
                  </label>
                  {cloneVoice.previewAudio && <audio className="xlVoiceCloneAudio" controls preload="metadata" src={cloneVoice.previewAudio} />}
                </section>
                <section>
                  <label className="xlVoiceCloneName"><span>语音名称</span><input value={cloneVoice.name} maxLength={20} placeholder="例如：我的直播声音" onChange={(event) => { setCloneVoice((draft) => ({ ...draft, name: event.target.value })); setCloneProgress('idle'); }} /><small>{cloneVoice.name.length}/20</small></label>
                  <label className="xlVoiceCloneText"><span>参考语音原文</span><textarea value={cloneVoice.transcript} maxLength={300} placeholder="请输入录音中实际说出的完整文字，文字越准确，克隆效果越自然。" onChange={(event) => { setCloneVoice((draft) => ({ ...draft, transcript: event.target.value })); setCloneProgress('idle'); }} /><small>{cloneVoice.transcript.length}/300</small></label>
                </section>
              </div>
              {cloneError && <div className="xlVoiceCloneError">{cloneError}</div>}
              {cloneProgress === 'ready' && <div className="xlVoiceCloneReady"><Check size={15} /><span><strong>克隆完成</strong><small>保存后会进入可用语音，选中后点击应用即可使用。</small></span></div>}
            </div>
            <footer className="xlVoiceFooter xlVoiceCloneFooter">
              <span>上传内容仅用于生成你的专属音色，请确保已获得声音授权。</span>
              <div><button type="button" disabled={cloneProgress === 'cloning'} onClick={cloneProgress === 'ready' ? saveCloneVoice : () => void startVoiceClone()}>{cloneProgress === 'cloning' ? <><LoaderCircle className="xlVoiceSpinner" size={14} />正在克隆…</> : cloneProgress === 'ready' ? '保存语音' : '开始克隆'}</button></div>
            </footer>
          </>}
        </section>
      </div>}

      {dialog === 'settings' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}>
        <section className="xlModal xlSettingsModal" role="dialog" aria-modal="true" aria-label="直播设置" onMouseDown={(event) => event.stopPropagation()}>
          <header><strong>直播设置</strong><button type="button" aria-label="关闭直播设置" onClick={() => setDialog(null)}><X size={17} /></button></header>
          <div className="xlSettingsBody">
            <nav>{SETTINGS_TABS.map((tab) => { const Icon = tab.icon; return <button className={settingsTab === tab.id ? 'active' : ''} type="button" key={tab.id} onClick={() => setSettingsTab(tab.id)}><Icon size={16} />{tab.label}{tab.id === 'dynamic' && <em>NEW</em>}</button>; })}</nav>
            <div className="xlSettingsContent">
              {settingsTab === 'qa' && <><div className="xlSettingRow"><span><strong>开启问答</strong><small>自动识别直播间问题并生成回复</small></span><button className={`xlSwitch ${liveOptions.qa ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.qa} onClick={() => setLiveOptions((value) => ({ ...value, qa: !value.qa }))}><i /></button></div><div className="xlSettingBlock"><strong>回复范围</strong><div className="xlRadioGroup"><button className={liveOptions.replyMode === 'hybrid' ? 'active' : ''} type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyMode: 'hybrid' }))}>智能回复 + 问答库</button><button className={liveOptions.replyMode === 'library' ? 'active' : ''} type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyMode: 'library' }))}>仅问答库回复</button></div></div><div className="xlSettingBlock"><strong>单次回复上限</strong><div className="xlStepper"><button type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyLimit: Math.max(1, value.replyLimit - 1) }))}>−</button><span>{liveOptions.replyLimit}</span><button type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyLimit: Math.min(20, value.replyLimit + 1) }))}>+</button><em>条</em></div></div></>}
              {settingsTab === 'dynamic' && <><div className="xlSettingRow"><span><strong>开启 AI 动态话术</strong><small>根据直播节奏智能改写和补充话术</small></span><button className={`xlSwitch ${liveOptions.dynamic ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.dynamic} onClick={() => setLiveOptions((value) => ({ ...value, dynamic: !value.dynamic }))}><i /></button></div><div className="xlSettingNote">AI 会保留商品卖点并动态生成表达，降低重复播报。</div><button type="button" className="xlDynamicGenerateButton" onClick={() => void generateDynamicScript()} disabled={!liveOptions.dynamic || dynamicGenerating}>{dynamicGenerating ? <LoaderCircle className="xlVoiceSpinner" size={14} /> : <WandSparkles size={14} />}{dynamicGenerating ? '正在生成动态话术' : '根据当前商品生成一条话术'}</button></>}
              {settingsTab === 'ambience' && <><div className="xlSettingRow"><span><strong>开启氛围互动</strong><small>自动欢迎新观众并感谢关注、点赞</small></span><button className={`xlSwitch ${liveOptions.ambience ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.ambience} onClick={() => setLiveOptions((value) => ({ ...value, ambience: !value.ambience }))}><i /></button></div><div className="xlSettingNote">互动内容会在当前话术播放间隙插入，不打断商品讲解。</div></>}
              {settingsTab === 'product' && <><div className="xlSettingRow"><span><strong>随讲解弹商品卡</strong><small>播报已关联商品的话术时自动展示对应商品卡</small></span><button className={`xlSwitch ${liveOptions.product ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.product} onClick={() => setLiveOptions((value) => ({ ...value, product: !value.product }))}><i /></button></div><div className="xlSettingNote">画面商品卡在话术开始时出现、结束时隐藏；平台原生可点击商品卡仍需商家 OAuth 和平台接口。</div></>}
              {settingsTab === 'output' && <div className="xlOutputSettings">
                <div className="xlSettingIntro"><Video size={18} /><span><strong>实时渲染输出预设</strong><small>配置目标画质、编码和媒体协议</small></span><em>当前 {outputConfig.resolution} · {outputConfig.frameRate}</em></div>
                {[
                  { key: 'resolution' as const, label: '分辨率', values: ['1080p', '4K'] },
                  { key: 'frameRate' as const, label: '帧率', values: ['25 fps', '30 fps', '60 fps'] },
                  { key: 'codec' as const, label: '编码', values: ['H.264', 'H.265'] },
                  { key: 'protocol' as const, label: '输出协议', values: ['RTMP', 'WebRTC', 'SRT'] },
                ].map((group) => <div className="xlOutputRow" key={group.key}><strong>{group.label}</strong><div>{group.values.map((value) => <button className={outputConfig[group.key] === value ? 'active' : ''} type="button" key={value} disabled={value === 'SRT'} onClick={() => setOutputConfig((config) => ({ ...config, [group.key]: value }))}>{value}{value === 'SRT' && <small>待接入</small>}</button>)}</div></div>)}
                <div className="xlSettingNote">当前保存的是输出编排预设；协议、编码与 4K / 60fps 能力需接入输出服务并在目标节点实机验收。</div>
              </div>}
              {settingsTab === 'environment' && <div className="xlEnvironmentSettings">
                <div className="xlEnvironmentHead"><span><strong>运行环境检查</strong><small>最近检测：{environmentCheckedAt}</small></span><button type="button" onClick={detectEnvironment}><ShieldCheck size={14} />重新检测</button></div>
                <div className="xlEnvironmentCurrent">
                  <article><Server size={17} /><span><small>当前系统</small><strong>{environmentInfo.browser}</strong></span><em>{environmentCheckedAt === '尚未检测' ? '待检测' : '已识别'}</em></article>
                  <article><Cpu size={17} /><span><small>CPU</small><strong>{environmentInfo.cpu}</strong></span><em>{environmentCheckedAt === '尚未检测' ? '待检测' : '已识别'}</em></article>
                  <article><HardDrive size={17} /><span><small>图形设备</small><strong>{environmentInfo.gpu}</strong></span><em>{environmentCheckedAt === '尚未检测' ? '待检测' : '已识别'}</em></article>
                </div>
                <div className="xlRequirementList">
                  <header><strong>部署目标</strong><span>服务端实机核验</span></header>
                  <p><span>操作系统</span><strong>Windows Server 2019+</strong><em>待节点核验</em></p>
                  <p><span>运行内存</span><strong>64 GB+</strong><em>待节点核验</em></p>
                  <p><span>GPU 显存</span><strong>24 GB+</strong><em>待节点核验</em></p>
                  <p><span>媒体端口</span><strong>1935 / 8000 / 8080</strong><em>配置项</em></p>
                </div>
              </div>}
            </div>
          </div>
        </section>
      </div>}

      {dialog === 'livePlatform' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}>
        <section className="xlModal xlLivePlatformModal" role="dialog" aria-modal="true" aria-label="平台授权中心" onMouseDown={(event) => event.stopPropagation()}>
          <header><span><Link2 size={17} /><strong>平台授权中心</strong></span><button type="button" aria-label="关闭平台授权中心" onClick={() => setDialog(null)}><X size={17} /></button></header>
          <div className="xlPlatformCenterBody">
            <div className="xlPlatformNotice"><ShieldCheck size={16} /><span><strong>{windowCaptureMode ? '窗口采集模式不需要平台 RTMP 密钥' : '通用 RTMP 已接入真实安全存储'}</strong><small>{windowCaptureMode ? 'AvatarLive 会打开纯净节目输出窗口；请使用平台官方直播伴侣捕获该窗口并完成开播。' : '推流密钥使用服务端 AES-GCM 加密且不会返回浏览器；连接测试只代表服务器可达，不等于平台账号或互动权限已授权。'}</small></span></div>
            <div className="xlLocalRtmpTest">
              <span><Server size={16} /><span><strong>没有平台密钥也能先测媒体链路</strong><small>向项目内置 SRS 推送 2 秒 H.264/AAC 测试画面，验证 FFmpeg 与 RTMP 服务；不会连接抖音等外部平台。</small></span></span>
              <button type="button" disabled={platformActionId !== null} onClick={() => void runLocalMediaSelfTest()}>{platformActionId === 'local-rtmp-self-test' ? <LoaderCircle className="xlVoiceSpinner" size={13} /> : <Play size={13} />}{platformActionId === 'local-rtmp-self-test' ? '正在推流自检' : '运行本机推流自检'}</button>
            </div>
            {localRtmpSelfTestResult && <div className="xlPlatformMessage xlLocalRtmpTestResult passed" role="status">{localRtmpSelfTestResult.message}（耗时 {(localRtmpSelfTestResult.durationMs / 1000).toFixed(1)} 秒）</div>}
            {localRtmpSelfTestError && <div className="xlPlatformError xlLocalRtmpTestError" role="alert">{localRtmpSelfTestError}</div>}
            <section className="xlCaptureModePanel">
              <header><span><strong>开播方式</strong><small>{windowCaptureMode ? '不需要平台 RTMP 密钥，由官方直播伴侣捕获节目窗口。' : '使用已保存的 RTMP 地址，由服务端 FFmpeg 转推到平台。'}</small></span><Radio size={16} /></header>
              <div className="xlCaptureModeChoice" role="group" aria-label="选择开播方式">
                <button className={windowCaptureMode ? 'active' : ''} type="button" onClick={() => { setPublishMode('window_capture'); setTermsAccepted(false); setPlatformError(''); }}>窗口采集（推荐）</button>
                <button className={!windowCaptureMode ? 'active' : ''} type="button" onClick={() => { setPublishMode('manual_rtmp'); setTermsAccepted(false); setPlatformError(''); }}>手工 RTMP</button>
              </div>
              {windowCaptureMode && <>
                <div className="xlCaptureModeChoice" role="group" aria-label="选择节目窗口比例">
                  <button className={captureOrientation === 'portrait' ? 'active' : ''} type="button" onClick={() => setCaptureOrientation('portrait')}>9:16 竖屏手机窗口</button>
                  <button className={captureOrientation === 'landscape' ? 'active' : ''} type="button" onClick={() => setCaptureOrientation('landscape')}>16:9 横屏 PC 窗口</button>
                </div>
                <p className="xlCaptureModeHint">点击下方按钮后会打开纯净节目窗口。请在抖音、快手、淘宝等官方直播伴侣中选择该窗口和系统声音，再点击平台自己的“开始直播”；若浏览器提示，请先在节目窗口点击启用声音。节目窗口与控制台需保持在同一台电脑并持续运行。</p>
                {windowCaptureState !== 'stopped' && <div className={`xlCaptureWindowState ${windowCaptureState === 'failed' ? 'failed' : ''}`}>{windowCaptureState === 'connecting' ? '节目窗口正在连接…' : windowCaptureState === 'live' ? '节目窗口已连接，可以交给官方直播伴侣捕获' : windowCaptureMessage || '节目窗口连接失败'}</div>}
              </>}
            </section>
            <div className="xlPlatformSummary"><span><Radio size={15} /><strong>输出预设</strong>{windowCaptureMode ? `${captureOrientation === 'portrait' ? '9:16' : '16:9'} · ${outputConfig.frameRate} · H.264` : `${outputConfig.protocol} · ${outputConfig.resolution} · ${outputConfig.frameRate} · ${outputConfig.codec}`}</span>{windowCaptureMode ? <span><i />节目窗口模式</span> : <span><i />已选 {selectedPlatformConnectionIds.length} 个目标</span>}{!windowCaptureMode && <label className="xlPlatformSource"><strong>最终画面来源</strong><select value={mediaSourceKind} onChange={(event) => setMediaSourceKind(event.target.value as 'browser_ingest' | 'test_pattern')}><option value="browser_ingest">浏览器媒体网关（生产）</option><option value="test_pattern">服务端测试画面（仅联调）</option></select></label>}</div>

            <div className="xlPlatformCenterGrid">
              <section className="xlRtmpConnections">
                <header><span><strong>推流目标</strong><small>{windowCaptureMode ? '窗口采集模式不会使用这里的 RTMP 目标' : '从平台直播后台获取合法地址和密钥'}</small></span><button type="button" onClick={openNewRtmpConnection}><Plus size={14} />新增 RTMP</button></header>
                {platformConnectionsLoading && <div className="xlPlatformLoading"><LoaderCircle className="xlVoiceSpinner" size={17} />正在读取平台连接…</div>}
                {!platformConnectionsLoading && !platformConnections.length && <div className="xlPlatformEmpty"><KeyRound size={25} /><strong>还没有推流目标</strong><span>新增后密钥只会加密保存在服务端。</span><button type="button" onClick={openNewRtmpConnection}><Plus size={13} />添加第一个目标</button></div>}
                <div className="xlRtmpConnectionList">{platformConnections.map((connection) => {
                  const selected = selectedPlatformConnectionIds.includes(connection.id);
                  const busy = platformActionId === connection.id;
                  return <article className={`${selected ? 'selected' : ''} ${connection.status === 'disabled' ? 'disabled' : ''}`} key={connection.id}>
                    <div className="xlRtmpConnectionMain">
                      <span className="xlRtmpConnectionIcon"><Radio size={16} /></span>
                      <span><strong>{connection.name}</strong><small>{connection.platformLabel} · 密钥 ••••{connection.streamKeyLast4}</small></span>
                      <em className={`xlConnectionStatus ${connection.testStatus}`}>{connection.status === 'disabled' ? '已停用' : connection.testStatus === 'passed' ? '服务器可达' : connection.testStatus === 'failed' ? '测试失败' : '待测试'}</em>
                    </div>
                    <p title={connection.serverUrl}>{connection.serverUrl}</p>
                    {connection.testMessage && <div className={`xlConnectionMessage ${connection.testStatus}`}>{connection.testMessage}</div>}
                    <div className="xlRtmpConnectionActions">
                      <button className={selected ? 'selected' : ''} type="button" disabled={connection.status === 'disabled' || busy} onClick={() => togglePlatformConnectionSelection(connection)}>{selected ? <Check size={12} /> : <Plus size={12} />}{selected ? '已选用于开播' : '选择用于开播'}</button>
                      <button type="button" disabled={connection.status === 'disabled' || busy} onClick={() => void runPlatformConnectionTest(connection)}>{busy ? <LoaderCircle className="xlVoiceSpinner" size={12} /> : <Wifi size={12} />}测试</button>
                      <button type="button" disabled={busy} onClick={() => editRtmpConnection(connection)}><Pencil size={12} />编辑</button>
                      <button type="button" disabled={busy} onClick={() => void togglePlatformConnectionStatus(connection)}>{connection.status === 'enabled' ? '停用' : '启用'}</button>
                    </div>
                  </article>;
                })}</div>

                {rtmpFormOpen && <form className="xlRtmpForm" onSubmit={saveRtmpConnection} noValidate>
                  <header><span><strong>{editingPlatformConnectionId ? '编辑 RTMP 目标' : '新增 RTMP 目标'}</strong><small>地址和密钥必须分开填写，避免密钥出现在普通 URL 字段或日志中。</small></span><button type="button" aria-label="关闭 RTMP 表单" onClick={() => { setRtmpFormOpen(false); setPlatformError(''); }}><X size={14} /></button></header>
                  <div className="xlRtmpFormGrid">
                    <label><span>连接名称</span><input value={rtmpDraft.name} onChange={(event) => setRtmpDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="例如：B 站测试场" maxLength={120} aria-required="true" /></label>
                    <label><span>平台备注</span><input value={rtmpDraft.platformLabel} onChange={(event) => setRtmpDraft((draft) => ({ ...draft, platformLabel: event.target.value }))} placeholder="例如：哔哩哔哩" maxLength={80} aria-required="true" /></label>
                    <label className="wide"><span>RTMP 服务器地址</span><input value={rtmpDraft.serverUrl} onChange={(event) => setRtmpDraft((draft) => ({ ...draft, serverUrl: event.target.value }))} placeholder="rtmps://push.example.com/live" maxLength={500} inputMode="url" aria-required="true" /><small className="xlRtmpFieldHint">这里只填服务器地址；完整推流地址末尾的密钥请拆分到下一项。</small></label>
                    <label className="wide"><span>推流密钥{editingPlatformConnectionId && <small>留空表示保留原密钥</small>}</span><div className="xlSecretInput"><input type={streamKeyVisible ? 'text' : 'password'} value={rtmpDraft.streamKey} onChange={(event) => setRtmpDraft((draft) => ({ ...draft, streamKey: event.target.value }))} placeholder={editingPlatformConnectionId ? '不修改请留空' : '从平台直播后台复制'} maxLength={1000} autoComplete="new-password" aria-required={!editingPlatformConnectionId} /><button type="button" aria-label={streamKeyVisible ? '隐藏推流密钥' : '显示推流密钥'} onClick={() => setStreamKeyVisible((value) => !value)}>{streamKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
                  </div>
                  <footer><span>保存后浏览器只能看到密钥末四位。</span><div><button type="button" onClick={() => setRtmpFormOpen(false)}>取消</button><button type="submit" disabled={rtmpFormBusy}>{rtmpFormBusy ? <LoaderCircle className="xlVoiceSpinner" size={13} /> : <Save size={13} />}{rtmpFormBusy ? '保存中' : '安全保存'}</button></div></footer>
                </form>}
                {liveRunPreflight && <div className={`xlPlatformMessage ${liveRunPreflight.ready ? 'passed' : 'failed'}`}>服务端预检：{liveRunPreflight.checks.filter((check) => check.passed).length}/{liveRunPreflight.checks.length} 项通过</div>}
                {platformError && <div className="xlPlatformError" role="alert">{platformError}</div>}
              </section>

              <aside className="xlPlatformPreflight">
                <section>
                  <header><strong>开播前检查</strong><span>{platformPreflightChecks.filter((item) => item.passed).length}/{platformPreflightChecks.length}</span></header>
                  <div>{platformPreflightChecks.map((check) => <p className={check.passed ? 'passed' : ''} key={check.label}><i>{check.passed ? <Check size={11} /> : '!'}</i><span>{check.label}</span></p>)}</div>
                  {roomDirty && <button type="button" onClick={() => void saveLiveRoom()}><Save size={12} />保存直播间配置</button>}
                </section>
                <section className="xlOfficialPlatforms">
                  <header><strong>官方账号授权</strong><span>下一阶段</span></header>
                  <p>OAuth、评论互动、商品和订单属于独立权限，需平台企业应用审核通过后逐项接入。</p>
                  <div>{PLATFORMS.map((platform) => <span key={platform.name}><i style={{ backgroundColor: platform.color }}><img src={platform.logo} alt="" /></i><strong>{platform.name}</strong><em>待申请</em></span>)}</div>
                </section>
              </aside>
            </div>
          </div>
          <footer className="xlPlatformCenterFooter"><label className="xlPlatformTerms">{windowCaptureMode ? <span>节目窗口由官方直播伴侣捕获；平台账号登录和实际开播由官方客户端完成。</span> : <><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>我已确认推流地址来源合法，并了解“服务器可达”不代表平台已授权</span></>}</label><div><button type="button" onClick={() => setDialog(null)}>关闭</button><button type="button" disabled={!platformPreflightReady || (!windowCaptureMode && !termsAccepted) || liveRunBusy} onClick={() => void completeLivePreflight()}>{liveRunBusy ? <LoaderCircle className="xlVoiceSpinner" size={14} /> : <ShieldCheck size={14} />}{liveRunBusy ? (windowCaptureMode ? '打开节目窗口中' : '服务端检查中') : (windowCaptureMode ? '打开节目输出窗口' : '完成开播预检')}</button></div></footer>
        </section>
      </div>}

      {dialog === 'scriptImport' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}>
        <section className="xlModal xlImportModal" role="dialog" aria-modal="true" aria-label="文档导入结果" onMouseDown={(event) => event.stopPropagation()}>
          <header><strong>文本解析结果</strong><button type="button" aria-label="关闭文档导入结果" onClick={() => setDialog(null)}><X size={17} /></button></header>
          <div className="xlImportSource"><FileSpreadsheet size={20} /><span><strong>{importedDocumentName}</strong><small>已读取文本内容 · {importedScripts.length} 个话术节点</small></span><em>读取完成</em></div>
          <div className="xlImportFlow">{importedScripts.map((item, index) => <article key={`${item.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><em>{item.category} · {item.duration}</em></article>)}</div>
          <div className="xlImportNote">已提取的内容会自动作为 AI 扩写参考，也可直接加入当前脚本。</div>
          <footer><button type="button" onClick={() => setDialog(null)}>取消</button><button type="button" disabled={!importedScripts.length} onClick={applyImportedScripts}>加入当前脚本</button></footer>
        </section>
      </div>}

      {editingScriptId !== null && <div className="xlModalBackdrop" onMouseDown={() => setEditingScriptId(null)}>
        <form className="xlModal xlScriptEditModal" role="dialog" aria-modal="true" aria-labelledby="script-edit-title" onSubmit={saveEditedScript} onMouseDown={(event) => event.stopPropagation()}>
          <header><strong id="script-edit-title">编辑直播话术</strong><button type="button" aria-label="关闭话术编辑" onClick={() => setEditingScriptId(null)}><X size={17} /></button></header>
          <div className="xlScriptEditFields">
            <label><span>话术标题</span><input value={scriptEditDraft.title} onChange={(event) => setScriptEditDraft((value) => ({ ...value, title: event.target.value }))} maxLength={200} autoFocus /></label>
            <label><span>话术类型</span><select value={scriptEditDraft.category} onChange={(event) => setScriptEditDraft((value) => ({ ...value, category: event.target.value as ScriptEditDraft['category'] }))}><option>开场</option><option>讲品</option><option>促单</option></select></label>
            <label className="wide"><span>口播正文</span><textarea value={scriptEditDraft.text} onChange={(event) => setScriptEditDraft((value) => ({ ...value, text: event.target.value }))} rows={9} maxLength={20000} /></label>
          </div>
          <footer><span>{scriptEditDraft.text.length} 字</span><div><button type="button" onClick={() => setEditingScriptId(null)}>取消</button><button type="submit" disabled={!scriptEditDraft.title.trim() || !scriptEditDraft.text.trim()}><Save size={13} />保存修改</button></div></footer>
        </form>
      </div>}

      {catalogProductToDelete && <div className="xlModalBackdrop xlNestedModalBackdrop" onMouseDown={() => { if (!catalogProductDeleting) setCatalogProductToDelete(null); }}>
        <section className="xlModal xlConfirmModal" role="alertdialog" aria-modal="true" aria-labelledby="product-delete-title" aria-describedby="product-delete-description" onMouseDown={(event) => event.stopPropagation()}>
          <header><strong id="product-delete-title">永久删除自建商品</strong><button type="button" disabled={catalogProductDeleting} aria-label="关闭商品删除确认" onClick={() => setCatalogProductToDelete(null)}><X size={17} /></button></header>
          <p id="product-delete-description">确定永久删除“{catalogProductToDelete.name}”吗？如果它仍被任一直播间使用，服务端会拒绝删除；请先从对应直播商品单移除。</p>
          <footer><button type="button" disabled={catalogProductDeleting} onClick={() => setCatalogProductToDelete(null)}>取消</button><button className="danger" type="button" disabled={catalogProductDeleting} onClick={() => void confirmDeleteCatalogProduct()}>{catalogProductDeleting ? <LoaderCircle className="xlVoiceSpinner" size={13} /> : <Trash2 size={13} />}{catalogProductDeleting ? '删除中' : '永久删除'}</button></footer>
        </section>
      </div>}

    </main>
  );
}
