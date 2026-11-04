'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, History, LoaderCircle, Plus, Radio, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { ProductShell } from '@/components/product-shell';
import { StoryboardScenePreview } from '@/components/storyboard-scene-preview';
import { deleteLiveRoom, getLiveRoomScene, listLiveRoomSummaries, LiveRoomApiError, type LiveRoomScene, type LiveRoomSummary } from '@/lib/live-room-api';
import { ALIYUN_PUBLIC_AVATARS } from '@/lib/live-avatar-catalog';
import yijingFontCatalog from '@/data/yijing-font-catalog.json';
import yijingTemplateCatalog from '@/data/yijing-template-catalog.json';
import { resolveYijingFontFamily } from '@/lib/yijing-fonts';
import { applyTemplateLayersPreservingHost, repairLegacyTemplateBackground } from '@/lib/live-template-layers';
import './live-room-list.css';

type RoomSort = 'created' | 'updated';

const BATCH_SIZE = 100;
const PAGE_SIZE = 12;
const AVATAR_IMAGES = new Map(ALIYUN_PUBLIC_AVATARS.map((avatar) => [avatar.id, avatar.image]));
const DEFAULT_AVATAR_IMAGE = AVATAR_IMAGES.get('aliyun-M1xuUWr440XEDhA6QPRvRiDQ') || ALIYUN_PUBLIC_AVATARS[0]?.image;
const COVER_FONTS: Record<string, string> = {
  '默认字体': "'Noto Sans SC', sans-serif",
  '思源黑体': "'SiYuanHeiTi', 'Noto Sans SC', sans-serif",
  '思源宋体': "'SiYuanSongTi', 'Noto Serif SC', serif",
  '站酷快乐体': "'Noto Sans SC', sans-serif",
  ...Object.fromEntries(yijingFontCatalog.map((font) => [font.value,
    `'${resolveYijingFontFamily(font.value, yijingFontCatalog)}', 'Noto Sans SC', sans-serif`])),
};
const LEGACY_TEMPLATE_IDS = new Set(['home', 'sale', 'spring', 'food', 'study', 'snack', 'fruit', 'fashion']);

async function restoreRoomScene(scene: LiveRoomScene): Promise<LiveRoomScene> {
  const templateId = LEGACY_TEMPLATE_IDS.has(scene.selectedTemplateId) ? yijingTemplateCatalog[0]?.id : scene.selectedTemplateId;
  const template = yijingTemplateCatalog.find((item) => item.id === templateId);
  const background = scene.layers.find((layer) => layer.sceneKey === 'templateBackground');
  const upgrade = Boolean(template && (LEGACY_TEMPLATE_IDS.has(scene.selectedTemplateId)
    || !scene.layers.some((layer) => layer.sceneKey === 'templateElement')));
  const repair = Boolean(template && background?.preview
    && ['/assets/xiling-live/yijing/blank.png', template.image].includes(background.preview));
  if (!template || (!upgrade && !repair)) return scene;
  try {
    const response = await fetch(template.layersUrl);
    if (!response.ok) return scene;
    const document = await response.json() as { pages?: Array<{ layers?: LiveRoomScene['layers'] }> };
    const pages = document.pages;
    if (!pages?.length) return scene;
    const page = pages[Math.min(scene.selectedTemplatePage ?? 0, pages.length - 1)];
    if (!page.layers?.length) return scene;
    return {
      ...scene,
      layers: upgrade
        ? applyTemplateLayersPreservingHost(page.layers, scene.layers)
        : repairLegacyTemplateBackground(page.layers, scene.layers, ['/assets/xiling-live/yijing/blank.png', template.image]),
    };
  } catch {
    return scene;
  }
}

function formatRoomDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function formatPlaybackSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

function LiveRoomCover({ room }: { room: LiveRoomSummary }) {
  const avatarImage = AVATAR_IMAGES.get(room.avatarId || '') || null;
  const [source, setSource] = useState(room.coverUrl || avatarImage);
  const [scene, setScene] = useState<LiveRoomScene | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSource(room.coverUrl || avatarImage), [room.coverUrl, avatarImage]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    setScene(null);
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      void getLiveRoomScene(room.id).then(restoreRoomScene).then((result) => {
        if (!cancelled) setScene(result);
      }).catch(() => undefined);
    }, { rootMargin: '300px' });
    observer.observe(root);
    return () => { cancelled = true; observer.disconnect(); };
  }, [room.id, room.version]);

  const sceneHost = scene && (AVATAR_IMAGES.get(scene.avatarId) || DEFAULT_AVATAR_IMAGE);
  const sceneBackground = scene?.layers.find((layer) => layer.sceneKey === 'templateBackground')?.preview;
  const background = sceneBackground && !sceneBackground.endsWith('/blank.png')
    ? sceneBackground : room.coverUrl || '/assets/xiling-live/yijing/blank.png';
  const sceneLayers = scene?.layers.map((layer) => layer.sceneKey === 'templateBackground'
    && layer.preview?.endsWith('/blank.png') && room.coverUrl
    ? { ...layer, preview: room.coverUrl } : layer) || [];

  return <div className="liveRoomListCover" ref={rootRef}>{scene && sceneHost && sceneLayers.length
    ? <StoryboardScenePreview roomCover layers={sceneLayers} background={background} host={sceneHost} fonts={COVER_FONTS} />
    : source
    ? <img className="liveRoomListFallbackImage" src={source} alt={`${room.name}封面`} loading="lazy" decoding="async" onError={() => setSource(source === avatarImage ? null : avatarImage)} />
    : <div className="liveRoomListCoverEmpty"><Radio size={28} /><span>暂无封面</span></div>}
  </div>;
}

export default function LiveRoomListPage() {
  const [rooms, setRooms] = useState<LiveRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RoomSort>('created');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<LiveRoomSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!deleteTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!deleting) cancelDeleteRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) {
        setDeleteTarget(null);
        window.requestAnimationFrame(() => deleteOpenerRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteTarget, deleting]);

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    window.requestAnimationFrame(() => deleteOpenerRef.current?.focus());
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteLiveRoom(deleteTarget.id);
      setRooms((items) => items.filter((room) => room.id !== deleteTarget.id));
      setDeleteTarget(null);
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadRooms() {
      setLoading(true);
      setError('');
      setUnauthorized(false);
      try {
        const allRooms: LiveRoomSummary[] = [];
        let batch: LiveRoomSummary[];
        do {
          batch = await listLiveRoomSummaries(BATCH_SIZE, allRooms.length);
          allRooms.push(...batch);
        } while (batch.length === BATCH_SIZE);
        if (!cancelled) setRooms(allRooms);
      } catch (cause) {
        if (!cancelled) {
          setRooms([]);
          setUnauthorized(cause instanceof LiveRoomApiError && cause.status === 401);
          setError(cause instanceof Error ? cause.message : '直播间列表读取失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRooms();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const visibleRooms = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return rooms.filter((room) => !term || room.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => new Date(sort === 'created' ? b.createdAt : b.updatedAt).getTime()
        - new Date(sort === 'created' ? a.createdAt : a.updatedAt).getTime()
        || b.id.localeCompare(a.id));
  }, [rooms, query, sort]);
  const pageCount = Math.max(1, Math.ceil(visibleRooms.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRooms = visibleRooms.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <ProductShell>
      <main className="liveRoomListPage">
        <div className="liveRoomListInner">
          <Link className="liveRoomListBack" href="/live"><ArrowLeft size={16} />返回直播首页</Link>
          <header className="liveRoomListTitlebar">
            <div>
              <h1 ref={headingRef} tabIndex={-1}>数字人直播列表</h1>
              <p>共 {rooms.length} 个直播间</p>
            </div>
            <Link className="liveRoomListCreate" href="/live?create=1"><Plus size={16} />新建直播间</Link>
          </header>

          <div className="liveRoomListToolbar">
            <div className="liveRoomListTools">
              <label className="liveRoomListSearch"><Search size={16} /><input
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder="搜索直播间名称"
                aria-label="搜索直播间名称"
              /></label>
              <select aria-label="直播间排序" value={sort} onChange={(event) => { setSort(event.target.value as RoomSort); setPage(1); }}>
                <option value="created">最新创建</option>
                <option value="updated">最近更新</option>
              </select>
              <button className="liveRoomListRefresh" type="button" aria-label="刷新直播间列表" title="刷新直播间列表" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /></button>
            </div>
          </div>

          {loading ? <div className="liveRoomListState" role="status"><LoaderCircle className="liveRoomListSpinner" size={22} />正在读取直播间…</div>
            : error ? <div className="liveRoomListState" role="alert"><History size={24} /><strong>无法读取直播间列表</strong><span>{error}</span>{unauthorized
              ? <Link href="/login">登录后查看<ArrowRight size={15} /></Link>
              : <button type="button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={15} />重新加载</button>}</div>
              : !pageRooms.length ? <div className="liveRoomListState"><Radio size={26} /><strong>{rooms.length ? '没有匹配的直播间' : '还没有创建直播间'}</strong>{rooms.length
                ? <button type="button" onClick={() => { setQuery(''); setPage(1); }}>清除搜索</button>
                : <Link href="/live?create=1"><Plus size={15} />新建直播间</Link>}</div>
                : <>
                  <div className="liveRoomListCards">
                    {pageRooms.map((room) => <article className="liveRoomListCard" key={room.id}>
                      <Link className="liveRoomListCoverLink" href={`/live?studio=1&room=${encodeURIComponent(room.id)}`} aria-label={`进入“${room.name}”控制台`}><LiveRoomCover room={room} /></Link>
                      <div className="liveRoomListCardBody">
                        <div className="liveRoomListCardHeader"><h2><Link href={`/live?studio=1&room=${encodeURIComponent(room.id)}`}>{room.name}</Link></h2><button type="button" className="liveRoomListDelete" title={`删除“${room.name}”`} aria-label={`删除“${room.name}”`} onClick={(event) => { deleteOpenerRef.current = event.currentTarget; setDeleteError(''); setDeleteTarget(room); }}><Trash2 size={16} /></button></div>
                        <small className="liveRoomListCardDate">创建于 {formatRoomDate(room.createdAt)}</small>
                        <div className="liveRoomListScript"><span>{room.scriptCount ? `${room.scriptCount} 段话术` : '直播话术'}{room.scriptTitle ? ` · ${room.scriptTitle}` : ''}</span><p>{room.scriptPreview || '暂无直播话术'}</p></div>
                        <div className="liveRoomListCardBottom"><span className="liveRoomListDuration"><Clock3 size={15} /><span>累计时长</span><strong>{formatPlaybackSeconds(room.totalPlaybackSeconds ?? 0)}</strong></span><Link className="liveRoomListOpen" href={`/live?studio=1&room=${encodeURIComponent(room.id)}`}>进入控制台<ArrowRight size={15} /></Link></div>
                      </div>
                    </article>)}
                  </div>
                  <footer className="liveRoomListFooter"><span>共 {visibleRooms.length} 个直播间</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div></footer>
                </>}
        </div>
      </main>
      {deleteTarget && <div className="liveRoomListDialogBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteDialog(); }}>
        <section className="liveRoomListDialog" role="alertdialog" aria-modal="true" aria-labelledby="live-room-delete-title" aria-describedby="live-room-delete-description">
          <header><h2 id="live-room-delete-title">删除直播间</h2><button type="button" aria-label="关闭删除确认" title="关闭" disabled={deleting} onClick={closeDeleteDialog}><X size={18} /></button></header>
          <p id="live-room-delete-description">确定删除“{deleteTarget.name}”吗？直播间配置和窗口采集记录将无法恢复。</p>
          {deleteError && <p className="liveRoomListDeleteError" role="alert">{deleteError}</p>}
          <footer><button ref={cancelDeleteRef} type="button" disabled={deleting} onClick={closeDeleteDialog}>取消</button><button className="danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <LoaderCircle className="liveRoomListSpinner" size={15} /> : <Trash2 size={15} />}{deleting ? '删除中' : '删除直播间'}</button></footer>
        </section>
      </div>}
    </ProductShell>
  );
}
