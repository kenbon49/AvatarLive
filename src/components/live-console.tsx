'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Film,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Mic,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Upload,
  UserRound,
  Video,
  Volume2,
} from 'lucide-react';
import {
  api,
  FLASHHEAD_URL,
  getFlashHeadActions,
  getFlashHeadAvatars,
  getLiveActTaskStatus,
  getMuseTalkActions,
  getMuseTalkAvatars,
  getMuseTalkHealth,
  interruptFlashHead,
  interruptMuseTalk,
  LIVETALKING_URL,
  LIVEACT_DEMO_URL,
  liveactStreamUrl,
  MUSETALK_URL,
  offerFlashHead,
  offerLiveTalking,
  offerMuseTalk,
  pingFlashHead,
  pingLiveActDemo,
  pingLiveTalking,
  PIXELSTREAMING_URL,
  RENDERER_BACKEND,
  setFlashHeadAvatar,
  setMuseTalkAvatar,
  speakFlashHead,
  speakMuseTalk,
  startLiveAct,
  triggerFlashHeadAction,
  triggerMuseTalkAction,
  type AnswerResult,
  type FlashHeadActionState,
  type FlashHeadAvatarState,
  type LiveActTaskStatus,
  type MuseTalkActionState,
  type MuseTalkAvatarState,
  type MuseTalkHealth,
  type ReadyInfo,
  type SessionInfo,
  type VoiceItem,
} from '@/lib/api';
import { MuseTalkMicrophoneStream } from '@/lib/musetalk-microphone';
import { MuseTalkTotalStream, pingMuseTalkTotal } from '@/lib/musetalk-total-stream';

type AvatarState = 'idle' | 'connecting' | 'connected' | 'failed';
type RenderMode = 'flashhead' | 'musetalk' | 'liveact' | 'fallback';
const MUSETALK_ONLY = true;

interface QaItem {
  question: string;
  answer: string;
  llmMs: number;
  model: string;
}

function StatusLight({
  label,
  ok,
  warn,
  hint,
  onClick,
  active,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const cls = warn ? 'liveLight warn' : ok ? 'liveLight ok' : 'liveLight off';
  const content = (
    <>
      <i />
      {label}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`${cls} action`}
        title={hint}
        aria-pressed={active}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={cls} title={hint}>
      {content}
    </span>
  );
}

// aiortc（LiveTalking 侧）不支持 trickle ICE，offer SDP 必须带全候选才能让其对端连通。
// 等 ICE 收集完成，最多等 timeoutMs（无 STUN 时仅 host 候选，通常瞬时完成）。仅 livetalking 后端用。
function waitIceGather(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, timeoutMs);
  });
}

// 当前是否走 UE5 Pixel Streaming（3D）。false = 旧 LiveTalking 2D 降级路径。
const IS_UNREAL = RENDERER_BACKEND !== 'livetalking';

// LiveAct 预置参考形象（拷自 SoulX-LiveAct examples/image，picker 直接 fetch 成 File 上传）。
const LIVEACT_AVATARS = [
  { id: '1', label: '形象 1', src: '/assets/liveact-avatars/1.png' },
  { id: '2', label: '形象 2', src: '/assets/liveact-avatars/2.png' },
  { id: '3', label: '形象 3', src: '/assets/liveact-avatars/3.png' },
  { id: '4', label: '形象 4', src: '/assets/liveact-avatars/4.png' },
] as const;

// LiveAct 默认生成 prompt（T5 文本条件，引导生成风格）。warmup 也用类似句子。
const LIVEACT_DEFAULT_PROMPT = '一个人在自然地说话';

// PixelStreaming 实例类型用 any 兜底（库类型随 UE 版本变，POC 阶段以运行时验证为准）。
type PixelStreamingInstance = {
  videoElementParent?: HTMLElement;
  disconnect?: () => void;
  // 经 Pixel Streaming datachannel 把 descriptor 发给 UE（蓝图 OnPixelStreamingInputEvent 接收）
  emitUIInteraction?: (descriptor: object | string) => void;
  addEventListener: (type: string, listener: (data?: unknown) => void) => void;
};

export function LiveConsole() {
  const [ready, setReady] = useState<ReadyInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);

  // 数字人画面连接
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [avatarErr, setAvatarErr] = useState('');

  // SSR/首帧一致：window.location 派生的 URL(信令地址)只在客户端 mount 后渲染，
  // 否则 server=localhost / client=局域网IP 文本不一致 → hydration 失败 → 整页按钮点不动。
  const [mounted, setMounted] = useState(false);
  const [rendererReachable, setRendererReachable] = useState<boolean | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const psRef = useRef<PixelStreamingInstance | null>(null);
  const psHostRef = useRef<HTMLDivElement | null>(null);
  const transportGenerationRef = useRef(0);

  // 播报（让数字人开口）
  const [broadcastText, setBroadcastText] = useState('欢迎来到直播间，今天为大家介绍我们的新品。');
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastInfo, setBroadcastInfo] = useState('');
  const [broadcastErr, setBroadcastErr] = useState('');

  // 问答（LLM → 数字人开口）
  const [question, setQuestion] = useState('这款产品支持七天无理由退货吗？');
  const [qaBusy, setQaBusy] = useState(false);
  const [qaResult, setQaResult] = useState<AnswerResult | null>(null);
  const [qaErr, setQaErr] = useState('');
  const [qaDriveInfo, setQaDriveInfo] = useState('');
  const [history, setHistory] = useState<QaItem[]>([]);

  // 当前部署只启用 MuseTalk，避免探测尚未部署的 FlashHead :8030。
  const [mode, setMode] = useState<RenderMode>('musetalk');
  const modeRef = useRef<RenderMode>('musetalk');
  const interactionGenerationRef = useRef(0);
  const flashHeadProbeGenerationRef = useRef(0);
  const [flashHeadUp, setFlashHeadUp] = useState<boolean | null>(null);
  const [flashHeadAvatarState, setFlashHeadAvatarState] =
    useState<FlashHeadAvatarState | null>(null);
  const [flashHeadAvatarLoading, setFlashHeadAvatarLoading] = useState(false);
  const [flashHeadAvatarPendingId, setFlashHeadAvatarPendingId] = useState<string | null>(null);
  const [flashHeadAvatarErr, setFlashHeadAvatarErr] = useState('');
  const flashHeadAvatarGenerationRef = useRef(0);
  const flashHeadAvatarSwitching =
    flashHeadAvatarPendingId !== null || !!flashHeadAvatarState?.switching;
  const [flashHeadActionState, setFlashHeadActionState] =
    useState<FlashHeadActionState | null>(null);
  const [flashHeadAction, setFlashHeadAction] = useState('auto');
  const [flashHeadActionBusy, setFlashHeadActionBusy] = useState(false);
  const [flashHeadActionErr, setFlashHeadActionErr] = useState('');
  const flashHeadActionGenerationRef = useRef(0);

  // —— MuseTalk 1.5：保留真人动作帧，只重建嘴部/下半脸 ——
  const [museTalkUp, setMuseTalkUp] = useState<boolean | null>(null);
  const [museTalkHealth, setMuseTalkHealth] = useState<MuseTalkHealth | null>(null);
  const museTalkProbeGenerationRef = useRef(0);
  const [museTalkAvatarState, setMuseTalkAvatarState] =
    useState<MuseTalkAvatarState | null>(null);
  const [museTalkAvatarLoading, setMuseTalkAvatarLoading] = useState(false);
  const [museTalkAvatarPendingId, setMuseTalkAvatarPendingId] = useState<string | null>(null);
  const [museTalkAvatarErr, setMuseTalkAvatarErr] = useState('');
  const museTalkAvatarGenerationRef = useRef(0);
  const museTalkAvatarSwitching =
    museTalkAvatarPendingId !== null || !!museTalkAvatarState?.switching;
  const [museTalkActionState, setMuseTalkActionState] =
    useState<MuseTalkActionState | null>(null);
  const [museTalkAction, setMuseTalkAction] = useState('auto');
  const [museTalkActionBusy, setMuseTalkActionBusy] = useState(false);
  const [museTalkActionErr, setMuseTalkActionErr] = useState('');
  const museTalkActionGenerationRef = useRef(0);
  const [museTalkMicState, setMuseTalkMicState] = useState<
    'idle' | 'connecting' | 'recording' | 'submitting'
  >('idle');
  const museTalkMicrophoneRef = useRef<MuseTalkMicrophoneStream | null>(null);
  const museTalkTotalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const museTalkTotalRef = useRef<MuseTalkTotalStream | null>(null);
  const museTalkAskQuestionRef = useRef('');
  const museTalkTextTargetRef = useRef<'qa' | 'none'>('none');
  const [museTalkMediaSource, setMuseTalkMediaSource] = useState<'webrtc' | 'total' | null>(null);
  const [museTalkTotalStage, setMuseTalkTotalStage] = useState('idle');
  const [museTalkTotalUp, setMuseTalkTotalUp] = useState<boolean | null>(null);

  // —— LiveAct 生成式数字人 ——
  const [laText, setLaText] = useState('大家好，今天为大家介绍我们的新品。');
  const [laAvatarId, setLaAvatarId] = useState<string>('1'); // 选中的预置形象；'' = 用上传
  const [laUploadFile, setLaUploadFile] = useState<File | null>(null); // 上传的形象（选中时优先）
  const [laVoice, setLaVoice] = useState<string>(''); // '' = 用后端默认音色
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [laBusy, setLaBusy] = useState(false);
  const [laStatus, setLaStatus] = useState<LiveActTaskStatus | null>(null);
  const [laTaskId, setLaTaskId] = useState<string | null>(null);
  const [laPlaying, setLaPlaying] = useState(false);
  const [laErr, setLaErr] = useState('');
  const [laDemoUp, setLaDemoUp] = useState<boolean | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const laFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadReady = useCallback(async () => {
    try {
      setReady(await api.ready());
    } catch {
      setReady(null);
    }
  }, []);

  const checkMuseTalkTotal = useCallback(async () => {
    const up = await pingMuseTalkTotal();
    setMuseTalkTotalUp(up);
    return up;
  }, []);

  const checkFlashHead = useCallback(async () => {
    const generation = ++flashHeadProbeGenerationRef.current;
    const up = await pingFlashHead();
    if (flashHeadProbeGenerationRef.current !== generation) return up;
    setFlashHeadUp(up);
    if (up) {
      setAvatarErr((current) =>
        current.startsWith('FlashHead 服务不可达') ? '' : current,
      );
    }
    return up;
  }, []);

  const loadFlashHeadAvatarState = useCallback(
    async (generation: number, showLoading = true) => {
      if (showLoading) setFlashHeadAvatarLoading(true);
      try {
        const nextState = await getFlashHeadAvatars();
        if (flashHeadAvatarGenerationRef.current !== generation) return;
        setFlashHeadAvatarState(nextState);
        setFlashHeadAvatarErr('');
        if (!nextState.switching) setFlashHeadAvatarPendingId(null);
      } catch (e) {
        if (flashHeadAvatarGenerationRef.current !== generation) return;
        setFlashHeadAvatarErr(`无法读取人物列表：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (showLoading && flashHeadAvatarGenerationRef.current === generation) {
          setFlashHeadAvatarLoading(false);
        }
      }
    },
    [],
  );

  const loadFlashHeadActionState = useCallback(async () => {
    const generation = ++flashHeadActionGenerationRef.current;
    try {
      const nextState = await getFlashHeadActions();
      if (flashHeadActionGenerationRef.current !== generation) return;
      setFlashHeadActionState(nextState);
      setFlashHeadActionErr('');
      setFlashHeadAction((current) =>
        nextState.actions.some((action) => action.id === current) ? current : 'auto',
      );
    } catch (e) {
      if (flashHeadActionGenerationRef.current !== generation) return;
      setFlashHeadActionState(null);
      setFlashHeadActionErr(`无法读取动作列表：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const checkMuseTalk = useCallback(async () => {
    const generation = ++museTalkProbeGenerationRef.current;
    try {
      const health = await getMuseTalkHealth();
      if (museTalkProbeGenerationRef.current !== generation) return health.ready;
      setMuseTalkHealth(health);
      setMuseTalkUp(health.ready);
      if (health.ready) {
        setAvatarErr((current) =>
          current.startsWith('MuseTalk 服务') ? '' : current,
        );
      }
      return health.ready;
    } catch {
      if (museTalkProbeGenerationRef.current === generation) {
        setMuseTalkHealth(null);
        setMuseTalkUp(false);
      }
      return false;
    }
  }, []);

  const loadMuseTalkAvatarState = useCallback(
    async (generation: number, showLoading = true) => {
      if (showLoading) setMuseTalkAvatarLoading(true);
      try {
        const nextState = await getMuseTalkAvatars();
        if (museTalkAvatarGenerationRef.current !== generation) return;
        setMuseTalkAvatarState(nextState);
        setMuseTalkAvatarErr(
          nextState.avatar_error
            ? `人物服务错误：${nextState.avatar_error}`
            : nextState.avatar_config_error
              ? `人物配置错误：${nextState.avatar_config_error}`
              : '',
        );
        if (!nextState.switching) setMuseTalkAvatarPendingId(null);
      } catch (e) {
        if (museTalkAvatarGenerationRef.current !== generation) return;
        setMuseTalkAvatarErr(
          `无法读取 MuseTalk 人物列表：${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        if (showLoading && museTalkAvatarGenerationRef.current === generation) {
          setMuseTalkAvatarLoading(false);
        }
      }
    },
    [],
  );

  const loadMuseTalkActionState = useCallback(async () => {
    const generation = ++museTalkActionGenerationRef.current;
    try {
      const nextState = await getMuseTalkActions();
      if (museTalkActionGenerationRef.current !== generation) return;
      setMuseTalkActionState(nextState);
      setMuseTalkActionErr('');
      setMuseTalkAction((current) => {
        if (nextState.actions.some((action) => action.id === current)) return current;
        return nextState.actions.find((action) => action.id === 'auto')?.id ??
          nextState.actions.find((action) => action.id !== 'idle')?.id ??
          'auto';
      });
    } catch (e) {
      if (museTalkActionGenerationRef.current !== generation) return;
      setMuseTalkActionState(null);
      setMuseTalkActionErr(`无法读取动作列表：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const checkLiveAct = useCallback(async () => {
    const up = await pingLiveActDemo();
    setLaDemoUp(up);
    if (up) {
      setLaErr((current) => (current.startsWith('LiveAct demo 不可达') ? '' : current));
    }
    return up;
  }, []);

  const ensureSession = useCallback(async () => {
    try {
      setSession(await api.createSession({ title: '前端中控测试' }));
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadReady();
    ensureSession();
    if (!MUSETALK_ONLY) {
      // 其他渲染器恢复启用时再探测，MuseTalk-only 部署不产生无效端口请求。
      if (!IS_UNREAL) pingLiveTalking().then(setRendererReachable);
      void checkFlashHead();
      void checkMuseTalk();
      void checkLiveAct();
    }
    void checkMuseTalkTotal();
    return () => {
      interactionGenerationRef.current += 1;
      transportGenerationRef.current += 1;
      flashHeadProbeGenerationRef.current += 1;
      flashHeadAvatarGenerationRef.current += 1;
      flashHeadActionGenerationRef.current += 1;
      museTalkProbeGenerationRef.current += 1;
      museTalkAvatarGenerationRef.current += 1;
      museTalkActionGenerationRef.current += 1;
      if (!MUSETALK_ONLY && modeRef.current === 'flashhead') void interruptFlashHead();
      if (!MUSETALK_ONLY && modeRef.current === 'musetalk') void interruptMuseTalk();
      void museTalkMicrophoneRef.current?.cancel();
      museTalkMicrophoneRef.current = null;
      void museTalkTotalRef.current?.stopLive();
      museTalkTotalRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      psRef.current?.disconnect?.();
      psRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [loadReady, ensureSession, checkFlashHead, checkMuseTalk, checkMuseTalkTotal, checkLiveAct]);

  // FlashHead 模型启动后才监听 :8030；实时模式持续探测，服务就绪后自动解锁连接。
  useEffect(() => {
    if (mode !== 'flashhead') return;
    void checkFlashHead();
    const timer = window.setInterval(() => void checkFlashHead(), 5000);
    return () => window.clearInterval(timer);
  }, [mode, checkFlashHead]);

  // 人物列表与媒体连接相互独立；切换人物只更新服务端当前形象，不重建 WebRTC。
  useEffect(() => {
    if (mode !== 'flashhead' || flashHeadUp !== true) return;
    const generation = ++flashHeadAvatarGenerationRef.current;
    void loadFlashHeadAvatarState(generation);
    return () => {
      if (flashHeadAvatarGenerationRef.current === generation) {
        flashHeadAvatarGenerationRef.current += 1;
      }
    };
  }, [mode, flashHeadUp, loadFlashHeadAvatarState]);

  useEffect(() => {
    if (mode !== 'flashhead' || flashHeadUp !== true) return;
    void loadFlashHeadActionState();
    return () => {
      flashHeadActionGenerationRef.current += 1;
    };
  }, [mode, flashHeadUp, flashHeadAvatarState?.active_avatar, loadFlashHeadActionState]);

  useEffect(() => {
    if (mode !== 'musetalk') return;
    if (!MUSETALK_ONLY) void checkMuseTalk();
    void checkMuseTalkTotal();
    const timer = window.setInterval(() => {
      if (!MUSETALK_ONLY) void checkMuseTalk();
      void checkMuseTalkTotal();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [mode, checkMuseTalk, checkMuseTalkTotal]);

  useEffect(() => {
    if (mode !== 'musetalk') return;
    const generation = ++museTalkAvatarGenerationRef.current;
    void loadMuseTalkAvatarState(generation);
    return () => {
      if (museTalkAvatarGenerationRef.current === generation) {
        museTalkAvatarGenerationRef.current += 1;
      }
    };
  }, [mode, museTalkUp, loadMuseTalkAvatarState]);

  useEffect(() => {
    if (mode !== 'musetalk' || museTalkUp !== true) return;
    void loadMuseTalkActionState();
    return () => {
      museTalkActionGenerationRef.current += 1;
    };
  }, [mode, museTalkUp, museTalkAvatarState?.active_avatar, loadMuseTalkActionState]);

  useEffect(() => {
    if (mode !== 'musetalk' || !museTalkAvatarState?.switching) return;
    const generation = museTalkAvatarGenerationRef.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const nextState = await getMuseTalkAvatars();
        if (stopped || museTalkAvatarGenerationRef.current !== generation) return;
        setMuseTalkAvatarState(nextState);
        setMuseTalkAvatarErr(
          nextState.avatar_error
            ? `人物服务错误：${nextState.avatar_error}`
            : nextState.avatar_config_error
              ? `人物配置错误：${nextState.avatar_config_error}`
              : '',
        );
        if (!nextState.switching) {
          setMuseTalkAvatarPendingId(null);
          void loadMuseTalkActionState();
          return;
        }
      } catch (e) {
        if (stopped || museTalkAvatarGenerationRef.current !== generation) return;
        setMuseTalkAvatarErr(
          `人物切换状态同步失败，正在重试：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      timer = setTimeout(() => void poll(), 1200);
    };

    timer = setTimeout(() => void poll(), 800);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [mode, museTalkAvatarState?.switching, loadMuseTalkActionState]);

  // 后端允许异步换人；switching=true 时轻量轮询，直到新人物真正可用。
  useEffect(() => {
    if (mode !== 'flashhead' || !flashHeadAvatarState?.switching) return;
    const generation = flashHeadAvatarGenerationRef.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const nextState = await getFlashHeadAvatars();
        if (stopped || flashHeadAvatarGenerationRef.current !== generation) return;
        setFlashHeadAvatarState(nextState);
        setFlashHeadAvatarErr('');
        if (!nextState.switching) {
          setFlashHeadAvatarPendingId(null);
          return;
        }
      } catch (e) {
        if (stopped || flashHeadAvatarGenerationRef.current !== generation) return;
        setFlashHeadAvatarErr(`人物切换状态同步失败，正在重试：${e instanceof Error ? e.message : String(e)}`);
      }
      timer = setTimeout(() => void poll(), 1200);
    };

    timer = setTimeout(() => void poll(), 800);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [mode, flashHeadAvatarState?.switching]);

  // LiveAct 加载模型和 warmup 期间端口不会监听。进入该模式后持续探测，
  // 服务一旦就绪便自动解锁生成按钮，无需刷新页面或来回切换模式。
  useEffect(() => {
    if (mode !== 'liveact') return;
    void checkLiveAct();
    const timer = window.setInterval(() => void checkLiveAct(), 5000);
    return () => window.clearInterval(timer);
  }, [mode, checkLiveAct]);

  // —— UE5 Pixel Streaming 连接（默认，3D）——
  // 库依赖 window/WebSocket，动态 import 规避 Next.js SSR 求值。
  const connectPixelStreaming = async (generation: number) => {
    const { PixelStreaming, Config } = await import(
      '@epicgames-ps/lib-pixelstreamingfrontend-ue5.5'
    );
    if (transportGenerationRef.current !== generation) return;
    psRef.current?.disconnect?.();

    const config = new Config({
      initialSettings: {
        AutoConnect: true,
        AutoPlayVideo: true,
        StartVideoMuted: false,
        UseMic: false,
        MatchViewportRes: true,
        ss: PIXELSTREAMING_URL, // TextParameters.SignallingServerUrl = 'ss'（库未导出常量，用字面量）
      },
    });
    // PixelStreaming 构造直接传 config（非 {config}）；videoElementParent 让库把 <video> 挂进我们的容器
    const ps = new PixelStreaming(config, {
      videoElementParent: psHostRef.current ?? undefined,
    }) as unknown as PixelStreamingInstance;
    psRef.current = ps;

    const setStateIfCurrent = (state: AvatarState) => {
      if (transportGenerationRef.current === generation) setAvatarState(state);
    };
    ps.addEventListener('videoInitialized', () => setStateIfCurrent('connected'));
    ps.addEventListener('webRtcConnected', () => setStateIfCurrent('connected'));
    ps.addEventListener('webRtcDisconnected', () => setStateIfCurrent('failed'));
    ps.addEventListener('webRtcFailed', () => setStateIfCurrent('failed'));
  };

  // 三个 2D 实时服务都兼容 aiortc /offer，通过传入信令函数复用连接流程。
  const connectWebRtcRenderer = async (
    negotiate: (sdp: string, type: string) => Promise<{ sdp: string; type: string }>,
    generation: number,
  ) => {
    if (transportGenerationRef.current !== generation) return;
    pcRef.current?.close();
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      if (transportGenerationRef.current === generation && videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(() => {});
      }
    };

    const releaseConnection = (nextState: AvatarState, closePeer: boolean) => {
      if (transportGenerationRef.current !== generation) return;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      if (pcRef.current === pc) pcRef.current = null;
      if (videoRef.current) {
        const stream = videoRef.current.srcObject;
        if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      if (closePeer && pc.connectionState !== 'closed') pc.close();
      setAvatarState(nextState);
    };

    pc.onconnectionstatechange = () => {
      if (transportGenerationRef.current !== generation) return;
      const state = pc.connectionState;
      if (state === 'connected') setAvatarState('connected');
      else if (state === 'failed' || state === 'disconnected') releaseConnection('failed', true);
      else if (state === 'closed') releaseConnection('idle', false);
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (transportGenerationRef.current !== generation) return;
      if (s === 'connected' || s === 'completed') setAvatarState('connected');
      else if (s === 'failed' || s === 'disconnected') releaseConnection('failed', true);
      else if (s === 'closed') releaseConnection('idle', false);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGather(pc);
    if (transportGenerationRef.current !== generation) return;
    const local = pc.localDescription;
    if (!local?.sdp) throw new Error('无法生成 WebRTC offer SDP');
    const ans = await negotiate(local.sdp, local.type);
    if (transportGenerationRef.current !== generation) return;
    await pc.setRemoteDescription({ sdp: ans.sdp, type: ans.type as RTCSdpType });
  };

  const connectAvatar = async (): Promise<boolean> => {
    const requestedMode = modeRef.current;
    if (avatarState === 'connected') return true;
    if (avatarState === 'connecting' || requestedMode === 'liveact') return false;
    setAvatarState('connecting');
    setAvatarErr('');
    const generation = ++transportGenerationRef.current;
    try {
      if (requestedMode === 'flashhead') {
        if (!(await checkFlashHead())) {
          throw new Error(`FlashHead 服务不可达（${FLASHHEAD_URL}），请确认 :8030 已启动并完成预热。`);
        }
        if (
          transportGenerationRef.current !== generation ||
          modeRef.current !== requestedMode
        ) return false;
        await connectWebRtcRenderer(offerFlashHead, generation);
      } else if (requestedMode === 'musetalk') {
        if (!(await checkMuseTalk())) {
          const warming = museTalkHealth && !museTalkHealth.ready;
          throw new Error(
            warming
              ? 'MuseTalk 服务仍在预处理动作素材，请稍后重试。'
              : `MuseTalk 服务不可达（${MUSETALK_URL}），请确认 :8031 已启动并完成预热。`,
          );
        }
        if (
          transportGenerationRef.current !== generation ||
          modeRef.current !== requestedMode
        ) return false;
        await connectWebRtcRenderer(offerMuseTalk, generation);
      } else if (IS_UNREAL) {
        await connectPixelStreaming(generation);
      } else {
        await connectWebRtcRenderer(offerLiveTalking, generation);
      }
      return (
        transportGenerationRef.current === generation &&
        modeRef.current === requestedMode
      );
    } catch (e) {
      if (transportGenerationRef.current === generation) {
        setAvatarState('failed');
        setAvatarErr(e instanceof Error ? e.message : String(e));
      }
      return false;
    }
  };

  // 经 Pixel Streaming datachannel 把音频/文本发给 UE（蓝图 OnPixelStreamingInputEvent）
  // verbatim：优先发 Azure 合成的音频（{type:'SayAudio', audio, text}）；无音频时兜底发文本
  const driveAvatar = (text: string, audio?: string) => {
    if (!IS_UNREAL) return;
    psRef.current?.emitUIInteraction?.(
      audio ? { type: 'SayAudio', audio, text } : { type: 'SayText', text },
    );
  };

  const retryFlashHeadAvatars = () => {
    if (modeRef.current !== 'flashhead' || flashHeadAvatarSwitching) return;
    const generation = ++flashHeadAvatarGenerationRef.current;
    void loadFlashHeadAvatarState(generation);
  };

  const chooseFlashHeadAvatar = async (avatarId: string) => {
    if (
      modeRef.current !== 'flashhead' ||
      flashHeadAvatarLoading ||
      flashHeadAvatarSwitching ||
      flashHeadActionBusy ||
      broadcastBusy ||
      qaBusy ||
      flashHeadAvatarState?.active_avatar === avatarId
    ) {
      return;
    }

    interactionGenerationRef.current += 1;
    const generation = flashHeadAvatarGenerationRef.current;
    setFlashHeadAvatarPendingId(avatarId);
    setFlashHeadAvatarErr('');
    try {
      const nextState = await setFlashHeadAvatar(avatarId);
      if (flashHeadAvatarGenerationRef.current !== generation) return;
      setFlashHeadAvatarState(nextState);
      if (!nextState.switching) setFlashHeadAvatarPendingId(null);
    } catch (e) {
      if (flashHeadAvatarGenerationRef.current !== generation) return;
      setFlashHeadAvatarPendingId(null);
      setFlashHeadAvatarErr(`人物切换失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const retryMuseTalkAvatars = () => {
    if (modeRef.current !== 'musetalk' || museTalkAvatarSwitching) return;
    const generation = ++museTalkAvatarGenerationRef.current;
    void loadMuseTalkAvatarState(generation);
  };

  const chooseMuseTalkAvatar = async (avatarId: string) => {
    if (
      modeRef.current !== 'musetalk' ||
      museTalkAvatarLoading ||
      museTalkAvatarSwitching ||
      museTalkActionBusy ||
      broadcastBusy ||
      qaBusy ||
      museTalkAvatarState?.active_avatar === avatarId
    ) {
      return;
    }

    interactionGenerationRef.current += 1;
    const generation = museTalkAvatarGenerationRef.current;
    setMuseTalkAvatarPendingId(avatarId);
    setMuseTalkAvatarErr('');
    try {
      const nextState = await setMuseTalkAvatar(avatarId);
      if (
        museTalkAvatarGenerationRef.current !== generation ||
        modeRef.current !== 'musetalk'
      ) return;
      setMuseTalkAvatarState(nextState);
      setMuseTalkAvatarErr(
        nextState.avatar_error
          ? `人物服务错误：${nextState.avatar_error}`
          : nextState.avatar_config_error
            ? `人物配置错误：${nextState.avatar_config_error}`
            : '',
      );
      if (!nextState.switching) {
        setMuseTalkAvatarPendingId(null);
        void loadMuseTalkActionState();
      }
    } catch (e) {
      if (
        museTalkAvatarGenerationRef.current !== generation ||
        modeRef.current !== 'musetalk'
      ) return;
      setMuseTalkAvatarPendingId(null);
      setMuseTalkAvatarErr(`人物切换失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const previewFlashHeadAction = async () => {
    if (
      modeRef.current !== 'flashhead' ||
      flashHeadActionBusy ||
      !['welcome', 'point', 'thank'].includes(flashHeadAction)
    ) return;
    setFlashHeadActionBusy(true);
    setFlashHeadActionErr('');
    try {
      const connected = await connectAvatar();
      if (!connected || modeRef.current !== 'flashhead') return;
      const nextState = await triggerFlashHeadAction(flashHeadAction);
      if (modeRef.current !== 'flashhead') return;
      setFlashHeadActionState(nextState);
    } catch (e) {
      if (modeRef.current === 'flashhead') {
        setFlashHeadActionErr(`动作预览失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (modeRef.current === 'flashhead') setFlashHeadActionBusy(false);
    }
  };

  const previewMuseTalkAction = async () => {
    if (
      modeRef.current !== 'musetalk' ||
      museTalkAvatarSwitching ||
      museTalkActionBusy ||
      !['welcome', 'point', 'thank'].includes(museTalkAction)
    ) return;
    setMuseTalkActionBusy(true);
    setMuseTalkActionErr('');
    try {
      const connected = await connectAvatar();
      if (!connected || modeRef.current !== 'musetalk') return;
      const nextState = await triggerMuseTalkAction(museTalkAction);
      if (modeRef.current !== 'musetalk') return;
      setMuseTalkActionState(nextState);
    } catch (e) {
      if (modeRef.current === 'musetalk') {
        setMuseTalkActionErr(`动作预览失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (modeRef.current === 'musetalk') setMuseTalkActionBusy(false);
    }
  };

  const stopMuseTalk = async () => {
    if (modeRef.current !== 'musetalk' || museTalkAvatarSwitching || museTalkActionBusy) return;
    const microphone = museTalkMicrophoneRef.current;
    museTalkMicrophoneRef.current = null;
    await microphone?.cancel();
    setMuseTalkMicState('idle');
    await museTalkTotalRef.current?.stopLive();
    museTalkTotalRef.current = null;
    setMuseTalkMediaSource(null);
    setMuseTalkTotalStage('idle');
    interactionGenerationRef.current += 1;
    setBroadcastBusy(false);
    setQaBusy(false);
    setMuseTalkActionBusy(true);
    setMuseTalkActionErr('');
    try {
      const stopped = await interruptMuseTalk();
      if (modeRef.current !== 'musetalk') return;
      if (!stopped) throw new Error('服务未确认中断');
      setBroadcastInfo('当前播报已停止 · 动作已回到待机');
      void loadMuseTalkActionState();
    } catch (e) {
      if (modeRef.current === 'musetalk') {
        setMuseTalkActionErr(`停止播报失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (modeRef.current === 'musetalk') setMuseTalkActionBusy(false);
    }
  };

  const toggleMuseTalkMicrophone = async () => {
    if (modeRef.current !== 'musetalk') return;
    const active = museTalkMicrophoneRef.current;
    if (active) {
      setMuseTalkMicState('submitting');
      try {
        const result = await active.stop();
        if (modeRef.current !== 'musetalk') return;
        const actionLabel = museTalkActionState?.actions.find(
          (action) => action.id === result.action,
        )?.label;
        setBroadcastInfo(
          `麦克风音频已提交 · ${result.audioSeconds.toFixed(1)} 秒${
            actionLabel ? ` · ${actionLabel}` : ''
          }`,
        );
        const generation = interactionGenerationRef.current;
        setMuseTalkMediaSource('webrtc');
        void monitorMuseTalkPlayback(Number(result.requestId), generation);
        setBroadcastErr('');
      } catch (error) {
        if (modeRef.current === 'musetalk') {
          setBroadcastErr(`麦克风提交失败：${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        if (museTalkMicrophoneRef.current === active) museTalkMicrophoneRef.current = null;
        if (modeRef.current === 'musetalk') setMuseTalkMicState('idle');
      }
      return;
    }

    setMuseTalkMicState('connecting');
    setBroadcastErr('');
    setBroadcastInfo('正在连接 MuseTalk 音频流并申请麦克风权限…');
    try {
      const connected = await connectAvatar();
      if (!connected || modeRef.current !== 'musetalk') throw new Error('WebRTC 画面尚未连接');
      const stream = new MuseTalkMicrophoneStream();
      museTalkMicrophoneRef.current = stream;
      await stream.start(museTalkAction);
      if (modeRef.current !== 'musetalk' || museTalkMicrophoneRef.current !== stream) {
        await stream.cancel();
        return;
      }
      setMuseTalkMicState('recording');
      setBroadcastInfo('正在采集麦克风 · 再次点击后提交并驱动实时画面');
    } catch (error) {
      const stream = museTalkMicrophoneRef.current;
      museTalkMicrophoneRef.current = null;
      await stream?.cancel();
      if (modeRef.current === 'musetalk') {
        setMuseTalkMicState('idle');
        setBroadcastInfo('');
        setBroadcastErr(`麦克风启动失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const interactionIsCurrent = (generation: number, expectedMode: RenderMode) =>
    interactionGenerationRef.current === generation && modeRef.current === expectedMode;

  const createMuseTalkTotal = (canvas: HTMLCanvasElement) => new MuseTalkTotalStream(canvas, {
    profile: 'chinese',
    language: 'ZH',
    onMediaActive: (active) => {
      if (modeRef.current === 'musetalk') setMuseTalkMediaSource(active ? 'total' : null);
    },
    onStage: (stage) => {
      if (modeRef.current === 'musetalk') setMuseTalkTotalStage(stage);
    },
    onTextUnit: (_unit, text) => {
      if (modeRef.current !== 'musetalk' || museTalkTextTargetRef.current !== 'qa') return;
      const currentQuestion = museTalkAskQuestionRef.current;
      setQaResult((current) => ({
        session_id: current?.session_id || session?.id || 'server-total',
        question: currentQuestion,
        answer: text,
        model_id: current?.model_id || 'server_total/LiteLLM',
        llm_latency_ms: current?.llm_latency_ms || 0,
        livetalking: null,
      }));
    },
  });

  const monitorMuseTalkPlayback = async (requestId: number, generation: number) => {
    let observed = false;
    for (let attempt = 0; attempt < 2400; attempt += 1) {
      if (!interactionIsCurrent(generation, 'musetalk')) return;
      try {
        const health = await getMuseTalkHealth();
        const timingId = Number(health.last_timing?.request_id || 0);
        const timingState = String(health.last_timing?.state || '');
        if (health.active_id === requestId || timingId === requestId) observed = true;
        if (
          timingId === requestId &&
          ['completed', 'failed', 'interrupted'].includes(timingState)
        ) break;
        if (observed && health.active_id !== requestId && health.queued === 0) break;
      } catch {
        // A transient health failure should not hide a stream that is already playing.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (
      interactionIsCurrent(generation, 'musetalk') &&
      museTalkMediaSource !== 'total'
    ) {
      setMuseTalkMediaSource(null);
    }
  };

  const doBroadcast = async () => {
    const operationMode = modeRef.current;
    if (
      operationMode === 'liveact' ||
      (operationMode === 'flashhead' && flashHeadAvatarSwitching) ||
      (operationMode === 'flashhead' && flashHeadActionBusy) ||
      (operationMode === 'musetalk' && (museTalkAvatarSwitching || museTalkActionBusy)) ||
      (operationMode === 'musetalk' && museTalkMicState !== 'idle') ||
      (!session && operationMode === 'fallback')
    ) return;
    const generation = ++interactionGenerationRef.current;
    setBroadcastBusy(true);
    setBroadcastErr('');
    setBroadcastInfo('');
    try {
      if (operationMode === 'flashhead') {
        // 用户直接点播报时顺带建 WebRTC，避免“未连接”造成一个额外操作步骤。
        const connected = await connectAvatar();
        if (!interactionIsCurrent(generation, operationMode) || !connected) return;
        const result = await speakFlashHead(broadcastText, true, flashHeadAction);
        if (!interactionIsCurrent(generation, operationMode)) return;
        const actionLabel = flashHeadActionState?.actions.find(
          (action) => action.id === result.action,
        )?.label;
        setBroadcastInfo(
          `已发送给 FlashHead · ${result.latencyMs}ms${actionLabel ? ` · ${actionLabel}` : ''}`,
        );
        return;
      }

      if (operationMode === 'musetalk') {
        const canvas = museTalkTotalCanvasRef.current;
        if (!canvas) throw new Error('MuseTalk 流式画布尚未就绪');
        let total = museTalkTotalRef.current;
        if (!total) {
          total = createMuseTalkTotal(canvas);
          museTalkTotalRef.current = total;
        }
        await total.startLive();
        museTalkTextTargetRef.current = 'none';
        const result = await total.speak(broadcastText);
        if (!interactionIsCurrent(generation, operationMode)) return;
        setBroadcastInfo(`已发送给 MuseTalk 流式服务 · ${result.totalLatencyMs}ms`);
        return;
      }

      if (!session) return;
      const r = await api.say(session.id, { text: broadcastText });
      if (!interactionIsCurrent(generation, operationMode)) return;
      const lt = r.livetalking;
      // 后端编排完成 → 前端经 datachannel 把 Azure 音频发给 UE 驱动 MetaHuman
      if (!lt.degraded) driveAvatar(broadcastText, lt.audio);
      setBroadcastInfo(
        lt.degraded ? `数字人未驱动：${lt.detail}` : `已发送给数字人 · ${lt.latency_ms}ms`,
      );
    } catch (e) {
      if (interactionIsCurrent(generation, operationMode)) {
        if (operationMode === 'musetalk' && MUSETALK_ONLY) {
          await museTalkTotalRef.current?.cancel();
        }
        setBroadcastErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (interactionIsCurrent(generation, operationMode)) setBroadcastBusy(false);
    }
  };

  const doAsk = async () => {
    const operationMode = modeRef.current;
    if (
      (!session && operationMode !== 'musetalk') ||
      (operationMode === 'flashhead' && (flashHeadAvatarSwitching || flashHeadActionBusy)) ||
      (operationMode === 'musetalk' &&
        (museTalkAvatarSwitching || museTalkActionBusy || museTalkMicState !== 'idle'))
    ) return;
    const generation = ++interactionGenerationRef.current;
    setQaBusy(true);
    setQaErr('');
    setQaDriveInfo('');
    setQaResult(null);
    try {
      let res: AnswerResult;
      if (operationMode === 'musetalk') {
        const canvas = museTalkTotalCanvasRef.current;
        if (!canvas) throw new Error('MuseTalk 流式画布尚未就绪');
        let total = museTalkTotalRef.current;
        if (!total) {
          total = createMuseTalkTotal(canvas);
          museTalkTotalRef.current = total;
        }
        await total.startLive();
        museTalkAskQuestionRef.current = question;
        museTalkTextTargetRef.current = 'qa';
        await interruptMuseTalk();
        const result = await total.ask(question);
        res = {
          session_id: session?.id || 'server-total',
          question,
          answer: result.answer,
          model_id: 'server_total/LiteLLM',
          llm_latency_ms: result.llmLatencyMs,
          livetalking: null,
        };
        setQaDriveInfo(`总流程已完成 · ${result.totalLatencyMs}ms · 流式音视频正在播放`);
      } else {
        if (!session) return;
        // 其他独立渲染模式仍由前端编排，避免同时误驱动旧 :8028。
        res = await api.answer(session.id, {
          question,
          speak: operationMode === 'fallback',
        });
      }
      if (!interactionIsCurrent(generation, operationMode)) return;
      if (operationMode === 'flashhead') {
        const connected = await connectAvatar();
        if (!interactionIsCurrent(generation, operationMode)) return;
        if (connected) {
          const result = await speakFlashHead(res.answer, true, flashHeadAction);
          if (!interactionIsCurrent(generation, operationMode)) return;
          setQaDriveInfo(`AI 回答已发送给 FlashHead · ${result.latencyMs}ms`);
        } else {
          setQaDriveInfo('AI 回答已生成；FlashHead 连接失败，暂未播报。');
        }
      } else if (operationMode === 'liveact') {
        setLaText(res.answer);
        setQaDriveInfo('AI 回答已填入左侧播报文本，确认后点击“生成高质量视频”。');
      } else if (res.livetalking && !res.livetalking.degraded) {
        // 兼容 UE 路径仍由 datachannel 注入后端返回的语音。
        driveAvatar(res.answer, res.livetalking.audio);
      }
      setQaResult((current) => {
        if (operationMode === 'musetalk') {
          return { ...res, answer: current?.answer || '' };
        }
        return res;
      });
      setHistory((h) =>
        [
          { question: res.question, answer: res.answer, llmMs: res.llm_latency_ms, model: res.model_id },
          ...h,
        ].slice(0, 20),
      );
    } catch (e) {
      if (interactionIsCurrent(generation, operationMode)) {
        if (operationMode === 'musetalk') {
          await museTalkTotalRef.current?.cancel();
        }
        setQaErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (interactionIsCurrent(generation, operationMode)) setQaBusy(false);
    }
  };

  // 切换渲染器时释放上一条媒体链路；各服务端口始终相互独立，不做替换。
  const switchMode = async (next: RenderMode) => {
    const previousMode = modeRef.current;
    if (next === previousMode) return;
    modeRef.current = next;
    interactionGenerationRef.current += 1;
    flashHeadProbeGenerationRef.current += 1;
    museTalkProbeGenerationRef.current += 1;
    if (previousMode === 'flashhead') void interruptFlashHead();
    if (previousMode === 'musetalk') void interruptMuseTalk();
    if (previousMode === 'musetalk') {
      void museTalkMicrophoneRef.current?.cancel();
      museTalkMicrophoneRef.current = null;
      void museTalkTotalRef.current?.stopLive();
      museTalkTotalRef.current = null;
      setMuseTalkMicState('idle');
      setMuseTalkMediaSource(null);
      setMuseTalkTotalStage('idle');
    }

    if (previousMode === 'liveact') {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setLaTaskId(null);
      setLaPlaying(false);
      setLaStatus(null);
    }

    transportGenerationRef.current += 1;
    flashHeadAvatarGenerationRef.current += 1;
    flashHeadActionGenerationRef.current += 1;
    museTalkAvatarGenerationRef.current += 1;
    museTalkActionGenerationRef.current += 1;
    pcRef.current?.close();
    pcRef.current = null;
    psRef.current?.disconnect?.();
    psRef.current = null;
    psHostRef.current?.replaceChildren();
    setAvatarState('idle');
    setAvatarErr('');
    setBroadcastBusy(false);
    setFlashHeadAvatarPendingId(null);
    setFlashHeadAvatarLoading(false);
    setFlashHeadAvatarErr('');
    setFlashHeadActionBusy(false);
    setFlashHeadActionErr('');
    setMuseTalkAvatarPendingId(null);
    setMuseTalkAvatarLoading(false);
    setMuseTalkAvatarErr('');
    setMuseTalkActionBusy(false);
    setMuseTalkActionErr('');
    setBroadcastErr('');
    setBroadcastInfo('');
    setQaBusy(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
    setMode(next);

    // 进入 LiveAct：懒载音色列表 + 复探 demo 可达性
    if (next === 'liveact') {
      setLaDemoUp(null);
      if (!voices.length) {
        try {
          setVoices(await api.voices('zh'));
        } catch {
          /* 音色列表非必需，用后端默认 */
        }
      }
    } else if (next === 'flashhead') {
      setFlashHeadUp(null);
      void checkFlashHead();
    } else if (next === 'musetalk') {
      setMuseTalkUp(null);
      setMuseTalkHealth(null);
      void checkMuseTalk();
    } else if (!IS_UNREAL) {
      setRendererReachable(null);
      pingLiveTalking().then(setRendererReachable);
    }
  };

  const doLiveAct = async () => {
    if (!laText.trim()) return;
    setLaBusy(true);
    setLaErr('');
    setLaStatus(null);
    setLaPlaying(false);
    // 切换到新任务前先清掉上一条的 hls
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (videoRef.current) videoRef.current.src = '';
    try {
      // 每次提交前重新确认，避免状态灯仍为旧的“在线”时先消耗一次 TTS 配额。
      if (!(await checkLiveAct())) {
        throw new Error(
          `LiveAct demo 不可达（${LIVEACT_DEMO_URL}）。页面会每 5 秒自动重试；请确认 scripts/run-liveact-demo.sh 已启动并完成预热。`,
        );
      }

      // 1) Azure TTS 合成 mp3 → File（复用后端 /api/v1/tts/synthesize，后端零改动）
      const synth = await api.synthesize({
        text: laText,
        lang: 'zh',
        voice: laVoice || (voices[0]?.id ?? ''),
      });
      const blob = await fetch(synth.url).then((r) => r.blob());
      URL.revokeObjectURL(synth.url);
      const audioFile = new File([blob], 'audio.mp3', { type: 'audio/mpeg' });

      // 2) 参考形象 → File（上传优先，否则取预置）
      let imgFile: File;
      if (laUploadFile) {
        imgFile = laUploadFile;
      } else {
        const av = LIVEACT_AVATARS.find((a) => a.id === laAvatarId) ?? LIVEACT_AVATARS[0];
        const ib = await fetch(av.src).then((r) => r.blob());
        imgFile = new File([ib], 'avatar.png', { type: ib.type || 'image/png' });
      }

      // 3) 组 FormData → POST /liveact-api/start_stream（demo.py 单任务锁，429 抛错）
      const taskId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}`;
      const form = new FormData();
      form.append('task_id', taskId);
      form.append('main_prompt', LIVEACT_DEFAULT_PROMPT);
      form.append('prompt_json', '[]');
      form.append('fps', '24');
      form.append('stream_with_audio', 'true'); // HLS 切片带音频
      form.append('img_file', imgFile);
      form.append('audio_file', audioFile);

      await startLiveAct(form); // 429 → 抛 Error('GPU 任务繁忙...')
      setLaTaskId(taskId); // 触发下方轮询 effect
    } catch (e) {
      setLaErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLaBusy(false);
    }
  };

  // 轮询 task_status + 首切片就绪即挂 hls.js（动态 import 规避 SSR）
  useEffect(() => {
    if (mode !== 'liveact' || !laTaskId) return;
    let alive = true;
    let hls: { destroy: () => void } | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const s = await getLiveActTaskStatus(laTaskId);
        if (!alive) return;
        setLaStatus(s);
        if (!s.error) {
          setLaErr((current) =>
            current.startsWith('LiveAct task_status HTTP') ? '' : current,
          );
        }

        if (s.stream_ready && !hls && videoRef.current) {
          const mod = await import('hls.js');
          if (!alive) return;
          const Hls = mod.default;
          if (Hls.isSupported()) {
            const inst = new Hls({
              liveSyncDurationCount: 1, // 滑动窗(hls_list_size=5)尽快起播
              maxBufferLength: 6,
              lowLatencyMode: false,
            });
            hls = inst as unknown as { destroy: () => void };
            hlsRef.current = hls;
            inst.loadSource(liveactStreamUrl(laTaskId));
            inst.attachMedia(videoRef.current);
            inst.on(Hls.Events.MANIFEST_PARSED, () => {
              videoRef.current?.play().catch(() => {});
              setLaPlaying(true);
            });
            // 生成结束后段不再增长，网络错误(404/EOF)是预期，忽略避免红字
            inst.on(Hls.Events.ERROR, (_evt, data) => {
              if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR && s.is_done) return;
            });
          } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari 原生 HLS
            videoRef.current.src = liveactStreamUrl(laTaskId);
            videoRef.current.play().catch(() => {});
            setLaPlaying(true);
          }
        }

        if (s.is_done || s.status === 'failed' || s.status === 'not_found') {
          if (timer) clearInterval(timer);
          if (s.error) setLaErr(s.error);
        }
      } catch (e) {
        if (alive) setLaErr(e instanceof Error ? e.message : String(e));
      }
    };

    timer = setInterval(() => void tick(), 1000);
    void tick(); // 立即首查（此时 timer 已赋值）
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [mode, laTaskId]);

  const avgLlm = useMemo(() => {
    if (!history.length) return 0;
    return Math.round(history.reduce((s, x) => s + x.llmMs, 0) / history.length);
  }, [history]);

  const avatarConnected = avatarState === 'connected';
  const avatarConnecting = avatarState === 'connecting';
  const isFlashHead = mode === 'flashhead';
  const isMuseTalk = mode === 'musetalk';
  const isLiveact = mode === 'liveact';
  const isFallback = mode === 'fallback';
  const canSpeak = isMuseTalk && MUSETALK_ONLY
    ? museTalkTotalUp === true
    : avatarConnected && (isFlashHead || isMuseTalk || !!session);
  const flashHeadActiveAvatar = flashHeadAvatarState?.avatars.find(
    (avatar) => avatar.id === flashHeadAvatarState.active_avatar,
  );
  const flashHeadPendingAvatar = flashHeadAvatarState?.avatars.find(
    (avatar) => avatar.id === flashHeadAvatarPendingId,
  );
  const flashHeadAvatarControlsDisabled =
    flashHeadAvatarLoading || flashHeadAvatarSwitching || flashHeadActionBusy || broadcastBusy || qaBusy;
  const flashHeadBodyEnabled = !!(
    flashHeadActionState?.available &&
    flashHeadAvatarState?.active_avatar === flashHeadActionState.profile_avatar
  );
  const flashHeadSpeechActions = flashHeadActionState?.actions.filter(
    (action) => action.id !== 'idle',
  ) ?? [];
  const flashHeadActionLabel = flashHeadActionState?.actions.find(
    (action) => action.id === flashHeadAction,
  )?.label;
  const museTalkActiveAvatar = museTalkAvatarState?.avatars.find(
    (avatar) => avatar.id === museTalkAvatarState.active_avatar,
  );
  const museTalkPendingAvatar = museTalkAvatarState?.avatars.find(
    (avatar) => avatar.id === museTalkAvatarPendingId,
  );
  const museTalkAvatarControlsDisabled =
    museTalkAvatarLoading ||
    museTalkAvatarSwitching ||
    museTalkActionBusy ||
    museTalkMicState !== 'idle' ||
    broadcastBusy ||
    qaBusy;
  const museTalkActionsEnabled = !!(
    museTalkActionState?.available &&
    museTalkActionState.enabled &&
    museTalkAvatarState?.active_avatar === museTalkActionState.profile_avatar
  );
  const museTalkSpeechActions = museTalkActionState?.actions.filter(
    (action) => action.id !== 'idle',
  ) ?? [];
  const museTalkActionLabel = museTalkActionState?.actions.find(
    (action) => action.id === museTalkAction,
  )?.label;
  const museTalkResolution = useMemo(() => {
    const resolution = museTalkHealth?.resolution;
    if (!resolution) return '';
    if (typeof resolution === 'string') return resolution;
    if (Array.isArray(resolution)) return resolution.join('×');
    return `${resolution.width}×${resolution.height}`;
  }, [museTalkHealth?.resolution]);
  // LiveAct 进度文案：stage · generated/total
  const laProgress = laStatus
    ? laStatus.total_chunks
      ? `${laStatus.stage} · ${laStatus.generated_chunks}/${laStatus.total_chunks}`
      : laStatus.stage
    : '';
  const laTaskActive =
    !!laTaskId &&
    !laStatus?.is_done &&
    laStatus?.status !== 'failed' &&
    laStatus?.status !== 'not_found';

  // 画面可见性：
  // - LiveAct 模式：HLS 起播后显示 <video>（hls.js 写 src），与后端类型无关
  // - FlashHead 与 MuseTalk 固定显示 WebRTC <video>
  // - 兼容模式：unreal 显示 PixelStreaming 容器，livetalking 显示 <video>
  const showPsHost = isFallback && IS_UNREAL;
  const showVideo = isLiveact
    ? laPlaying
    : isFlashHead || isMuseTalk
      ? avatarConnected
      : !IS_UNREAL && avatarConnected;
  const showMuseTalkIdle = isMuseTalk && museTalkMediaSource === null;
  const showMuseTalkTotal = isMuseTalk && museTalkMediaSource === 'total';

  return (
    <div className="liveConsole">
      {/* 状态栏 */}
      <div className="liveStatusbar">
        <div className="liveStatusLeft">
          <Radio size={18} />
          <div>
            <strong>直播中控台</strong>
            <small>
              {session ? `会话 ${session.id.slice(0, 8)}… · ${session.status}` : '正在创建会话…'}
            </small>
          </div>
        </div>
        <div className="liveLights">
          <StatusLight label="TTS 合成" ok={!!ready?.azure_configured} hint="Azure TTS（独立试听）" />
          <StatusLight
            label={`LLM ${ready?.llm_default_model_id || ''}`.trim()}
            ok={!!ready?.llm_configured}
            hint="LiteLLM 网关"
          />
          {!MUSETALK_ONLY && (
            <StatusLight
              label={isFlashHead ? 'FlashHead 实时 · 当前' : 'FlashHead 实时 · 点击进入'}
              ok={!!flashHeadUp}
              warn={flashHeadUp === null}
              active={isFlashHead}
              onClick={() => void switchMode('flashhead')}
              hint={flashHeadUp ? 'FlashHead Lite 已就绪' : `FlashHead 暂不可达 · ${FLASHHEAD_URL}`}
            />
          )}
          <StatusLight
            label={isMuseTalk ? 'MuseTalk 动作 · 当前' : 'MuseTalk 动作 · 点击进入'}
            ok={museTalkUp === true || museTalkTotalUp === true}
            warn={
              (museTalkUp === null && museTalkTotalUp === null) ||
              (!!museTalkHealth && !museTalkHealth.ready)
            }
            active={isMuseTalk}
            onClick={() => void switchMode('musetalk')}
            hint={
              museTalkTotalUp
                ? 'MuseTalk 总流程已就绪 · :8085 · 首帧待机/问答流式媒体自动切换'
                : museTalkUp
                ? mounted
                  ? `MuseTalk ${museTalkHealth?.model_version || '1.5'} 已就绪 · ${MUSETALK_URL}`
                  : 'MuseTalk 1.5 已就绪'
                : museTalkHealth
                  ? `MuseTalk 正在预热 · ${museTalkHealth.status}`
                  : museTalkUp === null
                    ? '正在探测 MuseTalk 1.5…'
                    : mounted
                      ? `MuseTalk 暂不可达 · ${MUSETALK_URL}`
                      : 'MuseTalk 暂不可达'
            }
          />
          {!MUSETALK_ONLY && (
            <StatusLight
              label={isLiveact ? 'LiveAct 生成式 · 当前' : 'LiveAct 生成式 · 点击进入'}
              ok={!!laDemoUp}
              warn={laDemoUp === null}
              active={isLiveact}
              onClick={() => void switchMode('liveact')}
              hint={`LiveAct · ${LIVEACT_DEMO_URL}`}
            />
          )}
        </div>
      </div>

      {/* 实时头肩、真人动作换嘴与生成式出片并列；旧渲染器仅作回退。 */}
      <div className="liveModeToggle" role="tablist" aria-label="数字人渲染模式">
        {!MUSETALK_ONLY && (
          <button
            type="button"
            role="tab"
            aria-selected={isFlashHead}
            className={`liveModeOption${isFlashHead ? ' active' : ''}`}
            onClick={() => void switchMode('flashhead')}
          >
            <Gauge size={20} />
            <span>
              <strong>实时高保真</strong>
              <small>FlashHead Lite · WebRTC</small>
            </span>
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={isMuseTalk}
          className={`liveModeOption musetalk${isMuseTalk ? ' active' : ''}`}
          onClick={() => void switchMode('musetalk')}
        >
          <Mic size={20} />
          <span>
            <strong>动作主播 · MuseTalk 1.5</strong>
            <small>MeloTTS · MuseTalk · MSTK 流式音视频</small>
          </span>
          <em>当前方案</em>
        </button>
        {!MUSETALK_ONLY && <button
          type="button"
          role="tab"
          aria-selected={isLiveact}
          className={`liveModeOption${isLiveact ? ' active' : ''}`}
          onClick={() => void switchMode('liveact')}
        >
          <Film size={20} />
          <span>
            <strong>LiveAct 高质量</strong>
            <small>扩散生成 · 高质量片段 · 非实时</small>
          </span>
        </button>}
        {!MUSETALK_ONLY && <button
          type="button"
          role="tab"
          aria-selected={isFallback}
          className={`liveModeFallback${isFallback ? ' active' : ''}`}
          onClick={() => void switchMode('fallback')}
          title={IS_UNREAL ? '原 UE5 Pixel Streaming 路径' : '原 LiveTalking :8028 路径'}
        >
          <RotateCcw size={14} /> 兼容模式
        </button>}
      </div>

      <div className="liveGrid">
        {/* 左：数字人预览 + 播报（实时模式）/ 生成式出片（LiveAct 模式） */}
        <section className="livePanel">
          <header className="livePanelHead">
            {isLiveact ? (
              <Film size={16} />
            ) : isFlashHead ? (
              <Gauge size={16} />
            ) : isMuseTalk ? (
              <Mic size={16} />
            ) : (
              <Volume2 size={16} />
            )}
            <span>
              {isLiveact
                ? 'LiveAct · 高质量生成'
                : isFlashHead
                  ? 'FlashHead Lite · 实时直播'
                  : isMuseTalk
                    ? '动作主播 · MuseTalk 1.5'
                    : '兼容渲染 · 文本播报'}
            </span>
          </header>

          <div className="liveStage">
            {/* UE5 Pixel Streaming：库生成的 video 元素挂到这里 */}
            <div
              ref={psHostRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                borderRadius: '20px',
                overflow: 'hidden',
                visibility: showPsHost && avatarConnected ? 'visible' : 'hidden',
                zIndex: 1,
              }}
            />
            {/* FlashHead、LiveTalking 和 LiveAct HLS 复用这一个媒体元素。 */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                objectPosition: 'center',
                background: '#070a0e',
                borderRadius: '20px',
                visibility: showVideo ? 'visible' : 'hidden',
                zIndex: 1,
              }}
            />
            <img
              src="/assets/musetalk-avatars/chinese.jpg"
              alt="MuseTalk 数字人待机画面"
              aria-hidden={!showMuseTalkIdle}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                objectPosition: 'center',
                background: '#070a0e',
                borderRadius: '20px',
                visibility: showMuseTalkIdle ? 'visible' : 'hidden',
                zIndex: 2,
              }}
            />
            <canvas
              ref={museTalkTotalCanvasRef}
              aria-hidden={!showMuseTalkTotal}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#070a0e',
                borderRadius: '20px',
                visibility: showMuseTalkTotal ? 'visible' : 'hidden',
                zIndex: 3,
              }}
            />
            {!isLiveact && !isMuseTalk && !avatarConnected && (
              <button
                className="primaryCta"
                onClick={() => void connectAvatar()}
                disabled={avatarConnecting}
                style={{ zIndex: 2 }}
              >
                {avatarConnecting ? <Loader2 size={16} className="spin" /> : <Video size={16} />}
                {avatarConnecting
                  ? '连接中…'
                  : avatarState === 'failed'
                    ? isFlashHead
                      ? '重连 FlashHead'
                      : isMuseTalk
                        ? '重连 MuseTalk'
                      : '重连数字人'
                    : isFlashHead
                      ? '连接 FlashHead'
                      : isMuseTalk
                        ? '连接 MuseTalk'
                        : '连接兼容渲染'}
              </button>
            )}
            <div className="liveStageCaption">
              {isLiveact
                ? laPlaying
                  ? 'LiveAct 生成中 / 播放中…'
                  : laBusy
                    ? '已提交，等待出片…'
                    : laErr
                      ? '生成失败'
                      : 'LiveAct · 生成式数字人预览'
                : isMuseTalk && museTalkMediaSource === 'total'
                  ? `MuseTalk 总流程 · ${museTalkTotalStage}`
                  : isMuseTalk && museTalkMediaSource === null
                    ? 'MuseTalk 默认人物 · 首帧静态待机'
                : avatarConnected
                  ? isFlashHead
                    ? flashHeadBodyEnabled
                      ? 'FlashHead 已连接 · 实时口型 + 真人肢体'
                      : 'FlashHead 已连接 · 实时 WebRTC 画面'
                    : isMuseTalk
                      ? 'MuseTalk 已连接 · 真人动作 + 嘴部重建'
                      : IS_UNREAL
                      ? 'UE5 MetaHuman 已连接 · 实时画面'
                      : 'LiveTalking 已连接 · 实时画面'
                  : avatarConnecting
                    ? isFlashHead
                      ? '正在连接 FlashHead WebRTC…'
                      : isMuseTalk
                        ? '正在连接 MuseTalk WebRTC…'
                        : IS_UNREAL
                        ? '正在连接 UE SignalingServer…'
                        : '正在建立 LiveTalking WebRTC…'
                    : avatarState === 'failed'
                      ? '连接失败'
                      : isFlashHead
                        ? '点击连接实时数字人'
                        : isMuseTalk
                          ? '点击连接动作主播'
                          : '点击连接兼容渲染'}
            </div>
            {isLiveact ? (
              <div className="liveStageNote">
                画面由 SoulX-LiveAct 扩散模型逐 chunk 生成、HLS 切片回传浏览器；demo {LIVEACT_DEMO_URL}
                {laDemoUp === false && ' · ⚠ demo 不可达（首次需预热 3-5 分钟）'}
                {laProgress && ` · ${laProgress}`}
                {laErr && <span style={{ color: '#ff5c5c' }}> · {laErr}</span>}
              </div>
            ) : (
              (!avatarConnected || avatarErr) && (
                <div className="liveStageNote">
                  {isFlashHead
                    ? 'FlashHead Lite 在 GPU 节点完整生成脸部、表情与头动，经 WebRTC 实时回传；本模式独立使用 :8030。'
                    : isMuseTalk
                      ? MUSETALK_ONLY
                        ? 'MuseTalk-only：空闲时循环默认形象；实时播报走 MeloTTS :8084 与 MuseTalk MSTK :8083，AI 问答走 server_total :8085。'
                        : 'MuseTalk 1.5 以真人动作视频当前帧为底片，只重建嘴部与下半脸，头姿、头发、身体和手势保持同一运动源；本模式独立使用 :8031。'
                      : IS_UNREAL
                      ? '画面由 UE5 MetaHuman 实时渲染、经 Pixel Streaming(WebRTC) 直传浏览器；语音经同一条流回传。'
                      : '画面由 GPU 节点 LiveTalking 实时渲染、经 WebRTC 直传浏览器，作为兼容回退。'}
                  {isFlashHead
                    ? mounted
                      ? ` 服务地址 ${FLASHHEAD_URL}`
                      : ' 服务地址 …'
                    : isMuseTalk
                      ? MUSETALK_ONLY
                        ? ' 服务地址 :8085 / :8083 / :8084'
                        : mounted
                          ? ` 服务地址 ${MUSETALK_URL}`
                          : ' 服务地址 …'
                      : IS_UNREAL
                    ? mounted
                      ? ` 信令地址 ${PIXELSTREAMING_URL}`
                      : ' 信令地址 …'
                    : rendererReachable === false
                      ? ' ⚠ 探测不到 LiveTalking(8028)，请先在 GPU 机部署。'
                      : mounted
                        ? ` 信令地址 ${LIVETALKING_URL}`
                        : ' 信令地址 …'}
                  {isFlashHead && flashHeadUp === false && ' ⚠ FlashHead 暂不可达，页面每 5 秒自动重试。'}
                  {!MUSETALK_ONLY && isMuseTalk && museTalkHealth && !museTalkHealth.ready && ' MuseTalk 正在预热动作素材，页面会自动重试。'}
                  {!MUSETALK_ONLY && isMuseTalk && museTalkUp === false && !museTalkHealth && ' ⚠ MuseTalk 暂不可达，页面每 5 秒自动重试。'}
                  {avatarErr && <span style={{ color: '#ff5c5c' }}> · {avatarErr}</span>}
                </div>
              )
            )}
          </div>

          {isFlashHead && (
            <section
              className="fhAvatarSelector"
              aria-labelledby="flashhead-avatar-title"
              aria-busy={flashHeadAvatarLoading || flashHeadAvatarSwitching}
            >
              <header className="fhAvatarHeader">
                <div>
                  <span id="flashhead-avatar-title">直播人物</span>
                  <small>切换后沿用当前 WebRTC 连接，无需重连</small>
                </div>
                <span className="fhAvatarStatus" aria-live="polite">
                  {flashHeadAvatarSwitching ? (
                    <>
                      <Loader2 size={13} className="spin" />
                      {flashHeadPendingAvatar
                        ? `正在切换为 ${flashHeadPendingAvatar.label}`
                        : '人物切换中'}
                    </>
                  ) : flashHeadAvatarLoading ? (
                    <>
                      <Loader2 size={13} className="spin" /> 正在读取人物
                    </>
                  ) : flashHeadActiveAvatar ? (
                    <>
                      <Check size={13} /> 当前 · {flashHeadActiveAvatar.label}
                    </>
                  ) : (
                    '选择本场直播人物'
                  )}
                </span>
              </header>

              {flashHeadAvatarState?.avatars.length ? (
                <div className="fhAvatarRail" role="group" aria-label="选择 FlashHead 直播人物">
                  {flashHeadAvatarState.avatars.map((avatar) => {
                    const active = flashHeadAvatarState.active_avatar === avatar.id;
                    const pending = flashHeadAvatarPendingId === avatar.id;
                    return (
                      <button
                        key={avatar.id}
                        type="button"
                        className={`fhAvatarOption${active ? ' active' : ''}${pending ? ' pending' : ''}`}
                        aria-pressed={active}
                        aria-label={`${avatar.label}${active ? '，当前人物' : ''}`}
                        disabled={flashHeadAvatarControlsDisabled}
                        onClick={() => void chooseFlashHeadAvatar(avatar.id)}
                      >
                        <span className="fhAvatarThumb">
                          <span className="fhAvatarFallback" aria-hidden="true">
                            <UserRound size={24} />
                            <b>{avatar.label.trim().slice(0, 1) || '人'}</b>
                          </span>
                          {/* 同源缩略图失败时隐藏图片，露出下方 fallback。 */}
                          {avatar.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatar.thumbnail}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          {pending && (
                            <span className="fhAvatarThumbBusy" aria-hidden="true">
                              <Loader2 size={18} className="spin" />
                            </span>
                          )}
                        </span>
                        <span className="fhAvatarName">
                          <strong>{avatar.label}</strong>
                          <small>{active ? '当前人物' : pending ? '切换中' : '点击切换'}</small>
                        </span>
                        {active && <Check size={15} className="fhAvatarCheck" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              ) : flashHeadAvatarLoading ? (
                <div className="fhAvatarSkeletons" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <div className="fhAvatarEmpty">
                  <UserRound size={18} />
                  {flashHeadUp === false ? 'FlashHead 服务就绪后将自动加载人物' : '暂无可用直播人物'}
                </div>
              )}

              {flashHeadAvatarErr && (
                <div className="fhAvatarError" role="alert">
                  <span>{flashHeadAvatarErr}</span>
                  {!flashHeadAvatarSwitching && flashHeadUp !== false && (
                    <button type="button" onClick={retryFlashHeadAvatars}>
                      <RefreshCw size={12} /> 重新加载
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {isFlashHead && (
            <section className={`fhActionComposer${flashHeadBodyEnabled ? ' enabled' : ''}`}>
              <header className="fhActionHeader">
                <div>
                  <span>肢体动作编排</span>
                  <small>真人动作底片与 FlashHead 口型在同一帧合成</small>
                </div>
                <em>{flashHeadBodyEnabled ? '动作层已启用' : '请选择“动作主播 PoC”'}</em>
              </header>

              {flashHeadSpeechActions.length ? (
                <div className="fhActionRail" role="radiogroup" aria-label="选择播报动作">
                  {flashHeadSpeechActions.map((action) => {
                    const selected = flashHeadAction === action.id;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={selected ? 'active' : ''}
                        disabled={!flashHeadBodyEnabled || flashHeadActionBusy}
                        onClick={() => {
                          setFlashHeadAction(action.id);
                          setFlashHeadActionErr('');
                        }}
                      >
                        <Sparkles size={14} />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="fhActionLoading">
                  {flashHeadActionErr ? '动作列表暂不可用' : '正在读取动作列表…'}
                </div>
              )}

              <div className="fhActionFooter">
                <small>
                  {flashHeadAction === 'auto'
                    ? '自动会根据“欢迎 / 参数 / 感谢”等关键词选择动作。'
                    : `本次播报固定使用“${flashHeadActionLabel || flashHeadAction}”。`}
                </small>
                <div className="fhActionButtons">
                  <span><Film size={13} /> 实时动作预览</span>
                  <button
                    type="button"
                    onClick={() => void previewFlashHeadAction()}
                    disabled={
                      !flashHeadBodyEnabled ||
                      flashHeadActionBusy ||
                      !['welcome', 'point', 'thank'].includes(flashHeadAction)
                    }
                    title={
                      ['welcome', 'point', 'thank'].includes(flashHeadAction)
                        ? '不播声音，只预览当前一次性动作'
                        : '选择“欢迎 / 指向 / 感谢”后可单独预览'
                    }
                  >
                    {flashHeadActionBusy ? <Loader2 size={13} className="spin" /> : <Video size={13} />}
                    单独预览
                  </button>
                </div>
              </div>
              {flashHeadActionErr && <div className="liveErr">{flashHeadActionErr}</div>}
            </section>
          )}

          {isMuseTalk && !MUSETALK_ONLY && (
            <section
              className="fhAvatarSelector"
              aria-labelledby="musetalk-avatar-title"
              aria-busy={museTalkAvatarLoading || museTalkAvatarSwitching}
            >
              <header className="fhAvatarHeader">
                <div>
                  <span id="musetalk-avatar-title">MuseTalk 直播人物</span>
                  <small>
                    {museTalkAvatarState?.multi_avatar_enabled
                      ? '切换后沿用当前 WebRTC 连接，无需重连'
                      : '当前只配置一个人物；新增人物资产后会自动出现在这里'}
                  </small>
                </div>
                <span className="fhAvatarStatus" aria-live="polite">
                  {museTalkAvatarSwitching ? (
                    <>
                      <Loader2 size={13} className="spin" />
                      {museTalkPendingAvatar
                        ? `正在切换为 ${museTalkPendingAvatar.label}`
                        : '人物切换中'}
                    </>
                  ) : museTalkAvatarLoading ? (
                    <>
                      <Loader2 size={13} className="spin" /> 正在读取人物
                    </>
                  ) : museTalkActiveAvatar ? (
                    <>
                      <Check size={13} /> 当前 · {museTalkActiveAvatar.label}
                    </>
                  ) : (
                    '选择本场直播人物'
                  )}
                </span>
              </header>

              {museTalkAvatarState?.avatars.length ? (
                <div className="fhAvatarRail" role="group" aria-label="选择 MuseTalk 直播人物">
                  {museTalkAvatarState.avatars.map((avatar) => {
                    const active = museTalkAvatarState.active_avatar === avatar.id;
                    const pending = museTalkAvatarPendingId === avatar.id;
                    return (
                      <button
                        key={avatar.id}
                        type="button"
                        className={`fhAvatarOption${active ? ' active' : ''}${pending ? ' pending' : ''}`}
                        aria-pressed={active}
                        aria-label={`${avatar.label}${active ? '，当前人物' : ''}`}
                        disabled={museTalkAvatarControlsDisabled}
                        onClick={() => void chooseMuseTalkAvatar(avatar.id)}
                      >
                        <span className="fhAvatarThumb">
                          <span className="fhAvatarFallback" aria-hidden="true">
                            <UserRound size={24} />
                            <b>{avatar.label.trim().slice(0, 1) || '人'}</b>
                          </span>
                          {avatar.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatar.thumbnail}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          {pending && (
                            <span className="fhAvatarThumbBusy" aria-hidden="true">
                              <Loader2 size={18} className="spin" />
                            </span>
                          )}
                        </span>
                        <span className="fhAvatarName">
                          <strong>{avatar.label}</strong>
                          <small>{active ? '当前人物' : pending ? '切换中' : '点击切换'}</small>
                        </span>
                        {active && <Check size={15} className="fhAvatarCheck" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              ) : museTalkAvatarLoading ? (
                <div className="fhAvatarSkeletons" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <div className="fhAvatarEmpty">
                  <UserRound size={18} />
                  {museTalkUp === false
                    ? 'MuseTalk 服务就绪后将自动加载人物'
                    : '暂无可用 MuseTalk 直播人物'}
                </div>
              )}

              {museTalkAvatarErr && (
                <div className="fhAvatarError" role="alert">
                  <span>{museTalkAvatarErr}</span>
                  {!museTalkAvatarSwitching && !museTalkAvatarLoading && (
                    <button type="button" onClick={retryMuseTalkAvatars}>
                      <RefreshCw size={12} /> 重新加载
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {isMuseTalk && !MUSETALK_ONLY && (
            <section className={`fhActionComposer mtActionComposer${museTalkActionsEnabled ? ' enabled' : ''}`}>
              <header className="fhActionHeader">
                <div>
                  <span>真人动作与口型编排</span>
                  <small>
                    目标视频保留头部和身体，只由 MuseTalk 重建嘴部
                    {museTalkResolution && ` · ${museTalkResolution}`}
                    {museTalkHealth?.fps ? ` @ ${museTalkHealth.fps} FPS` : ''}
                  </small>
                </div>
                <em>
                  {museTalkAvatarSwitching
                    ? '人物切换中'
                    : museTalkActionsEnabled
                      ? '同源运动已启用'
                      : '等待动作素材'}
                </em>
              </header>

              {museTalkSpeechActions.length ? (
                <div className="fhActionRail" role="radiogroup" aria-label="选择 MuseTalk 播报动作">
                  {museTalkSpeechActions.map((action) => {
                    const selected = museTalkAction === action.id;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={selected ? 'active' : ''}
                        disabled={
                          !museTalkActionsEnabled ||
                          museTalkAvatarSwitching ||
                          museTalkActionBusy
                        }
                        onClick={() => {
                          setMuseTalkAction(action.id);
                          setMuseTalkActionErr('');
                        }}
                      >
                        <Sparkles size={14} />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="fhActionLoading">
                  {museTalkActionErr ? '动作列表暂不可用' : '正在读取动作列表…'}
                </div>
              )}

              <div className="fhActionFooter">
                <small>
                  {museTalkAction === 'auto'
                    ? '自动会根据播报内容选择动作；空闲帧不会运行口型模型。'
                    : `本次播报固定使用“${museTalkActionLabel || museTalkAction}”。`}
                </small>
                <div className="fhActionButtons">
                  <button
                    type="button"
                    onClick={() => void stopMuseTalk()}
                    disabled={
                      museTalkUp !== true || museTalkAvatarSwitching || museTalkActionBusy
                    }
                    title="立即中断语音并回到待机动作"
                  >
                    <RotateCcw size={13} /> 停止播报
                  </button>
                  <button
                    type="button"
                    onClick={() => void previewMuseTalkAction()}
                    disabled={
                      !museTalkActionsEnabled ||
                      museTalkAvatarSwitching ||
                      museTalkActionBusy ||
                      !['welcome', 'point', 'thank'].includes(museTalkAction)
                    }
                    title={
                      ['welcome', 'point', 'thank'].includes(museTalkAction)
                        ? '不播声音，只预览当前一次性动作'
                        : '选择“欢迎 / 指向 / 感谢”后可单独预览'
                    }
                  >
                    {museTalkActionBusy ? <Loader2 size={13} className="spin" /> : <Video size={13} />}
                    单独预览
                  </button>
                </div>
              </div>
              {museTalkActionErr && <div className="liveErr">{museTalkActionErr}</div>}
            </section>
          )}

          {!isLiveact && (
            <div className="liveField">
              <label>播报文本</label>
              <textarea
                rows={3}
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="输入要让数字人说的话"
              />
              <div className="liveControls">
                <button
                  className="primaryCta"
                  onClick={doBroadcast}
                  disabled={
                    broadcastBusy ||
                    qaBusy ||
                    !broadcastText.trim() ||
                    (isFlashHead && flashHeadAvatarSwitching) ||
                    (isFlashHead && flashHeadActionBusy) ||
                    (isMuseTalk && museTalkAvatarSwitching) ||
                    (isMuseTalk && museTalkActionBusy) ||
                    (isMuseTalk && museTalkMicState !== 'idle') ||
                    (isFallback && !session)
                  }
                  title={
                    isFlashHead && flashHeadAvatarSwitching
                      ? '人物切换完成后即可播报'
                      : isMuseTalk && museTalkAvatarSwitching
                        ? '人物切换完成后即可播报'
                      : canSpeak
                        ? ''
                        : isFlashHead
                          ? '点击后会自动连接 FlashHead'
                          : isMuseTalk
                            ? '点击后会自动连接 MuseTalk'
                          : '请先连接数字人'
                  }
                >
                  {broadcastBusy ||
                  (isFlashHead && (flashHeadAvatarSwitching || flashHeadActionBusy)) ||
                  (isMuseTalk && (museTalkAvatarSwitching || museTalkActionBusy)) ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Volume2 size={16} />
                  )}
                  {isFlashHead && flashHeadAvatarSwitching
                    ? '人物切换中…'
                    : isMuseTalk && museTalkAvatarSwitching
                      ? '人物切换中…'
                    : isFlashHead && flashHeadActionBusy
                      ? '动作切换中…'
                      : isMuseTalk && museTalkActionBusy
                        ? '动作切换中…'
                        : isFlashHead || isMuseTalk
                          ? '实时播报'
                          : '让数字人说'}
                </button>
                {isMuseTalk && !MUSETALK_ONLY && (
                  <button
                    type="button"
                    className={`streamMicCta${museTalkMicState === 'recording' ? ' recording' : ''}`}
                    onClick={() => void toggleMuseTalkMicrophone()}
                    disabled={
                      museTalkMicState === 'connecting' ||
                      museTalkMicState === 'submitting' ||
                      museTalkAvatarSwitching ||
                      museTalkActionBusy ||
                      broadcastBusy ||
                      qaBusy
                    }
                    title="将浏览器麦克风转换为 16 kHz PCM，提交给 MuseTalk 并通过当前 WebRTC 画面播放"
                  >
                    {museTalkMicState === 'connecting' || museTalkMicState === 'submitting' ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Mic size={16} />
                    )}
                    {museTalkMicState === 'recording'
                      ? '停止并驱动画面'
                      : museTalkMicState === 'submitting'
                        ? '正在提交…'
                        : museTalkMicState === 'connecting'
                          ? '连接麦克风…'
                          : '麦克风流输入'}
                  </button>
                )}
              </div>
              {broadcastInfo && (
                <div className="liveAudioRow">
                  <span className="latencyChip">{broadcastInfo}</span>
                </div>
              )}
              {!canSpeak && broadcastText.trim() && !broadcastBusy && (
                <div className="liveInlineHint">
                  {isFlashHead
                    ? '可直接点击“实时播报”，页面会先连接 FlashHead 再发送文本。'
                    : isMuseTalk
                      ? 'MuseTalk 总流程就绪后可直接流式播报。'
                      : '请先点上方“连接兼容渲染”拉起画面，再播报。'}
                </div>
              )}
              {broadcastErr && <div className="liveErr">{broadcastErr}</div>}
            </div>
          )}

          {isLiveact && (
            <div className="liveField">
              <label>参考形象</label>
              <div className="laAvatarPicker">
                {LIVEACT_AVATARS.map((a) => {
                  const selected = !laUploadFile && laAvatarId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`laAvatarTile${selected ? ' selected' : ''}`}
                      onClick={() => {
                        setLaAvatarId(a.id);
                        setLaUploadFile(null);
                      }}
                      title={a.label}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.src} alt={a.label} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`laAvatarTile upload${laUploadFile ? ' selected' : ''}`}
                  onClick={() => laFileInputRef.current?.click()}
                  title="上传自定义形象"
                >
                  {laUploadFile ? <ImageIcon size={18} /> : <Upload size={18} />}
                  <span>{laUploadFile ? laUploadFile.name.slice(0, 12) : '上传'}</span>
                </button>
                <input
                  ref={laFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setLaUploadFile(f);
                      setLaAvatarId('');
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              <label>
                播报文本
                {voices.length > 0 && (
                  <select
                    className="laVoiceSelect"
                    value={laVoice}
                    onChange={(e) => setLaVoice(e.target.value)}
                  >
                    <option value="">默认音色</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}（{v.gender}）
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <textarea
                rows={3}
                value={laText}
                onChange={(e) => setLaText(e.target.value)}
                placeholder="输入要生成的话（短文本出片更快，建议 ≤ 15 秒）"
              />
              <div className="liveControls">
                <button
                  className="primaryCta"
                  onClick={doLiveAct}
                  disabled={laBusy || laTaskActive || !laText.trim()}
                  title={laDemoUp === false ? '点击重新检测 LiveAct，服务就绪后继续生成' : ''}
                >
                  {laBusy || laTaskActive ? <Loader2 size={16} className="spin" /> : <Film size={16} />}
                  {laBusy
                    ? '处理中…'
                    : laTaskActive
                      ? '生成中…'
                      : laDemoUp === false
                        ? '重试并生成'
                        : '生成高质量视频'}
                </button>
                {laProgress && <span className="latencyChip">{laProgress}</span>}
              </div>
              {laStatus?.message && !laErr && (
                <div className="liveAudioRow">
                  <span className="latencyChip">{laStatus.message}</span>
                </div>
              )}
              {laDemoUp === false && (
                <div className="liveErr">
                  LiveAct demo 不可达（{LIVEACT_DEMO_URL}）。首次启动需预热 3-5 分钟；页面会自动重试，也可以点击“重试并生成”。
                </div>
              )}
              {laErr && <div className="liveErr">{laErr}</div>}
            </div>
          )}
        </section>

        {/* 右：弹幕问答 */}
        <section className="livePanel">
          <header className="livePanelHead">
            <Sparkles size={16} />
            <span>
              弹幕问答 · {isFlashHead
                ? 'FlashHead 实时回复'
                : isMuseTalk
                  ? 'MuseTalk 动作回复'
                  : isLiveact
                    ? '生成高质量片段'
                    : 'AI 自动回复'}
            </span>
          </header>

          <div className="liveField">
            <label>观众问题 / 弹幕</label>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="观众提问，AI 会用数字人主播口吻回答并开口播报"
            />
            <div className="liveControls">
              <button
                className="primaryCta"
                onClick={doAsk}
                disabled={
                  qaBusy ||
                  broadcastBusy ||
                  !question.trim() ||
                  (!session && !isMuseTalk) ||
                  (isFlashHead && (flashHeadAvatarSwitching || flashHeadActionBusy)) ||
                  (isMuseTalk && (museTalkAvatarSwitching || museTalkActionBusy))
                }
              >
                {qaBusy ||
                (isFlashHead && (flashHeadAvatarSwitching || flashHeadActionBusy)) ||
                (isMuseTalk && (museTalkAvatarSwitching || museTalkActionBusy)) ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Send size={16} />
                )}
                {isFlashHead && flashHeadAvatarSwitching
                  ? '人物切换中…'
                  : isMuseTalk && museTalkAvatarSwitching
                    ? '人物切换中…'
                  : isFlashHead && flashHeadActionBusy
                    ? '动作切换中…'
                    : isMuseTalk && museTalkActionBusy
                      ? '动作切换中…'
                      : '提问（GPT 回答）'}
              </button>
            </div>
          </div>

          {qaResult && (
            <div className="qaCard">
              <div className="qaQuestion">
                <Mic size={14} /> {qaResult.question}
              </div>
              <p className="qaAnswer">{qaResult.answer}</p>
              <div className="qaMetrics">
                <span>LLM {qaResult.llm_latency_ms} ms</span>
                <span>{qaResult.model_id}</span>
                {qaResult.livetalking && (
                  <span className={qaResult.livetalking.degraded ? 'warn' : 'good'}>
                    数字人 {qaResult.livetalking.degraded ? '未驱动' : '已开口'}
                  </span>
                )}
              </div>
            </div>
          )}
          {qaDriveInfo && <div className="liveInlineHint">{qaDriveInfo}</div>}
          {qaErr && <div className="liveErr">{qaErr}</div>}

          {history.length > 0 && (
            <div className="qaHistory">
              <header className="livePanelHead subtle">
                <span>历史 ({history.length})</span>
              </header>
              <ul>
                {history.map((it, i) => (
                  <li key={i}>
                    <div className="qaHistQ">{it.question}</div>
                    <div className="qaHistA">{it.answer}</div>
                    <div className="qaHistMeta">
                      LLM {it.llmMs}ms · {it.model}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* 底部指标 */}
      <div className="liveMetrics">
        <div>
          <span>已回答</span>
          <strong>{history.length}</strong>
        </div>
        <div>
          <span>平均 LLM 延迟</span>
          <strong>{avgLlm ? `${avgLlm} ms` : '—'}</strong>
        </div>
        <div>
          <span>默认模型</span>
          <strong>{ready?.llm_default_model_id || '—'}</strong>
        </div>
        <div>
          <span>数字人</span>
          <strong className="mono">
            {isLiveact
              ? laDemoUp
                ? laPlaying
                  ? '播放中'
                  : laStatus?.is_done
                    ? '已出片'
                    : laBusy || laTaskId
                      ? '生成中'
                      : 'demo 就绪'
                : laDemoUp === null
                  ? '探测中'
                  : 'demo 离线'
              : isFlashHead
                ? flashHeadUp
                  ? avatarConnected
                    ? '实时已连接'
                    : avatarConnecting
                      ? '连接中'
                      : '8030 就绪'
                  : flashHeadUp === null
                    ? '探测中'
                    : '8030 离线'
                : isMuseTalk
                  ? museTalkUp
                    ? avatarConnected
                      ? '动作主播已连接'
                      : avatarConnecting
                        ? '连接中'
                        : '8031 就绪'
                    : museTalkHealth
                      ? '动作预处理中'
                      : museTalkUp === null
                        ? '探测中'
                        : '8031 离线'
                  : avatarConnected
                    ? '兼容已连接'
                    : avatarConnecting
                      ? '连接中'
                      : '兼容未连接'}
          </strong>
        </div>
      </div>
    </div>
  );
}
