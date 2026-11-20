import { keepPreviousData } from '@tanstack/react-query';
import { getGetDashboardQueryKey, useGetDashboard } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { formatLongDate, useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/use-now';
import { useLastData } from '@/lib/query-state';
import { ActionCard, BlockError, EmptyState, ErrorState, MetricCards, PageFrame, PageHead, PageSkeleton, RefreshingNotice, SectionTitle, SummaryCard, Timeline, demoSource } from '@/components/common';
import { SalesDashboard } from '@/components/sales-dashboard';
import { AssumptionsNote, ForecastList, Onboarding, Outcomes, PeriodBar, RevenueChart } from '@/components/seller';

function greetingKey(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Almaty' }).format(now));
  if (hour < 12) return 'Доброе утро.';
  if (hour < 18) return 'Добрый день.';
  return 'Добрый вечер.';
}

/**
 * The overview answers "what should I do today": the period's figures first, then the ranked actions,
 * then the trend and stock forecast, and below them the market signal, past outcomes and the event log.
 * Every figure, action and date comes from the dashboard response as it is.
 */
export default function OverviewPage() {
  const { locale, t } = useI18n();
  const { signedIn } = useSession();
  const { params } = usePeriod();
  const dashboardParams = signedIn ? params : undefined;
  // A new period keeps the current figures on screen (marked as updating) instead of blanking the page.
  const query = useGetDashboard(dashboardParams, { query: { queryKey: getGetDashboardQueryKey(dashboardParams), placeholderData: keepPreviousData } });
  const now = useNow(60_000);
  // When a new period fails, the figures already on screen stay (marked stale) instead of an error page.
  const lastData = useLastData(query.data);
  const shown = query.data ?? (query.isError ? lastData : undefined);
  if (!shown && query.isFetching) return <PageSkeleton className="rf-overview" />;
  // An error with nothing to show replaces the page; an error on refresh keeps the earlier data (below).
  if (!shown) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const dashboard = shown;
  const refreshing = query.isFetching;
  const metrics = Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  const actions = Array.isArray(dashboard.actions) ? dashboard.actions : [];
  const timeline = Array.isArray(dashboard.timeline) ? dashboard.timeline : [];
  const seller = dashboard.mode === 'USER';
  const head = <PageHead eyebrow={formatLongDate(now, locale)} title={greetingKey(now)} subtitle="Вот где ваше внимание сегодня принесёт больше всего результата." source={dashboard.source ?? demoSource} mode={dashboard.mode} refreshedAt={dashboard.refreshedAt} dataAsOf={dashboard.dataAsOf} action={<>{seller && <PeriodBar />}<RefreshingNotice active={refreshing} /></>} />;
  const staleError = query.isError && !refreshing
    ? <BlockError error={query.error} onRetry={query.refetch} what={t('Пульс бизнеса')} stale testId="overview-stale-error" />
    : null;

  if (dashboard.mode === 'EMPTY') {
    return <PageFrame className="rf-overview" busy={refreshing}>{head}{staleError}<Onboarding /></PageFrame>;
  }

  return (
    <PageFrame className="rf-overview" busy={refreshing}>
      {head}
      {staleError}

      <section className="rf-overview-section" aria-labelledby="overview-pulse">
        <SectionTitle title={<span id="overview-pulse">{t('Пульс бизнеса')}</span>} note={t(seller ? `compare.${dashboard.compare ?? 'previous'}` : 'сравнение с прошлым периодом')} />
        <div className="rf-overview-kpis"><MetricCards metrics={metrics} /></div>
        {seller && <AssumptionsNote assumptions={dashboard.assumptions} />}
      </section>

      <section className="rf-overview-section" aria-labelledby="overview-actions">
        <SectionTitle title={<span id="overview-actions">{t('Что сделать сегодня')}</span>} note={t('по эффекту × уверенности')} />
        {actions.length
          ? <div className="grid grid-2 rf-overview-actions">{actions.map((action, index) => <ActionCard action={action} index={index} key={action.key ?? `${action.object}-${index}`} />)}</div>
          : <div className="card">{seller
            ? <EmptyState label="actions" title={t('overview.noActions.title')} hint={t('overview.noActions.hint')} action={<Link href="/attention" className="rf-button rf-button--secondary rf-button--sm">{t('overview.noActions.cta')}</Link>} />
            : <EmptyState label="actions" />}</div>}
      </section>

      {seller ? (
        <section className="rf-overview-section">
          {dashboard.series && <RevenueChart series={dashboard.series} dataAsOf={dashboard.dataAsOf} />}
          <SectionTitle title={t('forecast.title')} note={t('forecast.note')} />
          <ForecastList items={dashboard.forecast ?? []} />
        </section>
      ) : (
        <section className="rf-overview-section"><SalesDashboard /></section>
      )}

      <section className="rf-overview-section" aria-labelledby="overview-signal">
        <SectionTitle title={<span id="overview-signal">{t('Сигнал по рынку')}</span>} note={t('на основе доступного снимка')} />
        {dashboard.summary ? <SummaryCard insight={dashboard.summary} /> : <div className="card"><EmptyState label="market signal" /></div>}
      </section>

      {seller && <Outcomes />}

      <section className="rf-overview-section" aria-labelledby="overview-log">
        <SectionTitle title={<span id="overview-log">{t('Как мы к этому пришли')}</span>} note={t('события, повлиявшие на снимок')} />
        {/* Only the demo's events cover a fixed window; a workspace lists its latest imports and verdicts. */}
        <Timeline events={timeline} windowLabel={seller ? undefined : t('последние 7 дней')} />
      </section>
    </PageFrame>
  );
}
