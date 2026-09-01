'use client';

import { useEffect, useRef, useState } from 'react';

type LiveProgramOutputProps = {
  sessionId: string;
  orientation: 'portrait' | 'landscape';
};

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    };
    const handleChange = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const timeout = window.setTimeout(finish, 5_000);
    peer.addEventListener('icegatheringstatechange', handleChange);
  });
}

export function LiveProgramOutput({ sessionId, orientation }: LiveProgramOutputProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Give window-capture tools a stable, recognizable window title.
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

    const peer = new RTCPeerConnection();
    const outputStream = new MediaStream();
    let readyTimer: number | null = null;
    let stopped = false;
    const opener = window.opener;
    const sendReady = () => opener.postMessage({ type: 'program-ready', sessionId }, window.location.origin);
    const tryPlay = () => {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = outputStream;
      void video.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };

    peer.ontrack = (event) => {
      if (!outputStream.getTracks().some((track) => track.id === event.track.id)) outputStream.addTrack(event.track);
      tryPlay();
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setConnected(true);
        if (readyTimer !== null) window.clearInterval(readyTimer);
        readyTimer = null;
        tryPlay();
      } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
        if (readyTimer !== null) window.clearInterval(readyTimer);
        readyTimer = null;
        setConnected(false);
        setError('节目媒体连接已中断，请回到控制台重试');
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== opener) return;
      const message = event.data as { type?: string; sessionId?: string; sdp?: string } | null;
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === 'stop') {
        stopped = true;
        peer.close();
        window.close();
        return;
      }
      if (message.type !== 'offer' || !message.sdp || stopped) return;
      void (async () => {
        try {
          await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp! });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await waitForIceGathering(peer);
          if (peer.localDescription?.sdp) {
            opener.postMessage({ type: 'answer', sessionId, sdp: peer.localDescription.sdp }, window.location.origin);
          }
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '节目媒体连接失败');
        }
      })();
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
      outputStream.getTracks().forEach((track) => track.stop());
      peer.close();
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
