import { useState } from 'react';
import { Link } from 'wouter';
import { useGetCompetitors } from '@workspace/api-client-react';
import { formatCurrency, formatNumber, useI18n } from '@/lib/i18n';
import { EmptyState, ErrorState, Hint, LoadingState, PageFrame, PageHead, SectionTitle, SummaryCard } from '@/components/common';
import { MarketSection } from '@/components/market';

const DEFAULT_SKU = '11700213';

export default function CompetitorsPage() {
  const { locale, sourceT, t } = useI18n();
  const [skuInput, setSkuInput] = useState(DEFAULT_SKU);
  const [selectedSku, setSelectedSku] = useState(DEFAULT_SKU);
  const query = useGetCompetitors({ kaspiSku: selectedSku });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} source={query.data?.source} />;
  const data = query.data;
  const sellers = Array.isArray(data.sellers) ? data.sellers : [];
  const alternatives = Array.isArray(data.alternatives) ? data.alternatives : [];
  const detail = data.detail
    ? sourceT(data.detail)
    : data.status === 'NO_DATA'
      ? t('No RedStat data found for this SKU.')
      : data.status === 'UNAVAILABLE'
        ? t('RedStat is temporarily unavailable.')
        : data.status === 'PARTIAL'
          ? t('RedStat returned partial data.')
          : undefined;
  const canSubmit = skuInput.trim().length > 0 && !query.isFetching;
  return <PageFrame>
    <PageHead eyebrow={t('REDSTAT COMPETITOR ANALYSIS')} title={t('Analyze competitors')} subtitle={t('Enter a Kaspi SKU to inspect its sellers and comparable products.')} source={data.source} sourceStatus={data.source === 'REDSTAT' ? data.status : undefined} refreshedAt={data.source === 'REDSTAT' ? data.refreshedAt : undefined} refreshedKind="checked" dataAsOf={data.dataAsOf} />
    <form className="card competitor-query" onSubmit={(event) => { event.preventDefault(); const nextSku = skuInput.trim(); if (nextSku === selectedSku) void query.refetch(); else setSelectedSku(nextSku); }}>
      <div className="field"><label htmlFor="competitor-kaspi-sku"><Hint term="SKU">{t('Kaspi product code')}</Hint></label><input id="competitor-kaspi-sku" inputMode="numeric" value={skuInput} onChange={(event) => setSkuInput(event.target.value)} maxLength={64} required data-testid="input-competitor-sku" /></div>
      <button className="btn" type="submit" disabled={!canSubmit} data-testid="button-analyze-competitors">{query.isFetching ? t('Loading…') : t('Analyze SKU')}</button>
    </form>
    {detail && <div className="card card-pad competitor-status" role="status" data-testid="redstat-connection-status"><strong>{t('RedStat data status')}</strong><p>{detail}</p>{data.detail === 'connector.redstat.connect_in_settings' && <Link href="/settings" className="btn secondary">{t('competitors.openSettings')}</Link>}</div>}
    {data.insight && <SummaryCard insight={data.insight} />}
    {data.market && <MarketSection market={data.market} />}
    <SectionTitle title={t('Sellers on this Kaspi card')} note={<>{sellers.length} {t('offers')}</>} />
    <div className="card table-wrap">{sellers.length ? <table className="data-table"><thead><tr><th>{t('Seller')}</th><th>{t('Price')}</th><th>{t('Rating')}</th><th>{t('Reviews')}</th><th>{t('Availability')}</th></tr></thead><tbody>{sellers.map((seller, index) => <tr key={`${seller.name}-${index}`}><td>{seller.url ? <a href={seller.url} target="_blank" rel="noreferrer noopener">{seller.name}</a> : seller.name}</td><td>{formatCurrency(seller.price, locale, 2)}</td><td>{seller.rating == null ? '—' : seller.rating}</td><td>{seller.reviews == null ? '—' : formatNumber(seller.reviews, locale)}</td><td>{seller.availability ?? '—'}</td></tr>)}</tbody></table> : <EmptyState label="seller offers" />}</div>
    <SectionTitle title={t('Comparable products')} note={<>{alternatives.length} {t('products')}</>} />
    <div className="card table-wrap">{alternatives.length ? <table className="data-table"><thead><tr><th>{t('Kaspi SKU')}</th><th>{t('Product')}</th><th>{t('Price')}</th><th>{t('Seller count')}</th><th>{t('Sales in snapshot')}</th></tr></thead><tbody>{alternatives.map((product) => <tr key={product.kaspiSku}><td>{product.kaspiSku}</td><td>{product.name}</td><td>{product.price == null ? '—' : formatCurrency(product.price, locale, 2)}</td><td>{product.sellerCount == null ? '—' : formatNumber(product.sellerCount, locale)}</td><td>{product.saleQty == null ? '—' : formatNumber(product.saleQty, locale)}</td></tr>)}</tbody></table> : <EmptyState label="comparable products" />}</div>
  </PageFrame>;
}
