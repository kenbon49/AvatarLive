'use client';

import {
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Check,
  CircleAlert,
  Clock3,
  Layers3,
  RefreshCw,
  Shirt,
  Sparkles,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import { AvatarLandmarkPanel, type AvatarLandmarkMode } from '@/components/avatar-landmark-panel';
import styles from './avatar-capability-panel.module.css';

export type AvatarCapabilityMode = AvatarLandmarkMode | 'style';

export type AvatarStyleSelection = {
  outfit: string;
  hair: string;
  accessory: string;
};

export const DEFAULT_AVATAR_STYLE_SELECTION: AvatarStyleSelection = {
  outfit: 'graphite',
  hair: 'natural',
  accessory: 'brooch',
};

type AvatarCapabilityPanelProps = {
  mode: AvatarCapabilityMode;
  avatarImage: string;
  avatarName: string;
  avatarVideo: string;
  styleSelection: AvatarStyleSelection;
  onStyleSelectionChange: Dispatch<SetStateAction<AvatarStyleSelection>>;
};

const STYLE_OPTIONS = {
  outfit: [
    { id: 'graphite', label: '商务石墨', detail: '正装', color: '#47505f' },
    { id: 'navy', label: '品牌深蓝', detail: '商务', color: '#355792' },
    { id: 'ivory', label: '简约象牙', detail: '轻商务', color: '#d7d0c2' },
    { id: 'wine', label: '庆典酒红', detail: '活动', color: '#913c4b' },
  ],
  hair: [
    { id: 'natural', label: '自然长发', detail: '发型 01', color: '#332b29' },
    { id: 'short', label: '利落短发', detail: '发型 02', color: '#242526' },
    { id: 'wave', label: '柔和卷发', detail: '发型 03', color: '#573e36' },
  ],
  accessory: [
    { id: 'brooch', label: '品牌胸针', detail: '配饰 01', color: '#d1a749' },
    { id: 'pearl', label: '珍珠耳饰', detail: '配饰 02', color: '#ede8dc' },
    { id: 'none', label: '无配饰', detail: '基础', color: '#d7dce5' },
  ],
};

export function AvatarCapabilityPanel({
  mode,
  avatarImage,
  avatarName,
  avatarVideo,
  styleSelection,
  onStyleSelectionChange,
}: AvatarCapabilityPanelProps) {
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | null>(null);
  const actionTimer = useRef<number | null>(null);
  const [styleTab, setStyleTab] = useState<keyof typeof STYLE_OPTIONS>('outfit');
  const [preloaded, setPreloaded] = useState(['graphite', 'navy', 'ivory', 'natural', 'short', 'wave', 'brooch', 'pearl', 'none']);
  const [preloading, setPreloading] = useState('');

  const notify = (message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2400);
  };

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    if (actionTimer.current !== null) window.clearTimeout(actionTimer.current);
  }, []);

  if (mode === 'expression' || mode === 'motion') {
    return <AvatarLandmarkPanel avatarImage={avatarImage} avatarName={avatarName} avatarVideo={avatarVideo} mode={mode} />;
  }

  const activeOutfit = STYLE_OPTIONS.outfit.find((item) => item.id === styleSelection.outfit) ?? STYLE_OPTIONS.outfit[0];
  const activeStyleOptions = STYLE_OPTIONS[styleTab];
  const displayName = avatarName.trim() || '未命名形象';

  const chooseStyle = (item: { id: string; label: string }) => {
    const category = styleTab;
    const apply = () => {
      onStyleSelectionChange((current) => ({ ...current, [category]: item.id }));
      setPreloading('');
      notify(`${item.label}已应用到${displayName}（演示配置）`);
    };
    if (preloaded.includes(item.id)) {
      apply();
      return;
    }
    setPreloading(item.id);
    actionTimer.current = window.setTimeout(() => {
      setPreloaded((current) => [...current, item.id]);
      apply();
    }, 650);
  };

  return (
    <section className={styles.panel} data-mode="style">
      <header className={styles.header}>
        <div className={styles.headerIcon}><Shirt size={20} /></div>
        <div><strong>造型配置</strong><span>组合服装、发型与配饰资产</span></div>
        <em><CircleAlert size={13} />未接真实资产均标注为演示配置</em>
      </header>

      <div className={styles.styleLayout}>
        <section className={styles.stylePreview}>
          <div className={styles.previewToolbar}><span><UserRound size={14} />{displayName} · 造型组合预览</span><em><i />演示配置</em></div>
          <div className={styles.styleViewport}>
            <div className={styles.styleBackdrop}><i /><i /><i /></div>
            {avatarImage
              ? <img src={avatarImage} alt={`${displayName}造型组合预览`} />
              : <span className={styles.modelCallout} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}><i />请先上传形象</span>}
            {avatarImage && <span className={styles.outfitTint} style={{ background: activeOutfit.color }} />}
            <div className={styles.styleLabels}>
              <span><i style={{ background: activeOutfit.color }} />{activeOutfit.label}</span>
              <span>{STYLE_OPTIONS.hair.find((item) => item.id === styleSelection.hair)?.label}</span>
              <span>{STYLE_OPTIONS.accessory.find((item) => item.id === styleSelection.accessory)?.label}</span>
            </div>
          </div>
          <footer><span><Layers3 size={13} />三类造型资产</span><span><Clock3 size={13} />加载目标 &lt;= 3 秒</span><span><Sparkles size={13} />组合效果演示</span></footer>
        </section>

        <aside className={styles.styleInspector}>
          <nav className={styles.styleTabs}>{([['outfit', '服装', Shirt], ['hair', '发型', UserRound], ['accessory', '配饰', Sparkles]] as const).map(([id, label, Icon]) => <button className={styleTab === id ? styles.active : ''} type="button" key={id} onClick={() => setStyleTab(id)}><Icon size={15} />{label}</button>)}</nav>
          <div className={styles.styleGrid}>{activeStyleOptions.map((item) => {
            const selected = styleSelection[styleTab] === item.id;
            const ready = preloaded.includes(item.id);
            return <button className={selected ? styles.selected : ''} type="button" key={item.id} disabled={preloading === item.id} onClick={() => chooseStyle(item)}><i style={{ background: item.color }}><span /></i><span><strong>{item.label}</strong><small>{preloading === item.id ? '正在预加载...' : ready ? `${item.detail} · 已预载` : `${item.detail} · 待预载`}</small></span>{selected && <Check size={14} />}</button>;
          })}</div>
          <section className={styles.preloadCard}>
            <header><span>资源预加载</span><em>演示配置</em></header>
            <div><i /><i /><i /><i className={styles.pendingBar} /></div>
            <p><span>{preloaded.length} 个资源已就绪</span><strong>1.8 s<small>演示切换耗时</small></strong></p>
          </section>
          <div className={styles.boundaryNote}><CircleAlert size={14} /><span>正式服装模型与同人物多套资产需在交付阶段接入；当前为组合流程和视觉效果演示。</span></div>
          <div className={styles.actionRow}>
            <button type="button" onClick={() => notify('造型资源列表已刷新')}><RefreshCw size={14} />刷新资源</button>
            <button className={styles.primary} type="button" onClick={() => notify(`${displayName}的造型已同步到保存配置`)}><WandSparkles size={14} />保存造型</button>
          </div>
        </aside>
      </div>

      {notice && <div className={styles.toast} role="status"><Check size={15} />{notice}</div>}
    </section>
  );
}
