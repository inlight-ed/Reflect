import { useMemo, useState } from 'react';
import { useGetProducts, type Product } from '@workspace/api-client-react';
import { fill, formatCurrency, formatNumber, formatPercent, useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useSession } from '@/lib/session';
import { EmptyState, ErrorState, Hint, LoadingState, PageFrame, PageHead, SectionTitle, demoSource, statusLabel } from '@/components/common';
import { Onboarding, PeriodBar } from '@/components/seller';
import { DataIssues, ProductEconomics } from '@/components/product-economics';

type Filter = 'ALL' | 'SCALE' | 'FIX' | 'DEFEND' | 'STOP' | 'WATCH';

// Demo matrix: ad efficiency (ROAS) × demand growth. Seller matrix: margin × sales trend.
const DEMO_X: [number, number] = [2.5, 7];
const DEMO_Y: [number, number] = [0, 24];
const USER_X: [number, number] = [-0.1, 0.7];
const USER_Y: [number, number] = [-60, 60];
const position = (value: number, [min, max]: [number, number]) => Math.max(4, Math.min(96, ((value - min) / (max - min)) * 100));

export default function ProductsPage() {
  const { locale, t } = useI18n();
  const { signedIn } = useSession();
  const { params } = usePeriod();
  const query = useGetProducts(signedIn ? params : undefined);
  const [filter, setFilter] = useState<Filter>('ALL');
  // A link from "Needs attention" (/products?sku=…) opens that product's economics.
  const [selectedSku, setSelectedSku] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get('sku') ?? undefined);
  const allProducts = useMemo(() => (Array.isArray(query.data?.products) ? query.data.products : []), [query.data]);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} source={query.data?.source} />;
  const data = query.data;
  const seller = data.mode === 'USER';
  const products = filter === 'ALL' ? allProducts : allProducts.filter((product) => product.opportunity === filter);
  const matrix = (Array.isArray(data.matrix) ? data.matrix : []).filter((item) => seller || item.label !== 'WATCH');
  const filters: Filter[] = seller ? ['ALL', 'SCALE', 'FIX', 'DEFEND', 'STOP', 'WATCH'] : ['ALL', 'SCALE', 'FIX', 'DEFEND', 'STOP'];
  const selected = allProducts.find((product) => product.sku === selectedSku);
  const head = <PageHead eyebrow="Портфель SKU" title="Масштабируйте товары с потенциалом." subtitle="Возможность — это сочетание динамики, сигнала маржинальности и доступного запаса." source={data.source ?? demoSource} refreshedAt={data.refreshedAt} action={seller ? <PeriodBar /> : undefined} />;
  if (data.mode === 'EMPTY') return <PageFrame>{head}<Onboarding /></PageFrame>;

  const point = (product: Product) => seller
    ? { x: position(product.marginPct ?? 0.2, USER_X), y: position(product.trendPct ?? 0, USER_Y) }
    : { x: position(product.roas ?? 0, DEMO_X), y: position(product.trend ?? 0, DEMO_Y) };

  const pick = (sku: string) => {
    setSelectedSku(sku);
    setFilter('ALL');
    requestAnimationFrame(() => document.querySelector('[data-testid="product-economics"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const issues = seller && Array.isArray(data.dataIssues) ? data.dataIssues : [];

  return (
    <PageFrame>
      {head}
      {issues.length > 0 && <DataIssues issues={issues} onPick={pick} />}
      <div className={`grid ${seller ? 'grid-5' : 'grid-4'}`}>
        {matrix.length ? matrix.map((item, index) => (
          <button type="button" className={`card metric-card matrix-summary ${filter === item.label ? 'active' : ''}`} key={`${item.label}-${index}`} title={t(item.description)} onClick={() => setFilter(filter === item.label ? 'ALL' : item.label as Filter)} data-testid={`matrix-summary-${index}`}>
            <div className="eyebrow">{t(statusLabel(item.label))}</div>
            <div className="metric-value">{item.count}</div>
          </button>
        )) : <div className="card"><EmptyState label="items" /></div>}
      </div>
      {(() => {
        const active = matrix.find((item) => item.label === filter);
        return active ? <p className="matrix-filter-note fade-in" key={active.label} data-testid="matrix-filter-note">{t(active.description)}</p> : null;
      })()}
      <SectionTitle title={t('Матрица возможностей')} note={t('динамика и экономика')} />
      <div className="card card-pad">
        <div className="matrix-frame">
          <span className="matrix-axis-y">{t('Рост спроса →')}</span>
          <div className="matrix" role="group" aria-label={t('Матрица возможностей')}>
            {allProducts.map((product) => {
              const { x, y } = point(product);
              return (
                <button
                  type="button"
                  className={`matrix-dot ${product.opportunity === 'SCALE' ? 'green' : product.opportunity === 'STOP' ? 'red' : product.opportunity === 'WATCH' ? 'grey' : ''} ${product.sku === selectedSku ? 'selected' : ''}`}
                  title={product.name}
                  aria-label={product.name}
                  aria-pressed={product.sku === selectedSku}
                  key={product.sku}
                  onClick={() => setSelectedSku(product.sku === selectedSku ? undefined : product.sku)}
                  style={{ left: `${x}%`, bottom: `${y}%` }}
                />
              );
            })}
          </div>
          <span className="matrix-axis-x">{t(seller ? 'products.axis.margin' : 'Окупаемость рекламы (ROAS) →')}</span>
        </div>
        <div className="matrix-caption" aria-live="polite" data-testid="matrix-selection">
          {selected
            ? <><strong>{selected.name}</strong> · {selected.sku} · {seller
              ? <>{t('products.col.margin')} {selected.marginPct === null || selected.marginPct === undefined ? '—' : formatPercent(selected.marginPct, locale)} · {t('рост спроса')} {selected.trendPct === null || selected.trendPct === undefined ? '—' : `${selected.trendPct > 0 ? '+' : ''}${formatNumber(selected.trendPct, locale, 1)}%`}</>
              : <>ROAS {formatNumber(selected.roas ?? 0, locale, 1)}x · {t('рост спроса')} +{selected.trend}%</>} · <span className={`status-tag tag-${selected.opportunity.toLowerCase()}`}>{t(statusLabel(selected.opportunity))}</span></>
            : t('Нажмите на точку, чтобы увидеть товар.')}
        </div>
        <div className="matrix-legend"><span><i className="legend-dot green" />{t('Масштабировать')}</span><span><i className="legend-dot" />{t('Исправить / защищать')}</span><span><i className="legend-dot red" />{t('Остановить')}</span>{seller && <span><i className="legend-dot grey" />{t('НАБЛЮДАТЬ')}</span>}</div>
      </div>
      <SectionTitle title={t('Таблица решений по SKU')}>
        <div className="filter-row">{filters.map((item) => <button className={`filter ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)} key={item} aria-pressed={filter === item} data-testid={`filter-products-${item.toLowerCase()}`}>{item === 'ALL' ? t('ВСЕ') : t(statusLabel(item))}</button>)}</div>
      </SectionTitle>
      {seller && selected && <ProductEconomics product={selected} onClose={() => setSelectedSku(undefined)} />}
      <div className="card table-wrap">{products.length ? (seller ? <SellerTable products={products} selectedSku={selectedSku} onPick={pick} /> : <DemoTable products={products} />) : <EmptyState label="товаров" />}</div>
    </PageFrame>
  );
}

function SellerTable({ products, selectedSku, onPick }: { products: Product[]; selectedSku?: string; onPick: (sku: string) => void }) {
  const { locale, t } = useI18n();
  const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${formatNumber(value, locale, 1)}%`);
  return <table className="data-table"><thead><tr>
    <th><Hint term="SKU">{t('SKU / товар')}</Hint></th>
    <th>{t('Выручка')}</th>
    <th>{t('products.col.trend')}</th>
    <th>{t('products.col.units')}</th>
    <th>{t('products.col.price')}</th>
    <th>{t('products.col.margin')}</th>
    <th><Hint term="stock">{t('Остаток')}</Hint></th>
    <th>{t('products.col.forecast')}</th>
    <th>{t('Решение')}</th>
  </tr></thead><tbody>{products.map((product) => (
    <tr key={product.sku} data-testid={`row-product-${product.sku}`} className={product.sku === selectedSku ? 'selected' : undefined}>
      <td><button type="button" className="row-link" onClick={() => onPick(product.sku)} aria-pressed={product.sku === selectedSku}>{product.name}</button><span className="table-sub">{product.sku}{product.category && product.category !== '—' ? ` · ${product.category}` : ''}</span></td>
      <td>{formatCurrency(product.revenue, locale)}</td>
      <td className={(product.trendPct ?? 0) >= 0 ? 'positive' : 'negative'}>{pct(product.trendPct)}</td>
      <td>{formatNumber(product.units, locale)}</td>
      <td>{product.avgPrice ? formatCurrency(product.avgPrice, locale) : '—'}</td>
      <td className={product.marginPct !== null && product.marginPct !== undefined && product.marginPct < 0.1 ? 'negative' : 'neutral'}>{product.marginPct === null || product.marginPct === undefined ? <span className="neutral">{t('products.noCost')}</span> : formatPercent(product.marginPct, locale)}{product.marginPct != null && (product.missingCosts?.length ?? 0) > 0 && <span className="table-sub">{t('economics.estimate')}</span>}</td>
      <td>{product.stock === null || product.stock === undefined ? '—' : formatNumber(product.stock, locale)}</td>
      <td className={(product.stockCoverDays ?? 99) < (product.leadTimeDays ?? 14) ? 'negative' : 'neutral'}>{product.stockCoverDays === null || product.stockCoverDays === undefined ? '—' : fill(t('{days} дн.'), { days: Math.floor(product.stockCoverDays) })}{product.reorderQty ? <span className="table-sub">{fill(t('forecast.reorder'), { qty: product.reorderQty })}</span> : null}</td>
      <td><span className={`status-tag tag-${product.opportunity.toLowerCase()}`}>{t(statusLabel(product.opportunity))}</span></td>
    </tr>
  ))}</tbody></table>;
}

function DemoTable({ products }: { products: Product[] }) {
  const { locale, t } = useI18n();
  return <table className="data-table"><thead><tr>
    <th><Hint term="SKU">{t('SKU / товар')}</Hint></th><th>{t('Выручка')}</th><th>{t('Заказы')}</th><th><Hint term="CVR">{t('Конверсия')}</Hint></th><th>{t('Расход')}</th><th><Hint term="ROAS">ROAS</Hint></th><th><Hint term="stock">{t('Остаток')}</Hint></th><th>{t('Решение')}</th>
  </tr></thead><tbody>{products.map((product) => (
    <tr key={product.sku} data-testid={`row-product-${product.sku}`}>
      <td>{product.name}<span className="table-sub">{product.sku} · {t(product.category)}</span></td>
      <td>{formatCurrency(product.revenue, locale)}</td>
      <td>{formatNumber(product.orders, locale)}</td>
      <td>{formatPercent(product.conversion ?? 0, locale)}</td>
      <td>{formatCurrency(product.spend ?? 0, locale)}</td>
      <td className={(product.roas ?? 0) >= 5 ? 'positive' : 'neutral'}>{formatNumber(product.roas ?? 0, locale, 1)}x</td>
      <td className={(product.stockCoverDays ?? 99) < 7 ? 'negative' : 'neutral'}>{formatNumber(product.stock ?? 0, locale)}<span className="table-sub">{fill(t('{days} дн.'), { days: product.stockCoverDays ?? 0 })}</span></td>
      <td><span className={`status-tag tag-${product.opportunity.toLowerCase()}`}>{t(statusLabel(product.opportunity))}</span></td>
    </tr>
  ))}</tbody></table>;
}
