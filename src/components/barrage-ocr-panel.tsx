'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, CircleStop, LoaderCircle, RefreshCw, ScanText, X } from 'lucide-react';
import { extractOcrComments, newOcrComments, type CaptureRegion } from '@/lib/screen-ocr-comments';

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
type OcrComment = { id: string; text: string; time: string; state: 'saving' | 'saved' | 'failed' };
type CapturePhase = 'idle' | 'opening' | 'loading' | 'ready' | 'error';

function boundsFromPointer(event: ReactPointerEvent<HTMLDivElement>, element: HTMLDivElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

export function BarrageOcrPanel({ open, roomId, onClose, onRunningChange }: { open: boolean; roomId: string; onClose: () => void; onRunningChange: (running: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const requestRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const seenRef = useRef(new Map<string, number>());
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [message, setMessage] = useState('');
  const [region, setRegion] = useState<CaptureRegion | null>(null);
  const [draftRegion, setDraftRegion] = useState<CaptureRegion | null>(null);
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [comments, setComments] = useState<OcrComment[]>([]);
  const [lastScan, setLastScan] = useState('');

  const stopCapture = useCallback(() => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onRunningChange(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    const worker = workerRef.current;
    workerRef.current = null;
    if (worker) void worker.terminate();
    setPhase('idle');
    setRegion(null);
    setDraftRegion(null);
  }, [onRunningChange]);

  useEffect(() => () => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (workerRef.current) void workerRef.current.terminate();
    onRunningChange(false);
  }, [onRunningChange]);

  const saveComment = useCallback((comment: OcrComment) => {
    setComments((items) => items.map((item) => item.id === comment.id ? { ...item, state: 'saving' } : item));
    void fetch(`/api/v1/live-rooms/${encodeURIComponent(roomId)}/ocr-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalEventId: comment.id, content: comment.text }),
    }).then((response) => {
      if (!response.ok) throw new Error('保存失败');
      setComments((items) => items.map((item) => item.id === comment.id ? { ...item, state: 'saved' } : item));
    }).catch(() => {
      setComments((items) => items.map((item) => item.id === comment.id ? { ...item, state: 'failed' } : item));
    });
  }, [roomId]);

  const startCapture = async () => {
    if (!window.isSecureContext) {
      const localUrl = `http://localhost${window.location.port ? `:${window.location.port}` : ''}${window.location.pathname}`;
      setMessage(`当前页面通过非安全的 HTTP 地址访问，浏览器已禁用窗口共享。请改用 HTTPS；如果浏览器就在服务器上，可访问 ${localUrl}。`);
      setPhase('error');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMessage('当前浏览器或页面权限不支持窗口共享，请使用桌面版 Chrome 或 Edge，并检查屏幕共享权限。');
      setPhase('error');
      return;
    }
    setMessage('');
    setPhase('opening');
    const request = ++requestRef.current;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) throw new Error('窗口预览尚未就绪');
      streamRef.current = stream;
      onRunningChange(true);
      stream.getVideoTracks()[0].addEventListener('ended', stopCapture, { once: true });
      video.srcObject = stream;
      await video.play();
      setDimensions({ width: video.videoWidth || 16, height: video.videoHeight || 9 });
      setPhase('loading');
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('chi_sim', 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/tesseract-core-lstm.wasm.js',
        langPath: '/ocr',
        gzip: false,
      });
      if (request !== requestRef.current) {
        await worker.terminate();
        return;
      }
      workerRef.current = worker;
      setPhase('ready');
    } catch (error) {
      if (request !== requestRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      onRunningChange(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      setPhase('error');
      setMessage(error instanceof Error && error.name === 'NotAllowedError' ? '未授权共享窗口' : error instanceof Error ? error.message : '窗口识别启动失败');
    }
  };

  useEffect(() => {
    if (phase !== 'ready' || !region) return;
    const worker = workerRef.current;
    const video = videoRef.current;
    if (!worker || !video) return;
    let cancelled = false;
    let timer: number | undefined;
    const scan = async () => {
      if (cancelled || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const width = Math.round(video.videoWidth * region.width);
      const height = Math.round(video.videoHeight * region.height);
      if (width < 80 || height < 30) {
        setMessage('选区太小，请重新框选评论区域');
        return;
      }
      const scale = Math.min(2, 1800 / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, Math.round(video.videoWidth * region.x), Math.round(video.videoHeight * region.y), width, height, 0, 0, canvas.width, canvas.height);
      try {
        const result = await worker.recognize(canvas);
        if (cancelled) return;
        const lines = newOcrComments(extractOcrComments(result.data.text), seenRef.current, Date.now());
        setLastScan(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        setMessage(lines.length ? '' : '正在识别评论区域');
        for (const text of lines.slice(0, 12)) {
          const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
          const comment: OcrComment = { id, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), state: 'saving' };
          setComments((items) => [comment, ...items].slice(0, 100));
          saveComment(comment);
        }
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? `识别失败：${error.message}` : '识别失败');
      }
      if (!cancelled) timer = window.setTimeout(scan, 1500);
    };
    void scan();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, region, saveComment]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'ready') return;
    const start = boundsFromPointer(event, event.currentTarget);
    dragStartRef.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftRegion({ ...start, width: 0, height: 0 });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const end = boundsFromPointer(event, event.currentTarget);
    setDraftRegion({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const end = boundsFromPointer(event, event.currentTarget);
    const next = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    dragStartRef.current = null;
    setDraftRegion(null);
    if (next.width > 0.03 && next.height > 0.03) {
      seenRef.current.clear();
      setRegion(next);
      setMessage('');
    }
  };
  const visibleRegion = draftRegion ?? region;

  return <div className="xlOcrBackdrop" hidden={!open} onMouseDown={onClose}>
    <section className="xlOcrPanel" role="dialog" aria-modal="true" aria-label="弹幕 OCR" onMouseDown={(event) => event.stopPropagation()}>
      <header className="xlOcrHeader"><span><ScanText size={18} /><strong>弹幕 OCR</strong></span><button type="button" title="关闭面板" aria-label="关闭弹幕 OCR 面板" onClick={onClose}><X size={18} /></button></header>
      <div className="xlOcrBody">
        <div className="xlOcrCapture">
          <div className="xlOcrToolbar"><span>{phase === 'ready' ? region ? '正在识别' : '框选评论区域' : phase === 'loading' ? '正在加载中文识别模型' : phase === 'opening' ? '正在选择窗口' : '等待选择窗口'}</span><div>{phase !== 'idle' && phase !== 'error' ? <button type="button" onClick={stopCapture}><CircleStop size={14} />停止</button> : <button type="button" onClick={() => void startCapture()}><ScanText size={14} />选择直播伴侣窗口</button>}</div></div>
          <div className="xlOcrPreview" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
            <video ref={videoRef} autoPlay muted playsInline />
            {phase === 'ready' && <div className="xlOcrSelectionSurface" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragStartRef.current = null; setDraftRegion(null); }}>
              {visibleRegion && <div className="xlOcrRegion" style={{ left: `${visibleRegion.x * 100}%`, top: `${visibleRegion.y * 100}%`, width: `${visibleRegion.width * 100}%`, height: `${visibleRegion.height * 100}%` }} />}
            </div>}
            {(phase === 'idle' || phase === 'error') && <span className="xlOcrPreviewEmpty"><ScanText size={30} />等待窗口画面</span>}
            {phase === 'loading' && <span className="xlOcrPreviewLoading"><LoaderCircle size={22} className="xlVoiceSpinner" />加载识别模型</span>}
          </div>
          {message && <p className={phase === 'error' || message.includes('失败') ? 'xlOcrError' : 'xlOcrHint'} role="status">{message}</p>}
        </div>
        <div className="xlOcrComments"><header><strong>识别结果</strong><span>{lastScan ? `最近扫描 ${lastScan}` : `${comments.length} 条`}</span></header><div className="xlOcrCommentList">{comments.length ? comments.map((comment) => <article key={comment.id}><span><strong>{comment.text}</strong><small>{comment.time} · {comment.state === 'saved' ? '已录入' : comment.state === 'saving' ? '录入中' : '录入失败'}</small></span>{comment.state === 'saved' ? <Check size={14} /> : comment.state === 'failed' ? <button type="button" title="重新录入" aria-label={`重新录入${comment.text}`} onClick={() => saveComment(comment)}><RefreshCw size={14} /></button> : null}</article>) : <div className="xlOcrEmpty">暂无评论</div>}</div></div>
      </div>
    </section>
  </div>;
}
