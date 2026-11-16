import { ExternalLink } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MarketContext, MarketPoint } from '@workspace/api-client-react';
import { axisTick, chartColors, formatMonthShort, gridProps, tooltipProps } from '@/lib/chart-theme';
import { fill, formatCompactCurrency, formatCurrency, formatMonthYear, formatNumber, useI18n } from '@/lib/i18n';
import { Reveal, SectionTitle } from '@/components/common';

const pctText = (value: number, locale: Parameters<typeof formatNumber>[1]) => `${formatNumber(value, locale, 1)}%`;

/**
 * The card in its market, from RedStat: the card's own month, the niche split into price
 * segments, the niche month by month and its leading brands. Every figure is RedStat's; months
 * RedStat marks as not comparable are drawn faded and never described as growth or decline.
 */
export function MarketSection({ market }: { market: MarketContext }) {
  const { locale, t } = useI18n();
  const { product, category, dynamics } = market;
  const monthLabel = fill(t('market.month'), { month: formatMonthYear(market.month, locale) });
  const yourSegment = product?.segment;
  const links = (kaspiUrl?: string, redstatUrl?: string) => (
    <span className="market-links">
      {kaspiUrl && <a href={kaspiUrl} target="_blank" rel="noreferrer noopener">{t('market.openKaspi')}<ExternalLink size={11} aria-hidden /></a>}
      {redstatUrl && <a href={redstatUrl} target="_blank" rel="noreferrer noopener">{t('market.openRedstat')}<ExternalLink size={11} aria-hidden /></a>}
    </span>
  );

  return (
    <section className="market" data-testid="market">
      <SectionTitle title={t('market.title')} note={monthLabel} />
      {product ? (
        <div className="card card-pad market-product" data-testid="market-product">
          <div className="market-product-head">
            <div>
              <strong>{product.name}</strong>
              <span className="market-path">{[product.brand, product.category].filter(Boolean).join(' · ')}</span>
            </div>
            {links(product.kaspiUrl, product.redstatUrl)}
          </div>
          <dl className="market-figures">
            {product.price != null && <div><dt>{t('market.price')}</dt><dd>{formatCurrency(product.price, locale)}</dd></div>}
            {product.orders != null && <div><dt>{t('market.orders')}</dt><dd>{formatNumber(product.orders, locale)}</dd></div>}
            {product.revenue != null && <div><dt>{t('market.revenue')}</dt><dd>{formatCompactCurrency(product.revenue, locale)}</dd></div>}
            {product.sellerCount != null && <div><dt>{t('market.sellers')}</dt><dd>{formatNumber(product.sellerCount, locale)}</dd></div>}
            {product.rating != null && <div><dt>{t('market.rating')}</dt><dd>{formatNumber(product.rating, locale, 1)}{product.reviews != null && <small>{fill(t('market.reviews'), { count: formatNumber(product.reviews, locale) })}</small>}</dd></div>}
            <div data-testid="market-change"><dt>{t('market.change')}</dt><dd className={product.revenueChangePct == null ? 'neutral' : product.revenueChangePct >= 0 ? 'positive' : 'negative'}>{product.revenueChangePct == null ? <small>{t('market.change.none')}</small> : `${product.revenueChangePct > 0 ? '+' : ''}${pctText(product.revenueChangePct, locale)}`}</dd></div>
          </dl>
          {(product.segment || product.branded !== undefined) && (
            <p className="market-tags">
              {product.segment && <span className="market-tag">{t('market.segment')}: {product.segment}</span>}
              {product.branded !== undefined && <span className="market-tag">{t(product.branded ? 'market.branded' : 'market.unbranded')}</span>}
            </p>
          )}
          {market.note && <Reveal label={t('market.note')} testId="market-note"><p className="market-note">{market.note}</p></Reveal>}
        </div>
      ) : (
        <div className="card card-pad competitor-status" role="status">{t('market.notFound')}</div>
      )}

      {category && category.segments.length > 0 && (
        <>
          <SectionTitle title={t('market.segments.title')} note={<>{category.name} {links(category.kaspiUrl, category.redstatUrl)}</>} />
          <div className="card table-wrap">
            <table className="data-table market-segments" data-testid="market-segments">
              <thead><tr><th>{t('market.segment')}</th><th>{t('market.segments.range')}</th><th>{t('market.segments.share')}</th><th>{t('market.segments.sellers')}</th><th>{t('market.segments.noBrand')}</th></tr></thead>
              <tbody>
                {category.segments.map((segment) => {
                  const yours = yourSegment === segment.name;
                  return (
                    <tr key={segment.index} className={yours ? 'yours' : undefined}>
                      <td>{segment.name}{yours && <span className="market-yours">{t('market.segments.yours')}</span>}</td>
                      <td>{formatCurrency(segment.minPrice, locale)} – {formatCurrency(segment.maxPrice, locale)}</td>
                      <td><span className="share-bar" aria-hidden><i style={{ width: `${Math.min(100, segment.revenueSharePct)}%` }} /></span>{pctText(segment.revenueSharePct, locale)}</td>
                      <td>{segment.avgSellers == null ? '—' : formatNumber(segment.avgSellers, locale, 1)}</td>
                      <td>{segment.noBrandPct == null ? '—' : pctText(segment.noBrandPct, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dynamics && dynamics.points.length > 1 && <MarketChart points={dynamics.points} peakMonth={dynamics.peakMonth} forecastPublished={dynamics.forecastPublished} />}

      {category && category.brands.length > 0 && (
        <>
          <SectionTitle title={t('market.brands.title')} />
          <ol className="card market-brands" data-testid="market-brands">
            {category.brands.map((brand) => (
              <li key={brand.name}>
                <span className="market-brand-name">{brand.redstatUrl ? <a href={brand.redstatUrl} target="_blank" rel="noreferrer noopener">{brand.name}</a> : brand.name}</span>
                <span>{formatCompactCurrency(brand.revenue, locale)}</span>
                {brand.skuCount != null && <span className="neutral">{fill(t('market.brands.skus'), { count: formatNumber(brand.skuCount, locale) })}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function MarketChart({ points, peakMonth, forecastPublished }: { points: MarketPoint[]; peakMonth?: number; forecastPublished: boolean }) {
  const { locale, t } = useI18n();
  const notes = [peakMonth ? fill(t('market.dynamics.peak'), { month: t(`market.monthName.${peakMonth}`) }) : null, forecastPublished ? null : t('market.dynamics.noForecast')].filter(Boolean).join(' · ');
  return (
    <>
      <SectionTitle title={t('market.dynamics.title')} note={notes} />
      <section className="card card-pad market-chart" data-testid="market-dynamics">
        <div className="chart-head">
          <span className="card-title">{t('market.dynamics.revenue')}</span>
          <span className="chart-legend"><i className="swatch current" />{t('market.dynamics.comparable')}<i className="swatch faded" />{t('market.dynamics.notComparable')}</span>
        </div>
        <div className="chart-body">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" tickFormatter={(value) => formatMonthShort(String(value), locale)} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={64} tickFormatter={(value) => formatCompactCurrency(Number(value), locale)} />
              <Tooltip
                {...tooltipProps}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                labelFormatter={(value) => formatMonthYear(String(value), locale)}
                formatter={(value, _name, item) => {
                  const point = item?.payload as MarketPoint | undefined;
                  return [formatCurrency(Number(value), locale), point?.comparable ? t('market.dynamics.revenue') : `${t('market.dynamics.revenue')} — ${point?.note ?? t('market.dynamics.notComparable')}`];
                }}
              />
              <Bar dataKey="revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {points.map((point) => <Cell key={point.month} fill={chartColors.accent} fillOpacity={point.comparable ? 0.9 : 0.35} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
