'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpenText,
  Check,
  ChevronDown,
  ClipboardList,
  Headphones,
  LifeBuoy,
  Rocket,
  Send,
  X,
} from 'lucide-react';
import styles from './service-center.module.css';

export type ServiceTicketDraft = {
  title: string;
  description: string;
  priority: 'normal' | 'urgent';
};

export type ServiceCenterProps = {
  open: boolean;
  onClose: () => void;
  onSubmitTicket?: (ticket: ServiceTicketDraft) => void | Promise<void>;
};

type SupportPanel = 'new' | 'history' | null;
type ResourceId = 'release' | 'learning' | 'report';
type TicketState = 'draft' | 'submitted' | null;

type StoredTicketDraft = ServiceTicketDraft & {
  id: string;
  createdAt: string;
};

const TICKET_DRAFTS_KEY = 'avatar-live-support-ticket-drafts';
const LOCAL_DRAFT_MESSAGE = '已保存本地草稿，正式提交待接工单服务';

const SERVICE_ITEMS = [
  { label: '实时互动', detail: '语音与驱动能力已配置' },
  { label: '数字人直播', detail: '推流与编排能力已配置' },
];

const RESOURCE_ITEMS = [
  {
    id: 'release' as const,
    label: '版本更新',
    meta: 'v2.4.0 · 08/07',
    summary: '直播环境检测与声音预览已升级',
    detail: '新增开播前网络、设备和推流状态检查，并优化音色试听与参数调节。',
    icon: Rocket,
  },
  {
    id: 'learning' as const,
    label: '培训与文档',
    meta: '12 篇指南',
    summary: '快速上手、直播配置与常见问题',
    detail: '内容已按实时互动、数字人创建、直播运营分类，可从基础配置开始学习。',
    icon: BookOpenText,
  },
  {
    id: 'report' as const,
    label: '运行月报',
    meta: '2026 年 7 月',
    summary: '示例月报：服务可用性 99.98%',
    detail: '月报页面用于汇总可用性、响应时间和直播任务成功率，正式数值由监控系统接入。',
    icon: BarChart3,
  },
];

export function ServiceCenter({ open, onClose, onSubmitTicket }: ServiceCenterProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const [supportPanel, setSupportPanel] = useState<SupportPanel>(null);
  const [expandedResource, setExpandedResource] = useState<ResourceId | null>(null);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketPriority, setTicketPriority] = useState<ServiceTicketDraft['priority']>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [ticketState, setTicketState] = useState<TicketState>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || onSubmitTicket) return;

    try {
      const stored = JSON.parse(localStorage.getItem(TICKET_DRAFTS_KEY) || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        setTicketState('draft');
        setSubmitMessage(LOCAL_DRAFT_MESSAGE);
      }
    } catch {
      // A malformed old value should not prevent the support drawer from opening.
    }
  }, [open, onSubmitTicket]);

  if (!open) return null;

  const submitTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ticketTitle.trim() || !ticketDescription.trim() || submitting) return;

    setSubmitting(true);
    setSubmitMessage('');
    const ticket: ServiceTicketDraft = {
      title: ticketTitle.trim(),
      description: ticketDescription.trim(),
      priority: ticketPriority,
    };

    try {
      if (onSubmitTicket) {
        await onSubmitTicket(ticket);
        setTicketState('submitted');
        setSubmitMessage('工单已成功提交至技术支持');
      } else {
        const stored = JSON.parse(localStorage.getItem(TICKET_DRAFTS_KEY) || '[]');
        const drafts = Array.isArray(stored) ? stored : [];
        const localDraft: StoredTicketDraft = {
          ...ticket,
          id: `draft-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem(TICKET_DRAFTS_KEY, JSON.stringify([localDraft, ...drafts]));
        setTicketState('draft');
        setSubmitMessage(LOCAL_DRAFT_MESSAGE);
      }
      setTicketTitle('');
      setTicketDescription('');
      setTicketPriority('normal');
      setSupportPanel('history');
    } catch {
      setSubmitMessage(onSubmitTicket ? '提交失败，请稍后重试' : '草稿保存失败，请检查浏览器存储空间');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headerIcon}><LifeBuoy size={19} /></div>
          <div>
            <span>服务中心</span>
            <h2 id={titleId}>服务与支持</h2>
          </div>
          <button className={styles.closeButton} type="button" aria-label="关闭服务与支持" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={styles.content}>
          <section className={styles.overview} aria-labelledby={`${titleId}-overview`}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>服务概览</span>
                <h3 id={`${titleId}-overview`}><i />服务能力已配置</h3>
              </div>
              <span className={styles.availability}><Activity size={14} />示例月度 99.98%</span>
            </div>
            <div className={styles.serviceList}>
              {SERVICE_ITEMS.map((item) => (
                <div className={styles.serviceItem} key={item.label}>
                  <span><Check size={13} /></span>
                  <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                  <em>已配置</em>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.support} aria-labelledby={`${titleId}-support`}>
            <div className={styles.supportCopy}>
              <span className={styles.supportIcon}><Headphones size={17} /></span>
              <div>
                <h3 id={`${titleId}-support`}>技术支持</h3>
                <p>{onSubmitTicket ? '在线支持 09:00–21:00，紧急故障 7×24 小时响应' : '可先保存问题草稿，正式提交能力待接入'}</p>
              </div>
            </div>
            <div className={styles.supportActions}>
              <button
                className={supportPanel === 'new' ? styles.activeAction : ''}
                type="button"
                onClick={() => { setSupportPanel((value) => value === 'new' ? null : 'new'); setSubmitMessage(''); }}
              >
                <Send size={14} />{onSubmitTicket ? '新建工单' : '填写工单'}
              </button>
              <button
                className={supportPanel === 'history' ? styles.activeAction : ''}
                type="button"
                onClick={() => setSupportPanel((value) => value === 'history' ? null : 'history')}
              >
                <ClipboardList size={14} />{onSubmitTicket ? '我的工单' : '本地草稿'}
              </button>
            </div>

            {supportPanel === 'new' && (
              <form className={styles.ticketForm} onSubmit={submitTicket}>
                <input
                  aria-label="问题标题"
                  value={ticketTitle}
                  onChange={(event) => setTicketTitle(event.target.value)}
                  placeholder="简要描述问题"
                  maxLength={40}
                  autoFocus
                />
                <textarea
                  aria-label="问题详情"
                  value={ticketDescription}
                  onChange={(event) => setTicketDescription(event.target.value)}
                  placeholder="补充出现时间和具体表现"
                  maxLength={300}
                  rows={3}
                />
                <div className={styles.ticketFooter}>
                  <div className={styles.priority} aria-label="工单优先级">
                    <button className={ticketPriority === 'normal' ? styles.selected : ''} type="button" onClick={() => setTicketPriority('normal')}>一般</button>
                    <button className={ticketPriority === 'urgent' ? styles.selected : ''} type="button" onClick={() => setTicketPriority('urgent')}>紧急</button>
                  </div>
                  <button className={styles.submitButton} type="submit" disabled={!ticketTitle.trim() || !ticketDescription.trim() || submitting}>
                    {submitting ? (onSubmitTicket ? '提交中…' : '保存中…') : (onSubmitTicket ? '提交工单' : '保存本地草稿')}
                  </button>
                </div>
                {submitMessage && <p className={styles.formMessage} role="status">{submitMessage}</p>}
              </form>
            )}

            {supportPanel === 'history' && (
              <div className={styles.ticketHistory} role="status">
                {onSubmitTicket && ticketState === 'submitted' ? (
                  <><span><Check size={14} /></span><div><strong>工单已提交</strong><small>{submitMessage || '工单已成功提交至技术支持'}</small></div><em className={styles.submittedState}>已提交</em></>
                ) : ticketState === 'draft' ? (
                  <><span><ClipboardList size={14} /></span><div><strong>本地草稿已保存</strong><small>{LOCAL_DRAFT_MESSAGE}</small></div><em>草稿</em></>
                ) : !onSubmitTicket ? (
                  <><span><ClipboardList size={14} /></span><div><strong>暂无本地草稿</strong><small>可填写问题并保存到当前浏览器</small></div></>
                ) : (
                  <><span><ClipboardList size={14} /></span><div><strong>暂无待处理工单</strong><small>历史问题均已处理完成</small></div></>
                )}
              </div>
            )}
          </section>

          <section className={styles.resources} aria-labelledby={`${titleId}-resources`}>
            <div className={styles.resourceHeading}>
              <div><span className={styles.eyebrow}>服务动态</span><h3 id={`${titleId}-resources`}>更新、学习与报告</h3></div>
              <small>最近更新 08/07</small>
            </div>
            <div className={styles.resourceList}>
              {RESOURCE_ITEMS.map((item) => {
                const Icon = item.icon;
                const expanded = expandedResource === item.id;
                return (
                  <article className={styles.resourceItem} key={item.id}>
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedResource(expanded ? null : item.id)}>
                      <span className={styles.resourceIcon}><Icon size={16} /></span>
                      <span className={styles.resourceCopy}>
                        <span><strong>{item.label}</strong><em>{item.meta}</em></span>
                        <small>{item.summary}</small>
                      </span>
                      <ChevronDown className={expanded ? styles.expanded : ''} size={17} />
                    </button>
                    {expanded && <p className={styles.resourceDetail}>{item.detail}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <span><i />{onSubmitTicket ? '支持服务在线' : '本地帮助中心'}</span>
          <small>{onSubmitTicket ? '平均响应时间约 2 小时' : '工单提交服务待接入'}</small>
        </footer>
      </section>
    </div>
  );
}
