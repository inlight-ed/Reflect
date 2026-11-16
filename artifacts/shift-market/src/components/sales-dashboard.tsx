import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonthYear, formatNumber, useI18n } from '@/lib/i18n';
import { axisTick, chartColors, formatMonthShort, gridProps, lastChange, tooltipProps } from '@/lib/chart-theme';
import {
  demoSalesReport,
  isImportedSalesReport,
  OTHER_SERIES,
  parseSalesReport,
  TOTAL_SERIES,
  type ImportedSalesReport,
  type SalesPoint,
  type SalesSeries,
} from '@/lib/sales-report';
import { SectionTitle } from './common';

// v2: series are read from the file. Reports saved by v1 (fixed distributors) are discarded.
const salesStorageKey = 'shift-market-sales-report-v2';
/** Rounds up to a tidy axis maximum: 1 010 → 1 200, 87 → 90. */
function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value)) / 5;
  return Math.ceil(value / step) * step;
}

const seriesColors = ['#e7b24f', '#b9d94b', '#65c6d0', '#d890c8', '#8fa6ff', '#f08f6c', '#7fd6a3', '#9aa3ad'];

function loadSavedReport(): ImportedSalesReport | null {
  try {
    window.localStorage.removeItem('shift-market-sales-report-v1');
    const saved = window.localStorage.getItem(salesStorageKey);
    const parsed = saved ? JSON.parse(saved) : null;
    if (isImportedSalesReport(parsed)) return parsed;
    if (saved) window.localStorage.removeItem(salesStorageKey);
  } catch {
    // Storage can be unavailable (private mode); the demo report is shown instead.
  }
  return null;
}

export function SalesDashboard() {
  const { locale, t } = useI18n();
  const [report, setReport] = useState<ImportedSalesReport | null>(loadSavedReport);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const activeReport = report ?? demoSalesReport;
  const latest = activeReport.points.at(-1);
  const previous = activeReport.points.at(-2);
  const growth = latest && previous && previous.total > 0 ? ((latest.total - previous.total) / previous.total) * 100 : 0;
  const seriesLabel = (series: SalesSeries) => series.label === TOTAL_SERIES ? t('Всего') : series.label === OTHER_SERIES ? t('Прочие') : series.label;
  const hasBreakdown = !(activeReport.series.length === 1 && activeReport.series[0].label === TOTAL_SERIES);
  const seriesMax = niceCeiling(Math.max(0, ...activeReport.points.flatMap((point) => activeReport.series.map((series) => Number(point[series.key] ?? 0)))));

  useEffect(() => {
    if (window.location.hash === '#sales-report') sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const uploadReport = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseSalesReport(file);
      setReport(parsed);
      setFailed(false);
      try { window.localStorage.setItem(salesStorageKey, JSON.stringify(parsed)); } catch { /* keep in memory only */ }
      setNotice(t('Отчёт загружен. Диаграммы построены по вашим данным.'));
    } catch (error) {
      setFailed(true);
      setNotice(error instanceof Error ? t(error.message) : t('Не удалось обработать отчёт. Проверьте формат файла.'));
    }
  };

  const resetReport = () => {
    setReport(null);
    setFailed(false);
    try { window.localStorage.removeItem(salesStorageKey); } catch { /* nothing stored */ }
    setNotice(t('Загруженный отчёт удалён. Показаны демонстрационные данные.'));
  };

  return <>
    <section className="sales-dashboard" id="sales-report" ref={sectionRef} data-testid="sales-dashboard">
      <div className="sales-dashboard-head">
        <div><div className="eyebrow">{t(report ? 'ЗАГРУЖЕННЫЙ ОТЧЁТ' : 'ДЕМО-ДАННЫЕ')}</div><h2>{t('Динамика заказов бренда')}</h2><p>{t('Главная диаграмма суммирует заказы по дистрибьюторам за каждый период.')}</p></div>
        <div className="report-actions">
          <label className="btn secondary upload-button" htmlFor="sales-report-upload"><UploadCloud size={14} /> {t('Загрузить отчёт')}</label>
          <input id="sales-report-upload" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => { void uploadReport(event.target.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-sales-report" />
          {report && <button className="btn secondary clear-report" onClick={resetReport} data-testid="button-clear-sales-report"><Trash2 size={14} /> {t('Очистить')}</button>}
        </div>
      </div>
      <div className="report-meta">
        <span><FileSpreadsheet size={13} /> {activeReport.fileName}</span>
        <span>{formatNumber(activeReport.rowsProcessed, locale)} {t('строк обработано')}</span>
        <span>{report ? t('Источник: загруженный файл') : t('Источник: демонстрационный отчёт')}</span>
        <span className="privacy-note"><ShieldCheck size={13} /> {t('Файл обрабатывается в браузере и никуда не отправляется.')}</span>
      </div>
      {notice && <div className={`report-notice ${failed ? 'error' : ''}`} role="status" data-testid="status-sales-report">{notice}</div>}
      <div className="sales-summary-strip">
        <div><span>{t('Заказы за последний период')}</span><strong>{formatNumber(latest?.total ?? 0, locale)}</strong></div>
        <div><span>{t('Динамика к прошлому периоду')}</span><strong className={growth >= 0 ? 'positive' : 'negative'}>{growth >= 0 ? '+' : ''}{formatNumber(growth, locale, 1)}%</strong></div>
        <div><span>{t('Периодов в отчёте')}</span><strong>{formatNumber(activeReport.points.length, locale)}</strong></div>
      </div>
      <div className="brand-orders-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activeReport.points} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
            <defs><linearGradient id="brand-orders-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColors.accent} stopOpacity={0.28} /><stop offset="100%" stopColor={chartColors.accent} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} tickFormatter={(period) => formatMonthShort(String(period), locale)} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(value) => formatNumber(Number(value), locale)} />
            <Tooltip {...tooltipProps} labelFormatter={(period) => formatMonthYear(String(period), locale)} formatter={(value) => [formatNumber(Number(value), locale), t('Заказы')]} />
            <Area type="monotone" dataKey="total" name={t('Заказы бренда')} stroke={chartColors.accent} strokeWidth={2.5} fill="url(#brand-orders-gradient)" dot={{ r: 3, fill: chartColors.accent, strokeWidth: 0 }} activeDot={{ r: 5, fill: chartColors.accent, stroke: chartColors.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
    {hasBreakdown ? <>
      <SectionTitle title={t('Динамика по дистрибьюторам')} note={t('заказы по каждому партнёру')} />
      <div className="distributor-chart-grid">
        {activeReport.series.map((series, index) => <SeriesChart key={series.key} series={series} label={seriesLabel(series)} data={activeReport.points} color={seriesColors[index % seriesColors.length]} max={seriesMax} />)}
      </div>
    </> : <p className="section-note standalone" data-testid="status-no-breakdown">{t('В отчёте нет разбивки по дистрибьюторам — показан только общий итог.')}</p>}
  </>;
}

/**
 * Small multiples share one vertical scale, so a partner with 480 orders does not look as big as one
 * with 1 010. The header carries the latest value and its change, which the line alone cannot show.
 */
function SeriesChart({ series, label, data, color, max }: { series: SalesSeries; label: string; data: SalesPoint[]; color: string; max: number }) {
  const { locale, t } = useI18n();
  const values = data.map((point) => Number(point[series.key] ?? 0));
  const latest = values.at(-1) ?? 0;
  const change = lastChange(values);
  return <section className="distributor-chart" data-testid={`chart-distributor-${label.toLowerCase().replace(/\s/g, '-')}`}>
    <div className="distributor-chart-head">
      <div><span className="chart-color" style={{ background: color }} /><strong>{label}</strong></div>
      <span><b>{formatNumber(latest, locale)}</b> {t('заказов')}{change !== null && <em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{formatNumber(change, locale, 1)}%</em>}</span>
    </div>
    <ResponsiveContainer width="100%" height={168}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="period" tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} tickFormatter={(period) => formatMonthShort(String(period), locale)} />
        <YAxis tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={[0, max]} tickCount={3} tickFormatter={(value) => formatNumber(Number(value), locale)} />
        <Tooltip {...tooltipProps} contentStyle={{ ...tooltipProps.contentStyle, fontSize: 11 }} labelFormatter={(period) => formatMonthYear(String(period), locale)} formatter={(value) => [formatNumber(Number(value), locale), t('Заказы')]} />
        <Line type="monotone" dataKey={series.key} name={label} stroke={color} strokeWidth={2.2} dot={false} activeDot={{ r: 4, fill: color, stroke: chartColors.surface, strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  </section>;
}
