'use client';

import { useEffect, useRef, useState } from 'react';

type LiveProgramOutputProps = {
  sessionId: string;
  orientation: 'portrait' | 'landscape';
};

type ProgramWindow = Window & { __avatarProgramStream?: MediaStream | null };

export function LiveProgramOutput({ sessionId, orientation }: LiveProgramOutputProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `AvatarLive 节目输出 · ${orientation === 'portrait' ? '9:16' : '16:9'}`;
    return () => {
      document.title = previousTitle;
    };
  }, [orientation]);

  useEffect(() => {
    if (!sessionId || !window.opener) {
      setError('请从直播控制台打开节目输出窗口');
      return;
    }

    let readyTimer: number | null = null;
    let stopped = false;
    const opener = window.opener;
    const sendReady = () => opener.postMessage({ type: 'program-ready', sessionId }, window.location.origin);
    const tryPlay = async () => {
      const video = videoRef.current;
      if (!video) return;
      const stream = (window as ProgramWindow).__avatarProgramStream;
      if (!stream?.getVideoTracks().length) {
        opener.postMessage({ type: 'program-error', sessionId, message: '节目画面媒体流不可用' }, window.location.origin);
        return;
      }
      video.srcObject = stream;
      try {
        try {
          await video.play();
          setAudioBlocked(false);
        } catch {
          video.muted = true;
          await video.play();
          setAudioBlocked(true);
        }
        if (stopped) return;
        setConnected(true);
        setError('');
        if (readyTimer !== null) window.clearInterval(readyTimer);
        readyTimer = null;
        opener.postMessage({ type: 'program-live', sessionId }, window.location.origin);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '节目画面播放失败';
        setError(message);
        opener.postMessage({ type: 'program-error', sessionId, message }, window.location.origin);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== opener) return;
      const message = event.data as { type?: string; sessionId?: string } | null;
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === 'stop') {
        stopped = true;
        window.close();
      } else if (message.type === 'direct-start' && !stopped) {
        void tryPlay();
      }
    };

    window.addEventListener('message', handleMessage);
    sendReady();
    readyTimer = window.setInterval(sendReady, 500);
    const handleBeforeUnload = () => opener.postMessage({ type: 'program-closed', sessionId }, window.location.origin);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      stopped = true;
      if (readyTimer !== null) window.clearInterval(readyTimer);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [sessionId]);

  const enableAudio = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
  };

  return (
    <main className={`liveProgramOutput ${orientation}`}>
      <video ref={videoRef} autoPlay playsInline aria-label="AvatarLive 直播节目画面" />
      {!connected && !error && <div className="liveProgramStatus">正在连接直播节目…</div>}
      {audioBlocked && !error && <button className="liveProgramAudioButton" type="button" onClick={enableAudio}>点击启用直播声音</button>}
      {error && <div className="liveProgramError">{error}</div>}
    </main>
  );
}
