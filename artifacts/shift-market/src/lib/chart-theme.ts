import type { Locale } from './i18n';

/**
 * One look for every chart: readable axis text, a tooltip that matches the cards,
 * and short month labels that fit on a phone.
 */
export const chartColors = {
  accent: '#e7b24f',
  previous: '#8a94a2',
  grid: '#29313c',
  axis: '#8a94a2',
  surface: '#151a21',
  border: '#3b4551',
  text: '#e7eaf0',
};

export const axisTick = { fill: chartColors.axis, fontSize: 11 };

export const gridProps = { stroke: chartColors.grid, strokeDasharray: '3 6', vertical: false } as const;

export const tooltipProps = {
  separator: ': ',
  cursor: { stroke: '#4a5563', strokeWidth: 1 },
  contentStyle: { background: chartColors.surface, border: `1px solid ${chartColors.border}`, borderRadius: 6, color: chartColors.text, fontSize: 12, padding: '8px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' },
  labelStyle: { color: chartColors.text, fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
} as const;

const shortMonths: Record<Exclude<Locale, 'en'>, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  kk: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
};

/** "июн 26" / "мау 26" / "Jun 26": axis labels that stay short on narrow screens. */
export function formatMonthShort(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  const year = String(date.getUTCFullYear()).slice(2);
  if (locale === 'en') return `${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)} ${year}`;
  return `${shortMonths[locale][date.getUTCMonth()]} ${year}`;
}

/** Percentage change between the last two points, or null when there is nothing to compare. */
export function lastChange(values: number[]) {
  if (values.length < 2) return null;
  const previous = values.at(-2) ?? 0;
  const latest = values.at(-1) ?? 0;
  return previous > 0 ? ((latest - previous) / previous) * 100 : null;
}
