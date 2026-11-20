import type { ReactNode } from 'react';
import { Database, FlaskConical } from 'lucide-react';
import { Link } from 'wouter';
import { useGetAdvertising, type AdvertisingActivity, type AdvertisingChannel, type SkuAd } from '@workspace/api-client-react';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { PeriodBar } from '@/components/seller';
import { formatCurrency, formatDate, formatNumber, useI18n } from '@/lib/i18n';
import { EmptyState, ErrorState, Hint, LoadingState, MetricCards, PageFrame, PageHead, Reveal, SectionTitle, SummaryCard, demoSource } from '@/components/common';
import { DataSourceBadge } from '@/components/data-trust';
import { Badge } from '@/components/ui';

export default function AdvertisingPage() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const { params } = usePeriod();
  const query = useGetAdvertising(signedIn ? params : undefined);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={query.refetch} source={query.data?.source} />;
  const data = query.data;
  if (data.mode === 'USER' || data.mode === 'EMPTY') {
    return (
      <PageFrame>
        <PageHead eyebrow="Распределение внимания" title="Покупайте внимание с пониманием причины." subtitle="Эффективность каждого канала, а не усреднённая картина." source={data.source} mode={data.mode} /* No time for the workspace's ads: the API puts the moment of the request in refreshedAt, not when the data changed. */ action={<PeriodBar />} />
        {data.mode === 'EMPTY' ? (
          <div className="card"><EmptyState label="ads" message={t('ads.empty')} /><div className="center-actions"><Link href="/data" className="btn">{t('nav.data')}</Link></div></div>
        ) : (
          <>
            <SummaryCard insight={data.signal} />
            <div className="section-gap" />
            <MetricCards metrics={data.primaryMetrics} />
            <SectionTitle title={t('ads.table.title')} note={<Hint term="ROAS">ROAS</Hint>} />
            <SkuAdsTable rows={data.skuAds ?? []} />
          </>
        )}
      </PageFrame>
    );
  }
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const activities = Array.isArray(data.activities) ? data.activities : [];
  return (
    <PageFrame>
      <PageHead eyebrow="Распределение внимания" title="Покупайте внимание с пониманием причины." subtitle="Эффективность каждого канала, а не усреднённая картина." source={data.source ?? demoSource} mode={data.mode} refreshedAt={data.refreshedAt} />
      <div className="advertising-note" data-testid="advertising-demo-notice"><Database size={14} /><span>{t('Демо-данные и причинное влияние оценены, а не подтверждены live-источником.')}</span></div>
      <SectionTitle title={t('Рекламные каналы')} note={t('source.demoEstimate')} />
      {channels.length ? <div className="ad-channel-grid">{channels.map((channel) => <AdvertisingChannelCard channel={channel} key={channel.id} />)}</div> : <div className="card"><EmptyState label="channels" /></div>}
      <SectionTitle title={t('Последние активности')} note={t('последние изменения, повлиявшие на оценку заказов')} />
      <AdvertisingActivityFeed activities={activities} />
    </PageFrame>
  );
}

function AdvertisingChannelCard({ channel }: { channel: AdvertisingChannel }) {
  const { locale, t } = useI18n();
  const metrics: Array<[ReactNode, string]> = [
    [t('Показы'), formatNumber(channel.impressions, locale)],
    [t('Клики'), formatNumber(channel.clicks, locale)],
    [<Hint term="CTR" key="ctr">CTR</Hint>, `${formatNumber(channel.ctr, locale, 2)}%`],
    [<Hint term="CPC" key="cpc">CPC</Hint>, formatCurrency(channel.cpc, locale, 2)],
    [t('Оценочные заказы'), formatNumber(channel.estimatedOrders, locale)],
  ];
  return <section className="ad-channel-card" data-testid={`card-ad-channel-${channel.id.toLowerCase()}`}>
    <div className="ad-channel-heading">
      <div>{channel.source === 'DEMO DATA' || channel.source === 'MOCK'
        ? <Badge tone="warning" icon={<FlaskConical />} description={t('source.demoEstimate.hint')}>{t('source.demoEstimate')}</Badge>
        : <DataSourceBadge source={channel.source} testId={`channel-source-${channel.id.toLowerCase()}`} />}<h2>{t(channel.name)}</h2></div>
      <span className="ad-channel-source">{t(channel.id === 'KASPI' ? 'Внутренняя реклама Kaspi' : `Канал ${channel.id[0]}${channel.id.slice(1).toLowerCase()}`)}</span>
    </div>
    <div className="channel-metrics">
      {metrics.map(([label, value], index) => <div key={index}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <SummaryCard insight={channel.signal} compact />
    <Reveal className="channel-activity-reveal" label={t('Активности и влияние')} meta={String(channel.activities.length)} testId={`reveal-activities-${channel.id.toLowerCase()}`}>
    <div className="channel-activity-list">
      <div className="activity-list-head"><span>{t('Активности и влияние')}</span><span>{t('Оценочный эффект')}</span></div>
      {channel.activities.map((activity) => <div className="channel-activity" key={activity.id}>
        <span className="timeline-date">{formatDate(activity.date, locale)}</span>
        <div><strong>{t(activity.eventType)}</strong><p>{t(activity.explanation)}</p></div>
        <span className="impact">{t(activity.estimatedImpact)}</span>
      </div>)}
    </div>
    </Reveal>
  </section>;
}

function AdvertisingActivityFeed({ activities }: { activities: AdvertisingActivity[] }) {
  const { locale, t } = useI18n();
  if (!activities.length) {
    return <div className="card"><EmptyState label="timeline events" /></div>;
  }
  return <div className="card activity-feed" data-testid="advertising-activity-feed">
    <div className="table-wrap table-scroll">
      <table className="data-table">
        <thead><tr><th>{t('Дата')}</th><th>{t('Канал')}</th><th className="col-wrap">{t('Событие')}</th><th className="col-wrap">{t('Возможное влияние на оценочные заказы')}</th></tr></thead>
        <tbody>{activities.map((activity) => <tr key={activity.id} data-testid={`advertising-activity-${activity.id}`}>
          <td>{formatDate(activity.date, locale)}</td><td>{t(activity.channel)}</td><td className="col-wrap">{t(activity.eventType)}<span className="table-sub">{t(activity.explanation)}</span></td><td className="positive">{t(activity.estimatedImpact)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function SkuAdsTable({ rows }: { rows: SkuAd[] }) {
  const { locale, t } = useI18n();
  return <div className="card"><div className="table-wrap table-scroll" data-testid="sku-ads"><table className="data-table">
    <thead><tr><th className="col-wrap">{t('SKU / товар')}</th><th>{t('metric.adSpend')}</th><th>{t('Выручка')}</th><th>ROAS</th><th>{t('ads.col.breakeven')}</th><th className="col-decision">{t('ads.col.verdict')}</th></tr></thead>
    <tbody>{rows.map((row) => {
      const verdict = row.roas === null || row.roas === undefined || row.breakevenRoas === null || row.breakevenRoas === undefined ? 'unknown' : row.roas >= row.breakevenRoas ? 'ok' : 'loss';
      return <tr key={row.sku}>
        <td className="col-wrap">{row.name}<span className="table-sub">{row.sku}</span></td>
        <td>{formatCurrency(row.spend, locale)}</td>
        <td>{formatCurrency(row.revenue, locale)}</td>
        <td>{row.roas === null || row.roas === undefined ? '—' : `${formatNumber(row.roas, locale, 2)}x`}</td>
        <td>{row.breakevenRoas === null || row.breakevenRoas === undefined ? '—' : `${formatNumber(row.breakevenRoas, locale, 2)}x`}</td>
        <td className="col-decision"><span className={`status-tag ${verdict === 'ok' ? 'tag-scale' : verdict === 'loss' ? 'tag-stop' : 'tag-keep'}`}>{t(`ads.verdict.${verdict}`)}</span></td>
      </tr>;
    })}</tbody>
  </table></div></div>;
}
