'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Headphones, ImagePlus, Mic, MicOff, PhoneCall, Send, Settings2, Sparkles } from 'lucide-react';
import {
  fetchMuseTalkAvatarCatalog,
  MuseTalkTotalStream,
  type MuseTalkAvatarProfile,
} from '@/lib/musetalk-total-stream';
import {
  CUSTOM_AVATAR_STORAGE_KEY,
  DEFAULT_AVATARS,
  readCustomAvatars,
  type Avatar,
} from '@/lib/avatar-catalog';
import { ProductShell } from '@/components/product-shell';

type Message = { role: 'user' | 'avatar'; text: string };

function AvatarMedia({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  return <img className={className} src={avatar.image} alt={`${avatar.name} 数字人形象`} />;
}

function avatarDesignHref(avatar: Avatar) {
  return `/design?avatar=${encodeURIComponent(avatar.id)}&tab=appearance`;
}

function Conversation({ avatar, onBack }: { avatar: Avatar; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'avatar', text: avatar.custom ? avatar.description : `你好，我是${avatar.name}。欢迎来到灵境数字人体验中心，有什么想了解的吗？` },
  ]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState('idle');
  const [mediaActive, setMediaActive] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'online' | 'failed'>('connecting');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const busy = stage !== 'idle' && stage !== 'conversation_end' && stage !== 'error';
  const showGeneratedMedia = mediaActive && !avatar.custom;
  const lipSyncStatus = avatar.custom
    ? '自定义模型待生成/接入'
    : connectionState === 'failed'
      ? '连接失败'
      : mediaActive ? '运行中' : '连接中';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  useEffect(() => {
    if (!canvasRef.current) return;
    setConnectionState('connecting');
    const stream = new MuseTalkTotalStream(canvasRef.current, {
      profile: avatar.profile,
      language: avatar.language,
      onStage: setStage,
      onMediaActive: (active) => {
        setMediaActive(active);
        if (active) setConnectionState('online');
      },
      onTextUnit: (_unit, text) => {
        setMessages((items) => {
          const last = items.at(-1);
          if (last?.role === 'avatar') {
            return [...items.slice(0, -1), { ...last, text }];
          }
          return [...items, { role: 'avatar', text }];
        });
      },
    });
    streamRef.current = stream;
    void stream.startLive()
      .then(() => {
        if (streamRef.current === stream) setConnectionState('online');
      })
      .catch((cause) => {
        if (streamRef.current !== stream) return;
        setConnectionState('failed');
        setStage('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      void stream.stopLive();
      if (streamRef.current === stream) streamRef.current = null;
      recognitionRef.current?.stop();
    };
  }, [avatar]);

  useEffect(() => {
    if (stage === 'error' && !mediaActive) setConnectionState('failed');
  }, [mediaActive, stage]);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || !streamRef.current) return;
    setInput('');
    setError('');
    if (connectionState === 'failed') setConnectionState('connecting');
    setMessages((items) => [...items, { role: 'user', text: question }]);
    try {
      await streamRef.current.ask(question);
      setConnectionState('online');
    } catch (cause) {
      if (!mediaActive) setConnectionState('failed');
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
    recognition.lang = avatar.language === 'EN' ? 'en-US' : 'zh-CN';
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
            <AvatarMedia avatar={avatar} className={showGeneratedMedia ? 'stageMedia hidden' : 'stageMedia'} />
            <canvas ref={canvasRef} className={showGeneratedMedia ? 'streamCanvas active' : 'streamCanvas'} />
            <div className="stageWash" />
            {busy && <div className="voiceWave" aria-label="数字人正在响应"><i /><i /><i /><i /><i /></div>}
            <div className="callDock">
              <span><i />{avatar.custom ? '实时语音' : '实时音视频'}</span>
              <button type="button" onClick={toggleMic} className={listening ? 'listening' : ''} aria-label={listening ? '停止聆听' : '开始语音输入'}>
                {listening ? <MicOff size={20} /> : <PhoneCall size={20} />}
              </button>
              <span>{avatar.custom ? '图片模式' : '低延迟模式'}</span>
            </div>
          </section>

          <aside className="dialogPanel">
            <header>
              <div className="dialogAvatar"><img src={avatar.image} alt="" /></div>
              <div><strong>对话记录</strong><span>与 {avatar.name} 实时交流</span></div>
              <span className="onlineTag"><i />{connectionState === 'failed' ? '连接失败' : connectionState === 'online' ? '在线' : '连接中'}</span>
              <Link className="dialogConfigure" href={avatarDesignHref(avatar)} aria-label={`配置${avatar.name}`}><Settings2 size={15} /></Link>
              <button className="dialogBack" type="button" onClick={onBack} aria-label="返回形象列表"><ArrowLeft size={16} /></button>
            </header>
            <div className="messageList" aria-live="polite">
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <span>{message.role === 'avatar' ? avatar.name.slice(0, 1) : '我'}</span>
                  <p>{message.text}</p>
                </div>
              ))}
              {busy && messages.at(-1)?.role !== 'avatar' && <div className="message avatar"><span>{avatar.name.slice(0, 1)}</span><p className="typing"><i /><i /><i /></p></div>}
              <div ref={messagesEndRef} />
            </div>
            {error && <div className="inlineError">{error}</div>}
            <div className="dialogSuggestion">
              <Headphones size={14} />ASR：{listening ? '识别中' : '就绪'} · 口型驱动：{lipSyncStatus} · 知识来源：通用模型
            </div>
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
  const [catalogAvatars, setCatalogAvatars] = useState<Avatar[]>(DEFAULT_AVATARS);
  const [customAvatars, setCustomAvatars] = useState<Avatar[]>([]);
  const [defaultProfile, setDefaultProfile] = useState<MuseTalkAvatarProfile>('chinese');
  const [catalogError, setCatalogError] = useState('');

  const avatars = [
    ...customAvatars,
    ...catalogAvatars.filter((avatar) => !customAvatars.some((custom) => custom.id === avatar.id)),
  ];

  useEffect(() => {
    const refreshCustomAvatars = () => setCustomAvatars(readCustomAvatars());
    const syncCustomAvatars = (event: StorageEvent) => {
      if (event.key === CUSTOM_AVATAR_STORAGE_KEY) refreshCustomAvatars();
    };
    refreshCustomAvatars();
    window.addEventListener('storage', syncCustomAvatars);
    window.addEventListener('focus', refreshCustomAvatars);
    return () => {
      window.removeEventListener('storage', syncCustomAvatars);
      window.removeEventListener('focus', refreshCustomAvatars);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchMuseTalkAvatarCatalog()
      .then((catalog) => {
        if (!active) return;
        const availableProfiles = new Set(catalog.avatars.map((item) => item.id));
        const available = DEFAULT_AVATARS.filter((item) => availableProfiles.has(item.profile));
        if (available.length) setCatalogAvatars(available);
        setDefaultProfile(catalog.default);
        setCatalogError('');
      })
      .catch((cause) => {
        if (!active) return;
        setCatalogError(cause instanceof Error ? cause.message : 'MuseTalk 数字人目录加载失败');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [selected]);

  if (selected) return <Conversation avatar={selected} onBack={() => setSelected(null)} />;

  const featuredAvatar = avatars.find((avatar) => avatar.profile === defaultProfile) || avatars[0];

  return (
    <ProductShell>
      <main className="consoleMain chatCatalogPage">
        <section className="catalogHero">
          <div className="heroCopy">
            <h1>来和你的数字人聊聊吧</h1>
            <p>选择数字人形象，即刻体验低延迟、可打断的自然对话。适用于客户接待、产品咨询与品牌服务。</p>
            <div className="catalogHeroActions">
              <button className="primaryAction" type="button" onClick={() => setSelected(featuredAvatar)} disabled={!featuredAvatar}><Sparkles size={17} />立即开始</button>
              {featuredAvatar && <Link className="secondaryAction" href={avatarDesignHref(featuredAvatar)}><Settings2 size={16} />配置形象</Link>}
            </div>
          </div>
          <div className="heroShowcase" aria-hidden="true">
            <div className="heroOrb one" />
            <div className="heroOrb two" />
            {featuredAvatar && <div className="heroPortrait"><img src={featuredAvatar.image} alt="" /></div>}
            {featuredAvatar && <div className="heroFloatingCard"><span><i />{catalogError ? '服务未连接' : '在线'}</span><strong>{featuredAvatar.name}</strong><small>{featuredAvatar.role}</small></div>}
          </div>
        </section>

        <section className="avatarCatalog">
          <header className="catalogHeader">
            <div><h2>选择数字人</h2><p>官方预设形象已完成实时对话配置</p></div>
            <div className="catalogTabs"><button className="active" type="button">全部形象</button><span>{avatars.length} 个可用</span></div>
          </header>
          {catalogError && <div className="inlineError">{catalogError}，当前显示内置目录，请确认 server_total :8080 已启动。</div>}
          <div className="avatarCatalogGrid">
            <Link className="createAvatarCard" href="/design">
              <span className="createAvatarIcon"><ImagePlus size={27} /></span>
              <span><strong>创建自己的数字人</strong><small>上传图片或通过对话修改形象</small></span>
            </Link>
            {avatars.map((avatar) => (
              <div className="avatarProductCardWrap" key={avatar.id}>
                <button className="avatarProductCard" type="button" onClick={() => setSelected(avatar)}>
                  <span className="avatarProductMedia"><AvatarMedia avatar={avatar} /></span>
                  <span className="avatarProductInfo">
                    <span><strong>{avatar.name}</strong><small>{avatar.custom ? `专属形象 · ${avatar.description || avatar.role}` : avatar.description || avatar.role}</small></span>
                  </span>
                </button>
                <Link className="avatarConfigLink" href={avatarDesignHref(avatar)} aria-label={`配置${avatar.name}`}><Settings2 size={13} /><span>配置</span></Link>
              </div>
            ))}
          </div>
        </section>
      </main>
    </ProductShell>
  );
}
