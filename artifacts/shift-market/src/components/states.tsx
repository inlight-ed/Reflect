import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CloudOff, Loader2, Lock, LogIn, RefreshCw, RotateCcw, WifiOff } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { fill, useI18n } from '@/lib/i18n';
import { canRetry, classifyError, useRetry, type ErrorKind } from '@/lib/query-state';
import { useSession } from '@/lib/session';
import { Button, InlineNotice, SkeletonCard, SkeletonMetric, SkeletonText } from '@/components/ui';
import { DataSourceBadge } from '@/components/data-trust';

/*
 * Common UI states: loading, empty, error (page and block), refreshing and a missing value.
 * Presentation only: the page keeps its query and passes `error` and its own `refetch`.
 */

const demoSource = 'DEMO DATA';

/**
 * The outline of a standard page while it loads: heading, a row of figures, cards, a chart.
 * Mirrors PageHead + MetricCards + a two-column grid, so the real page replaces it without a jump.
 */
export function PageSkeleton({ metrics = 4, cards = 2, chart = true, className }: { metrics?: number; cards?: number; chart?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <main className={`page rf-page-skeleton ${className ?? ''}`} aria-busy="true" data-testid="status-loading">
      <span className="visually-hidden" role="status">{t('Loading…')}</span>
      <div className="rf-page-skeleton-head"><SkeletonText lines={3} /></div>
      {metrics > 0 && <div className="grid grid-4 rf-page-skeleton-metrics">{Array.from({ length: metrics }, (_, key) => <SkeletonMetric key={key} />)}</div>}
      {cards > 0 && <div className="grid grid-2 rf-page-skeleton-cards">{Array.from({ length: cards }, (_, key) => <SkeletonCard key={key} height={200} />)}</div>}
      {chart && <SkeletonCard height={300} className="rf-page-skeleton-chart" />}
    </main>
  );
}

/** Kept for existing pages: the standard page outline. */
export function LoadingState() {
  return <PageSkeleton />;
}

const errorIcon: Record<ErrorKind, ReactNode> = {
  network: <WifiOff aria-hidden />, auth: <LogIn aria-hidden />, forbidden: <Lock aria-hidden />, rateLimit: <AlertTriangle aria-hidden />, timeout: <AlertTriangle aria-hidden />,
  server: <CloudOff aria-hidden />, request: <AlertTriangle aria-hidden />, parse: <AlertTriangle aria-hidden />, unexpected: <AlertTriangle aria-hidden />,
};

/**
 * Sign in again while the app still thinks the session is open but the server no longer accepts it.
 * The sign-in page sends a signed-in visitor on to the overview, so the stale session is closed first
 * through the app's own sign-out (which also clears cached answers); only then the sign-in page opens.
 */
function SignInAgain() {
  const { t } = useI18n();
  const { signOut, refresh } = useSession();
  const [, navigate] = useLocation();
  const [pending, setPending] = useState(false);
  const run = () => {
    if (pending) return;
    setPending(true);
    // If even sign-out fails, reloading the session tells the app it is signed out, and the link below takes over.
    void signOut().catch(() => refresh()).then(() => navigate('/login'), () => setPending(false));
  };
  return <Button variant="secondary" size="sm" icon={<LogIn />} pending={pending} onClick={run} data-testid="button-signin-again">{t('error.signin')}</Button>;
}

/** The one fitting way out of an error: retry, sign in again, check access again, or reload the page. */
function RecoveryAction({ kind, retry, pending, testId }: { kind: ErrorKind; retry: () => void; pending: boolean; testId: string }) {
  const { t } = useI18n();
  const { signedIn } = useSession();
  if (kind === 'auth') {
    return signedIn ? <SignInAgain /> : <Link href="/login" className="rf-button rf-button--secondary rf-button--sm" data-testid="button-signin-again"><LogIn aria-hidden /> {t('error.signin')}</Link>;
  }
  if (!canRetry(kind)) {
    return <Button variant="secondary" size="sm" icon={<RotateCcw />} onClick={() => window.location.reload()} data-testid="button-reload">{t('error.reload')}</Button>;
  }
  const label = pending ? t('error.retrying') : kind === 'forbidden' ? t('error.checkAgain') : t('Повторить');
  return <Button variant="secondary" size="sm" icon={<RefreshCw />} pending={pending} onClick={retry} data-testid={testId}>{label}</Button>;
}

/**
 * The page could not load. Says what kind of failure it was without technical detail, offers the
 * fitting recovery, keeps the source badge for a guest, and hands focus back to the page after a
 * successful retry so keyboard users are not left on a button that disappeared.
 */
export function ErrorState({ error, onRetry, source, kind: knownKind }: { error?: unknown; onRetry: () => Promise<unknown> | unknown; source?: string; kind?: ErrorKind }) {
  const { t } = useI18n();
  const { demo } = useSession();
  const kind = knownKind ?? classifyError(error);
  const { retry, pending } = useRetry(onRetry);
  const box = useRef<HTMLDivElement>(null);
  // The failed response carries no source. A guest is looking at the demo; for a signed-in person it is unknown, so no badge.
  const shown = source ?? (demo ? demoSource : undefined);
  // Whether focus is in the block. A pending retry disables its button, and the browser then drops focus to <body>
  // before the block unmounts, so focus inside the block at unmount time alone is not enough to know.
  const hadFocus = useRef(false);
  // Layout cleanup runs before the node leaves the DOM, while it can still tell whether it held focus.
  useLayoutEffect(() => {
    const node = box.current;
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body;
      if (node && (node.contains(active) || (hadFocus.current && lost))) requestAnimationFrame(() => document.getElementById('main-content')?.focus());
    };
  }, []);
  return (
    <main className="page" data-testid="status-error" data-error-kind={kind}>
      {shown && <div className="page-meta rf-state-meta"><DataSourceBadge source={shown} /></div>}
      <div className="rf-state rf-state--error" role="alert" ref={box} onFocus={() => { hadFocus.current = true; }} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) hadFocus.current = false; }}>
        <span className="rf-state-icon">{errorIcon[kind]}</span>
        <h1 className="rf-state-title">{t(`error.${kind}.title`)}</h1>
        <p className="rf-state-text">{t(`error.${kind}.body`)}</p>
        <div className="rf-state-actions"><RecoveryAction kind={kind} retry={() => void retry()} pending={pending} testId="button-retry" /></div>
      </div>
    </main>
  );
}

/**
 * One block failed while the rest of the page works: a notice in place of the block, with its own retry.
 * `what` names the block ("Outcomes of decisions"); `stale` says earlier data is still shown below.
 * `refreshing` says the block's request is running again (its retry, a refresh, a new period): the
 * notice stays and says so, with its button busy, until the request ends: gone on success, the error
 * again on failure. It is the one notice for the block meanwhile, so no separate "Updating…" beside it.
 */
export function BlockError({ error, onRetry, what, stale = false, refreshing = false, testId }: { error?: unknown; onRetry: () => Promise<unknown> | unknown; what: string; stale?: boolean; refreshing?: boolean; testId?: string }) {
  const { t } = useI18n();
  const kind = classifyError(error);
  const retryState = useRetry(onRetry);
  const { retry } = retryState;
  const pending = retryState.pending || refreshing;
  return (
    <InlineNotice
      tone={stale ? 'warning' : 'danger'}
      // A failure is announced at once; a warning about older data on screen, politely.
      announce={stale ? 'status' : 'alert'}
      className="rf-block-error"
      testId={testId}
      title={fill(t(stale ? 'state.staleError' : 'state.blockError'), { what })}
      action={<RecoveryAction kind={kind} retry={() => void retry()} pending={pending} testId={testId ? `${testId}-retry` : 'button-block-retry'} />}
    >
      {pending ? t('state.refreshing') : `${t(`error.${kind}.title`)}. ${t(`error.${kind}.body`)}`}
    </InlineNotice>
  );
}

/**
 * "Updating…" while a query refetches and the earlier data stays on screen (background refresh,
 * a new period). The live region is always rendered so the change is announced.
 */
export function RefreshingNotice({ active }: { active: boolean }) {
  const { t } = useI18n();
  return (
    <span className="rf-refreshing" role="status" aria-live="polite" data-testid="status-refreshing" data-active={active || undefined}>
      {active && <><Loader2 className="rf-refreshing-icon" aria-hidden />{t('state.refreshing')}</>}
    </span>
  );
}

export type MissingReason = 'notProvided' | 'notCalculable' | 'notApplicable' | 'unknown';

/** A value that is not there, shown as "—" with the reason for screen readers and the tooltip, never as 0. */
export function MissingValue({ reason = 'unknown' }: { reason?: MissingReason }) {
  const { t } = useI18n();
  const label = t(`missing.${reason}`);
  return <span className="rf-missing" title={label} data-testid="missing-value"><span aria-hidden>—</span><span className="visually-hidden">{label}</span></span>;
}

const emptyLabelKeys: Record<string, string> = {
  metrics: 'empty.metrics',
  'timeline events': 'empty.timeline',
  'market signal': 'empty.signal',
  impact: 'empty.impact',
  breakdown: 'empty.breakdown',
  integrations: 'empty.integrations',
  actions: 'empty.actions',
  channels: 'empty.channels',
  товаров: 'empty.products',
  кампаний: 'empty.campaigns',
  competitors: 'empty.competitors',
  'seller offers': 'empty.sellerOffers',
  'comparable products': 'empty.comparableProducts',
  recommendations: 'empty.recommendations',
  Strengths: 'empty.strengths',
  Weaknesses: 'empty.weaknesses',
};

/**
 * Nothing to show. With `title`, says what happened, `hint` says why (when known) and `action` what to
 * do next; without it, the short legacy line for blocks not yet migrated.
 */
export function EmptyState({ label, message, title, hint, action }: { label: string; message?: string; title?: string; hint?: string; action?: ReactNode }) {
  const { t } = useI18n();
  const testId = `empty-${label.toLowerCase().replace(/\s/g, '-')}`;
  if (title) {
    return (
      <div className="empty-box rf-empty" data-testid={testId}>
        <CloudOff size={24} aria-hidden />
        <h3 className="rf-empty-title">{title}</h3>
        {hint && <p className="rf-empty-hint">{hint}</p>}
        {action && <div className="rf-empty-action">{action}</div>}
      </div>
    );
  }
  return (
    <div className="empty-box" data-testid={testId}>
      <CloudOff size={24} aria-hidden />
      <p>{message ?? <>{t('В этом снимке нет данных:')} {t(emptyLabelKeys[label] ?? 'empty.items')}.</>}</p>
    </div>
  );
}
