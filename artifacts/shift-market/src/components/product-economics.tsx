import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useUpdateProductCosts, type DataIssue, type Product } from '@workspace/api-client-react';
import { fill, formatCurrency, formatNumber, useI18n } from '@/lib/i18n';
import { SectionTitle } from '@/components/common';

/**
 * What in the seller's data makes the figures less exact, by the share of revenue it touches.
 * Each product listed opens its economics, where the missing value is filled in on the spot.
 */
export function DataIssues({ issues, onPick }: { issues: DataIssue[]; onPick: (sku: string) => void }) {
  const { locale, t } = useI18n();
  if (!issues.length) return null;
  return (
    <section className="quality" data-testid="data-issues">
      <SectionTitle title={t('quality.title')} note={t('quality.note')} />
      <ul className="quality-list">
        {issues.map((issue) => (
          <li key={issue.type} data-testid={`data-issue-${issue.type}`}>
            <div className="quality-row">
              <strong>{fill(t(`quality.${issue.type}`), { count: formatNumber(issue.count, locale) })}</strong>
              {issue.revenueSharePct !== null && <span className="quality-share">{fill(t('quality.share'), { pct: formatNumber(issue.revenueSharePct, locale, 1) })}</span>}
            </div>
            <p>{t(`quality.${issue.type}.fix`)}</p>
            {issue.products.length > 0 && (
              <div className="quality-products">
                {issue.products.map((product) => (
                  <button type="button" key={product.sku} onClick={() => onPick(product.sku)} data-testid={`fix-${issue.type}-${product.sku}`}>
                    {product.name}<span>{formatCurrency(product.revenue, locale)}</span>
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Field = 'costPrice' | 'logisticsCost' | 'otherCost' | 'commissionPct' | 'stock' | 'leadTimeDays';
const FIELDS: Array<{ key: Field; label: string }> = [
  { key: 'costPrice', label: 'economics.cost' },
  { key: 'logisticsCost', label: 'economics.logistics' },
  { key: 'otherCost', label: 'economics.other' },
  { key: 'commissionPct', label: 'economics.commissionPct' },
  { key: 'stock', label: 'economics.stock' },
  { key: 'leadTimeDays', label: 'economics.leadTime' },
];

const initial = (product: Product): Record<Field, string> => ({
  costPrice: product.costPrice == null ? '' : String(product.costPrice),
  logisticsCost: product.logisticsCost == null ? '' : String(product.logisticsCost),
  otherCost: product.otherCost == null ? '' : String(product.otherCost),
  commissionPct: product.commissionAssumed || product.commissionPct == null ? '' : String(product.commissionPct),
  stock: product.stock == null ? '' : String(product.stock),
  leadTimeDays: product.leadTimeDays == null ? '' : String(product.leadTimeDays),
});

/**
 * One product's profit, line by line: price, then each cost taken off, then the ads. A value
 * Reflect assumed or does not have is said so on its line, and can be filled in right here.
 */
export function ProductEconomics({ product, onClose }: { product: Product; onClose: () => void }) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const save = useUpdateProductCosts();
  const [values, setValues] = useState(() => initial(product));
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => { setValues(initial(product)); setStatus('idle'); }, [product]);

  const price = product.avgPrice ?? null;
  const commissionPct = product.commissionPct ?? 12;
  const money = (value: number | null | undefined) => (value == null ? t('economics.unknown') : formatCurrency(value, locale));
  const minus = (value: number | null | undefined, missing = false) => (missing || value == null ? <span className="neutral">{t('economics.unknown')}</span> : `− ${formatCurrency(value, locale)}`);
  const missing = new Set(product.missingCosts ?? []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, number | null | string> = { sku: product.sku };
    for (const { key } of FIELDS) {
      const raw = values[key].replace(/\s/g, '').replace(',', '.');
      if (raw === initial(product)[key]) continue;
      body[key] = raw === '' ? null : Number(raw);
      if (raw !== '' && !Number.isFinite(body[key] as number)) { setStatus('error'); return; }
    }
    try {
      await save.mutateAsync({ data: body as never });
      await queryClient.invalidateQueries();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="card card-pad economics fade-in" data-testid="product-economics" aria-label={t('economics.title')}>
      <div className="economics-head">
        <div>
          <span className="eyebrow">{t('economics.title')}</span>
          <strong>{product.name}</strong>
          <span className="table-sub">{product.sku}</span>
        </div>
        <button type="button" className="economics-close" onClick={onClose} aria-label={t('economics.close')}><X size={16} aria-hidden /></button>
      </div>
      <div className="economics-body">
        <dl className="economics-lines">
          <div><dt>{t('economics.price')}</dt><dd>{money(price)}</dd></div>
          <div><dt>{t('economics.commission')} · {formatNumber(commissionPct, locale, 1)}%{missing.has('COMMISSION') && <em> · {t('economics.assumed')}</em>}</dt><dd>{price == null ? '—' : `− ${formatCurrency(price * commissionPct / 100, locale)}`}</dd></div>
          <div><dt>{t('economics.cost')}</dt><dd>{minus(product.costPrice, missing.has('COST'))}</dd></div>
          <div><dt>{t('economics.logistics')}</dt><dd>{minus(product.logisticsCost, missing.has('LOGISTICS'))}</dd></div>
          <div><dt>{t('economics.other')}</dt><dd>{product.otherCost == null ? <span className="neutral">—</span> : `− ${formatCurrency(product.otherCost, locale)}`}</dd></div>
          <div className="economics-total"><dt>{t('economics.unit')}</dt><dd className={(product.unitMargin ?? 0) < 0 ? 'negative' : ''}>{money(product.unitMargin)}</dd></div>
          <div><dt>{fill(t('economics.units'), { units: formatNumber(product.units, locale) })}</dt><dd /></div>
          <div><dt>{t('economics.ads')}</dt><dd>{product.adSpend ? `− ${formatCurrency(product.adSpend, locale)}` : '—'}</dd></div>
          <div className="economics-total"><dt>{t('economics.net')}</dt><dd className={(product.netProfit ?? 0) < 0 ? 'negative' : ''} data-testid="economics-net">{money(product.netProfit)}</dd></div>
        </dl>
        <form className="economics-form" onSubmit={submit}>
          {FIELDS.map(({ key, label }) => (
            <label key={key}>
              <span>{t(label)}</span>
              <input inputMode="decimal" value={values[key]} placeholder={key === 'commissionPct' ? '12' : '—'} onChange={(event) => { setValues({ ...values, [key]: event.target.value }); setStatus('idle'); }} data-testid={`economics-${key}`} />
            </label>
          ))}
          <div className="economics-actions">
            <button type="submit" className="btn" disabled={save.isPending} data-testid="economics-save">{t(save.isPending ? 'economics.saving' : 'economics.save')}</button>
            {status === 'saved' && <span className="positive" role="status">{t('economics.saved')}</span>}
            {status === 'error' && <span className="negative" role="alert">{t('economics.error')}</span>}
          </div>
        </form>
      </div>
    </section>
  );
}
