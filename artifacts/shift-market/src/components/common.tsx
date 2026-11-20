import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, BrainCircuit, Check, ChevronDown, X } from 'lucide-react';
import { getGetDashboardQueryKey, getListFeedbackQueryKey, useCreateFeedback, type ConfidenceBasis, type DashboardAction, type DataMode, type Insight, type Metric, type TemplateParams, type TimelineEvent, type Verdict } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { fill, formatCompactCurrency, formatDate, formatNumber, formatTime, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { GlossaryTerm } from '@/lib/i18n';
import { useAnimatedNumber } from '@/components/motion';
import { DataFreshness, DataSourceBadge, type SourceStatus } from '@/components/data-trust';
import { Badge, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/states';

// Common UI states live in components/states; re-exported so existing imports keep working.
export { BlockError, EmptyState, ErrorState, LoadingState, MissingValue, PageSkeleton, RefreshingNotice } from '@/components/states';

export const demoSource = 'DEMO DATA';

/** Translates a key and fills {params}, formatting numbers and ISO dates for the active language. */
export function useText() {
  const { locale, t } = useI18n();
  return (key: string, params?: TemplateParams | Record<string, string | number>) => {
    if (!params) return t(key);
    const formatted: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'number') formatted[name] = name === 'amount' ? formatCompactCurrency(value, locale) : formatNumber(value, locale, Math.abs(value) < 100 ? 1 : 0);
      else formatted[name] = /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value, locale) : value;
    }
    return fill(t(key), formatted);
  };
}

/** Kept for existing call sites; the source in words is drawn by DataSourceBadge. */
export function SourcePill({ source, status }: { source?: string; status?: SourceStatus }) {
  return <DataSourceBadge source={source} status={status} />;
}

const statusLabels: Record<string, string> = {
  SCALE: 'МАСШТАБИРОВАТЬ',
  OPTIMIZE: 'ОПТИМИЗИРОВАТЬ',
  DEFEND: 'ЗАЩИЩАТЬ',
  FIX: 'ИСПРАВИТЬ',
  WATCH: 'НАБЛЮДАТЬ',
  KEEP: 'СОХРАНИТЬ',
  REDUCE: 'СНИЗИТЬ',
  STOP: 'ОСТАНОВИТЬ',
  HIGH: 'ВЫСОКИЙ',
  MEDIUM: 'СРЕДНИЙ',
  LOW: 'НИЗКИЙ',
  ACTIVE: 'АКТИВНА',
  COMPLETE: 'ЗАВЕРШЕНА',
  PLANNED: 'ЗАПЛАНИРОВАНА',
  IN_STOCK: 'В НАЛИЧИИ',
  LOW_STOCK: 'МАЛО ОСТАЛОСЬ',
  NOT_CONNECTED: 'НЕ ПОДКЛЮЧЕНО',
  CONNECTED: 'ПОДКЛЮЧЕНО',
  ERROR: 'ОШИБКА',
  DEMO: 'ДЕМО',
  CONTENT: 'КОНТЕНТ',
};

export function statusLabel(value: string) {
  return statusLabels[value] ?? 'Статус недоступен';
}

/**
 * A term with a tap/hover explanation, so non-marketers can read the numbers.
 * The bubble is positioned against the viewport so scrolling tables never clip it.
 */
export function Hint({ term, text, children }: { term?: GlossaryTerm; text?: string; children?: ReactNode }) {
  const { t } = useI18n();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleId = useId();
  const open = position !== null;

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left - 8, window.innerWidth - width - 12));
    const below = rect.bottom + 8;
    const top = below + 140 > window.innerHeight ? Math.max(12, rect.top - 148) : below;
    setPosition({ top, left });
  };
  const hide = () => setPosition(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(event.target as Node)) hide();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  return (
    <span ref={ref} className={`hint ${open ? 'open' : ''}`} onMouseEnter={canHover ? show : undefined} onMouseLeave={canHover ? hide : undefined}>
      {children}
      <button
        ref={triggerRef}
        type="button"
        className="hint-trigger"
        aria-label={t('Что это значит')}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={(event) => { event.stopPropagation(); if (open && !canHover) hide(); else show(); }}
        onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) show(); }}
        onBlur={hide}
        data-testid={term ? `hint-${term.toLowerCase()}` : 'hint-info'}
      >?</button>
      {position && createPortal(<span role="tooltip" id={bubbleId} className="hint-bubble" style={{ top: position.top, left: position.left }}>{term ? t(`glossary.${term}`) : text}</span>, document.body)}
    </span>
  );
}




function metricTerm(label: string): GlossaryTerm | undefined {
  if (label.includes('ROAS')) return 'ROAS';
  if (label.includes('GMV') || label === 'metric.revenue') return 'GMV';
  if (label === 'metric.aov') return 'AOV';
  if (label.includes('STOCK')) return 'stock';
  if (label === 'CTR' || label === 'CPC' || label === 'CVR' || label === 'CPO') return label;
  return undefined;
}

/** The number in a metric card; numeric values count up to the final figure (instantly with reduced motion). */
function MetricValue({ metric }: { metric: Metric }) {
  const { locale, t } = useI18n();
  const numeric = metric.amount != null && !!metric.unit;
  const amount = useAnimatedNumber(numeric ? metric.amount! : 0);
  if (!numeric) return <>{t(metric.value)}</>;
  const shown = amount === metric.amount ? amount : metric.unit === 'MULTIPLIER' ? amount : Math.round(amount);
  if (metric.unit === 'CURRENCY') return <>{formatCompactCurrency(shown, locale)}</>;
  if (metric.unit === 'MULTIPLIER') return <>{`${formatNumber(shown, locale, 2)}x`}</>;
  if (metric.unit === 'DAYS') return <>{fill(t('metric.days'), { days: formatNumber(shown, locale) })}</>;
  return <>{formatNumber(shown, locale)}</>;
}

/**
 * A change that shows as zero ("0%", "0,0%", "+0.0%") is neither good nor bad: no arrow, no colour (C01-12).
 * Otherwise the API's own verdict decides, as before. The value is rounded to the one decimal it is shown with.
 */
export function metricChangeTone(metric: Pick<Metric, 'change' | 'changePct' | 'positive'>): 'positive' | 'negative' | 'neutral' {
  if (metric.changePct === null) return 'neutral';
  const shown = metric.changePct !== undefined ? metric.changePct : Number((metric.change ?? '').replace(/[^\d.,-]/g, '').replace(',', '.').replace(/^-?$/, 'NaN'));
  if (Number.isFinite(shown) && Math.round(shown * 10) === 0) return 'neutral';
  return metric.positive ? 'positive' : 'negative';
}

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  const { locale, t } = useI18n();
  if (!metrics.length) return <div className="card"><EmptyState label="metrics" /></div>;
  return (
    <div className="grid grid-4">
      {metrics.map((metric, index) => {
        const term = metricTerm(metric.label);
        return (
          <div className="card metric-card fade-in" key={`${metric.label}-${index}`} data-testid={`metric-card-${index}`}>
            <div className="eyebrow">{term ? <Hint term={term}>{t(metric.label)}</Hint> : t(metric.label)}</div>
            <div className="metric-value" data-testid={`text-metric-${index}`}><MetricValue metric={metric} />{metric.estimated && <span className="metric-estimate" title={t('metric.estimated.hint')} data-testid={`metric-estimated-${index}`}>{t('metric.estimated')}</span>}</div>
            {(() => {
              const tone = metricChangeTone(metric);
              return <div className={`metric-change ${tone}`} data-testid={`metric-change-${index}`}>
                {metric.changePct === null ? <span className="neutral">—</span> : <>{tone === 'neutral' ? null : metric.positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {metric.changePct !== undefined ? `${metric.changePct > 0 ? '+' : ''}${formatNumber(metric.changePct, locale, 1)}%` : t(metric.change)}</>}
              </div>;
            })()}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Keeps details one click away: a small toggle that slides the content open.
 * Collapsed content stays in the page but is inert, so keyboard and screen readers skip it.
 */
export function Reveal({ label, meta, children, className = '', testId }: { label?: string; meta?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={`reveal ${open ? 'open' : ''} ${className}`}>
      <button type="button" className="reveal-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} data-testid={testId}>
        <span>{open ? t('Свернуть') : (label ?? t('Подробнее'))}</span>
        {meta && <span className="reveal-meta">{meta}</span>}
        <ChevronDown size={13} className="reveal-chevron" aria-hidden />
      </button>
      <div className="reveal-panel" id={panelId} aria-hidden={!open} inert={!open}>
        <div className="reveal-inner"><div className="reveal-content">{children}</div></div>
      </div>
    </div>
  );
}

export function SummaryCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const { t } = useI18n();
  const text = useText();
  const title = insight.titleKey ? text(insight.titleKey, insight.params) : t(insight.title);
  const body = insight.bodyKey ? text(insight.bodyKey, insight.params) : t(insight.body);
  const impact = insight.impactAmount !== undefined && insight.impact === 'summary.impact' ? text('summary.impact', { amount: insight.impactAmount }) : t(insight.impact);
  return (
    <div className={`card summary ${compact ? 'signal-card' : ''}`} data-testid="card-ai-summary">
      <div className="summary-top">
        <span className="signal-mark"><BrainCircuit size={14} /></span>
        <span className="eyebrow">{t(insight.eyebrow || 'Сигнал ИИ')}</span>
      </div>
      <h2 className="summary-title">{title}</h2>
      <div className="summary-foot">
        <span className="confidence"><Hint term="confidence">{t('УВЕРЕННОСТЬ')} {insight.confidence}%</Hint></span>
        {impact !== '—' && <span className="impact">{t('ОЖИДАЕМЫЙ ЭФФЕКТ')} {impact}</span>}
        <span>{t(insight.severity === 'HIGH' ? 'ВЫСОКИЙ' : insight.severity === 'MEDIUM' ? 'СРЕДНИЙ' : 'НИЗКИЙ')} {t('СИГНАЛ').toLocaleLowerCase()}</span>
      </div>
      {body && <Reveal testId="reveal-summary"><p className="summary-body">{body}</p></Reveal>}
    </div>
  );
}

export function ConfidenceBasisView({ basis }: { basis: DashboardAction['confidenceBasis'] }) {
  const { t } = useI18n();
  return (
    <div className="confidence-basis">
      <span className="confidence-basis-title">{t('Почему такая уверенность')}</span>
      <ul>
        {basis.signals.map((signal) => (
          <li key={signal.key} className={signal.met ? 'met' : 'unmet'}>
            {signal.met ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
            <span className="sr-only">{signal.met ? '✓' : '✗'}</span>
            {t(`signal.${signal.key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Confirmed by 3 of 4 signals", shared by every place that explains a confidence. */
export function useConfidenceSupport() {
  const { t } = useI18n();
  return (basis: ConfidenceBasis) => fill(t('Подтверждают {supporting} из {total} сигналов'), { supporting: basis.supporting, total: basis.total });
}

/**
 * The reasons behind a confidence, one click away: how many signals confirm it and each signal, met or not.
 * Built from the API's confidenceBasis; renders nothing when the response has none.
 */
export function ConfidenceDisclosure({ basis, label, testId }: { basis?: ConfidenceBasis | null; label?: string; testId?: string }) {
  const { t } = useI18n();
  const support = useConfidenceSupport();
  if (!basis) return null;
  return (
    <Reveal label={label ?? t('Почему такая уверенность')} meta={support(basis)} testId={testId}>
      <ConfidenceBasisView basis={basis} />
    </Reveal>
  );
}

const verdicts: Verdict[] = ['WORKED', 'NOT_WORKED', 'TOO_EARLY'];

function FeedbackButtons({ action }: { action: DashboardAction }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const create = useCreateFeedback();
  const [saved, setSaved] = useState<Verdict | undefined>(action.verdict);
  if (!action.key) return null;
  const send = (verdict: Verdict) => {
    setSaved(verdict);
    create.mutate({ data: { actionKey: action.key!, actionType: action.type, sku: action.sku, object: action.object, verdict } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey().slice(0, 1) });
      },
      onError: () => setSaved(action.verdict),
    });
  };
  return (
    <div className="feedback-row" role="group" aria-label={t('action.feedback.question')}>
      <span>{t('action.feedback.question')}</span>
      {verdicts.map((verdict) => (
        <button type="button" key={verdict} className={`verdict ${verdict.toLowerCase()} ${saved === verdict ? 'active' : ''}`} aria-pressed={saved === verdict} disabled={create.isPending} onClick={() => send(verdict)} data-testid={`verdict-${verdict.toLowerCase()}`}>
          {t(`verdict.${verdict}`)}
        </button>
      ))}
    </div>
  );
}

const actionTone: Record<DashboardAction['type'], BadgeTone> = { SCALE: 'success', OPTIMIZE: 'warning', DEFEND: 'danger', FIX: 'info', WATCH: 'neutral', RESTOCK: 'danger' };

/**
 * One recommended action on the overview: what kind of move, its expected effect and how sure we are,
 * the next step, and the reasons one click away. Effect and confidence come from the API as they are.
 */
export function ActionCard({ action, index }: { action: DashboardAction; index: number }) {
  const { t } = useI18n();
  const text = useText();
  const support = useConfidenceSupport();
  const { signedIn } = useSession();
  const type = action.type.toLowerCase();
  const explanation = action.reasonKey ? text(action.reasonKey, action.params) : t(action.explanation);
  const recommendation = action.recommendationKey ? text(action.recommendationKey, action.params) : t(action.recommendation);
  const impact = action.impactAmount !== undefined && action.impact === 'action.impact' ? text('action.impact', { amount: action.impactAmount }) : t(action.impact);
  return (
    <article className={`rf-action rf-action--${type} fade-in stagger-${Math.min(index + 1, 3)}`} data-testid={`card-action-${index}`}>
      <header className="rf-action-head">
        <Badge tone={actionTone[action.type] ?? 'neutral'}>{t(`action.type.${action.type}`)}</Badge>
        {impact && impact !== '—' && <span className="rf-action-impact"><span className="visually-hidden">{t('action.effect')}: </span>{impact}</span>}
      </header>
      <h3 className="rf-action-object">{t(action.object)}</h3>
      <p className="rf-action-next"><strong>{t('Далее:')}</strong> {recommendation}</p>
      <div className="rf-action-confidence">
        <span className="rf-action-confidence-label"><Hint term="confidence">{t('action.confidence')}</Hint></span>
        <div className="rf-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={action.confidence} aria-label={t('action.confidence')}><span style={{ width: `${action.confidence}%` }} /></div>
        <strong className="rf-action-confidence-value">{action.confidence}%</strong>
      </div>
      <Reveal testId="reveal-action" label={t('Почему')} meta={action.confidenceBasis ? support(action.confidenceBasis) : undefined}>
        <p className="action-explanation">{explanation}</p>
        {action.confidenceBasis && <ConfidenceBasisView basis={action.confidenceBasis} />}
      </Reveal>
      {signedIn && <FeedbackButtons action={action} />}
    </article>
  );
}

/**
 * Events behind the snapshot, newest first. `windowLabel` names the period the list covers when the
 * data has one (the demo's last 7 days); a workspace's list is just its latest imports and verdicts.
 */
export function Timeline({ events, windowLabel }: { events: TimelineEvent[]; windowLabel?: string }) {
  const { locale, t } = useI18n();
  return (
    <div className="card rf-timeline-card">
      <div className="card-header"><span className="card-title">{t('Лента сигналов')}</span>{windowLabel && <span className="rf-timeline-window">{windowLabel}</span>}</div>
      {events.length ? <ol className="timeline">
        {events.map((event) => (
          <li className="timeline-item" key={event.id} data-testid={`timeline-event-${event.id}`}>
            <span className="timeline-node" aria-hidden />
            <time className="timeline-date" dateTime={event.date}>{formatDate(event.date, locale)}</time>
            <div><div className="timeline-label">{t(event.label)}</div><div className="timeline-detail">{t(event.detail)}</div></div>
          </li>
        ))}
      </ol> : <EmptyState label="timeline events" />}
    </div>
  );
}

type PageHeadProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** DataSource from the response. Without it, mode USER still means the workspace's own data. */
  source?: string;
  /** RedStat's answer for the snapshot (ready, partial…). */
  sourceStatus?: SourceStatus;
  mode?: DataMode;
  /** The response's refreshedAt; nothing is shown when it is missing, or when the workspace has no data yet (mode EMPTY). */
  refreshedAt?: string;
  /** "checked" when refreshedAt is the time a source was asked (RedStat), not when the data changed. */
  refreshedKind?: 'updated' | 'checked';
  /** The day the data reaches (dataAsOf), when the response has it. */
  dataAsOf?: string;
  action?: ReactNode;
};

export function PageHead({ eyebrow, title, subtitle, source, sourceStatus, mode, refreshedAt, refreshedKind = 'updated', dataAsOf, action }: PageHeadProps) {
  const { t } = useI18n();
  const shownSource = source ?? (mode === 'USER' ? 'USER DATA' : undefined);
  // An empty workspace has nothing that could have been updated; its timestamp is only the time of the answer.
  const updated = mode === 'EMPTY' ? undefined : refreshedAt;
  return (
    <div className="page-head">
      <div><div className="eyebrow">{t(eyebrow)}</div><h1 className="page-title">{t(title)}</h1><p className="page-subtitle">{t(subtitle)}</p></div>
      <div className="page-meta">
        {action}
        {shownSource && <DataSourceBadge source={shownSource} status={sourceStatus} />}
        {(updated || dataAsOf) && (
          <span className="rf-freshness-group">
            <DataFreshness at={updated} kind={refreshedKind} testId="page-refreshed-at" />
            <DataFreshness at={dataAsOf} kind="asOf" testId="page-data-as-of" />
          </span>
        )}
      </div>
    </div>
  );
}

export function PageFrame({ children, className = '', busy }: { children: ReactNode; className?: string; busy?: boolean }) {
  return <main className={`page fade-in ${className}`} aria-busy={busy || undefined}>{children}</main>;
}

export function SectionTitle({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return <div className="section-row"><h2 className="section-title">{title}</h2>{note && <span className="section-note">{note}</span>}{children}</div>;
}
