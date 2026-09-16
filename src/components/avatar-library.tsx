'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, ImageIcon, Play, Search, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { ProductShell } from '@/components/product-shell';
import {
  ALIYUN_PUBLIC_AVATARS,
  type LiveAvatarCatalogItem,
} from '@/lib/live-avatar-catalog';

type GenderFilter = '全部' | LiveAvatarCatalogItem['gender'];
type TypeFilter = '全部类型' | '2D' | '3D / UE';
type SceneFilter = '全部场景' | '播报' | '对话' | '直播';

const OFFICIAL_GUIDE_URL = 'https://help.aliyun.com/zh/avatar/avatar-application/user-guide/avatar-video-operation-guide';

function matchesAvatar(
  avatar: LiveAvatarCatalogItem,
  query: string,
  gender: GenderFilter,
  type: TypeFilter,
  scene: SceneFilter,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const matchesQuery = !normalizedQuery
    || `${avatar.name}${avatar.role}${avatar.providerName}${avatar.capability}${avatar.officialId ?? ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedQuery);
  const matchesGender = gender === '全部' || avatar.gender === gender;
  const isThreeDimensional = avatar.sourceType === 'AVATAR_3D_TRADITIONAL'
    || avatar.sourceType === 'AVATAR_UE_APPEARANCE';
  const matchesType = type === '全部类型'
    || (type === '2D' && !isThreeDimensional)
    || (type === '3D / UE' && isThreeDimensional);
  const matchesScene = scene === '全部场景'
    || (scene === '播报' && (avatar.businessType === 'BROADCAST' || avatar.businessType === 'BROADCAST_CHAT'))
    || (scene === '对话' && (avatar.businessType === 'CHAT' || avatar.businessType === 'BROADCAST_CHAT'))
    || (scene === '直播' && avatar.businessType === 'LIVE');
  return matchesQuery && matchesGender && matchesType && matchesScene;
}

function AvatarPreviewDialog({
  avatar,
  onClose,
}: {
  avatar: LiveAvatarCatalogItem;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="avatarPreviewBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="avatarPreviewDialog" role="dialog" aria-modal="true" aria-labelledby="avatar-preview-title">
        <header>
          <div>
            <span>{avatar.providerName} · {avatar.capability}</span>
            <h2 id="avatar-preview-title">{avatar.name}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭预览"><X size={20} /></button>
        </header>

        <div className={`avatarPreviewStage${avatar.previewVideo ? ' hasVideo' : ''}`}>
          {avatar.previewVideo ? (
            <video src={avatar.previewVideo} poster={avatar.image} controls autoPlay playsInline preload="metadata" />
          ) : (
            <div className="avatarPreviewUnavailable">
              <img src={avatar.image} alt={`${avatar.name}完整封面`} />
              <span><ImageIcon size={18} />该官方形象暂未提供预览视频</span>
            </div>
          )}
        </div>

        <footer>
          <div><strong>{avatar.role}</strong><span>{[avatar.gender, avatar.capability, avatar.aspectRatio].filter(Boolean).join(' · ')}</span></div>
          <a href={OFFICIAL_GUIDE_URL} target="_blank" rel="noreferrer">查看官方来源<ExternalLink size={14} /></a>
        </footer>
      </section>
    </div>
  );
}

export function AvatarLibrary() {
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('全部');
  const [type, setType] = useState<TypeFilter>('全部类型');
  const [scene, setScene] = useState<SceneFilter>('全部场景');
  const [selectedAvatar, setSelectedAvatar] = useState<LiveAvatarCatalogItem | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const visibleAvatars = useMemo(
    () => ALIYUN_PUBLIC_AVATARS.filter((avatar) => matchesAvatar(avatar, query, gender, type, scene)),
    [gender, query, scene, type],
  );

  const closePreview = () => {
    setSelectedAvatar(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <ProductShell>
      <main className="avatarLibraryPage">
        <header className="avatarLibraryHeader">
          <div>
            <span className="avatarLibraryEyebrow">官方数字人 · 精选形象</span>
            <h1>数字人形象库</h1>
            <p>覆盖播报、对话、直播，以及 2D、3D 与 UE 形象。</p>
          </div>
          <dl className="avatarLibraryStats">
            <div><dt>官方形象</dt><dd>{ALIYUN_PUBLIC_AVATARS.length}</dd></div>
            <div><dt>带预览</dt><dd>{ALIYUN_PUBLIC_AVATARS.filter((avatar) => avatar.previewVideo).length}</dd></div>
          </dl>
        </header>

        <section className="avatarLibraryToolbar" aria-label="形象筛选">
          <label className="avatarLibrarySearch">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索形象名称或特征" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={15} /></button>}
          </label>
          <div className="avatarLibraryFilters">
            <span><SlidersHorizontal size={15} />性别</span>
            {(['全部', '女', '男'] as const).map((item) => (
              <button className={gender === item ? 'active' : ''} type="button" aria-pressed={gender === item} onClick={() => setGender(item)} key={item}>{item}</button>
            ))}
          </div>
          <label className="avatarLibrarySelect">
            <select aria-label="形象类型" value={type} onChange={(event) => setType(event.target.value as TypeFilter)}>
              <option>全部类型</option>
              <option>2D</option>
              <option>3D / UE</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="avatarLibrarySelect">
            <select aria-label="使用场景" value={scene} onChange={(event) => setScene(event.target.value as SceneFilter)}>
              <option>全部场景</option>
              <option>播报</option>
              <option>对话</option>
              <option>直播</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <span className="avatarLibraryResultCount">{visibleAvatars.length} 个结果</span>
        </section>

        {visibleAvatars.length ? (
          <section className="avatarLibraryGrid" aria-label="公共数字人形象">
            {visibleAvatars.map((avatar) => (
              <button
                className="avatarLibraryCard"
                type="button"
                key={avatar.id}
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setSelectedAvatar(avatar);
                }}
              >
                <span className="avatarLibraryCover">
                  <img src={avatar.image} alt={`${avatar.name}数字人封面`} loading="lazy" decoding="async" />
                  <span className="avatarLibraryPreviewIcon">
                    {avatar.previewVideo ? <Play size={17} fill="currentColor" /> : <ImageIcon size={17} />}
                  </span>
                </span>
                <span className="avatarLibraryCardInfo">
                  <span><strong>{avatar.name}</strong><small>{avatar.role}</small></span>
                  <UserRound size={16} />
                </span>
              </button>
            ))}
          </section>
        ) : (
          <div className="avatarLibraryEmpty"><Search size={25} /><strong>没有找到匹配形象</strong><span>调整搜索词或筛选条件</span></div>
        )}
      </main>

      {selectedAvatar && <AvatarPreviewDialog avatar={selectedAvatar} onClose={closePreview} />}
    </ProductShell>
  );
}
