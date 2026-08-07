'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  CircleStop,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Layers3,
  Library,
  MessageCircleQuestion,
  Play,
  Plus,
  Radio,
  Save,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserRound,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import { MuseTalkAvatarProfile, MuseTalkTotalStream } from '@/lib/musetalk-total-stream';
import { ProductShell } from '@/components/product-shell';

const AVATARS = [
  { id: 'chinese', name: '林汐', role: '亲和型主播', image: '/assets/digital-humans/linxi.webp', type: '真人', gender: '女', age: '青年' },
  { id: 'business_male_1', name: '商务男1', role: '专业型主播', image: '/assets/musetalk-avatars/business-male-1.jpg', type: '真人', gender: '男', age: '青年' },
  { id: 'casual_male', name: '休闲风', role: '生活方式主播', image: '/assets/musetalk-avatars/casual-male.jpg', type: '真人', gender: '男', age: '青年' },
  { id: 'middle_aged_male', name: '中年男士', role: '资深行业顾问', image: '/assets/musetalk-avatars/middle-aged-male.jpg', type: '真人', gender: '男', age: '中年' },
  { id: 'casual_conversation', name: '休闲交流', role: '生活交流顾问', image: '/assets/musetalk-avatars/casual-conversation.jpg', type: '真人', gender: '女', age: '青年' },
  { id: 'casual_female', name: '休闲女主播', role: '内容分享主播', image: '/assets/musetalk-avatars/casual-female.jpg', type: '真人', gender: '女', age: '中年' },
] satisfies Array<{
  id: MuseTalkAvatarProfile;
  name: string;
  role: string;
  image: string;
  type: string;
  gender: string;
  age: string;
}>;

type ScriptItem = {
  id: number;
  title: string;
  category: '开场' | '讲品' | '促单';
  duration: string;
  text: string;
  state: 'ready' | 'playing' | 'done';
};

type LayerItem = {
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
type DialogName = 'settings' | 'livePlatform' | 'library' | 'avatarConfirm' | null;
type WorkspaceMode = 'script' | 'qa';

const MATERIAL_TABS = [
  { id: 'template', label: '模板', icon: Layers3 },
  { id: 'host', label: '主播', icon: UserRound },
  { id: 'image', label: '图片', icon: ImageIcon },
  { id: 'video', label: '视频', icon: Video },
  { id: 'text', label: '文本', icon: Type },
] as const;

const LIVE_TEMPLATES = [
  { id: 'home', name: '家居好物', image: '/assets/xiling-live/template-home.png', category: '家居', color: '暖色', title: '品质生活好物', tag: '居家焕新季', footer: '把舒适生活带回家' },
  { id: 'sale', name: '福利狂欢', image: '/assets/xiling-live/template-sale.png', category: '通用', color: '亮色', title: '狂欢盛典', tag: '提前加购', footer: '优惠开抢' },
  { id: 'spring', name: '春节狂欢', image: '/assets/xiling-live/template-spring.png', category: '食品', color: '暖色', title: '新春好礼到家', tag: '年货专场', footer: '欢欢喜喜过大年' },
  { id: 'food', name: '丰收美味', image: '/assets/xiling-live/template-food.png', category: '食品', color: '清新', title: '品味醇香时刻', tag: '好物享不停', footer: '速来抢购，不容错过' },
  { id: 'study', name: '学习课堂', image: '/assets/xiling-live/template-study.png', category: '教育', color: '清新', title: '高效学习课堂', tag: '知识充电站', footer: '每天进步一点点' },
  { id: 'snack', name: '吃货狂欢', image: '/assets/xiling-live/template-snack.png', category: '食品', color: '暖色', title: '吃货快乐星球', tag: '美味开箱', footer: '好吃不贵，快乐加倍' },
  { id: 'fruit', name: '果蔬乐园', image: '/assets/xiling-live/template-fruit.png', category: '食品', color: '清新', title: '新鲜产地直达', tag: '自然鲜活', footer: '把新鲜带回家' },
  { id: 'fashion', name: '衣橱焕新', image: '/assets/xiling-live/template-fashion.png', category: '服饰', color: '亮色', title: '今日穿搭灵感', tag: '衣橱焕新', footer: '轻松穿出高级感' },
] as const;

const INITIAL_SCRIPTS: ScriptItem[] = [
  {
    id: 1,
    title: '咖啡豆开场介绍',
    category: '开场',
    duration: '00:42',
    text: '直播间爱喝咖啡的宝子们，有没有对咖啡质感要求特别高的，就喜欢喝那种口感醇厚、风味独特的咖啡？今天这款可千万别错过！它选用高品质咖啡豆，香气饱满、层次丰富，日常提神醒脑或者和朋友一起分享都很合适。库存不多，宝子们先到先得哦！',
    state: 'ready',
  },
  {
    id: 2,
    title: '咖啡豆商品讲解',
    category: '讲品',
    duration: '00:47',
    text: '刚刚给大家介绍了这是一款高质感咖啡豆。它在烘焙工艺上下足了功夫，经过精心把控时间和温度，让咖啡豆呈现出浓郁香气和丰富风味。忙碌的早晨来上一杯，醇厚口感瞬间唤醒状态；颗颗饱满、色泽均匀，不管自己慢慢品尝还是送给爱喝咖啡的朋友，都是很好的选择。',
    state: 'ready',
  },
  {
    id: 3,
    title: '咖啡豆商品讲解',
    category: '讲品',
    duration: '00:50',
    text: '选咖啡豆不能只看外表，还要了解它的内在。咱们这款咖啡豆风味层次清晰，冲煮时香气释放充分，入口醇厚又不会失去细腻感。无论是手冲、浓缩还是冰咖啡，都能展现出稳定的品质。工作学习需要集中精力，或者周末想在家享受一段悠闲时光，它都能满足你的需求。',
    state: 'ready',
  },
  {
    id: 4,
    title: '咖啡豆引导下单',
    category: '促单',
    duration: '00:40',
    text: '今天这么好的咖啡豆只有一个小缺点，就是库存有限！为了让更多人尝到这份独特风味，直播间给大家争取到了特别划算的价格。现在别犹豫，主播倒数三、二、一，上链接！不管自己喝还是送给亲朋好友都很合适，趁着还有库存一定不要错过。',
    state: 'ready',
  },
];

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

const FONT_FAMILIES: Record<string, string> = {
  '默认字体': "'Noto Sans SC', sans-serif",
  '思源黑体': "'Noto Sans SC', sans-serif",
  '站酷快乐体': "'Noto Sans SC', sans-serif",
};

const roundCanvasValue = (value: number) => Math.round(value * 10) / 10;
const clampCanvasValue = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

const createTemplateLayers = (templateId: string, avatarName: string): LayerItem[] => {
  const template = LIVE_TEMPLATES.find((item) => item.id === templateId) ?? LIVE_TEMPLATES[3];
  return [
    { id: `title-${template.id}`, kind: 'text', value: template.title, sceneKey: 'templateTitle', x: 50, y: 15, width: 76, height: 12, rotation: 0, opacity: 100, fontSize: 26, color: '#ffffff', ...textLayerDefaults, fontWeight: 'bold' },
    { id: `tag-${template.id}`, kind: 'text', value: template.tag, sceneKey: 'templateTag', x: 50, y: 23, width: 56, height: 7, rotation: 0, opacity: 100, fontSize: 13, color: '#ffffff', ...textLayerDefaults },
    { id: `footer-${template.id}`, kind: 'text', value: template.footer, sceneKey: 'templateFooter', x: 50, y: 91, width: 72, height: 8, rotation: 0, opacity: 100, fontSize: 18, color: '#ffffff', ...textLayerDefaults },
    { id: 'host', kind: 'host', value: avatarName, sceneKey: 'host', x: 50, y: 64, width: 76, height: 70, rotation: 0, opacity: 100 },
    { id: `background-${template.id}`, kind: 'image', value: '图片', sceneKey: 'templateBackground', preview: template.image, x: 50, y: 50, width: 100, height: 100, rotation: 0, opacity: 100 },
  ];
};

const INITIAL_LAYERS = createTemplateLayers('food', '林汐');

const SQUARE_ASSETS: Record<'image' | 'video', AssetItem[]> = {
  image: [
    { id: 'square-image-1', kind: 'image', name: '咖啡氛围图', preview: '/assets/xiling-live/product.jpg' },
    { id: 'square-image-2', kind: 'image', name: '直播装饰图', preview: '/assets/xiling-live/template-food.png' },
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
] as const;

const PLATFORMS = [
  { name: '抖音', logo: '/assets/brand-logos/douyin.svg', color: '#111111', status: '系统维护' },
  { name: '美团', logo: '/assets/brand-logos/meituan.svg', color: '#ffc72c', status: '' },
  { name: '快手', logo: '/assets/brand-logos/kuaishou.svg', color: '#ff4e22', status: '' },
  { name: '京东', logo: '/assets/brand-logos/jd.svg', color: '#e1251b', status: '' },
  { name: '淘宝', logo: '/assets/brand-logos/taobao.svg', color: '#ff5000', status: '' },
  { name: '拼多多', logo: '/assets/brand-logos/pinduoduo.svg', color: '#e02e24', status: '' },
  { name: '唯品会', logo: '/assets/brand-logos/vipshop.svg', color: '#d62f7f', status: '' },
  { name: '小红书', logo: '/assets/brand-logos/xiaohongshu.svg', color: '#ff2442', status: '内测中' },
] as const;

export function LiveStudio() {
  const [entered, setEntered] = useState(false);
  const [avatarId, setAvatarId] = useState<MuseTalkAvatarProfile>('chinese');
  const avatar = AVATARS.find((item) => item.id === avatarId) ?? AVATARS[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const canvasGestureRef = useRef<CanvasGesture | null>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const [mediaActive, setMediaActive] = useState(false);
  const [stage, setStage] = useState('idle');
  const [onAir, setOnAir] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedAt, setSavedAt] = useState('10:40');
  const [dialog, setDialog] = useState<DialogName>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('script');
  const [materialTab, setMaterialTab] = useState<(typeof MATERIAL_TABS)[number]['id']>('template');
  const [scripts, setScripts] = useState<ScriptItem[]>(INITIAL_SCRIPTS);
  const [draft, setDraft] = useState('宝子们，今天直播间为大家准备了一款特别值得入手的高品质好物。');
  const [showComposer, setShowComposer] = useState(false);
  const [showScriptMenu, setShowScriptMenu] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedScriptIds, setSelectedScriptIds] = useState<number[]>([]);
  const [playbackMode, setPlaybackMode] = useState<'sequence' | 'random'>('sequence');
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [showGoodsMenu, setShowGoodsMenu] = useState(false);
  const [goods, setGoods] = useState([{ id: 1, name: '咖啡豆2026-08-07 10:39:34', source: '商品' }]);
  const [activeGoodsId, setActiveGoodsId] = useState(1);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateCategory, setTemplateCategory] = useState('全部');
  const [templateColor, setTemplateColor] = useState('全部');
  const [selectedTemplateId, setSelectedTemplateId] = useState('food');
  const [pendingAvatarId, setPendingAvatarId] = useState<MuseTalkAvatarProfile | null>(null);
  const [avatarSwitching, setAvatarSwitching] = useState(false);
  const [hostQuery, setHostQuery] = useState('');
  const [hostScope, setHostScope] = useState<'mine' | 'square' | 'favorite'>('mine');
  const [showHostFilters, setShowHostFilters] = useState(false);
  const [hostFilters, setHostFilters] = useState({ type: '全部', gender: '全部', age: '全部' });
  const [assetScope, setAssetScope] = useState<'mine' | 'square'>('mine');
  const [assetQuery, setAssetQuery] = useState('');
  const [assets, setAssets] = useState<Record<'image' | 'video', AssetItem[]>>({ image: [], video: [] });
  const [assetBatchMode, setAssetBatchMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const materialsScrollRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLDivElement>(null);
  const [customText, setCustomText] = useState('直播间专属福利');
  const [layers, setLayers] = useState<LayerItem[]>(INITIAL_LAYERS);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [inspectorLayerId, setInspectorLayerId] = useState<string | null>(null);
  const [canvasGestureMode, setCanvasGestureMode] = useState<CanvasGesture['mode'] | null>(null);
  const [previewHelp, setPreviewHelp] = useState(false);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [qaQuery, setQaQuery] = useState('');
  const [qaQuestion, setQaQuestion] = useState('这款咖啡豆适合哪种冲泡方式？');
  const [qaAnswer, setQaAnswer] = useState('手冲、浓缩和冰咖啡都适合，可以按照日常口味调整研磨度。');
  const [showQaComposer, setShowQaComposer] = useState(false);
  const [settingsTab, setSettingsTab] = useState<(typeof SETTINGS_TABS)[number]['id']>('qa');
  const [liveOptions, setLiveOptions] = useState({ qa: true, dynamic: true, ambience: false, product: true, replyLimit: 5, replyMode: 'hybrid' });
  const [selectedPlatform, setSelectedPlatform] = useState('美团');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('00:00:00');

  const activeGoods = goods.find((item) => item.id === activeGoodsId) ?? goods[0];
  const selectedTemplate = LIVE_TEMPLATES.find((item) => item.id === selectedTemplateId) ?? LIVE_TEMPLATES[3];
  const filteredTemplates = useMemo(() => LIVE_TEMPLATES.filter((item) => (
    item.name.includes(templateQuery.trim())
    && (templateCategory === '全部' || item.category === templateCategory)
    && (templateColor === '全部' || item.color === templateColor)
  )), [templateCategory, templateColor, templateQuery]);
  const visibleHosts = useMemo(() => AVATARS.filter((item, index) => {
    const inScope = hostScope === 'square' || (hostScope === 'mine' && index === 0) || (hostScope === 'favorite' && index === 0);
    const matchesFilters = (hostFilters.type === '全部' || item.type === hostFilters.type)
      && (hostFilters.gender === '全部' || item.gender === hostFilters.gender)
      && (hostFilters.age === '全部' || item.age === hostFilters.age);
    return inScope && matchesFilters && `${item.name}${item.role}`.toLowerCase().includes(hostQuery.trim().toLowerCase());
  }), [hostFilters, hostQuery, hostScope]);
  const filteredQaItems = useMemo(() => qaItems.filter((item) => `${item.question}${item.answer}`.includes(qaQuery.trim())), [qaItems, qaQuery]);
  const inspectorLayer = layers.find((item) => item.id === inspectorLayerId) ?? null;
  const hostLayer = layers.find((item) => item.sceneKey === 'host') ?? null;
  const backgroundLayer = layers.find((item) => item.sceneKey === 'templateBackground') ?? null;
  const previewBackground = backgroundLayer?.preview ?? selectedTemplate.image;
  const estimatedTime = avatarId === 'middle_aged_male' ? '03:16' : '02:59';
  const currentAssets = materialTab === 'image' || materialTab === 'video'
    ? (assetScope === 'mine' ? assets[materialTab] : SQUARE_ASSETS[materialTab]).filter((item) => item.name.includes(assetQuery.trim()))
    : [];

  useEffect(() => {
    if (!entered || workspaceMode !== 'script' || !canvasRef.current) return;
    const stream = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatarId,
      language: 'ZH',
      onStage: setStage,
      onMediaActive: setMediaActive,
    });
    streamRef.current = stream;
    void stream.startLive().catch((cause) => {
      if (streamRef.current !== stream) return;
      setStage('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      void stream.stopLive();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [avatarId, entered, workspaceMode]);

  useEffect(() => {
    setLayers((items) => items.map((item) => item.sceneKey === 'host' ? { ...item, value: avatar.name } : item));
  }, [avatar.name]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    if (stage !== 'idle' || !streamRef.current) return;
    setError('');
    setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'playing' } : candidate));
    try {
      await streamRef.current.speak(item.text);
      setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'done' } : candidate));
      setNotice(onAir ? '本条话术播报完成' : '话术试听完成');
    } catch (cause) {
      setStage('idle');
      setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'ready' } : candidate));
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addScript = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setScripts((items) => [...items, { id: Date.now(), title: '自定义直播话术', category: '讲品', duration: '00:30', text: draft.trim(), state: 'ready' }]);
    setDraft('');
    setShowComposer(false);
    setNotice('已添加一条新话术');
  };

  const addGeneratedScript = () => {
    setScripts((items) => [...items, {
      id: Date.now(),
      title: 'AI 动态促单话术',
      category: '促单',
      duration: '00:28',
      text: '刚进入直播间的朋友看这里，今天的咖啡豆福利已经为大家准备好了。香气、口感和性价比都在线，喜欢醇厚风味的朋友现在下单最合适。',
      state: 'ready',
    }]);
    setShowScriptMenu(false);
    setNotice('AI 已生成一条促单话术');
  };

  const addQa = (event: FormEvent) => {
    event.preventDefault();
    if (!qaQuestion.trim() || !qaAnswer.trim()) return;
    setQaItems((items) => [...items, { id: Date.now(), question: qaQuestion.trim(), answer: qaAnswer.trim() }]);
    setQaQuestion('');
    setQaAnswer('');
    setShowQaComposer(false);
    setNotice('问答组添加成功');
  };

  const stopLive = async () => {
    await streamRef.current?.stopLive();
    setStage('idle');
    setMediaActive(false);
    setOnAir(false);
    setStartedAt(null);
    setScripts((items) => items.map((item) => item.state === 'playing' ? { ...item, state: 'ready' } : item));
  };

  const startLive = (platform: string) => {
    setOnAir(true);
    setStartedAt(Date.now());
    setDialog(null);
    setNotice(`已通过${platform}开始直播，话术播报已启用`);
  };

  const saveToLibrary = () => {
    const now = new Date();
    setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setNotice(`已将 ${scripts.length} 条话术保存到脚本库`);
  };

  const addGoods = (source: string) => {
    const id = Date.now();
    const label = source === '新建空白商品' ? '未命名商品' : source.replace('添加', '');
    setGoods((items) => [...items, { id, name: `${label}${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`, source }]);
    setActiveGoodsId(id);
    setShowGoodsMenu(false);
    setNotice(`${source}成功`);
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
    setScripts((items) => items.filter((item) => !selectedScriptIds.includes(item.id)));
    setNotice(`已删除 ${selectedScriptIds.length} 条话术`);
    setSelectedScriptIds([]);
    setBatchMode(false);
  };

  const openLayerInspector = (id: string) => {
    setSelectedLayerId(id);
    setInspectorLayerId(id);
  };

  const closeLayerInspector = () => {
    setSelectedLayerId(null);
    setInspectorLayerId(null);
  };

  const updateLayer = (id: string, values: Partial<LayerItem>) => {
    setLayers((items) => items.map((item) => item.id === id ? { ...item, ...values } : item));
  };

  const beginCanvasGesture = (event: ReactPointerEvent<HTMLElement>, layer: LayerItem, mode: CanvasGesture['mode'], handle?: ResizeHandle) => {
    if (event.button !== 0 || !previewCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    openLayerInspector(layer.id);
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
    openLayerInspector(id);
    setNotice(`${asset.kind === 'image' ? '图片' : '视频'}素材已添加到画面`);
  };

  const addTextToCanvas = () => {
    if (!customText.trim()) return;
    const id = `text-${Date.now()}`;
    setLayers((items) => [{
      id,
      kind: 'text',
      value: customText.trim(),
      sceneKey: 'custom',
      x: 50,
      y: 70,
      width: 52,
      height: 8,
      fontSize: 16,
      color: '#ffffff',
      ...textLayerDefaults,
      rotation: 0,
      opacity: 100,
    }, ...items]);
    openLayerInspector(id);
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
    setNotice(`已导入 ${imported.length} 个${kind === 'image' ? '图片' : '视频'}素材，点击素材可添加到画面`);
  };

  const toggleAssetSelection = (id: string) => {
    setSelectedAssetIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const deleteSelectedAssets = () => {
    if (!selectedAssetIds.length || (materialTab !== 'image' && materialTab !== 'video')) return;
    setAssets((items) => ({ ...items, [materialTab]: items[materialTab].filter((item) => !selectedAssetIds.includes(item.id)) }));
    setNotice(`已删除 ${selectedAssetIds.length} 个素材`);
    setSelectedAssetIds([]);
    setAssetBatchMode(false);
  };

  const moveLayer = (id: string, action: 'forward' | 'backward' | 'front' | 'back') => {
    setLayers((items) => {
      const currentIndex = items.findIndex((item) => item.id === id);
      if (currentIndex < 0) return items;
      const targetIndex = action === 'front' ? 0 : action === 'back' ? items.length - 1 : action === 'forward' ? Math.max(0, currentIndex - 1) : Math.min(items.length - 1, currentIndex + 1);
      if (targetIndex === currentIndex) return items;
      const next = [...items];
      const [current] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, current);
      return next;
    });
  };

  const deleteLayer = (id: string) => {
    setLayers((items) => items.filter((item) => item.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
    if (inspectorLayerId === id) setInspectorLayerId(null);
    setNotice('图层已删除');
  };

  const applyTemplate = (templateId: string) => {
    const template = LIVE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const currentHost = layers.find((item) => item.sceneKey === 'host');
    const templateLayers = createTemplateLayers(template.id, avatar.name);
    setSelectedTemplateId(template.id);
    setLayers(templateLayers.map((item) => item.sceneKey === 'host' && currentHost ? currentHost : item));
    closeLayerInspector();
    setNotice(`已应用“${template.name}”模板`);
  };

  const applyPendingAvatar = () => {
    const nextAvatar = AVATARS.find((item) => item.id === pendingAvatarId);
    if (!nextAvatar) return;
    setAvatarSwitching(true);
    setAvatarId(nextAvatar.id);
    const nextDurations = nextAvatar.id === 'middle_aged_male' ? ['00:46', '00:51', '00:56', '00:43'] : ['00:42', '00:47', '00:50', '00:40'];
    setScripts((items) => items.map((item, index) => ({ ...item, duration: nextDurations[index] ?? item.duration })));
    setLayers((items) => items.map((item) => item.sceneKey === 'host' ? {
      ...item,
      value: nextAvatar.name,
        width: 76,
        height: 70,
        y: 64,
    } : item));
    setPendingAvatarId(null);
    setDialog(null);
    setNotice('声音已应用到全部商品');
    window.setTimeout(() => setNotice('主播形象已更换'), 450);
    window.setTimeout(() => {
      setAvatarSwitching(false);
    }, 900);
  };

  if (!entered) {
    return (
      <ProductShell>
        <main className="liveLanding">
          <section className="liveLandingCopy">
            <span className="liveLandingKicker"><i />AI DIGITAL HOST</span>
            <h1>欢迎体验数字人直播间</h1>
            <p>选择数字人主播、编排直播话术并连接推流地址，用当前项目的实时驱动能力快速完成一场直播。</p>
            <div className="liveLandingActions">
              <button className="primaryAction" type="button" onClick={() => setEntered(true)}><Sparkles size={17} />进入直播控制台</button>
              <button className="secondaryAction" type="button" onClick={() => setEntered(true)}><FileText size={17} />创建直播任务<ArrowRight size={16} /></button>
            </div>
            <div className="liveLandingMeta"><span><strong>2</strong> 个内置形象</span><i /><span><strong>实时</strong> 话术播报</span><i /><span><strong>RTMP</strong> 推流配置</span></div>
          </section>

          <section className="liveLandingVisual" aria-label="数字人直播功能预览">
            <div className="liveWindow">
              <div className="liveWindowBar"><span><i /><i /><i /></span><em><b />LIVE</em></div>
              <img src={AVATARS[0].image} alt="林汐数字人主播" />
              <div className="liveWindowLower"><strong>林汐</strong><span>AI 数字人主播</span></div>
            </div>
            <article className="floatingScript"><span><FileText size={14} />话术编排</span><p>欢迎进入今天的数字人直播间，我们马上开始本期内容。</p></article>
            <article className="floatingScenes"><span><Video size={14} />直播画面</span><div><i /><i /><i /></div></article>
            <div className="landingGlow" />
          </section>
        </main>
      </ProductShell>
    );
  }

  const previewHost = avatarId === 'chinese' ? '/assets/xiling-live/host.png' : avatar.image;

  return (
    <main className="xilingLive">
      <header className="xlTopbar">
        <div className="xlTitleGroup">
          <button type="button" className="xlBack" onClick={() => { void stopLive(); setEntered(false); }} aria-label="返回直播首页"><ArrowLeft size={17} /></button>
          <div><strong>直播间 08/07 10:39:35</strong><span>保存于{savedAt}</span></div>
        </div>
        <div className="xlTopActions">
          <button type="button" className="xlDarkButton" onClick={() => setDialog('settings')}><Settings2 size={15} />直播设置</button>
          {onAir ? (
            <button className="xlLiveButton danger" type="button" onClick={() => void stopLive()}><CircleStop size={16} />结束直播 <span>{elapsed}</span></button>
          ) : (
            <button className="xlLiveButton" type="button" onClick={() => setDialog('livePlatform')}><Radio size={16} />开始直播</button>
          )}
        </div>
      </header>

      <div className="xlProgram">
        <aside className="xlGoodsRail">
          <h2>直播商品单</h2>
          <div className="xlGoodsTools">
            <div className="xlMenuAnchor">
              <button type="button" aria-expanded={showPlaybackMenu} onClick={() => { setShowPlaybackMenu((value) => !value); setShowGoodsMenu(false); }}>{playbackMode === 'sequence' ? '顺序播放' : '随机播放'} <ChevronDown size={13} /></button>
              {showPlaybackMenu && <div className="xlPopMenu compact"><button className={playbackMode === 'sequence' ? 'active' : ''} type="button" onClick={() => { setPlaybackMode('sequence'); setShowPlaybackMenu(false); }}>顺序播放</button><button className={playbackMode === 'random' ? 'active' : ''} type="button" onClick={() => { setPlaybackMode('random'); setShowPlaybackMenu(false); }}>随机播放</button></div>}
            </div>
            <div className="xlMenuAnchor">
              <button type="button" aria-label="添加商品" aria-expanded={showGoodsMenu} onClick={() => { setShowGoodsMenu((value) => !value); setShowPlaybackMenu(false); }}><Plus size={16} /></button>
              {showGoodsMenu && <div className="xlPopMenu goods">{['从脚本库添加', '添加平台商品', '添加自建商品', '新建空白商品'].map((label) => <button type="button" key={label} onClick={() => addGoods(label)}><Plus size={13} />{label}</button>)}</div>}
            </div>
          </div>
          <div className="xlGoodsList">
            {goods.map((item, index) => (
              <button type="button" className={`xlGoodsCard ${activeGoodsId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setActiveGoodsId(item.id)}>
                <span className="xlGoodsIndex">{index + 1}</span>
                <span className="xlGoodsScene"><img src={previewBackground} alt="" />{hostLayer && !avatarSwitching && <img src={previewHost} alt="" style={{ opacity: hostLayer.opacity / 100 }} />}<em>{item.source === '商品' ? '咖啡豆' : '文本'}</em></span>
                <strong>{item.name}</strong>
              </button>
            ))}
          </div>
        </aside>

        <section className="xlProgramContent">
          <header className="xlProductHeader">
            <div className="xlProductName"><span>商品{goods.findIndex((item) => item.id === activeGoodsId) + 1}</span><strong>{activeGoods.name}</strong></div>
            <div className="xlModeSwitch"><button className={workspaceMode === 'script' ? 'active' : ''} type="button" onClick={() => setWorkspaceMode('script')}>脚本</button><button className={workspaceMode === 'qa' ? 'active' : ''} type="button" onClick={() => setWorkspaceMode('qa')}>问答</button></div>
            <button type="button" className="xlSaveScript" onClick={saveToLibrary}><Save size={13} />保存到脚本库</button>
          </header>

          {workspaceMode === 'qa' ? (
            <section className="xlQaWorkspace">
              <header><div><strong>直播问答</strong><span>共{qaItems.length}条</span></div><div><button type="button" onClick={() => setShowQaComposer((value) => !value)}><Plus size={14} />问答组</button><label><input value={qaQuery} onChange={(event) => setQaQuery(event.target.value)} placeholder="搜索相关问题与回答" /><Search size={15} /></label></div></header>
              {showQaComposer && <form className="xlQaComposer" onSubmit={addQa}><label><span>观众问题</span><input value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} placeholder="输入常见问题" /></label><label><span>主播回答</span><textarea value={qaAnswer} onChange={(event) => setQaAnswer(event.target.value)} placeholder="输入推荐回答" rows={3} /></label><div><button type="button" onClick={() => setShowQaComposer(false)}>取消</button><button type="submit" disabled={!qaQuestion.trim() || !qaAnswer.trim()}>添加问答组</button></div></form>}
              {filteredQaItems.length ? <div className="xlQaList">{filteredQaItems.map((item, index) => <article key={item.id}><span>Q{index + 1}</span><div><strong>{item.question}</strong><p>{item.answer}</p></div><button type="button" aria-label={`删除问题${index + 1}`} onClick={() => setQaItems((items) => items.filter((candidate) => candidate.id !== item.id))}><Trash2 size={14} /></button></article>)}</div> : <div className="xlQaEmpty"><MessageCircleQuestion size={58} /><strong>{qaQuery ? '没有匹配的问答' : '您还没有添加问答组'}</strong><p>添加常见问题后，AI 主播可以自动回复直播间弹幕。</p><button type="button" onClick={() => setShowQaComposer(true)}><Plus size={14} />添加第一个问答组</button></div>}
            </section>
          ) : (
            <div className="xlEditorGrid">
              <section className="xlScriptPanel">
                <header className="xlPanelToolbar">
                  <div><strong>话术列表</strong><span>共{scripts.length}条</span></div>
                  <button type="button" className="xlSpeaker" onClick={() => setMaterialTab('host')}><img src={previewHost} alt="" /><span>{avatarId === 'chinese' ? '专业靠谱爽朗女' : avatar.name}</span></button>
                  <div className="xlScriptTools">
                    {batchMode && selectedScriptIds.length ? <button type="button" aria-label="删除已选话术" onClick={deleteSelectedScripts}><Trash2 size={15} /></button> : <button type="button" aria-label="随机排序" onClick={shuffleScripts}><Shuffle size={15} /></button>}
                    <button className={batchMode ? 'active' : ''} type="button" aria-label={batchMode ? '退出批量选择' : '批量选择'} onClick={toggleBatchMode}>{batchMode ? <X size={15} /> : <Check size={15} />}</button>
                    <div className="xlMenuAnchor"><button type="button" aria-label="添加话术" aria-expanded={showScriptMenu} onClick={() => setShowScriptMenu((value) => !value)}><Plus size={17} /></button>{showScriptMenu && <div className="xlPopMenu script"><button type="button" onClick={() => { setShowComposer(true); setShowScriptMenu(false); }}><Plus size={13} />新建话术</button><button type="button" onClick={() => { setDialog('library'); setShowScriptMenu(false); }}><Library size={13} />从话术库选择</button><button type="button" onClick={addGeneratedScript}><WandSparkles size={13} />AI 生成话术</button></div>}</div>
                  </div>
                </header>

                {showComposer && <form className="xlScriptComposer" onSubmit={addScript}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入新的直播话术…" rows={3} maxLength={200} autoFocus /><div><span>{draft.length}/200</span><span><button className="secondary" type="button" onClick={() => setShowComposer(false)}>取消</button><button type="submit" disabled={!draft.trim()}><Plus size={14} />添加话术</button></span></div></form>}

                <div className="xlScriptList">
                  {scripts.map((item, index) => {
                    const selected = selectedScriptIds.includes(item.id);
                    return <article className={`xlScriptItem ${item.state} ${selected ? 'selected' : ''}`} key={item.id} onClick={() => { if (batchMode) toggleScriptSelection(item.id); }}>
                      <button className="xlScriptNumber" type="button" aria-label={batchMode ? `${selected ? '取消选择' : '选择'}${item.title}` : `第${index + 1}条话术`} onClick={(event) => { if (batchMode) { event.stopPropagation(); toggleScriptSelection(item.id); } }}>{batchMode ? (selected ? <CheckSquare size={16} /> : <span className="xlEmptyCheck" />) : index + 1}</button>
                      <span className={`xlScriptCategory ${item.category === '促单' ? 'yellow' : item.category === '开场' ? 'pink' : ''}`}>{item.category}</span>
                      <div className="xlScriptBody"><header><strong>{item.title}</strong><span>00:00 / {item.duration}</span></header><p>{item.text}</p><div className="xlScriptItemActions"><button type="button" onClick={(event) => { event.stopPropagation(); void play(item); }} disabled={stage !== 'idle' || item.state === 'playing'} aria-label={`试听${item.title}`}><Play size={13} fill="currentColor" /></button><button type="button" onClick={(event) => { event.stopPropagation(); setScripts((items) => items.filter((candidate) => candidate.id !== item.id)); setNotice('话术已删除'); }} aria-label={`删除${item.title}`}><Trash2 size={13} /></button></div></div>
                    </article>;
                  })}
                </div>
              </section>

              <section className="xlPreviewPanel">
                <header className="xlPreviewHeader"><span>直播预览 <button type="button" aria-label="查看预览说明" onClick={() => setPreviewHelp((value) => !value)}><HelpCircle size={15} /></button></span><span>预估时间 <strong>{estimatedTime}</strong></span></header>
                <div className="xlPreviewStage">
                  {previewHelp && <div className="xlPreviewHelp">预览会实时同步模板、主播、文本与图层显隐状态。</div>}
                  <div className={`xlPortraitCanvas ${canvasGestureMode ? `interacting ${canvasGestureMode}` : ''}`} ref={previewCanvasRef} onPointerMove={handleCanvasPointerMove} onPointerUp={finishCanvasGesture} onPointerCancel={finishCanvasGesture} onLostPointerCapture={finishCanvasGesture}>
                    {backgroundLayer && <img className="xlSceneBackground" src={previewBackground} alt={`${selectedTemplate.name}直播模板`} style={{ left: `${backgroundLayer.x}%`, top: `${backgroundLayer.y}%`, right: 'auto', bottom: 'auto', width: `${backgroundLayer.width}%`, height: `${backgroundLayer.height}%`, transform: `translate(-50%, -50%) rotate(${backgroundLayer.rotation}deg)`, opacity: backgroundLayer.opacity / 100 }} />}
                    {hostLayer && !avatarSwitching && <img className={mediaActive ? 'xlSceneHost hidden' : 'xlSceneHost'} src={previewHost} alt={`${avatar.name}直播预览`} style={{ left: `${hostLayer.x}%`, top: `${hostLayer.y}%`, right: 'auto', bottom: 'auto', width: `${hostLayer.width}%`, height: `${hostLayer.height}%`, opacity: hostLayer.opacity / 100, transform: `translate(-50%, -50%) rotate(${hostLayer.rotation}deg)` }} />}
                    <canvas ref={canvasRef} className={mediaActive ? 'xlStreamCanvas active' : 'xlStreamCanvas'} />
                    {avatarSwitching && <div className="xlAvatarLoading" role="status"><i /><span>主播形象加载中</span></div>}
                    {layers.map((item, index) => item.kind === 'text' ? <span className={`xlCanvasText ${item.sceneKey === 'custom' ? 'custom' : item.sceneKey ?? ''}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, zIndex: 10 + layers.length - index, transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`, opacity: item.opacity / 100, color: item.color, fontFamily: FONT_FAMILIES[item.fontFamily ?? '默认字体'], fontSize: `${item.fontSize ?? 16}px`, fontWeight: item.fontWeight, fontStyle: item.fontStyle, textDecoration: item.textDecoration, textAlign: item.textAlign, letterSpacing: `${item.letterSpacing ?? 0}px`, lineHeight: item.lineHeight, WebkitTextStroke: item.strokeEnabled ? `1px ${item.strokeColor ?? '#000000'}` : undefined, textShadow: item.shadowEnabled ? `${item.shadowX ?? 4}px ${item.shadowY ?? 4}px ${item.shadowBlur ?? 8}px ${item.shadowColor ?? '#000000'}` : undefined }} key={item.id}>{item.value}</span> : item.sceneKey === 'custom' && item.kind !== 'host' ? <span className={`xlCustomSceneAsset ${item.kind}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, zIndex: 10 + layers.length - index, transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`, opacity: item.opacity / 100 }} key={item.id}>{item.kind === 'image' && item.preview ? <img src={item.preview} alt={item.value} /> : item.kind === 'image' ? <ImageIcon size={23} /> : <Video size={23} />}<em>{item.value}</em></span> : null)}
                    {layers.map((item, index) => <button className={`xlLayerHitTarget ${item.sceneKey === 'templateBackground' ? 'background' : ''}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, zIndex: 30 + layers.length - index, transform: `translate(-50%, -50%) rotate(${item.rotation}deg)` }} type="button" aria-label={`选择并移动图层：${item.value}`} aria-pressed={selectedLayerId === item.id} data-layer-hit={item.id} key={`hit-${item.id}`} onPointerDown={(event) => beginCanvasGesture(event, item, 'move')} onClick={(event) => { event.stopPropagation(); openLayerInspector(item.id); }} />)}
                    {inspectorLayer && <div className={`xlLayerSelectionBox ${inspectorLayer.kind}`} style={{ left: `${inspectorLayer.x}%`, top: `${inspectorLayer.y}%`, width: `${inspectorLayer.width}%`, height: `${inspectorLayer.height}%`, transform: `translate(-50%, -50%) rotate(${inspectorLayer.rotation}deg)` }} role="group" aria-label={`画布控制：${inspectorLayer.value}`} onPointerDownCapture={(event) => beginSelectionGesture(event, inspectorLayer)}>
                      {(['nw', 'ne', 'se', 'sw'] as const).map((handle) => <span className={`xlResizeHandle ${handle}`} role="button" aria-label={`${handle}方向缩放${inspectorLayer.value}`} data-resize-handle={handle} key={handle} />)}
                      <span className="xlRotateHandle" role="button" aria-label={`旋转${inspectorLayer.value}`} data-rotate-handle="true" />
                    </div>}
                    {onAir && <span className="xlOnAir">LIVE</span>}
                    {stage !== 'idle' && <span className="xlRenderState">{stage === 'error' ? '连接异常' : '数字人生成中'}</span>}
                  </div>
                  {error && <div className="xlPreviewError">{error}</div>}
                </div>
              </section>

              <aside className="xlMaterialsPanel">
                <nav className="xlMaterialTabs" aria-label="直播素材">{MATERIAL_TABS.map((tabItem) => { const Icon = tabItem.icon; return <button className={materialTab === tabItem.id ? 'active' : ''} type="button" key={tabItem.id} onClick={() => { setMaterialTab(tabItem.id); closeLayerInspector(); setAssetQuery(''); setAssetBatchMode(false); setSelectedAssetIds([]); }}><Icon size={17} /><span>{tabItem.label}</span></button>; })}</nav>
                <input ref={imageInputRef} className="xlHiddenInput" type="file" accept="image/*" multiple onChange={(event) => { void importAssets('image', event.currentTarget.files); event.currentTarget.value = ''; }} />
                <input ref={videoInputRef} className="xlHiddenInput" type="file" accept="video/*" multiple onChange={(event) => { void importAssets('video', event.currentTarget.files); event.currentTarget.value = ''; }} />
                <div className="xlMaterialsWorkspace">
                  <div className="xlMaterialsScroll" ref={materialsScrollRef}>
                  {inspectorLayer ? (
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
                          <label className="xlInspectorWide"><span>字体</span><select aria-label="字体" value={inspectorLayer.fontFamily ?? '默认字体'} onChange={(event) => updateLayer(inspectorLayer.id, { fontFamily: event.target.value })}><option>默认字体</option><option>思源黑体</option><option>站酷快乐体</option></select></label>
                          <label><span>文字颜色</span><input aria-label="文字颜色" type="color" value={inspectorLayer.color ?? '#ffffff'} onChange={(event) => updateLayer(inspectorLayer.id, { color: event.target.value })} /></label>
                          <label><span>字号</span><input aria-label="文字字号" type="number" min="8" max="72" value={inspectorLayer.fontSize ?? 16} onChange={(event) => updateLayer(inspectorLayer.id, { fontSize: Math.max(8, Math.min(72, Number(event.target.value))) })} /></label>
                          <label><span>字距</span><input aria-label="文字字距" type="number" min="-10" max="30" value={inspectorLayer.letterSpacing ?? 0} onChange={(event) => updateLayer(inspectorLayer.id, { letterSpacing: Math.max(-10, Math.min(30, Number(event.target.value))) })} /></label>
                          <label><span>行距</span><input aria-label="文字行距" type="number" min="0.8" max="3" step="0.1" value={inspectorLayer.lineHeight ?? 1.2} onChange={(event) => updateLayer(inspectorLayer.id, { lineHeight: Math.max(0.8, Math.min(3, Number(event.target.value))) })} /></label>
                          <div className="xlTextStyleGroup"><span>修饰</span><div><button className={inspectorLayer.fontWeight === 'bold' ? 'active' : ''} type="button" aria-label="加粗" aria-pressed={inspectorLayer.fontWeight === 'bold'} onClick={() => updateLayer(inspectorLayer.id, { fontWeight: inspectorLayer.fontWeight === 'bold' ? 'normal' : 'bold' })}>B</button><button className={inspectorLayer.fontStyle === 'italic' ? 'active' : ''} type="button" aria-label="斜体" aria-pressed={inspectorLayer.fontStyle === 'italic'} onClick={() => updateLayer(inspectorLayer.id, { fontStyle: inspectorLayer.fontStyle === 'italic' ? 'normal' : 'italic' })}>I</button><button className={inspectorLayer.textDecoration === 'underline' ? 'active' : ''} type="button" aria-label="下划线" aria-pressed={inspectorLayer.textDecoration === 'underline'} onClick={() => updateLayer(inspectorLayer.id, { textDecoration: inspectorLayer.textDecoration === 'underline' ? 'none' : 'underline' })}>U</button><button className={inspectorLayer.textDecoration === 'line-through' ? 'active' : ''} type="button" aria-label="删除线" aria-pressed={inspectorLayer.textDecoration === 'line-through'} onClick={() => updateLayer(inspectorLayer.id, { textDecoration: inspectorLayer.textDecoration === 'line-through' ? 'none' : 'line-through' })}>S</button></div></div>
                          <div className="xlTextStyleGroup"><span>对齐方式</span><div>{(['left', 'center', 'right'] as const).map((alignment) => <button className={inspectorLayer.textAlign === alignment ? 'active' : ''} type="button" aria-label={`文本${alignment === 'left' ? '左' : alignment === 'center' ? '居中' : '右'}对齐`} aria-pressed={inspectorLayer.textAlign === alignment} key={alignment} onClick={() => updateLayer(inspectorLayer.id, { textAlign: alignment })}>{alignment === 'left' ? '左' : alignment === 'center' ? '中' : '右'}</button>)}</div></div>
                          <div className="xlEffectControl"><div><span>描边</span><button className={inspectorLayer.strokeEnabled ? 'on' : ''} type="button" role="switch" aria-label="描边开关" aria-checked={inspectorLayer.strokeEnabled} onClick={() => updateLayer(inspectorLayer.id, { strokeEnabled: !inspectorLayer.strokeEnabled })}><i /></button></div>{inspectorLayer.strokeEnabled && <input aria-label="描边颜色" type="color" value={inspectorLayer.strokeColor ?? '#000000'} onChange={(event) => updateLayer(inspectorLayer.id, { strokeColor: event.target.value })} />}</div>
                          <div className="xlEffectControl xlInspectorWide"><div><span>阴影</span><button className={inspectorLayer.shadowEnabled ? 'on' : ''} type="button" role="switch" aria-label="阴影开关" aria-checked={inspectorLayer.shadowEnabled} onClick={() => updateLayer(inspectorLayer.id, { shadowEnabled: !inspectorLayer.shadowEnabled })}><i /></button></div>{inspectorLayer.shadowEnabled && <div className="xlShadowFields"><input aria-label="阴影颜色" type="color" value={inspectorLayer.shadowColor ?? '#000000'} onChange={(event) => updateLayer(inspectorLayer.id, { shadowColor: event.target.value })} /><input aria-label="阴影模糊" title="模糊" type="number" min="0" max="30" value={inspectorLayer.shadowBlur ?? 8} onChange={(event) => updateLayer(inspectorLayer.id, { shadowBlur: Math.max(0, Math.min(30, Number(event.target.value))) })} /><input aria-label="阴影横向偏移" title="X" type="number" min="-30" max="30" value={inspectorLayer.shadowX ?? 4} onChange={(event) => updateLayer(inspectorLayer.id, { shadowX: Math.max(-30, Math.min(30, Number(event.target.value))) })} /><input aria-label="阴影纵向偏移" title="Y" type="number" min="-30" max="30" value={inspectorLayer.shadowY ?? 4} onChange={(event) => updateLayer(inspectorLayer.id, { shadowY: Math.max(-30, Math.min(30, Number(event.target.value))) })} /></div>}</div>
                        </div>}
                        <div className="xlInspectorSection"><label className="xlOpacityField"><span><strong>不透明度</strong><em>{inspectorLayer.opacity}%</em></span><input aria-label="图层不透明度" type="range" min="0" max="100" value={inspectorLayer.opacity} onChange={(event) => updateLayer(inspectorLayer.id, { opacity: Number(event.target.value) })} /></label></div>
                        <button className="xlApplyAllGoods" type="button" onClick={() => setNotice(inspectorLayer.kind === 'host' ? '人像位置已同步到全部商品' : `“${inspectorLayer.value}”已添加至所有商品`)}>{inspectorLayer.kind === 'host' ? '同步人像位置' : '添加至所有商品'}</button>
                      </div>
                    </section>
                  ) : <div className="xlMaterialBrowser">
                    {materialTab === 'template' && <><label className="xlMaterialSearch"><input value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} placeholder="搜索模板名称" /><Search size={15} /></label><div className="xlMaterialFilters"><label><select aria-label="模板类型" value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}>{['全部', '通用', '家居', '食品', '教育', '服饰'].map((item) => <option value={item} key={item}>类型：{item}</option>)}</select><ChevronDown size={12} /></label><label><select aria-label="模板颜色" value={templateColor} onChange={(event) => setTemplateColor(event.target.value)}>{['全部', '暖色', '清新', '亮色'].map((item) => <option value={item} key={item}>颜色：{item}</option>)}</select><ChevronDown size={12} /></label></div><div className="xlTemplateGrid">{filteredTemplates.map((template) => <button className={selectedTemplateId === template.id ? 'selected' : ''} type="button" key={template.id} onClick={() => applyTemplate(template.id)}><img src={template.image} alt={template.name} /><span>{template.name}</span></button>)}</div>{!filteredTemplates.length && <div className="xlMaterialNoResult">没有找到匹配模板</div>}</>}

                    {materialTab === 'host' && <div className="xlHostPicker"><label className="xlMaterialSearch"><input value={hostQuery} onChange={(event) => setHostQuery(event.target.value)} placeholder="搜索人像名称" /><Search size={15} /></label><div className="xlHostScope"><button className={hostScope === 'mine' ? 'active' : ''} type="button" onClick={() => setHostScope('mine')}>我的</button><button className={hostScope === 'square' ? 'active' : ''} type="button" onClick={() => setHostScope('square')}>广场</button><button className={hostScope === 'favorite' ? 'active' : ''} type="button" onClick={() => setHostScope('favorite')}>收藏</button></div>{hostScope === 'square' && <><button className="xlExpandFilters" type="button" aria-expanded={showHostFilters} onClick={() => setShowHostFilters((value) => !value)}>{showHostFilters ? '收起筛选' : '展开筛选'}<ChevronDown size={13} /></button>{showHostFilters && <div className="xlHostFilters"><label><span>类型</span><select value={hostFilters.type} onChange={(event) => setHostFilters((filters) => ({ ...filters, type: event.target.value }))}><option>全部</option><option>真人</option><option>卡通</option></select></label><label><span>性别</span><select value={hostFilters.gender} onChange={(event) => setHostFilters((filters) => ({ ...filters, gender: event.target.value }))}><option>全部</option><option>女</option><option>男</option></select></label><label><span>年龄</span><select value={hostFilters.age} onChange={(event) => setHostFilters((filters) => ({ ...filters, age: event.target.value }))}><option>全部</option><option>青年</option><option>中年</option></select></label></div>}</>}{visibleHosts.map((item) => <button className={avatarId === item.id ? 'selected' : ''} type="button" key={item.id} disabled={onAir} onClick={() => { if (item.id === avatarId) { setNotice('当前已使用该主播'); return; } setPendingAvatarId(item.id); setDialog('avatarConfirm'); }}><img src={item.id === 'chinese' ? '/assets/xiling-live/host.png' : item.image} alt={item.name} /><span><strong>{item.name}</strong><small>{item.role}</small></span>{avatarId === item.id && <Check size={15} />}</button>)}{!visibleHosts.length && <div className="xlMaterialNoResult">没有找到匹配主播</div>}</div>}

                    {(materialTab === 'image' || materialTab === 'video') && <div className="xlAssetPanel"><label className="xlMaterialSearch"><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder={`搜索${materialTab === 'image' ? '图片' : '视频'}名称`} /><Search size={15} /></label><div className="xlAssetToolbar"><div><button className={assetScope === 'mine' ? 'active' : ''} type="button" onClick={() => { setAssetScope('mine'); setSelectedAssetIds([]); }}>我的</button><button className={assetScope === 'square' ? 'active' : ''} type="button" onClick={() => { setAssetScope('square'); setSelectedAssetIds([]); }}>广场</button></div><span><button type="button" onClick={() => (materialTab === 'image' ? imageInputRef : videoInputRef).current?.click()}><Upload size={13} />导入</button><button className={assetBatchMode ? 'active' : ''} type="button" onClick={() => { setAssetBatchMode((value) => !value); setSelectedAssetIds([]); }}>批量</button></span></div>{assetBatchMode && <div className="xlAssetBatchToolbar"><button type="button" onClick={() => setSelectedAssetIds(selectedAssetIds.length === currentAssets.length ? [] : currentAssets.map((item) => item.id))}>{currentAssets.length > 0 && selectedAssetIds.length === currentAssets.length ? <CheckSquare size={14} /> : <span className="xlEmptyCheck" />}全选</button><button type="button" disabled={!selectedAssetIds.length || assetScope !== 'mine'} onClick={deleteSelectedAssets}><Trash2 size={14} />删除已选</button></div>}{assetScope === 'mine' && currentAssets.length === 0 ? <div className="xlMaterialEmpty"><span>{materialTab === 'image' ? <ImageIcon size={26} /> : <Video size={26} />}</span><strong>暂无{materialTab === 'image' ? '图片' : '视频'}素材</strong><p>导入只会加入“我的素材”，点击素材卡片才会添加到直播画面。</p><button type="button" onClick={() => (materialTab === 'image' ? imageInputRef : videoInputRef).current?.click()}><Plus size={14} />导入素材</button></div> : <div className="xlAssetCards">{currentAssets.map((asset) => { const selected = selectedAssetIds.includes(asset.id); return <button className={selected ? 'selected' : ''} type="button" key={asset.id} onClick={() => assetBatchMode ? toggleAssetSelection(asset.id) : addAssetToCanvas(asset)}>{asset.preview && asset.kind === 'image' ? <img src={asset.preview} alt="" /> : <span>{asset.kind === 'image' ? <ImageIcon size={22} /> : <Video size={22} />}</span>}<strong>{asset.name}</strong>{assetBatchMode && <i>{selected ? <Check size={12} /> : null}</i>}</button>; })}</div>}</div>}

                    {materialTab === 'text' && <div className="xlTextMaterial"><h3>添加文本素材</h3><label><span>文本内容</span><input value={customText} onChange={(event) => setCustomText(event.target.value)} maxLength={24} /></label><div className="xlTextPreview">{customText || '请输入文本内容'}</div><button type="button" disabled={!customText.trim()} onClick={addTextToCanvas}><Plus size={14} />添加到直播画面</button></div>}
                  </div>}
                  </div>
                  <section className="xlLayers">
                    <header><strong>图层</strong><span>{layers.length}</span></header>
                    <div className="xlLayerList" ref={layerListRef}>{layers.map((layer) => {
                        const Icon = layer.kind === 'text' ? Type : layer.kind === 'image' ? ImageIcon : layer.kind === 'video' ? Video : UserRound;
                        return <div className={`xlLayerRow ${selectedLayerId === layer.id ? 'selected' : ''}`} role="button" tabIndex={0} data-layer-id={layer.id} aria-pressed={selectedLayerId === layer.id} key={layer.id} onClick={() => openLayerInspector(layer.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLayerInspector(layer.id); } }}><span>{layer.preview && layer.kind === 'image' ? <img src={layer.preview} alt="" /> : <Icon size={14} />}</span><em>{layer.value}</em><button className="xlLayerDelete" type="button" aria-label={`删除${layer.value}图层`} onClick={(event) => { event.stopPropagation(); deleteLayer(layer.id); }}><Trash2 size={13} /></button></div>;
                      })}</div>
                  </section>
                </div>
              </aside>
            </div>
          )}
        </section>
      </div>

      {notice && <div className="xlToast" role="status"><Check size={15} />{notice}</div>}

      {dialog === 'settings' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}><section className="xlModal xlSettingsModal" role="dialog" aria-modal="true" aria-label="直播设置" onMouseDown={(event) => event.stopPropagation()}><header><strong>直播设置</strong><button type="button" aria-label="关闭直播设置" onClick={() => setDialog(null)}><X size={17} /></button></header><div className="xlSettingsBody"><nav>{SETTINGS_TABS.map((tab) => { const Icon = tab.icon; return <button className={settingsTab === tab.id ? 'active' : ''} type="button" key={tab.id} onClick={() => setSettingsTab(tab.id)}><Icon size={16} />{tab.label}{tab.id === 'dynamic' && <em>NEW</em>}</button>; })}</nav><div className="xlSettingsContent">{settingsTab === 'qa' && <><div className="xlSettingRow"><span><strong>开启问答</strong><small>自动识别直播间问题并生成回复</small></span><button className={`xlSwitch ${liveOptions.qa ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.qa} onClick={() => setLiveOptions((value) => ({ ...value, qa: !value.qa }))}><i /></button></div><div className="xlSettingBlock"><strong>回复范围</strong><div className="xlRadioGroup"><button className={liveOptions.replyMode === 'hybrid' ? 'active' : ''} type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyMode: 'hybrid' }))}>文心智能回复 + 问答库回复</button><button className={liveOptions.replyMode === 'library' ? 'active' : ''} type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyMode: 'library' }))}>仅问答库回复</button></div></div><div className="xlSettingBlock"><strong>单次回复上限</strong><div className="xlStepper"><button type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyLimit: Math.max(1, value.replyLimit - 1) }))}>−</button><span>{liveOptions.replyLimit}</span><button type="button" onClick={() => setLiveOptions((value) => ({ ...value, replyLimit: Math.min(20, value.replyLimit + 1) }))}>+</button><em>条</em></div></div></>}{settingsTab === 'dynamic' && <><div className="xlSettingRow"><span><strong>开启 AI 动态话术</strong><small>根据直播节奏智能改写和补充话术</small></span><button className={`xlSwitch ${liveOptions.dynamic ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.dynamic} onClick={() => setLiveOptions((value) => ({ ...value, dynamic: !value.dynamic }))}><i /></button></div><div className="xlSettingNote">开启后，AI 会在保留商品卖点的前提下动态生成表达，降低重复播报。</div></>}{settingsTab === 'ambience' && <><div className="xlSettingRow"><span><strong>开启氛围互动</strong><small>自动欢迎新观众并感谢关注、点赞</small></span><button className={`xlSwitch ${liveOptions.ambience ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.ambience} onClick={() => setLiveOptions((value) => ({ ...value, ambience: !value.ambience }))}><i /></button></div><div className="xlSettingNote">互动内容会在当前话术播放间隙插入，不会打断商品讲解。</div></>}{settingsTab === 'product' && <><div className="xlSettingRow"><span><strong>随讲解弹商品卡</strong><small>讲到价格和下单信息时自动展示商品卡</small></span><button className={`xlSwitch ${liveOptions.product ? 'on' : ''}`} type="button" role="switch" aria-checked={liveOptions.product} onClick={() => setLiveOptions((value) => ({ ...value, product: !value.product }))}><i /></button></div><div className="xlSettingNote">商品卡将跟随促单话术出现，观众可以更快找到当前讲解商品。</div></>}</div></div></section></div>}

      {dialog === 'livePlatform' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}><section className="xlModal xlLivePlatformModal" role="dialog" aria-modal="true" aria-label="选择直播平台" onMouseDown={(event) => event.stopPropagation()}><header><strong>选择直播平台</strong><button type="button" aria-label="关闭直播平台选择" onClick={() => setDialog(null)}><X size={17} /></button></header><div className="xlPlatformNotice">由于平台规则调整，部分平台授权能力可能暂不可用，请选择已完成账号授权的平台开始直播。</div><h2>授权您的直播账号，快速开启 AI 主播直播</h2><div className="xlPlatformGrid">{PLATFORMS.map((platform) => <button className={selectedPlatform === platform.name ? 'selected' : ''} type="button" key={platform.name} disabled={platform.status === '系统维护'} onClick={() => setSelectedPlatform(platform.name)}><span className="xlPlatformLogo" style={{ backgroundColor: platform.color }}><img src={platform.logo} alt="" /></span><strong>{platform.name}</strong>{platform.status && <em>{platform.status}</em>}</button>)}</div><footer><button type="button" onClick={() => setDialog(null)}>取消</button><button type="button" onClick={() => startLive(selectedPlatform)}>开始直播</button></footer></section></div>}

      {dialog === 'library' && <div className="xlModalBackdrop" onMouseDown={() => setDialog(null)}><section className="xlModal xlLibraryModal" role="dialog" aria-modal="true" aria-label="话术库" onMouseDown={(event) => event.stopPropagation()}><header><strong>从话术库选择</strong><button type="button" aria-label="关闭话术库" onClick={() => setDialog(null)}><X size={17} /></button></header><div className="xlLibraryList">{[{ title: '咖啡冲泡建议', text: '不同冲泡方式会呈现不同风味，手冲清晰、浓缩醇厚，大家可以根据自己的口味选择。' }, { title: '直播间福利提醒', text: '直播间专属福利正在进行，喜欢的朋友记得及时下单，库存售完就恢复日常价格。' }, { title: '品质保障说明', text: '每一批咖啡豆都经过筛选和烘焙把控，包装后妥善保存，可以更好地保留香气。' }].map((item) => <article key={item.title}><div><strong>{item.title}</strong><p>{item.text}</p></div><button type="button" onClick={() => { setScripts((items) => [...items, { id: Date.now(), title: item.title, category: '讲品', duration: '00:32', text: item.text, state: 'ready' }]); setDialog(null); setNotice('已从话术库添加内容'); }}><Plus size={14} />添加</button></article>)}</div></section></div>}

      {dialog === 'avatarConfirm' && <div className="xlModalBackdrop" onMouseDown={() => { setDialog(null); setPendingAvatarId(null); }}><section className="xlModal xlConfirmModal" role="dialog" aria-modal="true" aria-labelledby="avatar-confirm-title" onMouseDown={(event) => event.stopPropagation()}><header><strong id="avatar-confirm-title">切换人像</strong><button type="button" aria-label="关闭主播确认" onClick={() => { setDialog(null); setPendingAvatarId(null); }}><X size={17} /></button></header><p>切换人像后，当前直播中所有商品都将会被替换，是否继续？</p><footer><button type="button" onClick={() => { setDialog(null); setPendingAvatarId(null); }}>取消</button><button type="button" onClick={applyPendingAvatar}>确定</button></footer></section></div>}
    </main>
  );
}
