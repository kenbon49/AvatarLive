'use client';

import { CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  Check,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Mic2,
  Move3d,
  Palette,
  Play,
  RotateCcw,
  ScanFace,
  Send,
  Sparkles,
  UserRound,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  AvatarCapabilityPanel,
  DEFAULT_AVATAR_STYLE_SELECTION,
  type AvatarCapabilityMode,
  type AvatarStyleSelection,
} from '@/components/avatar-capability-panel';
import {
  AVATAR_VOICE_STORAGE_KEY,
  CUSTOM_AVATAR_STORAGE_KEY,
  readAvatarVoicePreferences,
  readCustomAvatars,
  type Avatar,
  type AvatarVideoAsset,
  type AvatarVideoJob,
} from '@/lib/avatar-catalog';
import { avatarPreviewVideo } from '@/lib/avatar-preview-media';
import {
  cloneMuseTalkVoice,
  fetchMuseTalkVoices,
  type MuseTalkAvatarProfile,
} from '@/lib/musetalk-total-stream';

export type CreatorTab = 'appearance' | 'voice' | 'background' | 'persona' | AvatarCapabilityMode;
type ChatMessage = { role: 'assistant' | 'user'; text: string };
type DesignVoice = { id: string; name: string; detail: string; preview: string; source: 'public' };
type ImageRevision = { image: string; filter: string };
type ImageDimensions = { width: number; height: number };

type StoredAvatar = {
  id: string;
  name: string;
  role: string;
  description: string;
  profile: MuseTalkAvatarProfile;
  language: 'ZH' | 'EN';
  image: string;
  custom: true;
  voice: string;
  background: string;
  style: AvatarStyleSelection;
  baseProfile: MuseTalkAvatarProfile;
  video?: AvatarVideoAsset;
  pendingVideo?: AvatarVideoJob;
};

type AvatarVideoJobPayload = {
  jobId: string;
  avatarId: string;
  profile?: string;
  status: AvatarVideoJob['status'] | 'ready';
  model?: string;
  progress?: string;
  error?: string;
  image?: string;
  idleVideo?: string;
  talkVideo?: string;
  quality?: { duration?: number; width?: number; height?: number; frames?: number; fps?: number } | null;
  message?: string;
};

const SEEDANCE_FALLBACK_MODEL = 'doubao-seedance-2-5-260628';

type AvatarDesignStudioProps = {
  initialAvatar?: Avatar;
  initialAvatarId?: string;
  initialTab: CreatorTab;
};

const CREATOR_TABS = [
  { id: 'appearance' as const, label: '形象', icon: UserRound },
  { id: 'voice' as const, label: '声音', icon: Mic2 },
  { id: 'background' as const, label: '背景', icon: ImageIcon },
  { id: 'expression' as const, label: '表情', icon: ScanFace },
  { id: 'motion' as const, label: '动作', icon: Move3d },
];

const BACKGROUNDS = [
  { id: 'transparent', label: '透明', className: 'transparent' },
  { id: 'studio', label: '演播室', className: 'studio' },
  { id: 'warm', label: '暖调空间', className: 'warm' },
  { id: 'brand', label: '品牌蓝', className: 'brand' },
];

const DESIGN_VOICES: DesignVoice[] = [
  { id: 'default_female', name: '默认女声', detail: 'CosyVoice · 中文女声', preview: '', source: 'public' },
  { id: 'customer_service_female', name: '客服女声', detail: 'Fish Audio · 清晰专业', preview: '/assets/voice-samples/fish-audio/professional-female.mp3', source: 'public' },
  { id: 'gentle_female', name: '温柔女声', detail: 'Fish Audio · 温暖亲和', preview: '/assets/voice-samples/fish-audio/considerate-female.mp3', source: 'public' },
  { id: 'corporate_narrator_male', name: '企业宣传男声', detail: 'Fish Audio · 沉稳可信', preview: '/assets/voice-samples/fish-audio/steady-story-male.mp3', source: 'public' },
];

const AI_FULL_BODY_PATTERN = /全身|补全|扩图|扩展画面|下半身|腿部|鞋子|脚部/;
const AI_IMAGE_RATIOS = [
  { label: '9:16', value: 9 / 16 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '1:1', value: 1 },
  { label: '5:4', value: 5 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 },
] as const;

function aiImageAspectRatio(instruction: string, dimensions: ImageDimensions | null) {
  if (AI_FULL_BODY_PATTERN.test(instruction)) return '9:16';
  if (!dimensions?.width || !dimensions.height) return '9:16';
  const ratio = dimensions.width / dimensions.height;
  return AI_IMAGE_RATIOS.reduce((closest, candidate) => (
    Math.abs(candidate.value - ratio) < Math.abs(closest.value - ratio) ? candidate : closest
  )).label;
}

async function resizeImage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('图片格式无法识别'));
    element.src = source;
  });
  const scale = Math.min(1, 1080 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

async function bakeImageFilter(source: string, filter: string): Promise<string> {
  if (filter === 'none') return source;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('修改后的图片无法保存'));
    element.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片');
  context.filter = filter;
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function initialGreeting(avatar?: Avatar) {
  if (!avatar) return '你好，很高兴认识你。有什么可以帮你？';
  return avatar.custom ? avatar.description : `你好，我是${avatar.name}。有什么可以帮你？`;
}

function pendingJobFromPayload(payload: AvatarVideoJobPayload): AvatarVideoJob {
  const allowed = new Set<AvatarVideoJob['status']>(['submitted', 'processing', 'finalizing', 'review', 'failed']);
  if (!payload.jobId || !allowed.has(payload.status as AvatarVideoJob['status'])) {
    throw new Error('动态素材服务返回了无效任务状态');
  }
  return {
    jobId: payload.jobId,
    status: payload.status as AvatarVideoJob['status'],
    model: payload.model,
    profile: payload.profile,
    progress: payload.progress,
    error: payload.error,
    idleVideo: payload.idleVideo,
    talkVideo: payload.talkVideo,
    image: payload.image,
  };
}

function updateStoredAvatarVideo(
  avatarId: string,
  pendingVideo: AvatarVideoJob | undefined,
  video: AvatarVideoAsset | undefined,
  image?: string,
) {
  const avatars = readCustomAvatars();
  const current = avatars.find((avatar) => avatar.id === avatarId);
  if (!current) return;
  const updated = {
    ...current,
    image: image || current.image,
    profile: video?.profile || current.profile,
    pendingVideo,
    video,
  };
  localStorage.setItem(
    CUSTOM_AVATAR_STORAGE_KEY,
    JSON.stringify([updated, ...avatars.filter((avatar) => avatar.id !== avatarId)]),
  );
}

export function AvatarDesignStudio({
  initialAvatar,
  initialAvatarId,
  initialTab,
}: AvatarDesignStudioProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<CreatorTab>(initialTab);
  const [name, setName] = useState(initialAvatar?.name ?? '');
  const [role, setRole] = useState(initialAvatar?.role ?? '品牌数字人');
  const [greeting, setGreeting] = useState(initialGreeting(initialAvatar));
  const [voice, setVoice] = useState(initialAvatar?.voice ?? DESIGN_VOICES[0].id);
  const [pendingVoice, setPendingVoice] = useState(initialAvatar?.voice ?? DESIGN_VOICES[0].id);
  const [voiceSource, setVoiceSource] = useState<'public' | 'clone'>('public');
  const [voiceProfiles, setVoiceProfiles] = useState<DesignVoice[]>(DESIGN_VOICES);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [clonePreview, setClonePreview] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneTranscript, setCloneTranscript] = useState('');
  const [cloneState, setCloneState] = useState<'idle' | 'cloning' | 'ready'>('idle');
  const [cloneError, setCloneError] = useState('');
  const [clonedVoice, setClonedVoice] = useState<DesignVoice | null>(null);
  const [background, setBackground] = useState(initialAvatar?.background ?? 'transparent');
  const [styleSelection, setStyleSelection] = useState<AvatarStyleSelection>(initialAvatar?.style ?? { ...DEFAULT_AVATAR_STYLE_SELECTION });
  const [image, setImage] = useState(initialAvatar?.image ?? '');
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [imageHistory, setImageHistory] = useState<ImageRevision[]>([]);
  const [imageEditing, setImageEditing] = useState(false);
  const [sourceAvatarId, setSourceAvatarId] = useState(initialAvatar?.id ?? initialAvatarId ?? '');
  const [editingCustomAvatar, setEditingCustomAvatar] = useState(initialAvatar?.custom === true);
  const [sourceProfile, setSourceProfile] = useState<MuseTalkAvatarProfile>(initialAvatar?.profile ?? 'chinese');
  const [baseProfile, setBaseProfile] = useState<MuseTalkAvatarProfile>(initialAvatar?.baseProfile ?? initialAvatar?.profile ?? 'chinese');
  const [sourceLanguage, setSourceLanguage] = useState<'ZH' | 'EN'>(initialAvatar?.language ?? 'ZH');
  const [video, setVideo] = useState<AvatarVideoAsset | undefined>(initialAvatar?.video);
  const [pendingVideo, setPendingVideo] = useState<AvatarVideoJob | undefined>(initialAvatar?.pendingVideo);
  const [videoActionPending, setVideoActionPending] = useState(false);
  const draftAvatarIdRef = useRef(`custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const [imageFilter, setImageFilter] = useState('none');
  const [prompt, setPrompt] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'assistant', text: '上传形象后，可以调整亮度和色调，也可以让 AI 换装、换背景或补全全身。' },
  ]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const capabilityMode = activeTab === 'expression' || activeTab === 'motion' || activeTab === 'style' ? activeTab : null;

  useEffect(() => {
    if (initialAvatar || !initialAvatarId) return;
    const stored = readCustomAvatars().find((avatar) => avatar.id === initialAvatarId);
    if (!stored) {
      setError('没有找到要配置的数字人，请从形象列表重新进入。');
      return;
    }
    setSourceAvatarId(stored.id);
    setEditingCustomAvatar(true);
    setSourceProfile(stored.profile);
    setBaseProfile(stored.baseProfile ?? stored.profile);
    setSourceLanguage(stored.language);
    setName(stored.name);
    setRole(stored.role);
    setGreeting(initialGreeting(stored));
    setVoice(stored.voice ?? DESIGN_VOICES[0].id);
    setPendingVoice(stored.voice ?? DESIGN_VOICES[0].id);
    setBackground(stored.background ?? 'transparent');
    setStyleSelection(stored.style ?? { ...DEFAULT_AVATAR_STYLE_SELECTION });
    setImage(stored.image);
    setVideo(stored.video);
    setPendingVideo(stored.pendingVideo);
  }, [initialAvatar, initialAvatarId]);

  const syncDesignUrl = (tab: CreatorTab) => {
    const params = new URLSearchParams(window.location.search);
    if (sourceAvatarId) params.set('avatar', sourceAvatarId);
    else params.delete('avatar');
    params.set('tab', tab);
    params.delete('driveTab');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `/design${query ? `?${query}` : ''}`);
  };

  const chooseTab = (tab: CreatorTab) => {
    setActiveTab(tab);
    syncDesignUrl(tab);
  };

  const loadImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择 JPG、PNG 或 WebP 图片。');
      return;
    }
    try {
      setError('');
      setImage(await resizeImage(file));
      setImageFilter('none');
      setImageHistory([]);
      setChat((items) => [...items, { role: 'assistant', text: '形象已载入。现在可以用自然语言调整画面风格。' }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片处理失败');
    }
  };

  const modifyImage = async (event: FormEvent) => {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!instruction || imageEditing) return;
    setPrompt('');
    setChat((items) => [...items, { role: 'user', text: instruction }]);

    if (!image) {
      setChat((items) => [...items, { role: 'assistant', text: '请先上传一张正面人物图片，我才能开始修改。' }]);
      return;
    }

    let nextFilter = imageFilter;
    let response = '';
    if (/恢复|还原|原图|重置/.test(instruction)) {
      nextFilter = 'none';
      response = '已恢复原图。';
    } else if (/更亮|亮一点|提亮|明亮/.test(instruction)) {
      nextFilter = 'brightness(1.14) contrast(1.03)';
      response = '已经提亮形象，并轻微增强了对比度。';
    } else if (/更暗|暗一点|压暗/.test(instruction)) {
      nextFilter = 'brightness(.84) contrast(1.06)';
      response = '已经降低亮度，让画面更沉稳。';
    } else if (/暖|温暖|暖色/.test(instruction)) {
      nextFilter = 'sepia(.16) saturate(1.12) brightness(1.03)';
      response = '已经调整为更温暖、自然的色调。';
    } else if (/冷|冷色|清冷/.test(instruction)) {
      nextFilter = 'saturate(.9) hue-rotate(8deg) brightness(1.02)';
      response = '已经调整为更清爽的冷色调。';
    } else if (/黑白|单色|去色/.test(instruction)) {
      nextFilter = 'grayscale(1) contrast(1.08)';
      response = '已经生成黑白风格预览。';
    }
    if (response) {
      setImageFilter(nextFilter);
      window.setTimeout(() => setChat((items) => [...items, { role: 'assistant', text: response }]), 180);
      return;
    }

    setImageEditing(true);
    setError('');
    setChat((items) => [...items, { role: 'assistant', text: '正在保持人物身份特征并生成修改后的形象…' }]);
    try {
      const renderedImage = await bakeImageFilter(image, imageFilter);
      const sourceResponse = await fetch(renderedImage);
      if (!sourceResponse.ok) throw new Error('当前形象读取失败');
      const sourceBlob = await sourceResponse.blob();
      const form = new FormData();
      form.append('prompt', instruction);
      form.append('aspect_ratio', aiImageAspectRatio(instruction, imageDimensions));
      form.append('image', sourceBlob, 'avatar-reference.jpg');

      const editResponse = await fetch('/avatar-image-api/edit', { method: 'POST', body: form });
      const payload = await editResponse.json() as { image?: unknown; message?: unknown; model?: unknown };
      if (!editResponse.ok || typeof payload.image !== 'string') {
        throw new Error(typeof payload.message === 'string' ? payload.message : `图像编辑服务返回 HTTP ${editResponse.status}`);
      }
      const generatedResponse = await fetch(payload.image);
      const generatedBlob = await generatedResponse.blob();
      const normalizedImage = await resizeImage(new File([generatedBlob], 'avatar-generated.png', { type: generatedBlob.type || 'image/png' }));

      setImageHistory((items) => [...items.slice(-4), { image, filter: imageFilter }]);
      setImage(normalizedImage);
      setImageFilter('none');
      setChat((items) => [
        ...items.slice(0, -1),
        { role: 'assistant', text: `修改完成${typeof payload.model === 'string' ? ` · ${payload.model}` : ''}。不满意可以撤销后重新描述。` },
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'AI 形象修改失败';
      setError(message);
      setChat((items) => [...items.slice(0, -1), { role: 'assistant', text: `修改失败：${message}` }]);
    } finally {
      setImageEditing(false);
    }
  };

  const undoImageEdit = () => {
    const previous = imageHistory.at(-1);
    if (!previous || imageEditing) return;
    setImage(previous.image);
    setImageFilter(previous.filter);
    setImageHistory((items) => items.slice(0, -1));
    setError('');
    setChat((items) => [...items, { role: 'assistant', text: '已撤销上一次 AI 修改。' }]);
  };

  const stopVoicePreview = () => {
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    setPreviewVoiceId(null);
  };

  useEffect(() => () => {
    voiceAudioRef.current?.pause();
  }, []);

  useEffect(() => {
    let active = true;
    void fetchMuseTalkVoices()
      .then((items) => {
        if (!active || !items.length) return;
        const profiles = items.map<DesignVoice>((item) => ({
          id: item.voice_id,
          name: item.name,
          detail: `${item.source?.provider || 'CosyVoice'} · ${item.kind === 'clone' ? '克隆音色' : '可用音色'}`,
          preview: item.source?.sample_url || DESIGN_VOICES.find((voice) => voice.id === item.voice_id)?.preview || '',
          source: 'public',
        }));
        const ids = new Set(profiles.map((item) => item.id));
        setVoiceProfiles(profiles);
        setVoice((current) => ids.has(current) ? current : profiles[0].id);
        setPendingVoice((current) => ids.has(current) ? current : profiles[0].id);
      })
      .catch((cause) => {
        if (active) setCloneError(cause instanceof Error ? cause.message : '音色目录加载失败');
      });
    return () => { active = false; };
  }, []);

  const previewVoice = async (item: DesignVoice) => {
    if (previewVoiceId === item.id) {
      stopVoicePreview();
      return;
    }
    stopVoicePreview();
    if (!item.preview) {
      setCloneError('该音色没有可用的试听音频。');
      return;
    }
    const audio = new Audio(item.preview);
    voiceAudioRef.current = audio;
    audio.onended = stopVoicePreview;
    audio.onerror = stopVoicePreview;
    try {
      await audio.play();
      setPreviewVoiceId(item.id);
    } catch {
      setCloneError('试听音频播放失败，请检查浏览器的音频播放权限。');
    }
  };

  const loadCloneAudio = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setCloneError('请选择 MP3、WAV、M4A、AAC 或 OGG 音频。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setCloneError('参考语音不能超过 20 MB。');
      return;
    }
    if (clonePreview && !voiceProfiles.some((item) => item.preview === clonePreview)) URL.revokeObjectURL(clonePreview);
    setCloneFile(file);
    setClonePreview(URL.createObjectURL(file));
    setCloneName((current) => current || `${file.name.replace(/\.[^.]+$/, '')}的声音`);
    setClonedVoice(null);
    setCloneState('idle');
    setCloneError('');
  };

  const cloneVoice = async () => {
    if (!cloneFile) {
      setCloneError('请先上传一段清晰的参考语音。');
      return;
    }
    if (!cloneName.trim()) {
      setCloneError('请为克隆语音命名。');
      return;
    }
    setCloneError('');
    setCloneState('cloning');
    try {
      const result = await cloneMuseTalkVoice(cloneName.trim(), cloneFile);
      setClonedVoice({
        id: result.voice_id,
        name: result.name,
        detail: '我的克隆语音 · Whisper 已识别',
        preview: clonePreview,
        source: 'public',
      });
      setCloneTranscript(result.whisper_text || 'Whisper 已完成识别');
      setCloneState('ready');
    } catch (cause) {
      setCloneState('idle');
      setCloneError(cause instanceof Error ? cause.message : '音色克隆失败');
    }
  };

  const saveCloneVoice = () => {
    if (cloneState !== 'ready' || !clonedVoice) return;
    setVoiceProfiles((items) => [clonedVoice, ...items.filter((item) => item.id !== clonedVoice.id)]);
    setPendingVoice(clonedVoice.id);
    setVoiceSource('public');
    setCloneFile(null);
    setClonePreview('');
    setCloneName('');
    setCloneTranscript('');
    setClonedVoice(null);
    setCloneState('idle');
  };

  const applyVoice = () => {
    setVoice(pendingVoice);
    const avatarId = sourceAvatarId || initialAvatarId;
    if (!avatarId) return;
    const preferences = readAvatarVoicePreferences();
    localStorage.setItem(AVATAR_VOICE_STORAGE_KEY, JSON.stringify({ ...preferences, [avatarId]: pendingVoice }));
  };

  const currentCustomAvatarId = () => (
    editingCustomAvatar && sourceAvatarId.startsWith('custom-')
      ? sourceAvatarId
      : draftAvatarIdRef.current
  );

  const persistAvatar = (finalImage: string) => {
    const avatar: StoredAvatar = {
      id: currentCustomAvatarId(),
      name: name.trim(),
      role: role.trim() || '专属数字人',
      description: greeting.trim() || '专属互动数字人',
      profile: video?.profile || sourceProfile,
      baseProfile,
      language: sourceLanguage,
      image: finalImage,
      custom: true,
      voice,
      background,
      style: styleSelection,
      video,
      pendingVideo,
    };
    const remaining = readCustomAvatars().filter((item) => item.id !== avatar.id);
    localStorage.setItem(CUSTOM_AVATAR_STORAGE_KEY, JSON.stringify([avatar, ...remaining]));
    setSourceAvatarId(avatar.id);
    setEditingCustomAvatar(true);
    return avatar;
  };

  const saveAvatar = async () => {
    if (!name.trim() || !image || saving) return;
    setSaving(true);
    setError('');
    try {
      persistAvatar(await bakeImageFilter(image, imageFilter));
      router.push('/');
    } catch (cause) {
      setSaving(false);
      setError(cause instanceof Error ? cause.message : '浏览器存储空间不足，请使用尺寸更小的照片。');
    }
  };

  const startVideoGeneration = async (requestedModel?: string) => {
    if (!name.trim() || !image || videoActionPending || ['submitted', 'processing', 'finalizing'].includes(pendingVideo?.status || '')) return;
    setVideoActionPending(true);
    setError('');
    try {
      const finalImage = await bakeImageFilter(image, imageFilter);
      const avatar = persistAvatar(finalImage);
      const sourceResponse = await fetch(finalImage);
      if (!sourceResponse.ok) throw new Error('最终形象图片读取失败');
      const form = new FormData();
      form.append('avatar_id', avatar.id);
      form.append('avatar_name', avatar.name);
      form.append('base_profile', avatar.baseProfile);
      form.append('image', await sourceResponse.blob(), 'avatar-reference.jpg');
      if (requestedModel) form.append('model', requestedModel);
      const response = await fetch('/avatar-video-api/jobs', { method: 'POST', body: form });
      const payload = await response.json() as AvatarVideoJobPayload;
      if (!response.ok) throw new Error(payload.message || payload.error || `动态素材服务 HTTP ${response.status}`);
      const nextJob = pendingJobFromPayload(payload);
      setImage(finalImage);
      setImageFilter('none');
      setPendingVideo(nextJob);
      updateStoredAvatarVideo(avatar.id, nextJob, video, finalImage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '动态素材任务创建失败');
    } finally {
      setVideoActionPending(false);
    }
  };

  const publishVideo = async () => {
    if (!pendingVideo || pendingVideo.status !== 'review' || videoActionPending) return;
    setVideoActionPending(true);
    setError('');
    try {
      const response = await fetch(`/avatar-video-api/jobs/${encodeURIComponent(pendingVideo.jobId)}/publish`, { method: 'POST' });
      const payload = await response.json() as AvatarVideoJobPayload;
      if (!response.ok || payload.status !== 'ready' || !payload.profile || !payload.idleVideo || !payload.talkVideo) {
        throw new Error(payload.message || payload.error || '动态素材应用失败');
      }
      const nextVideo: AvatarVideoAsset = {
        jobId: payload.jobId,
        profile: payload.profile,
        idleVideo: payload.idleVideo,
        talkVideo: payload.talkVideo,
        image: payload.image,
      };
      setVideo(nextVideo);
      setPendingVideo(undefined);
      setSourceProfile(nextVideo.profile);
      if (payload.image) setImage(payload.image);
      updateStoredAvatarVideo(currentCustomAvatarId(), undefined, nextVideo, payload.image);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '动态素材应用失败');
    } finally {
      setVideoActionPending(false);
    }
  };

  useEffect(() => {
    if (!pendingVideo || ['review', 'failed'].includes(pendingVideo.status)) return;
    let active = true;
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/avatar-video-api/jobs/${encodeURIComponent(pendingVideo.jobId)}`, { cache: 'no-store' });
        const payload = await response.json() as AvatarVideoJobPayload;
        if (!payload.jobId) throw new Error(payload.message || `动态素材任务查询 HTTP ${response.status}`);
        const nextJob = pendingJobFromPayload(payload);
        if (!active) return;
        setPendingVideo(nextJob);
        updateStoredAvatarVideo(currentCustomAvatarId(), nextJob, video, payload.image);
        if (!['review', 'failed'].includes(nextJob.status)) timeout = window.setTimeout(poll, 5_000);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : '动态素材任务查询失败');
        timeout = window.setTimeout(poll, 8_000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [pendingVideo?.jobId, pendingVideo?.status, sourceAvatarId, video]);

  const appliedVoiceName = voiceProfiles.find((item) => item.id === voice)?.name ?? voice;
  const pendingVoiceName = voiceProfiles.find((item) => item.id === pendingVoice)?.name ?? pendingVoice;
  const creatorCanvasStyle = image && imageDimensions
    ? { '--creator-image-ratio': String(imageDimensions.width / imageDimensions.height) } as CSSProperties
    : undefined;

  return (
    <div className="creatorShell">
      <header className="creatorTopbar">
        <button className="creatorBack" type="button" onClick={() => router.push('/')} aria-label="返回形象列表"><ArrowLeft size={18} /></button>
        <div className="creatorResourceTitle"><span>图片数字人 /</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="未命名形象" maxLength={16} /></div>
        <span className="creatorSaveHint">配置会保存在当前浏览器</span>
        <button className="creatorPublish" type="button" onClick={() => void saveAvatar()} disabled={!name.trim() || !image || saving || imageEditing}>{saving ? '正在保存…' : '保存并使用'}</button>
      </header>

      <div className="creatorBody">
        <nav className="creatorRail" aria-label="数字人配置">
          {CREATOR_TABS.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} type="button" onClick={() => chooseTab(tab.id)}><Icon size={20} /><span>{tab.label}</span></button>;
          })}
        </nav>

        {capabilityMode ? (
          <main className="creatorCapabilityStage">
            <AvatarCapabilityPanel
              mode={capabilityMode}
              avatarImage={image}
              avatarName={name}
              avatarVideo={pendingVideo?.idleVideo || video?.idleVideo || avatarPreviewVideo(sourceAvatarId)}
              styleSelection={styleSelection}
              onStyleSelectionChange={setStyleSelection}
            />
          </main>
        ) : <>
        <aside className="creatorInspector">
          {activeTab === 'appearance' && (
            <>
              <div className="inspectorHeading"><div><h1>形象设置</h1><p>上传照片并通过对话调整视觉风格</p></div><Sparkles size={19} /></div>
              <button className={`creatorUpload ${image ? 'hasImage' : ''}`} type="button" onClick={() => fileRef.current?.click()}>
                {image ? <><img src={image} alt="当前数字人形象" style={{ filter: imageFilter }} /><span>更换图片</span></> : <><ImagePlus size={28} /><strong>上传人物图片</strong><small>JPG / PNG / WebP，建议正脸、无遮挡</small></>}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void loadImage(event.target.files?.[0])} />

              <section className="imageChat">
                <div className="imageChatTitle"><MessageSquareText size={16} /><span><strong>对话修改形象</strong><small>当前支持本地画面风格指令</small></span></div>
                <div className="imageChatMessages">
                  {chat.slice(-4).map((message, index) => <p className={message.role} key={`${message.role}-${index}`}>{message.text}</p>)}
                </div>
                <form className="imagePrompt" onSubmit={(event) => void modifyImage(event)}>
                  <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：补全为职业女性全身照" disabled={imageEditing} />
                  <button aria-label="发送修改要求" disabled={!prompt.trim() || imageEditing}>{imageEditing ? <Loader2 size={15} className="creatorAiSpinner" /> : <Send size={15} />}</button>
                </form>
                <div className="apiBoundary"><Sparkles size={13} />亮度与色调在本地处理，复杂修改由 Nano Banana 生成</div>
              </section>

              <section className="creatorMotionCard">
                <div className="creatorMotionTitle"><Play size={15} /><span><strong>动态形象素材</strong><small>同一底片生成静息循环并供 MuseTalk 实时换口型</small></span></div>
                {video && !pendingVideo && <div className="creatorMotionState ready"><Check size={14} /><span><strong>动态素材已应用</strong><small>当前形象可以进入实时音视频互动</small></span></div>}
                {video && !pendingVideo && <video className="creatorMotionPreview" src={video.idleVideo} muted autoPlay loop playsInline controls />}
                {pendingVideo && <div className={`creatorMotionState ${pendingVideo.status}`}>
                  {['submitted', 'processing', 'finalizing'].includes(pendingVideo.status) ? <Loader2 size={14} className="creatorAiSpinner" /> : pendingVideo.status === 'review' ? <Play size={14} /> : <RotateCcw size={14} />}
                  <span><strong>{pendingVideo.status === 'review' ? '候选视频等待确认' : pendingVideo.status === 'failed' ? '动态素材生成失败' : '正在生成动态素材'}</strong><small>{pendingVideo.error || pendingVideo.progress || '任务正在处理中'}</small></span>
                </div>}
                {pendingVideo?.status === 'review' && pendingVideo.idleVideo && <video className="creatorMotionPreview" src={pendingVideo.idleVideo} muted autoPlay loop playsInline controls />}
                {pendingVideo?.status === 'review'
                  ? <button className="creatorMotionAction primary" type="button" disabled={videoActionPending} onClick={() => void publishVideo()}>{videoActionPending ? '正在应用…' : '确认并应用动态素材'}</button>
                  : !pendingVideo || pendingVideo.status === 'failed'
                    ? <>
                      <button className="creatorMotionAction" type="button" disabled={!image || !name.trim() || videoActionPending} onClick={() => void startVideoGeneration()}>{videoActionPending ? '正在提交…' : video ? '用 HappyHorse 重新生成' : '生成动态形象'}</button>
                      {pendingVideo?.status === 'failed' && pendingVideo.model !== SEEDANCE_FALLBACK_MODEL && <button className="creatorMotionAction" type="button" disabled={!image || !name.trim() || videoActionPending} onClick={() => void startVideoGeneration(SEEDANCE_FALLBACK_MODEL)}>改用 Seedance 2.5</button>}
                    </>
                    : null}
                <p>优先使用 HappyHorse 720P（预计约 10.8–14.4 元/次）；失败时可显式改用 Seedance 2.5，生成结果需预览确认后才会切换。</p>
              </section>
            </>
          )}

          {activeTab === 'voice' && (
            <>
              <div className="inspectorHeading"><div><h1>声音设置</h1><p>试听经典音色，或克隆你的专属声音</p></div><Volume2 size={19} /></div>
              <div className="creatorVoiceTabs" role="tablist" aria-label="声音来源">
                <button className={voiceSource === 'public' ? 'active' : ''} type="button" onClick={() => { stopVoicePreview(); setVoiceSource('public'); }}>可用语音</button>
                <button className={voiceSource === 'clone' ? 'active' : ''} type="button" onClick={() => { stopVoicePreview(); setVoiceSource('clone'); }}>克隆语音</button>
              </div>
              {voiceSource !== 'clone' ? <div className="voiceOptions creatorVoiceList">
                {voiceProfiles.map((item) => <div className={pendingVoice === item.id ? 'active' : ''} role="radio" aria-checked={pendingVoice === item.id} tabIndex={0} key={item.id} onClick={() => setPendingVoice(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPendingVoice(item.id); } }}><button className="creatorVoicePlay" type="button" aria-label={`试听${item.name}`} onClick={(event) => { event.stopPropagation(); void previewVoice(item); }}>{previewVoiceId === item.id ? <Volume2 size={14} /> : <Play size={14} fill="currentColor" />}</button><span><strong>{item.name}</strong><small>{item.detail}{voice === item.id ? ' · 使用中' : ''}</small></span>{pendingVoice === item.id && <Check size={16} />}</div>)}
                <button className="creatorVoiceApply" type="button" disabled={pendingVoice === voice} onClick={applyVoice}>{pendingVoice === voice ? '当前语音已应用' : `应用“${pendingVoiceName}”`}</button>
              </div> : <div className="creatorVoiceClone">
                <label className={cloneFile ? 'hasFile' : ''} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadCloneAudio(event.dataTransfer.files[0]); }}>
                  <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg" onChange={(event) => loadCloneAudio(event.target.files?.[0])} />
                  <span>{cloneFile ? <Check size={18} /> : <Upload size={18} />}</span><strong>{cloneFile?.name ?? '上传参考语音'}</strong><small>{cloneFile ? `${(cloneFile.size / 1024 / 1024).toFixed(2)} MB · 点击更换` : '10–30 秒清晰录音，最大 20 MB'}</small>
                </label>
                {clonePreview && <audio controls preload="metadata" src={clonePreview} />}
                <div className="creatorVoiceFields"><label><span>语音名称</span><input value={cloneName} maxLength={20} placeholder="例如：我的直播声音" onChange={(event) => { setCloneName(event.target.value); setCloneState('idle'); setClonedVoice(null); }} /></label><label><span>Whisper 识别文本</span><textarea value={cloneTranscript} maxLength={300} placeholder="上传后由后端 Whisper 自动识别" readOnly /></label></div>
                {cloneError && <div className="creatorVoiceError">{cloneError}</div>}
                {cloneState === 'ready' && <div className="creatorVoiceReady"><Check size={14} /><span><strong>克隆完成</strong><small>保存后会进入“可用语音”，选中并应用即可使用。</small></span></div>}
                <button className="creatorVoiceCloneAction" type="button" disabled={cloneState === 'cloning'} onClick={cloneState === 'ready' ? saveCloneVoice : () => void cloneVoice()}>{cloneState === 'cloning' ? <><Loader2 size={14} className="xlVoiceSpinner" />正在克隆…</> : cloneState === 'ready' ? '保存语音' : '开始克隆'}</button>
                <p>上传内容仅用于生成专属音色，请确保已获得声音授权。</p>
              </div>}
              <div className="creatorInfoNote"><Volume2 size={16} /><span><strong>当前播报声音：{appliedVoiceName}</strong><small>应用后会绑定到当前数字人，并随实时互动推理请求发送。</small></span></div>
            </>
          )}

          {activeTab === 'background' && (
            <>
              <div className="inspectorHeading"><div><h1>背景设置</h1><p>选择预览和直播画布背景</p></div><Palette size={19} /></div>
              <div className="backgroundOptions">
                {BACKGROUNDS.map((item) => <button key={item.id} className={background === item.id ? 'active' : ''} type="button" onClick={() => setBackground(item.id)}><i className={item.className} /> <span>{item.label}</span>{background === item.id && <Check size={14} />}</button>)}
              </div>
            </>
          )}

          {activeTab === 'persona' && (
            <>
              <div className="inspectorHeading"><div><h1>人设设置</h1><p>定义数字人的身份与开场方式</p></div><Bot size={19} /></div>
              <div className="personaFields">
                <label><span>数字人名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：小岚" maxLength={16} /></label>
                <label><span>角色定位</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="例如：品牌讲解员" maxLength={24} /></label>
                <label><span>开场问候</span><textarea value={greeting} onChange={(event) => setGreeting(event.target.value)} rows={5} maxLength={120} /></label>
              </div>
            </>
          )}

          {error && <div className="inlineError creatorError">{error}</div>}
        </aside>

        <main className="creatorStage">
          <div className="creatorNotice"><Sparkles size={15} /><span>{background === 'transparent' ? '当前为透明背景预览，保存后可在互动与直播场景中继续配置。' : '当前背景仅用于构图预览，形象会以原始比例完整显示。'}</span></div>
          <div className={`creatorCanvas background-${background} ${image ? 'hasImage' : ''}`} style={creatorCanvasStyle}>
            {image ? <img src={image} alt="数字人预览" style={{ filter: imageFilter }} onLoad={(event) => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <button type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={30} /><strong>上传一张图片开始创建</strong><span>人物会在这里以原始比例预览</span></button>}
            {image && <span className="creatorAiBadge"><Sparkles size={12} />图片数字人</span>}
            {imageEditing && <span className="creatorAiProgress"><Loader2 size={17} className="creatorAiSpinner" />AI 正在修改形象</span>}
          </div>
          <div className="creatorStageActions">
            <div>
              <button type="button" onClick={() => setImageFilter('none')} disabled={!image || imageFilter === 'none' || imageEditing}><RotateCcw size={16} />恢复色调</button>
              <button type="button" onClick={undoImageEdit} disabled={!imageHistory.length || imageEditing}><RotateCcw size={16} />撤销 AI 修改</button>
            </div>
            <span>{appliedVoiceName}</span>
          </div>
        </main>
        </>}
      </div>
    </div>
  );
}
