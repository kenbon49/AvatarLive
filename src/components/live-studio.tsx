'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleStop, Copy, Play, Plus, Radio, Settings2, Trash2, Users, Video } from 'lucide-react';
import { MuseTalkTotalStream } from '@/lib/musetalk-total-stream';
import { ProductShell } from '@/components/product-shell';

const AVATARS = [
  { id: 'chinese', name: '林汐', role: '亲和型主播', video: '/assets/musetalk-default/chinese.mp4' },
  { id: 'american', name: 'Avery', role: '双语型主播', video: '/assets/musetalk-default/american.mp4' },
] as const;

type ScriptItem = { id: number; text: string; state: 'ready' | 'playing' | 'done' };

export function LiveStudio() {
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
    if (!canvasRef.current) return;
    streamRef.current = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatarId, language: avatarId === 'american' ? 'EN' : 'ZH', onStage: setStage, onMediaActive: setMediaActive,
    });
    return () => { void streamRef.current?.cancel(); streamRef.current = null; };
  }, [avatarId]);

  useEffect(() => {
    if (!startedAt) { setElapsed('00:00:00'); return; }
    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [startedAt]);

  const changeAvatar = (id: 'chinese' | 'american') => {
    if (stage !== 'idle') return;
    setAvatarId(id); setError('');
  };

  const play = async (item: ScriptItem) => {
    if (!onAir || stage !== 'idle' || !streamRef.current) return;
    setError(''); setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'playing' } : candidate));
    try {
      await streamRef.current.speak(item.text);
      setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'done' } : candidate));
    } catch (cause) {
      setStage('idle'); setScripts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'ready' } : candidate));
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addScript = (event: FormEvent) => {
    event.preventDefault(); if (!draft.trim()) return;
    setScripts((items) => [...items, { id: Date.now(), text: draft.trim(), state: 'ready' }]); setDraft('');
  };

  const stopLive = async () => {
    await streamRef.current?.cancel(); setStage('idle'); setMediaActive(false); setOnAir(false); setStartedAt(null);
    setScripts((items) => items.map((item) => item.state === 'playing' ? { ...item, state: 'ready' } : item));
  };

  return (
    <ProductShell>
      <main className="livePage">
        <header className="liveHeader"><div><span className="eyebrow">LIVE WORKBENCH</span><h1>数字人直播工作台</h1><p>配置形象、编排内容，一站式完成数字人直播。</p></div><div className="liveActions"><span className={`airState ${onAir ? 'active' : ''}`}><i />{onAir ? `直播中 ${elapsed}` : '尚未开播'}</span>{onAir ? <button className="stopButton" onClick={() => void stopLive()}><CircleStop size={17} />结束直播</button> : <button className="primaryButton compact" onClick={() => { setOnAir(true); setStartedAt(Date.now()); }}><Radio size={17} />开始直播</button>}</div></header>
        <div className="studioGrid">
          <section className="previewColumn">
            <div className="previewFrame">
              <video className={mediaActive ? 'liveAvatar hidden' : 'liveAvatar'} src={avatar.video} preload="auto" muted playsInline />
              <canvas ref={canvasRef} className={mediaActive ? 'streamCanvas active' : 'streamCanvas'} />
              <div className="previewOverlay"><span className={onAir ? 'onAir' : ''}>{onAir ? 'LIVE' : 'PREVIEW'}</span><span><Users size={14} /> 0</span></div>
              <div className="lowerThird"><strong>{avatar.name}</strong><span>{avatar.role}</span></div>
              {stage !== 'idle' && <div className="renderState"><i /><span>{stage === 'error' ? '连接异常' : 'MuseTalk 正在生成画面'}</span></div>}
            </div>
            <div className="streamInfo"><div><Video size={18} /><span><strong>直播画面</strong><small>1080 × 1920 · 25 FPS</small></span></div><button title="画面设置"><Settings2 size={18} /></button></div>
            {error && <div className="inlineError">{error}</div>}
          </section>
          <section className="controlColumn">
            <div className="controlCard">
              <div className="controlTitle"><span>01</span><div><h2>选择主播</h2><p>直播过程中不可切换形象</p></div></div>
              <div className="miniAvatars">{AVATARS.map((item) => <button key={item.id} className={avatarId === item.id ? 'selected' : ''} onClick={() => changeAvatar(item.id)} disabled={onAir}><video src={item.video} preload="auto" muted playsInline /><span><strong>{item.name}</strong><small>{item.role}</small></span>{avatarId === item.id && <Check size={15} />}</button>)}</div>
            </div>
            <div className="controlCard scriptCard">
              <div className="controlTitle"><span>02</span><div><h2>直播内容</h2><p>按顺序播报，也可以随时插播</p></div><em>{scripts.length} 条</em></div>
              <div className="scriptList">{scripts.map((item, index) => <article className={item.state} key={item.id}><span className="scriptIndex">{String(index + 1).padStart(2, '0')}</span><p>{item.text}</p><span className="scriptState">{item.state === 'done' ? '已播报' : item.state === 'playing' ? '播报中' : '待播报'}</span><button className="playButton" onClick={() => void play(item)} disabled={!onAir || stage !== 'idle' || item.state === 'playing'} title="播报"><Play size={15} fill="currentColor" /></button><button className="deleteButton" onClick={() => setScripts((items) => items.filter((candidate) => candidate.id !== item.id))} title="删除"><Trash2 size={15} /></button></article>)}</div>
              <form className="scriptComposer" onSubmit={addScript}><textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入新的直播话术…" rows={3} /><div><span>{draft.length}/200</span><button disabled={!draft.trim()}><Plus size={15} />加入播报队列</button></div></form>
            </div>
            <div className="controlCard destinationCard">
              <div className="controlTitle"><span>03</span><div><h2>推流设置</h2><p>填写直播平台的 RTMP 地址</p></div></div>
              <label><span>推流地址</span><div><input placeholder="rtmp://live.example.com/app/stream-key" disabled={onAir} /><button title="粘贴"><Copy size={16} /></button></div></label>
              <div className="connectionHint"><i /><span><strong>本地预览模式</strong><small>填写地址并接入推流服务后可发布到直播平台</small></span><ChevronRight size={17} /></div>
            </div>
          </section>
        </div>
      </main>
    </ProductShell>
  );
}
