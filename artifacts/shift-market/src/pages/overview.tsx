import { useGetDashboard } from '@workspace/api-client-react';
import { formatLongDate, useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/use-now';
import { ActionCard, EmptyState, ErrorState, MetricCards, PageFrame, PageHead, SectionTitle, SummaryCard, Timeline, demoSource } from '@/components/common';
import { SalesDashboard } from '@/components/sales-dashboard';
import { AssumptionsNote, ForecastList, Onboarding, Outcomes, PeriodBar, RevenueChart } from '@/components/seller';
import { SkeletonCard, SkeletonMetric, SkeletonText } from '@/components/ui';

function greetingKey(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Almaty' }).format(now));
  if (hour < 12) return 'Доброе утро.';
  if (hour < 18) return 'Добрый день.';
  return 'Добрый вечер.';
}

/** The overview's own shape while it loads: heading, four figures, two actions, the chart. */
function OverviewSkeleton() {
  const { t } = useI18n();
  return (
    <main className="page rf-overview" aria-busy="true" data-testid="status-loading">
      <span className="visually-hidden" role="status">{t('Loading…')}</span>
      <div className="rf-overview-skeleton-head"><SkeletonText lines={3} /></div>
      <div className="grid grid-4 rf-overview-kpis">{[0, 1, 2, 3].map((key) => <SkeletonMetric key={key} />)}</div>
      <div className="grid grid-2 rf-overview-actions">{[0, 1].map((key) => <SkeletonCard key={key} height={200} />)}</div>
      <SkeletonCard height={300} className="rf-overview-skeleton-chart" />
    </main>
  );
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
  const query = useGetDashboard(signedIn ? params : undefined);
  const now = useNow(60_000);
  if (query.isLoading) return <OverviewSkeleton />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const dashboard = query.data;
  const metrics = Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  const actions = Array.isArray(dashboard.actions) ? dashboard.actions : [];
  const timeline = Array.isArray(dashboard.timeline) ? dashboard.timeline : [];
  const seller = dashboard.mode === 'USER';
  const head = <PageHead eyebrow={formatLongDate(now, locale)} title={greetingKey(now)} subtitle="Вот где ваше внимание сегодня принесёт больше всего результата." source={dashboard.source ?? demoSource} mode={dashboard.mode} refreshedAt={dashboard.refreshedAt} dataAsOf={dashboard.dataAsOf} action={seller ? <PeriodBar /> : undefined} />;

  if (dashboard.mode === 'EMPTY') {
    return <PageFrame className="rf-overview">{head}<Onboarding /></PageFrame>;
  }

  return (
    <PageFrame className="rf-overview">
      {head}

      <section className="rf-overview-section" aria-labelledby="overview-pulse">
        <SectionTitle title={<span id="overview-pulse">{t('Пульс бизнеса')}</span>} note={t(seller ? `compare.${dashboard.compare ?? 'previous'}` : 'сравнение с прошлым периодом')} />
        <div className="rf-overview-kpis"><MetricCards metrics={metrics} /></div>
        {seller && <AssumptionsNote assumptions={dashboard.assumptions} />}
      </section>

      <section className="rf-overview-section" aria-labelledby="overview-actions">
        <SectionTitle title={<span id="overview-actions">{t('Что сделать сегодня')}</span>} note={t('по эффекту × уверенности')} />
        {actions.length
          ? <div className="grid grid-2 rf-overview-actions">{actions.map((action, index) => <ActionCard action={action} index={index} key={action.key ?? `${action.object}-${index}`} />)}</div>
          : <div className="card"><EmptyState label="actions" /></div>}
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
