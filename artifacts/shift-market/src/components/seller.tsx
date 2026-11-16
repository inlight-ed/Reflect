import { CheckCircle2, CircleDashed, Database, FileSpreadsheet, PlugZap, UploadCloud } from 'lucide-react';
import { Link } from 'wouter';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useListFeedback, type Assumptions, type ForecastItem, type SeriesPoint } from '@workspace/api-client-react';
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, useI18n } from '@/lib/i18n';
import { usePeriod, type CompareValue, type PeriodValue } from '@/lib/period';
import { useSession } from '@/lib/session';
import { axisTick, chartColors, gridProps, tooltipProps } from '@/lib/chart-theme';
import { downloadTemplate } from '@/lib/template';
import { EmptyState, SectionTitle, useText } from './common';

export function PeriodBar() {
  const { t } = useI18n();
  const { period, compare, setPeriod, setCompare } = usePeriod();
  return (
    <div className="period-bar" role="group" aria-label={t('period.label')}>
      <div className="segmented">
        {(['7', '30', '90'] as PeriodValue[]).map((value) => (
          <button type="button" key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} onClick={() => setPeriod(value)} data-testid={`period-${value}`}>{t(`period.${value}`)}</button>
        ))}
      </div>
      <select value={compare} onChange={(event) => setCompare(event.target.value as CompareValue)} aria-label={t('period.label')} data-testid="select-compare">
        <option value="previous">{t('compare.previous')}</option>
        <option value="year">{t('compare.year')}</option>
      </select>
    </div>
  );
}

export function RevenueChart({ series }: { series: SeriesPoint[] }) {
  const { locale, t } = useI18n();
  const { period } = usePeriod();
  return (
    <section className="card card-pad revenue-chart" data-testid="revenue-chart">
      <div className="chart-head">
        <span className="card-title">{t(period === '90' ? 'chart.revenue.week' : 'chart.revenue')}</span>
        <span className="chart-legend"><i className="swatch current" />{t('chart.current')}<i className="swatch previous" />{t('chart.previous')}</span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColors.accent} stopOpacity={0.28} /><stop offset="100%" stopColor={chartColors.accent} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" tickFormatter={(value) => formatDate(String(value), locale)} minTickGap={18} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} width={64} tickFormatter={(value) => formatCompactCurrency(Number(value), locale)} />
            <Tooltip {...tooltipProps} labelFormatter={(value) => formatDate(String(value), locale)} formatter={(value, name) => [formatCurrency(Number(value), locale), name === 'total' ? t('chart.current') : t('chart.previous')]} />
            <Line type="monotone" dataKey="previous" stroke={chartColors.previous} strokeWidth={1.6} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="total" stroke={chartColors.accent} strokeWidth={2.4} fill="url(#revenue-fill)" animationDuration={500} activeDot={{ r: 5, fill: chartColors.accent, stroke: chartColors.surface, strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ForecastList({ items }: { items: ForecastItem[] }) {
  const { locale, t } = useI18n();
  const text = useText();
  if (!items.length) return <div className="card"><EmptyState label="forecast" message={t('forecast.empty')} /></div>;
  return (
    <div className="card forecast-list" data-testid="forecast">
      {items.map((item) => {
        const urgent = item.coverDays < item.leadTimeDays;
        return (
          <div className={`forecast-row ${urgent ? 'urgent' : ''}`} key={item.sku}>
            <div className="forecast-name"><strong>{item.name}</strong><span>{item.sku} · {text('forecast.pace', { velocity: item.velocity })}</span></div>
            <div className="forecast-meter" aria-hidden><span style={{ width: `${Math.min(100, (item.coverDays / Math.max(item.leadTimeDays + 7, 1)) * 100)}%` }} /></div>
            <div className="forecast-days"><strong>{text('forecast.days', { days: Math.floor(item.coverDays) })}</strong><span>{text('forecast.until', { date: item.stockoutDate })}</span></div>
            <div className="forecast-order">{item.reorderQty > 0 ? text('forecast.reorder', { qty: item.reorderQty }) : '—'}</div>
            <div className="forecast-stock">{formatNumber(item.stock, locale)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function AssumptionsNote({ assumptions }: { assumptions?: Assumptions }) {
  const text = useText();
  const { locale, t } = useI18n();
  if (!assumptions) return null;
  const coverage = assumptions.costCoveragePct;
  const lastOrder = assumptions.lastOrderAt ? Date.parse(assumptions.lastOrderAt) : NaN;
  const staleDays = Number.isNaN(lastOrder) ? 0 : Math.floor((Date.now() - lastOrder) / 86_400_000);
  const notes = [
    assumptions.commissionAssumed ? text('assumption.commission', { pct: assumptions.defaultCommissionPct ?? 12 }) : null,
    // Revenue-weighted: "profit is preliminary, cost is known for 82% of revenue".
    coverage !== null && coverage !== undefined && coverage < 100
      ? text('assumption.costCoverage', { pct: formatNumber(coverage, locale, 1), count: assumptions.missingCosts })
      : assumptions.missingCosts ? text('assumption.costs', { count: assumptions.missingCosts }) : null,
    staleDays >= 3 ? text('assumption.stale', { date: formatDate(assumptions.lastOrderAt!, locale), days: staleDays }) : null,
    assumptions.missingStock ? text('assumption.stock', { count: assumptions.missingStock }) : null,
  ].filter(Boolean);
  if (!notes.length) return null;
  return (
    <div className="assumption-note" role="note" data-testid="assumptions">
      <Database size={14} aria-hidden />
      <div>{notes.map((note) => <p key={note}>{note}</p>)}</div>
      <Link href="/data" className="btn secondary">{t('assumption.fix')}</Link>
    </div>
  );
}

export function Outcomes() {
  const { locale, t } = useI18n();
  const text = useText();
  const query = useListFeedback();
  const items = query.data ?? [];
  if (!items.length) return null;
  return (
    <>
      <SectionTitle title={t('outcomes.title')} note={t('outcomes.note')} />
      <div className="card table-wrap" data-testid="outcomes">
        <table className="data-table">
          <thead><tr><th>{t('Дата')}</th><th>{t('Товар')}</th><th>{t('Статус')}</th><th>{t('outcomes.before')}</th><th>{t('outcomes.after')}</th><th>{t('Рост')}</th></tr></thead>
          <tbody>{items.slice(0, 12).map((item) => (
            <tr key={item.id}>
              <td>{formatDate(item.createdAt, locale)}</td>
              <td>{item.object}<span className="table-sub">{t(item.actionType === 'RESTOCK' ? 'ДОЗАКАЗАТЬ' : item.actionType)}</span></td>
              <td><span className={`status-tag verdict-tag ${item.verdict.toLowerCase()}`}>{t(`verdict.${item.verdict}`)}</span></td>
              <td>{item.beforePerDay === null || item.beforePerDay === undefined ? '—' : formatCurrency(item.beforePerDay, locale)}</td>
              <td>{item.afterPerDay === null || item.afterPerDay === undefined ? <span className="neutral">{t('outcomes.waiting')}</span> : <>{formatCurrency(item.afterPerDay, locale)}<span className="table-sub">{text('outcomes.days', { days: item.daysAfter ?? 0 })}</span></>}</td>
              <td className={(item.changePct ?? 0) >= 0 ? 'positive' : 'negative'}>{item.changePct === null || item.changePct === undefined ? '—' : `${item.changePct > 0 ? '+' : ''}${formatNumber(item.changePct, locale, 1)}%`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

export function Onboarding() {
  const { locale, t } = useI18n();
  const { session } = useSession();
  const steps = [
    { done: Boolean(session?.hasData), icon: UploadCloud, title: 'onboarding.step1.title', body: 'onboarding.step1.body', action: <Link href="/data" className="btn" data-testid="onboarding-upload">{t('onboarding.go.upload')}</Link> },
    { done: Boolean(session?.hasProducts), icon: FileSpreadsheet, title: 'onboarding.step2.title', body: 'onboarding.step2.body', action: <button type="button" className="btn secondary" onClick={() => void downloadTemplate(locale)} data-testid="onboarding-template">{t('onboarding.go.template')}</button> },
    { done: Boolean(session?.hasConnections), icon: PlugZap, title: 'onboarding.step3.title', body: 'onboarding.step3.body', action: <Link href="/settings" className="btn secondary">{t('onboarding.go.connect')}</Link> },
  ];
  return (
    <section className="onboarding" data-testid="onboarding">
      <div className="onboarding-head"><h2>{t('onboarding.title')}</h2><p>{t('onboarding.subtitle')}</p></div>
      <ol className="onboarding-steps">
        {steps.map(({ done, icon: Icon, title, body, action }, index) => (
          <li key={title} className={done ? 'done' : ''}>
            <div className="step-index">{done ? <CheckCircle2 size={18} /> : index === steps.findIndex((step) => !step.done) ? <Icon size={18} /> : <CircleDashed size={18} />}</div>
            <div className="step-copy"><h3>{t(title)}</h3><p>{t(body)}</p></div>
            <div className="step-action">{done ? <span className="positive">{t('onboarding.done')}</span> : action}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
