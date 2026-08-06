'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Headphones, ImagePlus, Mic, MicOff, PhoneCall, Send, Sparkles } from 'lucide-react';
import { MuseTalkTotalStream } from '@/lib/musetalk-total-stream';
import { ProductShell } from '@/components/product-shell';

type Avatar = {
  id: string;
  name: string;
  role: string;
  description: string;
  profile: 'chinese' | 'american';
  image: string;
};

type Message = { role: 'user' | 'avatar'; text: string };

const DEFAULT_AVATARS: Avatar[] = [
  {
    id: 'linxi',
    name: '林汐',
    role: '品牌咨询顾问',
    description: '亲和自然，适合产品讲解与客户接待',
    profile: 'chinese',
    image: '/assets/liveact-avatars/2.png',
  },
  {
    id: 'avery',
    name: 'Avery',
    role: '双语数字助理',
    description: '中英双语，适合国际业务与品牌展示',
    profile: 'american',
    image: '/assets/flashhead-avatars/bright-host.png',
  },
];

function AvatarMedia({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  return <img className={className} src={avatar.image} alt={`${avatar.name} 数字人形象`} />;
}

function Conversation({ avatar, onBack }: { avatar: Avatar; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'avatar', text: `你好，我是${avatar.name}。欢迎来到灵境数字人体验中心，有什么想了解的吗？` },
  ]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState('idle');
  const [mediaActive, setMediaActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const busy = stage !== 'idle' && stage !== 'conversation_end' && stage !== 'error';

  useEffect(() => {
    if (!canvasRef.current) return;
    streamRef.current = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatar.profile,
      language: avatar.profile === 'american' ? 'EN' : 'ZH',
      onStage: setStage,
      onMediaActive: setMediaActive,
    });
    return () => {
      void streamRef.current?.cancel();
      streamRef.current = null;
      recognitionRef.current?.stop();
    };
  }, [avatar]);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || !streamRef.current) return;
    setInput('');
    setError('');
    setMessages((items) => [...items, { role: 'user', text: question }]);
    try {
      const result = await streamRef.current.ask(question);
      setMessages((items) => [
        ...items,
        { role: 'avatar', text: result.answer || '我已经收到你的问题。' },
      ]);
    } catch (cause) {
      setStage('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const browserWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SpeechRecognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('当前浏览器不支持语音识别，请使用文字输入。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = avatar.profile === 'american' ? 'en-US' : 'zh-CN';
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInput(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        setListening(false);
        void ask(transcript);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setError('没有识别到声音，请重试。');
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setError('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  return (
    <ProductShell>
      <main className="consoleMain conversationWorkspace">
        <div className="conversationWorkbench">
          <section className="avatarCallStage" aria-label={`${avatar.name} 数字人画面`}>
            <AvatarMedia avatar={avatar} className={mediaActive ? 'stageMedia hidden' : 'stageMedia'} />
            <canvas ref={canvasRef} className={mediaActive ? 'streamCanvas active' : 'streamCanvas'} />
            <div className="stageWash" />
            {busy && <div className="voiceWave" aria-label="数字人正在响应"><i /><i /><i /><i /><i /></div>}
            <div className="callDock">
              <span><i />实时音视频</span>
              <button type="button" onClick={toggleMic} className={listening ? 'listening' : ''} aria-label={listening ? '停止聆听' : '开始语音输入'}>
                {listening ? <MicOff size={20} /> : <PhoneCall size={20} />}
              </button>
              <span>低延迟模式</span>
            </div>
          </section>

          <aside className="dialogPanel">
            <header>
              <div className="dialogAvatar"><img src={avatar.image} alt="" /></div>
              <div><strong>对话记录</strong><span>与 {avatar.name} 实时交流</span></div>
              <span className="onlineTag"><i />在线</span>
              <button className="dialogBack" type="button" onClick={onBack} aria-label="返回形象列表"><ArrowLeft size={16} /></button>
            </header>
            <div className="messageList">
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <span>{message.role === 'avatar' ? avatar.name.slice(0, 1) : '我'}</span>
                  <p>{message.text}</p>
                </div>
              ))}
              {busy && <div className="message avatar"><span>{avatar.name.slice(0, 1)}</span><p className="typing"><i /><i /><i /></p></div>}
            </div>
            {error && <div className="inlineError">{error}</div>}
            <div className="dialogSuggestion"><Headphones size={14} />支持文字输入与浏览器语音识别</div>
            <form className="composer" onSubmit={submit}>
              <button type="button" className={`micButton ${listening ? 'recording' : ''}`} onClick={toggleMic} disabled={busy} aria-label="语音输入">
                {listening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={listening ? '正在聆听…' : '输入你想问的问题'} disabled={busy} />
              <button className="sendButton" disabled={!input.trim() || busy} aria-label="发送"><Send size={17} /></button>
            </form>
          </aside>
        </div>
      </main>
    </ProductShell>
  );
}

export function InteractionConsole() {
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>(DEFAULT_AVATARS);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lingjing-custom-avatars') || '[]') as Avatar[];
      if (Array.isArray(stored)) {
        const custom = stored.filter((item) => item?.id && item?.name && item?.image);
        setAvatars([...custom, ...DEFAULT_AVATARS]);
      }
    } catch {
      // Ignore malformed local data and keep the official presets available.
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [selected]);

  if (selected) return <Conversation avatar={selected} onBack={() => setSelected(null)} />;

  return (
    <ProductShell>
      <main className="consoleMain chatCatalogPage">
        <section className="catalogHero">
          <div className="heroCopy">
            <h1>来和你的数字人聊聊吧</h1>
            <p>选择数字人形象，即刻体验低延迟、可打断的自然对话。适用于客户接待、产品咨询与品牌服务。</p>
            <button className="primaryAction" type="button" onClick={() => setSelected(avatars[0])}><Sparkles size={17} />立即开始</button>
          </div>
          <div className="heroShowcase" aria-hidden="true">
            <div className="heroOrb one" />
            <div className="heroOrb two" />
            <div className="heroPortrait"><img src={DEFAULT_AVATARS[0].image} alt="" /></div>
            <div className="heroFloatingCard"><span><i />在线</span><strong>{DEFAULT_AVATARS[0].name}</strong><small>{DEFAULT_AVATARS[0].role}</small></div>
          </div>
        </section>

        <section className="avatarCatalog">
          <header className="catalogHeader">
            <div><h2>选择数字人</h2><p>官方预设形象已完成实时对话配置</p></div>
            <div className="catalogTabs"><button className="active" type="button">全部形象</button><span>{avatars.length} 个可用</span></div>
          </header>
          <div className="avatarCatalogGrid">
            <Link className="createAvatarCard" href="/design">
              <span className="createAvatarIcon"><ImagePlus size={27} /></span>
              <span><strong>创建自己的数字人</strong><small>上传图片或通过对话修改形象</small></span>
            </Link>
            {avatars.map((avatar) => (
              <button className="avatarProductCard" type="button" key={avatar.id} onClick={() => setSelected(avatar)}>
                <span className="avatarProductMedia"><AvatarMedia avatar={avatar} /><span className="cardOnline"><i />可体验</span></span>
                <span className="avatarProductInfo">
                  <span><strong>{avatar.name}</strong><small>{avatar.role}</small></span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </ProductShell>
  );
}
