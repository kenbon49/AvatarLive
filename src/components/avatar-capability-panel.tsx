'use client';

import {
  CSSProperties,
  Dispatch,
  SetStateAction,
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  Box,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleGauge,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileUp,
  Gauge,
  Grid3X3,
  Layers3,
  Move3d,
  Pause,
  Play,
  RefreshCw,
  Rotate3d,
  Scan,
  ShieldCheck,
  Shirt,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import styles from './avatar-capability-panel.module.css';

export type AvatarCapabilityMode = 'model' | 'drive' | 'style';
export type AvatarDriveTab = 'expression' | 'motion';

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
  driveTab: AvatarDriveTab;
  onDriveTabChange: (tab: AvatarDriveTab) => void;
  styleSelection: AvatarStyleSelection;
  onStyleSelectionChange: Dispatch<SetStateAction<AvatarStyleSelection>>;
};

const MODEL_METRICS = [
  { label: '面部三角面', target: '>= 200 万面', value: '236 万面' },
  { label: '身体三角面', target: '>= 800 万面', value: '864 万面' },
  { label: '材质贴图', target: 'PBR / 8K', value: '12 组材质' },
];

const EXPRESSIONS = [
  { id: 'eye', label: '眼球转动', group: '眼部', channels: '8 通道' },
  { id: 'blink', label: '自然眨眼', group: '眼部', channels: '2 通道' },
  { id: 'brow', label: '眉毛挑动', group: '眉部', channels: '5 通道' },
  { id: 'smile', label: '自然微笑', group: '嘴部', channels: '4 通道' },
  { id: 'mouth', label: '嘴唇微张', group: '嘴部', channels: '6 通道' },
  { id: 'cheek', label: '面颊收紧', group: '面部', channels: '2 通道' },
];

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

type LandmarkPoint = { x: number; y: number };
type MediaFit = 'contain' | 'cover';

const DEFAULT_FACE_POINTS: LandmarkPoint[] = [
  { x: 48.8, y: 20.7 }, { x: 52.4, y: 20.3 }, { x: 57.2, y: 20.2 }, { x: 61.1, y: 20.7 },
  { x: 49.4, y: 22.2 }, { x: 53.0, y: 22.0 }, { x: 56.7, y: 21.9 }, { x: 60.5, y: 22.0 },
  { x: 55.0, y: 23.0 }, { x: 55.0, y: 24.7 }, { x: 51.8, y: 26.3 }, { x: 55.1, y: 26.9 },
  { x: 58.8, y: 26.2 }, { x: 49.7, y: 25.0 }, { x: 55.0, y: 29.0 }, { x: 61.2, y: 24.9 },
];

const FACE_EDGES: Array<[number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [11, 12], [13, 14], [14, 15],
];

const FACE_POINT_GROUPS: Record<string, number[]> = {
  eye: [4, 5, 6, 7],
  blink: [4, 5, 6, 7],
  brow: [0, 1, 2, 3],
  smile: [10, 11, 12],
  mouth: [9, 10, 11, 12],
  cheek: [13, 15],
};

// The default demo portrait is seated with one arm extended, so the calibration
// template follows that pose instead of pretending it is a standing T-pose.
const DEFAULT_POSE_POINTS: LandmarkPoint[] = [
  { x: 55.0, y: 23.2 }, { x: 56.0, y: 31.0 },
  { x: 43.5, y: 34.0 }, { x: 33.0, y: 48.6 }, { x: 16.8, y: 41.5 },
  { x: 69.5, y: 33.5 }, { x: 76.0, y: 47.5 }, { x: 64.0, y: 67.2 },
  { x: 56.5, y: 59.7 },
  { x: 47.0, y: 60.0 }, { x: 42.0, y: 75.5 }, { x: 31.0, y: 95.5 },
  { x: 65.0, y: 59.7 }, { x: 58.5, y: 74.0 }, { x: 52.5, y: 95.0 },
];

const POSE_EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8],
  [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14], [2, 5], [9, 12],
];

function useRegisteredMedia(src: string, fit: MediaFit, positionY = .5) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);
  const [mediaBox, setMediaBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const natural = naturalSize.current;
    if (!viewport || !natural || !natural.width || !natural.height) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    const scale = fit === 'cover'
      ? Math.max(width / natural.width, height / natural.height)
      : Math.min(width / natural.width, height / natural.height);
    const renderedWidth = natural.width * scale;
    const renderedHeight = natural.height * scale;
    const next = {
      left: (width - renderedWidth) * .5,
      top: (height - renderedHeight) * positionY,
      width: renderedWidth,
      height: renderedHeight,
    };
    setMediaBox((current) => current
      && Math.abs(current.left - next.left) < .5
      && Math.abs(current.top - next.top) < .5
      && Math.abs(current.width - next.width) < .5
      && Math.abs(current.height - next.height) < .5
      ? current
      : next);
  }, [fit, positionY]);

  useEffect(() => {
    setMediaBox(null);
    naturalSize.current = null;
  }, [src]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const registerImage = useCallback((image: HTMLImageElement) => {
    naturalSize.current = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    measure();
  }, [measure]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const register = () => registerImage(image);
    image.addEventListener('load', register);
    if (image.complete && image.naturalWidth) register();
    return () => image.removeEventListener('load', register);
  }, [registerImage, src]);

  const onImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    registerImage(event.currentTarget);
  }, [registerImage]);

  const mediaStyle: CSSProperties = mediaBox
    ? { left: mediaBox.left, top: mediaBox.top, width: mediaBox.width, height: mediaBox.height, opacity: 1 }
    : { left: 0, top: 0, width: '100%', height: '100%', opacity: 0 };

  return { imageRef, viewportRef, mediaStyle, onImageLoad };
}

function LandmarkOverlay({
  points,
  edges,
  active,
  activeIndices,
  label,
  onChange,
  variant,
}: {
  points: LandmarkPoint[];
  edges: Array<[number, number]>;
  active: boolean;
  activeIndices?: number[];
  label: string;
  onChange: (points: LandmarkPoint[]) => void;
  variant: 'face' | 'pose';
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const draggingPoint = useRef<number | null>(null);

  const movePoint = useCallback((index: number, clientX: number, clientY: number) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    onChange(points.map((point, pointIndex) => pointIndex === index ? { x, y } : point));
  }, [onChange, points]);

  useEffect(() => {
    const move = (event: MouseEvent | PointerEvent) => {
      if (draggingPoint.current !== null) movePoint(draggingPoint.current, event.clientX, event.clientY);
    };
    const stop = () => { draggingPoint.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('mousemove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('mouseup', stop);
    };
  }, [movePoint]);

  return (
    <div className={`${styles.landmarkOverlay} ${variant === 'face' ? styles.faceLandmarks : styles.poseLandmarks} ${active ? styles.landmarksActive : ''}`} ref={overlayRef}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {edges.map(([from, to]) => <line key={`${from}-${to}`} x1={points[from].x} y1={points[from].y} x2={points[to].x} y2={points[to].y} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {points.map((point, index) => (
        <button
          aria-label={`${label} ${index + 1}，可拖拽校准`}
          className={activeIndices?.includes(index) ? styles.landmarkSelected : ''}
          key={`${variant}-${index}`}
          onPointerDown={(event) => {
            event.preventDefault();
            draggingPoint.current = index;
            movePoint(index, event.clientX, event.clientY);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            draggingPoint.current = index;
            movePoint(index, event.clientX, event.clientY);
          }}
          onDragStart={(event) => event.preventDefault()}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          type="button"
        />
      ))}
    </div>
  );
}

export function AvatarCapabilityPanel({
  mode,
  avatarImage,
  avatarName,
  driveTab,
  onDriveTabChange,
  styleSelection,
  onStyleSelectionChange,
}: AvatarCapabilityPanelProps) {
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | null>(null);
  const actionTimer = useRef<number | null>(null);

  const [modelView, setModelView] = useState<'front' | 'side' | 'wire'>('front');
  const [reportName, setReportName] = useState('');
  const [inspection, setInspection] = useState<'idle' | 'checking' | 'done'>('idle');
  const reportInput = useRef<HTMLInputElement>(null);

  const [expressionId, setExpressionId] = useState('brow');
  const [intensity, setIntensity] = useState(64);
  const [expressionPlaying, setExpressionPlaying] = useState(false);
  const [tracking, setTracking] = useState(true);
  const [calibration, setCalibration] = useState<'ready' | 'checking'>('ready');
  const [facePoints, setFacePoints] = useState<LandmarkPoint[]>(DEFAULT_FACE_POINTS.map((point) => ({ ...point })));
  const [posePoints, setPosePoints] = useState<LandmarkPoint[]>(DEFAULT_POSE_POINTS.map((point) => ({ ...point })));
  const faceMedia = useRegisteredMedia(avatarImage, 'cover', .28);
  const motionMedia = useRegisteredMedia(avatarImage, 'contain');

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

  useEffect(() => {
    setFacePoints(DEFAULT_FACE_POINTS.map((point) => ({ ...point })));
    setPosePoints(DEFAULT_POSE_POINTS.map((point) => ({ ...point })));
  }, [avatarImage]);

  const activeExpression = EXPRESSIONS.find((item) => item.id === expressionId) ?? EXPRESSIONS[0];
  const activeOutfit = STYLE_OPTIONS.outfit.find((item) => item.id === styleSelection.outfit) ?? STYLE_OPTIONS.outfit[0];
  const activeStyleOptions = STYLE_OPTIONS[styleTab];
  const displayName = avatarName.trim() || '未命名形象';
  const title = useMemo(() => ({
    model: ['模型验收', '检查模型结构、验收目标与检测材料'],
    drive: ['驱动配置', '调试 ARKit 表情映射与动作捕捉流程'],
    style: ['造型配置', '组合服装、发型与配饰资产'],
  }[mode]), [mode]);

  const runInspection = () => {
    setInspection('checking');
    actionTimer.current = window.setTimeout(() => {
      setInspection('done');
      notify('模型检查演示完成，检测结果仍待第三方验收');
    }, 700);
  };

  const playExpression = () => {
    setExpressionPlaying(true);
    notify(`正在预览“${activeExpression.label}”，强度 ${intensity}%`);
    actionTimer.current = window.setTimeout(() => setExpressionPlaying(false), 1100);
  };

  const calibrate = () => {
    setCalibration('checking');
    actionTimer.current = window.setTimeout(() => {
      setPosePoints(DEFAULT_POSE_POINTS.map((point) => ({ ...point })));
      setCalibration('ready');
      notify('当前人物坐姿点位已重置，可继续拖拽微调');
    }, 750);
  };

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
    <section className={styles.panel} data-mode={mode}>
      <header className={styles.header}>
        <div className={styles.headerIcon}>{mode === 'model' ? <Box size={20} /> : mode === 'drive' ? <Move3d size={20} /> : <Shirt size={20} />}</div>
        <div><strong>{title[0]}</strong><span>{title[1]}</span></div>
        <em><CircleAlert size={13} />未接真实数据均标注为验收目标或演示配置</em>
      </header>

      {mode === 'model' && (
        <div className={styles.modelLayout}>
          <section className={styles.previewCard}>
            <div className={styles.previewToolbar}>
              <span><Scan size={14} />{displayName} · 模型检查视图</span>
              <div>{([['front', '正面'], ['side', '侧面'], ['wire', '线框']] as const).map(([id, label]) => <button className={modelView === id ? styles.active : ''} type="button" key={id} onClick={() => { setModelView(id); notify(`已切换到${label}检查视图`); }}>{label}</button>)}</div>
            </div>
            <div className={styles.modelViewport} data-view={modelView}>
              <div className={styles.viewportGrid} />
              <span className={styles.modelOrbit}><i /><i /><i /></span>
              {avatarImage
                ? <img src={avatarImage} alt={`${displayName}模型检查预览`} />
                : <span className={styles.modelCallout} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}><i />请先上传形象</span>}
              <i className={styles.scanLine} />
              <span className={styles.modelCallout} style={{ left: '34%', top: '29%' }}><i />面部拓扑</span>
              <span className={styles.modelCallout} style={{ left: '62%', top: '64%' }}><i />身体网格</span>
              <div className={styles.axis}><b>Y</b><span>X</span><em>Z</em></div>
            </div>
            <footer><span><Rotate3d size={13} />旋转预览</span><span><Grid3X3 size={13} />LOD 0</span><span><Layers3 size={13} />PBR 材质</span></footer>
          </section>

          <aside className={styles.inspector}>
            <div className={styles.sectionTitle}><div><small>MODEL INSPECTION</small><strong>模型验收参数</strong></div><span>演示配置</span></div>
            <div className={styles.metricList}>{MODEL_METRICS.map((metric) => <article key={metric.label}><div><strong>{metric.label}</strong><small>验收目标 {metric.target}</small></div><b>{metric.value}</b><em>演示配置</em></article>)}</div>
            <div className={styles.reportCard}>
              <span><FileCheck2 size={18} /></span>
              <div><strong>第三方检测报告</strong><small>{reportName || '支持 PDF、JPG、PNG，正式交付时上传'}</small></div>
              <em>{reportName ? '待审核' : '待上传'}</em>
            </div>
            <input ref={reportInput} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) { setReportName(file.name); notify('检测报告已加入待审核列表'); } }} />
            <div className={styles.actionRow}>
              <button type="button" onClick={() => reportInput.current?.click()}><FileUp size={14} />上传报告</button>
              <button className={styles.primary} type="button" disabled={inspection === 'checking'} onClick={runInspection}>{inspection === 'checking' ? <RefreshCw className={styles.spin} size={14} /> : <ShieldCheck size={14} />}{inspection === 'checking' ? '检查中' : inspection === 'done' ? '重新检查' : '运行检查'}</button>
            </div>
            {inspection === 'done' && <div className={styles.resultNote}><CheckCircle2 size={14} /><span>演示检查完成；面数与检测报告仍需正式验收。</span></div>}
          </aside>
        </div>
      )}

      {mode === 'drive' && (
        <div className={styles.driveShell}>
          <nav className={styles.driveTabs} aria-label="驱动配置类型">
            <button className={driveTab === 'expression' ? styles.active : ''} type="button" onClick={() => onDriveTabChange('expression')}><Eye size={15} />表情映射</button>
            <button className={driveTab === 'motion' ? styles.active : ''} type="button" onClick={() => onDriveTabChange('motion')}><Move3d size={15} />动作校准</button>
          </nav>

          {driveTab === 'expression' ? (
            <div className={styles.driveLayout}>
              <section className={styles.faceCard}>
                <div className={styles.previewToolbar}><span><Eye size={14} />{displayName} · 面部驱动预览</span><em><i />图片坐标已同步 · 可拖拽</em></div>
                <div className={styles.faceViewport} ref={faceMedia.viewportRef}>
                  {avatarImage
                    ? <div className={`${styles.registeredMedia} ${styles.faceMedia} ${expressionPlaying ? styles.mediaPlaying : ''}`} style={faceMedia.mediaStyle}>
                        <img ref={faceMedia.imageRef} src={avatarImage} alt={`${displayName} ARKit 表情映射预览`} onLoad={faceMedia.onImageLoad} />
                        <LandmarkOverlay
                          active={expressionPlaying}
                          activeIndices={FACE_POINT_GROUPS[expressionId]}
                          edges={FACE_EDGES}
                          label="面部点位"
                          onChange={setFacePoints}
                          points={facePoints}
                          variant="face"
                        />
                      </div>
                    : <span className={styles.modelCallout} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}><i />请先上传形象</span>}
                  <span className={styles.expressionBadge}><Sparkles size={12} />{activeExpression.label}<b>{intensity}%</b></span>
                  {avatarImage && <span className={styles.calibrationHint}>拖拽蓝点可微调当前人物</span>}
                </div>
                <div className={styles.channelMeter}><span>当前通道 <b>{activeExpression.channels}</b></span><div><i style={{ width: `${intensity}%` }} /></div><em>驱动强度演示</em></div>
              </section>
              <aside className={styles.driveInspector}>
                <div className={styles.sectionTitle}><div><small>ARKIT MAPPING</small><strong>52 项映射模板</strong></div><span>待实机联调</span></div>
                <div className={styles.expressionGrid}>{EXPRESSIONS.map((item) => <button className={expressionId === item.id ? styles.selected : ''} type="button" key={item.id} onClick={() => setExpressionId(item.id)}><span>{item.group}</span><strong>{item.label}</strong><small>{item.channels}</small>{expressionId === item.id && <Check size={14} />}</button>)}</div>
                <label className={styles.rangeControl}><span>驱动强度 <b>{intensity}%</b></span><input type="range" min="0" max="100" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label>
                <button className={styles.widePrimary} type="button" onClick={playExpression} disabled={expressionPlaying}>{expressionPlaying ? <RefreshCw className={styles.spin} size={14} /> : <Play size={14} />}{expressionPlaying ? '正在预览' : '播放表情预览'}</button>
              </aside>
            </div>
          ) : (
            <div className={styles.driveLayout}>
              <section className={styles.motionCard}>
                <div className={styles.previewToolbar}><span><Move3d size={14} />{displayName} · 当前姿态校准</span><em className={tracking ? styles.live : ''}><i />{tracking ? '点位显示中 · 可拖拽' : '点位已暂停'}</em></div>
                <div className={styles.motionViewport} ref={motionMedia.viewportRef}>
                  <div className={styles.motionGrid} />
                  {avatarImage
                    ? <div className={`${styles.registeredMedia} ${styles.motionMedia}`} style={motionMedia.mediaStyle}>
                        <img ref={motionMedia.imageRef} src={avatarImage} alt={`${displayName}动作驱动人物预览`} onLoad={motionMedia.onImageLoad} />
                        <LandmarkOverlay
                          active={tracking}
                          edges={POSE_EDGES}
                          label="姿态关节"
                          onChange={setPosePoints}
                          points={posePoints}
                          variant="pose"
                        />
                      </div>
                    : <span className={styles.modelCallout} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}><i />请先上传形象</span>}
                  <i className={styles.floorRing} />
                  <span className={styles.trackQuality}><strong>{tracking ? '98.6' : '--'}</strong><small>跟踪质量 · 演示配置</small></span>
                </div>
                <footer><span><CheckCircle2 size={13} />15 个可调校准点</span><span><Activity size={13} />图片坐标同步</span><span><ShieldCheck size={13} />坐姿模板已对齐</span></footer>
              </section>
              <aside className={styles.driveInspector}>
                <div className={styles.sectionTitle}><div><small>MOTION CAPTURE</small><strong>设备与动作校准</strong></div><span>手动校准</span></div>
                <div className={styles.deviceList}>{[['当前人物点位', '15 / 15 关节'], ['双手与肘部', '支持拖拽微调'], ['图片坐标映射', '缩放后保持对齐']].map(([label, value]) => <article key={label}><span><Check size={13} /></span><div><strong>{label}</strong><small>{value}</small></div><em>演示状态</em></article>)}</div>
                <section className={styles.latencyCard}>
                  <header><span>端到端动作延迟</span><em>验收目标 &lt;= 50 ms</em></header>
                  <div><strong>{tracking ? '36' : '--'}</strong><span>ms<small>演示配置</small></span><CircleGauge size={34} /></div>
                  <footer><span>采集 <b>12 ms</b></span><span>解算 <b>14 ms</b></span><span>驱动 <b>10 ms</b></span></footer>
                </section>
                <div className={styles.actionRow}>
                  <button type="button" disabled={calibration === 'checking'} onClick={calibrate}><RefreshCw className={calibration === 'checking' ? styles.spin : ''} size={14} />{calibration === 'checking' ? '校准中' : '重新校准'}</button>
                  <button className={styles.primary} type="button" onClick={() => { setTracking((value) => !value); notify(tracking ? '动作追踪已暂停' : '动作追踪已启动（演示输入）'); }}>{tracking ? <Pause size={14} /> : <Play size={14} />}{tracking ? '暂停驱动' : '开始驱动'}</button>
                </div>
              </aside>
            </div>
          )}
        </div>
      )}

      {mode === 'style' && (
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
      )}

      {notice && <div className={styles.toast} role="status"><CheckCircle2 size={15} />{notice}</div>}
    </section>
  );
}
