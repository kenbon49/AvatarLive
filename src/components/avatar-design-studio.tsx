'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  Check,
  Image as ImageIcon,
  ImagePlus,
  MessageSquareText,
  Mic2,
  Move3d,
  Palette,
  RotateCcw,
  ScanFace,
  Send,
  Sparkles,
  Shirt,
  UserRound,
  Volume2,
} from 'lucide-react';
import {
  AvatarCapabilityPanel,
  DEFAULT_AVATAR_STYLE_SELECTION,
  type AvatarCapabilityMode,
  type AvatarStyleSelection,
} from '@/components/avatar-capability-panel';
import {
  CUSTOM_AVATAR_STORAGE_KEY,
  readCustomAvatars,
  type Avatar,
} from '@/lib/avatar-catalog';
import { avatarPreviewVideo } from '@/lib/avatar-preview-media';
import type { MuseTalkAvatarProfile } from '@/lib/musetalk-total-stream';

export type CreatorTab = 'appearance' | 'voice' | 'background' | 'persona' | AvatarCapabilityMode;
type ChatMessage = { role: 'assistant' | 'user'; text: string };

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
};

type AvatarDesignStudioProps = {
  initialAvatar?: Avatar;
  initialAvatarId?: string;
  initialTab: CreatorTab;
};

const CREATOR_TABS = [
  { id: 'appearance' as const, label: '形象', icon: UserRound },
  { id: 'voice' as const, label: '声音', icon: Mic2 },
  { id: 'background' as const, label: '背景', icon: ImageIcon },
  { id: 'persona' as const, label: '人设', icon: Bot },
  { id: 'expression' as const, label: '表情', icon: ScanFace },
  { id: 'motion' as const, label: '动作', icon: Move3d },
  { id: 'style' as const, label: '造型', icon: Shirt },
];

const BACKGROUNDS = [
  { id: 'transparent', label: '透明', className: 'transparent' },
  { id: 'studio', label: '演播室', className: 'studio' },
  { id: 'warm', label: '暖调空间', className: 'warm' },
  { id: 'brand', label: '品牌蓝', className: 'brand' },
];

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
  const [voice, setVoice] = useState(initialAvatar?.voice ?? '温暖自然 · 中文女声');
  const [background, setBackground] = useState(initialAvatar?.background ?? 'transparent');
  const [styleSelection, setStyleSelection] = useState<AvatarStyleSelection>(initialAvatar?.style ?? { ...DEFAULT_AVATAR_STYLE_SELECTION });
  const [image, setImage] = useState(initialAvatar?.image ?? '');
  const [sourceAvatarId, setSourceAvatarId] = useState(initialAvatar?.id ?? initialAvatarId ?? '');
  const [editingCustomAvatar, setEditingCustomAvatar] = useState(initialAvatar?.custom === true);
  const [sourceProfile, setSourceProfile] = useState<MuseTalkAvatarProfile>(initialAvatar?.profile ?? 'chinese');
  const [sourceLanguage, setSourceLanguage] = useState<'ZH' | 'EN'>(initialAvatar?.language ?? 'ZH');
  const [imageFilter, setImageFilter] = useState('none');
  const [prompt, setPrompt] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'assistant', text: '上传形象后，可以告诉我“亮一点”“偏暖”“黑白”或“恢复原图”。' },
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
    setSourceLanguage(stored.language);
    setName(stored.name);
    setRole(stored.role);
    setGreeting(initialGreeting(stored));
    setVoice(stored.voice ?? '温暖自然 · 中文女声');
    setBackground(stored.background ?? 'transparent');
    setStyleSelection(stored.style ?? { ...DEFAULT_AVATAR_STYLE_SELECTION });
    setImage(stored.image);
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
      setChat((items) => [...items, { role: 'assistant', text: '形象已载入。现在可以用自然语言调整画面风格。' }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片处理失败');
    }
  };

  const modifyImage = (event: FormEvent) => {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!instruction) return;
    setPrompt('');
    setChat((items) => [...items, { role: 'user', text: instruction }]);

    if (!image) {
      setChat((items) => [...items, { role: 'assistant', text: '请先上传一张正面人物图片，我才能开始修改。' }]);
      return;
    }

    let nextFilter = imageFilter;
    let response = '已记录这条修改要求。换装、发型或重绘需要接入图像编辑模型；当前预览支持亮度、冷暖和黑白调整。';
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
    setImageFilter(nextFilter);
    window.setTimeout(() => setChat((items) => [...items, { role: 'assistant', text: response }]), 180);
  };

  const saveAvatar = async () => {
    if (!name.trim() || !image || saving) return;
    setSaving(true);
    setError('');
    try {
      const finalImage = await bakeImageFilter(image, imageFilter);
      const avatar: StoredAvatar = {
        id: editingCustomAvatar && sourceAvatarId ? sourceAvatarId : `custom-${Date.now()}`,
        name: name.trim(),
        role: role.trim() || '专属数字人',
        description: greeting.trim() || '专属互动数字人',
        profile: sourceProfile,
        language: sourceLanguage,
        image: finalImage,
        custom: true,
        voice,
        background,
        style: styleSelection,
      };
      const remaining = readCustomAvatars().filter((item) => item.id !== avatar.id);
      localStorage.setItem(CUSTOM_AVATAR_STORAGE_KEY, JSON.stringify([avatar, ...remaining]));
      router.push('/');
    } catch (cause) {
      setSaving(false);
      setError(cause instanceof Error ? cause.message : '浏览器存储空间不足，请使用尺寸更小的照片。');
    }
  };

  return (
    <div className="creatorShell">
      <header className="creatorTopbar">
        <button className="creatorBack" type="button" onClick={() => router.push('/')} aria-label="返回形象列表"><ArrowLeft size={18} /></button>
        <div className="creatorResourceTitle"><span>图片数字人 /</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="未命名形象" maxLength={16} /></div>
        <span className="creatorSaveHint">配置会保存在当前浏览器</span>
        <button className="creatorPublish" type="button" onClick={() => void saveAvatar()} disabled={!name.trim() || !image || saving}>{saving ? '正在保存…' : '保存并使用'}</button>
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
              avatarVideo={avatarPreviewVideo(sourceAvatarId)}
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
                <form className="imagePrompt" onSubmit={modifyImage}>
                  <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：整体亮一点" />
                  <button aria-label="发送修改要求" disabled={!prompt.trim()}><Send size={15} /></button>
                </form>
                <div className="apiBoundary"><Sparkles size={13} />复杂重绘已预留图像编辑 API 接入位置</div>
              </section>
            </>
          )}

          {activeTab === 'voice' && (
            <>
              <div className="inspectorHeading"><div><h1>声音设置</h1><p>为数字人选择默认播报声音</p></div><Volume2 size={19} /></div>
              <div className="voiceOptions">
                {['温暖自然 · 中文女声', '清晰专业 · 中文女声', '沉稳可信 · 中文男声'].map((item) => <button className={voice === item ? 'active' : ''} type="button" key={item} onClick={() => setVoice(item)}><span><strong>{item.split(' · ')[0]}</strong><small>{item.split(' · ')[1]}</small></span>{voice === item && <Check size={16} />}</button>)}
              </div>
              <div className="creatorInfoNote"><Volume2 size={16} /><span><strong>实时语音驱动</strong><small>进入互动或直播后，可通过项目现有 MuseTalk 流程生成音视频。</small></span></div>
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
          <div className={`creatorCanvas background-${background}`}>
            {image ? <img src={image} alt="数字人预览" style={{ filter: imageFilter }} /> : <button type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={30} /><strong>上传一张图片开始创建</strong><span>人物会在这里以原始比例预览</span></button>}
            {image && <span className="creatorAiBadge"><Sparkles size={12} />图片数字人</span>}
          </div>
          <div className="creatorStageActions">
            <button type="button" onClick={() => setImageFilter('none')} disabled={!image || imageFilter === 'none'}><RotateCcw size={16} />恢复原图</button>
            <span>{voice}</span>
          </div>
        </main>
        </>}
      </div>
    </div>
  );
}
