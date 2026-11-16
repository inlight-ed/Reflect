import { useGetDashboard } from '@workspace/api-client-react';
import { formatLongDate, useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/use-now';
import { ActionCard, EmptyState, ErrorState, LoadingState, MetricCards, PageFrame, PageHead, SectionTitle, SummaryCard, Timeline, demoSource } from '@/components/common';
import { SalesDashboard } from '@/components/sales-dashboard';
import { AssumptionsNote, ForecastList, Onboarding, Outcomes, PeriodBar, RevenueChart } from '@/components/seller';

function greetingKey(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Almaty' }).format(now));
  if (hour < 12) return 'Доброе утро.';
  if (hour < 18) return 'Добрый день.';
  return 'Добрый вечер.';
}

export default function OverviewPage() {
  const { locale, t } = useI18n();
  const { signedIn } = useSession();
  const { params } = usePeriod();
  const query = useGetDashboard(signedIn ? params : undefined);
  const now = useNow(60_000);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} source={demoSource} />;
  const dashboard = query.data;
  const metrics = Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  const actions = Array.isArray(dashboard.actions) ? dashboard.actions : [];
  const timeline = Array.isArray(dashboard.timeline) ? dashboard.timeline : [];
  const head = <PageHead eyebrow={formatLongDate(now, locale)} title={greetingKey(now)} subtitle="Рынок изменился за ночь. Вот где ваше внимание принесёт больше всего результата." source={dashboard.source ?? demoSource} refreshedAt={dashboard.refreshedAt} action={dashboard.mode === 'USER' ? <PeriodBar /> : undefined} />;

  if (dashboard.mode === 'EMPTY') {
    return <PageFrame>{head}<Onboarding /></PageFrame>;
  }

  if (dashboard.mode === 'USER') {
    return (
      <PageFrame>
        {head}
        <AssumptionsNote assumptions={dashboard.assumptions} />
        <SectionTitle title={t('Что сделать сегодня')} note={t('по эффекту × уверенности')} />
        {actions.length ? <div className="grid grid-2 action-grid">{actions.map((action, index) => <ActionCard action={action} index={index} key={action.key ?? `${action.object}-${index}`} />)}</div> : <div className="card"><EmptyState label="actions" /></div>}
        <SectionTitle title={t('Сигнал по рынку')} note={t('на основе доступного снимка')} />
        <SummaryCard insight={dashboard.summary} />
        <SectionTitle title={t('Пульс бизнеса')} note={t(`compare.${dashboard.compare ?? 'previous'}`)} />
        <MetricCards metrics={metrics} />
        {dashboard.series && <><div className="section-gap" /><RevenueChart series={dashboard.series} /></>}
        <SectionTitle title={t('forecast.title')} note={t('forecast.note')} />
        <ForecastList items={dashboard.forecast ?? []} />
        <Outcomes />
        <SectionTitle title={t('Как мы к этому пришли')} note={t('события, повлиявшие на снимок')} />
        <Timeline events={timeline} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {head}
      <SectionTitle title={t('Что сделать сегодня')} note={t('по эффекту × уверенности')} />
      {actions.length ? <div className="grid grid-2 action-grid">{actions.map((action, index) => <ActionCard action={action} index={index} key={`${action.object}-${index}`} />)}</div> : <div className="card"><EmptyState label="actions" /></div>}
      <SectionTitle title={t('Сигнал по рынку')} note={t('на основе доступного снимка')} />
      {dashboard.summary ? <SummaryCard insight={dashboard.summary} /> : <div className="card"><EmptyState label="market signal" /></div>}
      <SectionTitle title={t('Пульс бизнеса')} note={t('сравнение с прошлым периодом')} />
      <MetricCards metrics={metrics} />
      <div className="section-gap" />
      <SalesDashboard />
      <SectionTitle title={t('Как мы к этому пришли')} note={t('события, повлиявшие на снимок')} />
      <Timeline events={timeline} />
    </PageFrame>
  );
}
