'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Sparkles } from 'lucide-react';
import { ProductShell } from '@/components/product-shell';

type StoredAvatar = {
  id: string;
  name: string;
  role: string;
  profile: 'chinese';
  image: string;
  custom: true;
};

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

export function AvatarDesignStudio() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('专属数字人');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择 JPG、PNG 或 WebP 图片。');
      return;
    }
    try {
      setError('');
      setImage(await resizeImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片处理失败');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !image) return;
    setSaving(true);
    const avatar: StoredAvatar = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      role: role.trim() || '专属数字人',
      profile: 'chinese',
      image,
      custom: true,
    };
    try {
      const existing = JSON.parse(localStorage.getItem('lingjing-custom-avatars') || '[]') as StoredAvatar[];
      localStorage.setItem('lingjing-custom-avatars', JSON.stringify([...(Array.isArray(existing) ? existing : []), avatar]));
      router.push('/');
    } catch {
      setSaving(false);
      setError('浏览器存储空间不足，请使用尺寸更小的照片。');
    }
  };

  return (
    <ProductShell>
      <main className="designPage">
        <button className="backButton designBack" type="button" onClick={() => router.push('/')}><ArrowLeft size={18} />返回形象列表</button>
        <header className="designHeader">
          <span className="eyebrow">AVATAR DESIGN STUDIO</span>
          <h1>设计你的数字人</h1>
          <p>一张清晰的正面照片，即可建立专属互动形象。</p>
        </header>
        <form className="designWorkspace" onSubmit={submit}>
          <section className="designPreview">
            <button type="button" className={`designUpload ${image ? 'hasImage' : ''}`} onClick={() => fileRef.current?.click()}>
              {image ? <img src={image} alt="数字人形象预览" /> : <><span><ImagePlus size={34} /></span><strong>上传正面照片</strong><small>支持 JPG、PNG、WebP，建议人物居中且光线均匀</small></>}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void loadImage(event.target.files?.[0])} />
            <div className="photoTips"><strong>照片要求</strong><span><Check size={14} />正脸面向镜头</span><span><Check size={14} />面部无遮挡</span><span><Check size={14} />背景简洁清晰</span></div>
          </section>
          <section className="designSettings">
            <div className="settingHeading"><span>形象信息</span><small>创建后可立即在实时互动中选择</small></div>
            <label><span>数字人名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：小岚" maxLength={16} /></label>
            <label><span>角色定位</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="例如：品牌讲解员" maxLength={24} /></label>
            <label><span>默认声音</span><select defaultValue="warm"><option value="warm">温暖自然 · 中文女声</option><option value="clear">清晰专业 · 中文女声</option><option value="male">沉稳可信 · 中文男声</option></select></label>
            <div className="designEngine"><Sparkles size={18} /><span><strong>MuseTalk 实时驱动</strong><small>新形象默认使用中文音视频生成配置</small></span></div>
            {error && <div className="inlineError designError">{error}</div>}
            <button className="primaryButton" disabled={!name.trim() || !image || saving} type="submit">{saving ? '正在创建…' : '完成创建'} <ArrowRight size={17} /></button>
          </section>
        </form>
      </main>
    </ProductShell>
  );
}
