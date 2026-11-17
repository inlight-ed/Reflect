import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { useGetAttention, type AttentionItem } from '@workspace/api-client-react';
import { fill, formatCurrency, formatNumber, useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { ErrorState, LoadingState, PageFrame, PageHead, SectionTitle, demoSource } from '@/components/common';
import { Onboarding, PeriodBar } from '@/components/seller';

/** Where each kind of item is dealt with. A product item opens that product's economics. */
function target(item: AttentionItem) {
  if (item.type === 'SHOP_SALES_DROP') return '/overview';
  if (item.type === 'ADS_LOSING') return '/advertising';
  if (item.type === 'DATA_ORDERS_OUTDATED') return '/settings';
  if (item.type === 'DATA_SOLD_NOT_IN_CATALOG') return '/data';
  return item.sku ? `/products?sku=${encodeURIComponent(item.sku)}` : '/products';
}

function Row({ item }: { item: AttentionItem }) {
  const { locale, t } = useI18n();
  const params = Object.fromEntries(Object.entries(item.params ?? {}).map(([key, value]) => [key, typeof value === 'number' && key !== 'days' && key !== 'lead' && key !== 'count'
    ? (['lost', 'loss', 'spend', 'perDay', 'ads'].includes(key) ? formatCurrency(value, locale) : formatNumber(value, locale, 1))
    : value]));
  return (
    <li className={`attention-item ${item.severity === 'HIGH' ? 'high' : ''}`} data-testid={`attention-${item.key}`}>
      <span className="attention-mark" aria-hidden />
      <div className="attention-copy">
        <strong>{fill(t(`attention.${item.type}`), params)}</strong>
        {item.name && !item.type.startsWith('DATA_') && <span>{item.name}</span>}
        {item.type.startsWith('DATA_') && <span>{fill(t(`attention.${item.type}.next`), params)}</span>}
      </div>
      {item.impactAmount > 0 && <span className="attention-impact">{fill(t(item.type.startsWith('DATA_') ? 'attention.affects' : 'attention.atStake'), { amount: formatCurrency(item.impactAmount, locale) })}</span>}
      <Link href={target(item)} className="attention-go" aria-label={t('attention.open')}><ArrowRight size={16} aria-hidden /></Link>
    </li>
  );
}

export default function AttentionPage() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const { params } = usePeriod();
  const query = useGetAttention(signedIn ? params : undefined);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const data = query.data;
  const seller = data.mode === 'USER';
  const head = <PageHead eyebrow="attention.eyebrow" title="attention.title" subtitle="attention.subtitle" source={seller ? undefined : demoSource} refreshedAt={data.refreshedAt} action={seller ? <PeriodBar /> : undefined} />;
  if (data.mode === 'EMPTY') return <PageFrame>{head}<Onboarding /></PageFrame>;
  const high = data.items.filter((item) => item.severity === 'HIGH');
  const medium = data.items.filter((item) => item.severity === 'MEDIUM');
  return (
    <PageFrame>
      {head}
      {data.items.length === 0 ? (
        <div className="card card-pad attention-clear" data-testid="attention-clear">{t('attention.clear')}</div>
      ) : (
        <>
          {high.length > 0 && <>
            <SectionTitle title={t('attention.high')} note={String(high.length)} />
            <ul className="attention-list" data-testid="attention-high">{high.map((item) => <Row item={item} key={item.key} />)}</ul>
          </>}
          {medium.length > 0 && <>
            <SectionTitle title={t('attention.medium')} note={String(medium.length)} />
            <ul className="attention-list" data-testid="attention-medium">{medium.map((item) => <Row item={item} key={item.key} />)}</ul>
          </>}
        </>
      )}
    </PageFrame>
  );
}
