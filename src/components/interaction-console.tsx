'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Mic, MicOff, Plus, Send, Upload } from 'lucide-react';
import { MuseTalkTotalStream } from '@/lib/musetalk-total-stream';
import { ProductShell } from '@/components/product-shell';

type Avatar = {
  id: string;
  name: string;
  role: string;
  profile: 'chinese' | 'american';
  video?: string;
  image?: string;
  custom?: boolean;
};

type Message = { role: 'user' | 'avatar'; text: string };

const PRESET_AVATARS: Avatar[] = [
  { id: 'linxi', name: '林汐', role: '智能生活助理', profile: 'chinese', video: '/assets/musetalk-default/chinese.mp4' },
  { id: 'avery', name: 'Avery', role: '双语品牌顾问', profile: 'american', video: '/assets/musetalk-default/american.mp4' },
];

const STAGE_LABELS: Record<string, string> = {
  idle: '随时可以开始', connecting: '正在连接 MuseTalk', ready: '已连接', llm_start: '正在思考',
  llm_result: '正在组织回答', tts_start: '正在生成声音', stream_start: '正在回应',
  conversation_end: '回答完成', error: '连接异常',
};

function AvatarMedia({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  if (avatar.image) return <img className={className} src={avatar.image} alt={avatar.name} />;
  return <video className={className} src={avatar.video} preload="auto" muted playsInline />;
}

function Conversation({ avatar, onBack }: { avatar: Avatar; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [messages, setMessages] = useState<Message[]>([{ role: 'avatar', text: `你好，我是${avatar.name}。现在就可以问我任何问题。` }]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState('idle');
  const [mediaActive, setMediaActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const busy = stage !== 'idle' && stage !== 'conversation_end' && stage !== 'error';

  useEffect(() => {
    if (!canvasRef.current) return;
    streamRef.current = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatar.profile, language: avatar.profile === 'american' ? 'EN' : 'ZH',
      onStage: setStage, onMediaActive: setMediaActive,
    });
    return () => { void streamRef.current?.cancel(); streamRef.current = null; recognitionRef.current?.stop(); };
  }, [avatar]);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || !streamRef.current) return;
    setInput(''); setError(''); setMessages((items) => [...items, { role: 'user', text: question }]);
    try {
      const result = await streamRef.current.ask(question);
      setMessages((items) => [...items, { role: 'avatar', text: result.answer || '我已经收到你的问题。' }]);
    } catch (cause) {
      setStage('error'); setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleMic = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('当前浏览器不支持语音识别，请使用文字输入。'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = avatar.profile === 'american' ? 'en-US' : 'zh-CN';
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((result: any) => result[0].transcript).join('');
      setInput(transcript);
      if (event.results[event.results.length - 1].isFinal) { setListening(false); void ask(transcript); }
    };
    recognition.onerror = () => { setListening(false); setError('没有识别到声音，请重试。'); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition; recognition.start(); setListening(true); setError('');
  };

  return (
    <main className="conversationPage">
      <div className="conversationTop"><button className="backButton" onClick={onBack}><ArrowLeft size={18} />更换数字人</button><div><span className={`liveDot ${stage === 'error' ? 'error' : ''}`} />{STAGE_LABELS[stage] || stage}</div></div>
      <section className="conversationGrid">
        <div className="avatarStage">
          <AvatarMedia avatar={avatar} className={mediaActive ? 'stageMedia hidden' : 'stageMedia'} />
          <canvas ref={canvasRef} className={mediaActive ? 'streamCanvas active' : 'streamCanvas'} />
          <div className="avatarIdentity"><span>{avatar.name}</span><small>{avatar.role}</small></div>
          {busy && <div className="thinkingWave"><i /><i /><i /><i /></div>}
        </div>
        <div className="chatPanel">
          <div className="chatHeading"><div><strong>与 {avatar.name} 对话</strong><span>MuseTalk 实时流式互动</span></div><span className="secureBadge"><Check size={13} /> 已连接</span></div>
          <div className="messageList">
            {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'avatar' ? avatar.name.slice(0, 1) : '我'}</span><p>{message.text}</p></div>)}
            {busy && <div className="message avatar"><span>{avatar.name.slice(0, 1)}</span><p className="typing"><i /><i /><i /></p></div>}
          </div>
          {error && <div className="inlineError">{error}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <button type="button" className={`micButton ${listening ? 'recording' : ''}`} onClick={toggleMic} disabled={busy}>{listening ? <MicOff size={20} /> : <Mic size={20} />}</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? '正在聆听…' : '输入问题，或点击麦克风说话'} disabled={busy} />
            <button className="sendButton" disabled={!input.trim() || busy} aria-label="发送"><Send size={18} /></button>
          </form>
        </div>
      </section>
    </main>
  );
}

export function InteractionConsole() {
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [custom, setCustom] = useState<Avatar[]>([]);
  const avatars = useMemo(() => [...PRESET_AVATARS, ...custom], [custom]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lingjing-custom-avatars') || '[]') as Avatar[];
      setCustom(Array.isArray(stored) ? stored : []);
    } catch {
      setCustom([]);
    }
  }, []);

  if (selected) return <ProductShell><Conversation avatar={selected} onBack={() => setSelected(null)} /></ProductShell>;

  return (
    <ProductShell>
      <main className="selectionPage">
        <section className="selectionHero"><span className="eyebrow">REAL-TIME DIGITAL HUMAN</span><h1>选择一位数字人<br />开始自然对话</h1><p>低延迟音视频合成，让每一次交流都有真实的表情、声音与回应。</p></section>
        <section className="avatarSection">
          <div className="sectionTitle"><div><h2>选择互动形象</h2><p>点击形象即可进入实时互动</p></div><span>{avatars.length} 个可用形象</span></div>
          <div className="avatarGrid">
            {avatars.map((avatar, index) => (
              <button className="avatarCard" key={avatar.id} onClick={() => setSelected(avatar)}>
                <AvatarMedia avatar={avatar} />
                <span className="cardNumber">0{index + 1}</span><span className="cardStatus"><i /> 在线</span>
                <span className="avatarMeta"><span><strong>{avatar.name}</strong><small>{avatar.role}</small></span><i className="roundArrow"><ArrowRight size={18} /></i></span>
              </button>
            ))}
            <Link className="createCard" href="/design"><span className="createIcon"><Plus size={28} /></span><strong>设计新形象</strong><small>上传照片，创建你的专属数字人</small><span className="textLink"><Upload size={15} /> 开始创建</span></Link>
          </div>
        </section>
      </main>
    </ProductShell>
  );
}
