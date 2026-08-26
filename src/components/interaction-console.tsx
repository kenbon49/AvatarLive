'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Headphones, ImagePlus, Mic, MicOff, PhoneCall, Send, Settings2, Sparkles } from 'lucide-react';
import {
  fetchMuseTalkAvatarCatalog,
  MuseTalkTotalStream,
  type MuseTalkAvatarProfile,
} from '@/lib/musetalk-total-stream';
import {
  ACTIVE_AVATAR_STORAGE_KEY,
  AVATAR_VOICE_STORAGE_KEY,
  CUSTOM_AVATAR_STORAGE_KEY,
  DEFAULT_AVATARS,
  readAvatarVoicePreferences,
  readCustomAvatars,
  type Avatar,
} from '@/lib/avatar-catalog';
import { avatarIdleVideo } from '@/lib/avatar-preview-media';
import { ProductShell } from '@/components/product-shell';

type Message = { role: 'user' | 'avatar'; text: string };

function AvatarMedia({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  return <img className={className} src={avatar.image} alt={`${avatar.name} 数字人形象`} />;
}

const IDLE_HANDOFF_SECONDS = 0;
const IDLE_SEEK_TIMEOUT_MS = 250;
const CONFIGURED_INTERACTIVE_AVATAR_IDS = new Set(['chinese', 'business-male-1', 'chenyu', 'suqing', 'guyan']);

function isInteractiveAvatar(avatar: Avatar, availableAvatarIds: Set<string>) {
  if (avatar.custom) return Boolean(avatar.video) && availableAvatarIds.has(avatar.profile);
  return CONFIGURED_INTERACTIVE_AVATAR_IDS.has(avatar.id) && availableAvatarIds.has(avatar.id);
}

function IdleAvatarMedia({
  avatar,
  className,
  handoffRequested,
  returnRequested,
  onForwardBoundary,
  onReturnBoundary,
}: {
  avatar: Avatar;
  className: string;
  handoffRequested: boolean;
  returnRequested: boolean;
  onForwardBoundary: () => void;
  onReturnBoundary: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handoffHandledRef = useRef(false);
  const returnHandledRef = useRef(false);
  const source = avatarIdleVideo(avatar);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const resume = () => {
      void video.play().catch(() => {
        // Muted inline video normally starts automatically; a poster remains if the browser blocks it.
      });
    };
    const seekToTime = (time: number, onReady: () => void) => {
      let completed = false;
      let timeout: number | null = null;
      const complete = () => {
        if (completed) return;
        completed = true;
        video.removeEventListener('seeked', complete);
        if (timeout !== null) window.clearTimeout(timeout);
        onReady();
      };
      // If the loop is already displaying the requested frame, no seek event
      // is expected and the stream can be released immediately.
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && Math.abs(video.currentTime - time) <= 1 / 48) {
        complete();
        return () => undefined;
      }
      video.addEventListener('seeked', complete, { once: true });
      timeout = window.setTimeout(complete, IDLE_SEEK_TIMEOUT_MS);
      try {
        video.currentTime = time;
      } catch {
        complete();
      }
      return () => {
        video.removeEventListener('seeked', complete);
        if (timeout !== null) window.clearTimeout(timeout);
      };
    };

    if (!handoffRequested) handoffHandledRef.current = false;
    if (!returnRequested) returnHandledRef.current = false;

    if (returnRequested && !returnHandledRef.current) {
      returnHandledRef.current = true;
      video.pause();
      return seekToTime(0, () => {
        // Start the decoded idle source behind the canvas before fading the
        // generated frame out, so the return transition never reveals a pause.
        resume();
        onReturnBoundary();
      });
    }

    if (handoffRequested && !handoffHandledRef.current) {
      handoffHandledRef.current = true;
      video.pause();
      // A new backend request starts from the source video's first frame.
      return seekToTime(IDLE_HANDOFF_SECONDS, onForwardBoundary);
    }

    resume();
  }, [handoffRequested, onForwardBoundary, onReturnBoundary, returnRequested]);

  if (!source) return <AvatarMedia avatar={avatar} className={className} />;
  return <video ref={videoRef} className={className} src={source} muted autoPlay loop playsInline preload="auto" aria-label={`${avatar.name} 数字人静息画面`} />;
}

function avatarDesignHref(avatar: Avatar) {
  return `/design?avatar=${encodeURIComponent(avatar.id)}&tab=appearance`;
}

function Conversation({ avatar, onBack }: { avatar: Avatar; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MuseTalkTotalStream | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const playbackGateResolveRef = useRef<(() => void) | null>(null);
  const returnGateResolveRef = useRef<(() => void) | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'avatar', text: avatar.custom ? avatar.description : `你好，我是${avatar.name}。欢迎来到灵境数字人体验中心，有什么想了解的吗？` },
  ]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState('idle');
  const [mediaActive, setMediaActive] = useState(false);
  const [streamStartPending, setStreamStartPending] = useState(false);
  const [streamEndPending, setStreamEndPending] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'online' | 'failed'>('connecting');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const busy = stage !== 'idle' && stage !== 'conversation_end' && stage !== 'error';
  const hasIdleVideo = Boolean(avatarIdleVideo(avatar));
  const showGeneratedMedia = mediaActive && (!avatar.custom || Boolean(avatar.video));
  const lipSyncStatus = connectionState === 'failed'
      ? '连接失败'
      : mediaActive ? '运行中' : '连接中';

  const handleIdleForwardBoundary = useCallback(() => {
    const resolve = playbackGateResolveRef.current;
    playbackGateResolveRef.current = null;
    resolve?.();
  }, []);

  const handleIdleReturnBoundary = useCallback(() => {
    returnGateResolveRef.current?.();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  useEffect(() => {
    if (!canvasRef.current) return;
    setConnectionState('connecting');
    const stream = new MuseTalkTotalStream(canvasRef.current, {
      avatarId: avatar.id,
      profile: avatar.profile,
      language: avatar.language,
      voice: avatar.voice,
      onStage: setStage,
      onPlaybackReady: () => {
        if (!hasIdleVideo) return;
        return new Promise<void>((resolve) => {
          playbackGateResolveRef.current = resolve;
          setStreamStartPending(true);
        });
      },
      onPlaybackFinished: () => {
        if (!hasIdleVideo) return;
        return new Promise<void>((resolve) => {
          // Keep the generated frame visible until the idle clip is ready.
          const complete = () => {
            if (returnGateResolveRef.current !== complete) return;
            returnGateResolveRef.current = null;
            resolve();
          };
          returnGateResolveRef.current = complete;
          setStreamEndPending(true);
          window.setTimeout(complete, 350);
        });
      },
      onMediaActive: (active) => {
        if (active) {
          setMediaActive(true);
          setStreamStartPending(false);
          setConnectionState('online');
          return;
        }
        setMediaActive(false);
        setStreamStartPending(false);
        setStreamEndPending(false);
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
      playbackGateResolveRef.current?.();
      playbackGateResolveRef.current = null;
      returnGateResolveRef.current?.();
      returnGateResolveRef.current = null;
      recognitionRef.current?.stop();
    };
  }, [avatar]);

  useEffect(() => {
    if (stage !== 'error') return;
    playbackGateResolveRef.current?.();
    playbackGateResolveRef.current = null;
    setStreamStartPending(false);
    returnGateResolveRef.current?.();
    returnGateResolveRef.current = null;
    setStreamEndPending(false);
  }, [stage]);

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
            <IdleAvatarMedia
              avatar={avatar}
              className={showGeneratedMedia ? 'stageMedia hidden' : 'stageMedia'}
              handoffRequested={streamStartPending}
              returnRequested={streamEndPending}
              onForwardBoundary={handleIdleForwardBoundary}
              onReturnBoundary={handleIdleReturnBoundary}
            />
            <canvas ref={canvasRef} className={showGeneratedMedia ? 'streamCanvas active' : 'streamCanvas'} />
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
  const requestedAvatarIdRef = useRef('');
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [catalogAvatars, setCatalogAvatars] = useState<Avatar[]>(DEFAULT_AVATARS);
  const [customAvatars, setCustomAvatars] = useState<Avatar[]>([]);
  const [voicePreferences, setVoicePreferences] = useState<Record<string, string>>({});
  const [defaultProfile, setDefaultProfile] = useState<MuseTalkAvatarProfile>('chinese');
  const [defaultAvatarId, setDefaultAvatarId] = useState('');
  const [availableAvatarIds, setAvailableAvatarIds] = useState<Set<string>>(new Set());
  const [catalogError, setCatalogError] = useState('');
  const [preferredAvatarId, setPreferredAvatarId] = useState('');

  const avatars = useMemo(() => [
      ...catalogAvatars,
      ...customAvatars.filter((custom) => !catalogAvatars.some((avatar) => avatar.id === custom.id)),
    ].map((avatar) => voicePreferences[avatar.id] ? { ...avatar, voice: voicePreferences[avatar.id] } : avatar),
  [catalogAvatars, customAvatars, voicePreferences]);

  const enterAvatar = useCallback((avatar: Avatar) => {
    try {
      localStorage.setItem(ACTIVE_AVATAR_STORAGE_KEY, avatar.id);
    } catch {
      // The current selection still works when browser storage is unavailable.
    }
    setPreferredAvatarId(avatar.id);
    setSelected(avatar);
  }, []);

  useEffect(() => {
    const refreshCustomAvatars = () => {
      setCustomAvatars(readCustomAvatars());
      setVoicePreferences(readAvatarVoicePreferences());
      try {
        setPreferredAvatarId(localStorage.getItem(ACTIVE_AVATAR_STORAGE_KEY) || '');
      } catch {
        setPreferredAvatarId('');
      }
    };
    const syncCustomAvatars = (event: StorageEvent) => {
      if (event.key === CUSTOM_AVATAR_STORAGE_KEY
        || event.key === AVATAR_VOICE_STORAGE_KEY
        || event.key === ACTIVE_AVATAR_STORAGE_KEY) refreshCustomAvatars();
    };
    requestedAvatarIdRef.current = new URLSearchParams(window.location.search).get('avatar')?.trim() || '';
    refreshCustomAvatars();
    window.addEventListener('storage', syncCustomAvatars);
    window.addEventListener('focus', refreshCustomAvatars);
    return () => {
      window.removeEventListener('storage', syncCustomAvatars);
      window.removeEventListener('focus', refreshCustomAvatars);
    };
  }, []);

  useEffect(() => {
    const requestedAvatarId = requestedAvatarIdRef.current;
    if (!requestedAvatarId || selected || !availableAvatarIds.size) return;
    const avatar = avatars.find((item) => item.id === requestedAvatarId);
    if (!avatar || !isInteractiveAvatar(avatar, availableAvatarIds)) return;
    requestedAvatarIdRef.current = '';
    enterAvatar(avatar);
    const url = new URL(window.location.href);
    url.searchParams.delete('avatar');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [availableAvatarIds, avatars, enterAvatar, selected]);

  useEffect(() => {
    let active = true;
    void fetchMuseTalkAvatarCatalog()
      .then((catalog) => {
        if (!active) return;
        // Keep the curated page order stable; availability is handled by the
        // profiles explicitly enabled for real-time conversation above.
        setCatalogAvatars(DEFAULT_AVATARS);
        setDefaultProfile(catalog.default);
        setDefaultAvatarId(catalog.defaultAvatarId);
        setAvailableAvatarIds(new Set(catalog.availableAvatarIds));
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

  const interactive = (avatar: Avatar) => isInteractiveAvatar(avatar, availableAvatarIds);
  const featuredAvatar = avatars.find((avatar) => interactive(avatar) && avatar.id === preferredAvatarId)
    || avatars.find((avatar) => interactive(avatar) && avatar.id === defaultAvatarId)
    || avatars.find((avatar) => interactive(avatar) && avatar.profile === defaultProfile)
    || avatars.find(interactive);
  const interactiveAvatarCount = avatars.filter(interactive).length;

  return (
    <ProductShell>
      <main className="consoleMain chatCatalogPage">
        <section className="catalogHero">
          <div className="heroCopy">
            <h1>来和你的数字人聊聊吧</h1>
            <p>选择数字人形象，即刻体验低延迟、可打断的自然对话。适用于客户接待、产品咨询与品牌服务。</p>
            <div className="catalogHeroActions">
              <button className="primaryAction" type="button" onClick={() => featuredAvatar && enterAvatar(featuredAvatar)} disabled={!featuredAvatar}><Sparkles size={17} />立即开始</button>
              {featuredAvatar && <Link className="secondaryAction" href={avatarDesignHref(featuredAvatar)}><Settings2 size={16} />配置形象</Link>}
            </div>
          </div>
          <div className="heroShowcase" aria-hidden="true">
            <div className="heroOrb one" />
            <div className="heroOrb two" />
            {featuredAvatar && <div className="heroPortrait"><img src={featuredAvatar.image} alt="" /></div>}
            {featuredAvatar && <div className="heroFloatingCard"><span><i />{catalogError ? '服务未连接' : '在线'}</span><strong>{featuredAvatar.name}<em>{featuredAvatar.custom ? '自定义' : '内置'}</em></strong><small>{featuredAvatar.role}</small></div>}
          </div>
        </section>

        <section className="avatarCatalog">
          <header className="catalogHeader">
            <div><h2>选择数字人</h2><p>可用形象支持实时对话，其他形象仅供展示</p></div>
            <div className="catalogTabs"><button className="active" type="button">全部形象</button><span>{interactiveAvatarCount} 个可用 · {avatars.length} 个形象</span></div>
          </header>
          {catalogError && <div className="inlineError">{catalogError}，当前显示内置目录，请确认 server_total 或本地 MuseTalk :8031 已启动。</div>}
          <div className="avatarCatalogGrid">
            <Link className="createAvatarCard" href="/design">
              <span className="createAvatarIcon"><ImagePlus size={27} /></span>
              <span><strong>创建自己的数字人</strong><small>上传图片或通过对话修改形象</small></span>
            </Link>
            {avatars.map((avatar) => {
              const avatarIsInteractive = interactive(avatar);
              const availability = avatar.pendingVideo?.status === 'review'
                ? '动态视频待确认'
                : avatar.pendingVideo && ['submitted', 'processing', 'finalizing'].includes(avatar.pendingVideo.status)
                  ? '动态视频生成中'
                  : avatar.pendingVideo?.status === 'failed'
                    ? '动态视频生成失败'
                    : '暂不可用';
              return (
              <div className="avatarProductCardWrap" key={avatar.id}>
                <button className="avatarProductCard" type="button" onClick={() => avatarIsInteractive && enterAvatar(avatar)} disabled={!avatarIsInteractive}>
                  <span className="avatarProductMedia">
                    <AvatarMedia avatar={avatar} />
                    <span className={`avatarIdentityBadge ${avatar.custom ? 'custom' : 'builtIn'}`}>{avatar.custom ? '自定义' : '内置'}</span>
                    {avatar.id === preferredAvatarId && avatarIsInteractive && <span className="avatarRecentBadge">最近使用</span>}
                    {!avatarIsInteractive && <span className="avatarAvailabilityBadge">{availability}</span>}
                  </span>
                  <span className="avatarProductInfo">
                    <span><strong>{avatar.name}</strong><small>{avatar.custom ? `专属形象 · ${avatar.description || avatar.role}` : avatar.description || avatar.role}</small></span>
                  </span>
                </button>
                {(avatarIsInteractive || avatar.custom) && <Link className="avatarConfigLink" href={avatarDesignHref(avatar)} aria-label={`配置${avatar.name}`}><Settings2 size={13} /><span>配置</span></Link>}
              </div>
              );
            })}
          </div>
        </section>
      </main>
    </ProductShell>
  );
}
