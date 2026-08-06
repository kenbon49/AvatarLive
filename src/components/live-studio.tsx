'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleStop, Copy, FileText, Play, Plus, Radio, Settings2, Sparkles, Trash2, Users, Video, Wifi } from 'lucide-react';
import { MuseTalkTotalStream } from '@/lib/musetalk-total-stream';
import { ProductShell } from '@/components/product-shell';

const AVATARS = [
  {
    id: 'chinese',
    name: '林汐',
    role: '亲和型主播',
    image: '/assets/liveact-avatars/2.png',
  },
  {
    id: 'american',
    name: 'Avery',
    role: '双语型主播',
    image: '/assets/flashhead-avatars/bright-host.png',
  },
] as const;

type ScriptItem = { id: number; text: string; state: 'ready' | 'playing' | 'done' };

export function LiveStudio() {
  const [entered, setEntered] = useState(false);
  const [avatarId, setAvatarId] = useState<'chinese' | 'american'>('chinese');
  const avatar = AVATARS.find((item) => item.id === avatarId) ?? AVATARS[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const [mediaActive, setMediaActive] = useState(false);
  const [stage, setStage] = useState('idle');
  const [onAir, setOnAir] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('欢迎来到直播间，今天为大家带来一场特别的产品分享。');
  const [scripts, setScripts] = useState<ScriptItem[]>([
    { id: 1, text: '大家好，欢迎来到我们的数字人直播间。', state: 'ready' },
    { id: 2, text: '今天会从核心亮点、使用场景和常见问题三个方面展开介绍。', state: 'ready' },
  ]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    if (!entered || !canvasRef.current) return;
    streamRef.current = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatarId,
      language: avatarId === 'american' ? 'EN' : 'ZH',
      onStage: setStage,
      onMediaActive: setMediaActive,
    });
    return () => {
      void streamRef.current?.cancel();
      streamRef.current = null;
    };
  }, [avatarId, entered]);

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
    if (!onAir || stage !== 'idle' || !streamRef.current) return;
    setError('');
    setScripts((items) => items.map((candidate) => (
      candidate.id === item.id ? { ...candidate, state: 'playing' } : candidate
    )));
    try {
      await streamRef.current.speak(item.text);
      setScripts((items) => items.map((candidate) => (
        candidate.id === item.id ? { ...candidate, state: 'done' } : candidate
      )));
    } catch (cause) {
      setStage('idle');
      setScripts((items) => items.map((candidate) => (
        candidate.id === item.id ? { ...candidate, state: 'ready' } : candidate
      )));
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addScript = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setScripts((items) => [...items, { id: Date.now(), text: draft.trim(), state: 'ready' }]);
    setDraft('');
  };

  const stopLive = async () => {
    await streamRef.current?.cancel();
    setStage('idle');
    setMediaActive(false);
    setOnAir(false);
    setStartedAt(null);
    setScripts((items) => items.map((item) => (
      item.state === 'playing' ? { ...item, state: 'ready' } : item
    )));
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

  return (
    <ProductShell>
      <main className="consoleMain liveWorkspace">
        <header className="workspaceHeader">
          <div>
            <button className="liveBackLanding" type="button" onClick={() => { void stopLive(); setEntered(false); }}><ArrowLeft size={14} />直播首页</button>
            <span className="pageKicker"><i />数字人直播</span>
            <h1>直播控制台</h1>
            <p>配置数字人、编排直播话术并管理推流状态。</p>
          </div>
          <div className="liveActions">
            <span className={`airState ${onAir ? 'active' : ''}`}><i />{onAir ? `直播中 ${elapsed}` : '尚未开播'}</span>
            {onAir ? (
              <button className="stopButton" type="button" onClick={() => void stopLive()}><CircleStop size={17} />结束直播</button>
            ) : (
              <button className="primaryAction" type="button" onClick={() => { setOnAir(true); setStartedAt(Date.now()); }}><Radio size={17} />开始直播</button>
            )}
          </div>
        </header>

        <div className="studioGrid">
          <section className="previewColumn">
            <div className="previewPanelHeader"><div><Video size={17} /><span><strong>直播预览</strong><small>1080 × 1920 · 25 FPS</small></span></div><button type="button" aria-label="画面设置"><Settings2 size={17} /></button></div>
            <div className="previewFrame">
              <img className={mediaActive ? 'liveAvatar hidden' : 'liveAvatar'} src={avatar.image} alt={`${avatar.name} 直播预览`} />
              <canvas ref={canvasRef} className={mediaActive ? 'streamCanvas active' : 'streamCanvas'} />
              <div className="previewShade" />
              <div className="previewOverlay">
                <span className={onAir ? 'onAir' : ''}>{onAir ? 'LIVE' : 'PREVIEW'}</span>
                <span><Users size={13} />0</span>
              </div>
              <div className="lowerThird"><strong>{avatar.name}</strong><span>{avatar.role}</span></div>
              {stage !== 'idle' && <div className="renderState"><i /><span>{stage === 'error' ? '连接异常' : 'MuseTalk 正在生成画面'}</span></div>}
            </div>
            <div className="streamHealth"><span><i /><strong>本地预览正常</strong></span><span><Wifi size={14} />推流服务待配置</span></div>
            {error && <div className="inlineError previewError">{error}</div>}
          </section>

          <section className="controlColumn">
            <article className="controlCard">
              <header className="controlTitle"><span>01</span><div><h2>选择数字人</h2><p>直播过程中不可切换形象</p></div></header>
              <div className="miniAvatars">
                {AVATARS.map((item) => (
                  <button
                    key={item.id}
                    className={avatarId === item.id ? 'selected' : ''}
                    type="button"
                    onClick={() => { if (stage === 'idle') { setAvatarId(item.id); setError(''); } }}
                    disabled={onAir}
                  >
                    <img src={item.image} alt="" />
                    <span><strong>{item.name}</strong><small>{item.role}</small></span>
                    {avatarId === item.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            </article>

            <article className="controlCard scriptCard">
              <header className="controlTitle"><span>02</span><div><h2>直播话术</h2><p>按顺序播报，也可以随时插播</p></div><em>{scripts.length} 条</em></header>
              <div className="scriptList">
                {scripts.map((item, index) => (
                  <div className={item.state} key={item.id}>
                    <span className="scriptIndex">{String(index + 1).padStart(2, '0')}</span>
                    <p>{item.text}</p>
                    <span className="scriptState">{item.state === 'done' ? '已播报' : item.state === 'playing' ? '播报中' : '待播报'}</span>
                    <button className="playButton" type="button" onClick={() => void play(item)} disabled={!onAir || stage !== 'idle' || item.state === 'playing'} aria-label="播报"><Play size={14} fill="currentColor" /></button>
                    <button className="deleteButton" type="button" onClick={() => setScripts((items) => items.filter((candidate) => candidate.id !== item.id))} aria-label="删除"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <form className="scriptComposer" onSubmit={addScript}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入新的直播话术…" rows={3} maxLength={200} />
                <div><span>{draft.length}/200</span><button disabled={!draft.trim()}><Plus size={14} />加入播报队列</button></div>
              </form>
            </article>

            <article className="controlCard destinationCard">
              <header className="controlTitle"><span>03</span><div><h2>推流设置</h2><p>填写直播平台提供的 RTMP 地址</p></div></header>
              <label><span>推流地址</span><div><input placeholder="rtmp://live.example.com/app/stream-key" disabled={onAir} /><button type="button" aria-label="粘贴"><Copy size={16} /></button></div></label>
              <div className="connectionHint"><i /><span><strong>当前为本地预览模式</strong><small>接入推流服务后即可发布到直播平台</small></span><ChevronRight size={17} /></div>
            </article>
          </section>
        </div>
      </main>
    </ProductShell>
  );
}
