import type { MediaDeclaredTotal, MediaPlacementInput } from '@workspace/api-client-react';
import type { RawMatrix } from './import-parse';

/**
 * Reads a media plan the way the agency writes it: a title, then for each budget variant a
 * section row ("ВАРИАНТ 1: …", "ФОРМАТ 2: МЕДИУМ …"), a header row, placement rows and an
 * "ИТОГО" row. The sheet with the most placements is the plan; summary and rate-card sheets lose.
 */
export type ParsedMediaPlan = { sheet: string; title: string; placements: MediaPlacementInput[]; declaredTotals: MediaDeclaredTotal[] };

type Column = 'platform' | 'format' | 'mechanic' | 'buyType' | 'period' | 'cost' | 'impressions' | 'reach' | 'ctr' | 'clicks' | 'effect';
const MATCHERS: Array<[Column, RegExp]> = [
  ['platform', /^(площадка|platform|канал|channel)/i],
  ['mechanic', /механик|mechanic|описание/i],
  ['buyType', /тип закупки|buy type|модель закупки/i],
  ['format', /инструмент|инвентарь|формат|format|placement/i],
  ['period', /период|period|сроки|даты/i],
  ['cost', /стоимость|бюджет|cost|budget|сумма/i],
  ['impressions', /показ|impression/i],
  ['reach', /охват|reach|уник/i],
  ['ctr', /ctr/i],
  ['clicks', /клик|click/i],
  ['effect', /эффект|cvr|effect|kpi/i],
];

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** "1 600 000 ₸", "1,600,000 ₸", "3 ₸", 1600000 → number; "1,00%", "3.0%", 0.01 → share of 1. */
export function toNumber(value: unknown, percent = false): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? (percent && value > 1 ? value / 100 : value) : null;
  let raw = text(value).replace(/[₸$€]|тг|kzt/gi, '').replace(/\s/g, '');
  if (!raw || raw === '-' || raw === '—') return null;
  const isPercent = raw.endsWith('%');
  raw = raw.replace('%', '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, '');
  else if (raw.includes(',') && !raw.includes('.')) raw = raw.replace(',', '.');
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  return isPercent || (percent && number > 1) ? number / 100 : number;
}

function headerMap(row: unknown[]): Partial<Record<Column, number>> | null {
  const map: Partial<Record<Column, number>> = {};
  row.forEach((cell, index) => {
    const name = text(cell);
    if (!name || name.length > 60) return;
    const hit = MATCHERS.find(([column, pattern]) => map[column] === undefined && pattern.test(name));
    if (hit) map[hit[0]] = index;
  });
  return map.platform !== undefined && map.cost !== undefined && map.format !== undefined ? map : null;
}

/** A row whose filled cells all say the same thing: a merged section title. */
function sectionTitle(row: unknown[]): string | null {
  const filled = [...new Set(row.map(text).filter(Boolean))];
  if (filled.length !== 1) return null;
  const value = filled[0]!;
  if (!/вариант|формат\s*\d|стратеги|лайт|медиум|макс|light|medium|max|option|variant/i.test(value)) return null;
  return value.replace(/\s*\(.*$/, '').replace(/^\[merged\]\s*/i, '').trim().slice(0, 200) || null;
}

function readSheet({ sheet, matrix }: RawMatrix): ParsedMediaPlan {
  let columns: Partial<Record<Column, number>> | null = null;
  let variant = 'Основной';
  let title = '';
  const placements: MediaPlacementInput[] = [];
  const declaredTotals: MediaDeclaredTotal[] = [];
  for (const row of matrix) {
    const cells = row ?? [];
    if (!cells.some((cell) => text(cell))) continue;
    const header = headerMap(cells);
    if (header) { columns = header; continue; }
    // The first line above any table is the plan's name, even when it says "variants".
    if (!columns && !title) { title = cells.map(text).find(Boolean)?.slice(0, 300) ?? ''; continue; }
    const section = sectionTitle(cells);
    if (section) { variant = section; continue; }
    if (!columns) continue;
    const cell = (column: Column) => (columns![column] === undefined ? '' : cells[columns![column]!]);
    const first = cells.map(text).find(Boolean) ?? '';
    if (/^(итого|всего|total)/i.test(first)) {
      declaredTotals.push({ variant, cost: toNumber(cell('cost')), impressions: toNumber(cell('impressions')), clicks: toNumber(cell('clicks')) });
      continue;
    }
    const platform = text(cell('platform'));
    const format = text(cell('format'));
    if (!platform || !format) continue;
    const optional = (column: Column) => text(cell(column)).slice(0, column === 'buyType' || column === 'period' ? 100 : 500) || null;
    placements.push({
      variant,
      platform: platform.slice(0, 200),
      format: format.slice(0, 300),
      mechanic: optional('mechanic'),
      buyType: optional('buyType'),
      period: optional('period'),
      cost: toNumber(cell('cost')),
      planImpressions: toNumber(cell('impressions')),
      planReach: toNumber(cell('reach')),
      planClicks: toNumber(cell('clicks')),
      planCtr: toNumber(cell('ctr'), true),
      expectedEffect: optional('effect'),
    });
  }
  return { sheet, title, placements, declaredTotals };
}

/** A rate card lists formats and prices, not a plan: it never wins over a sheet with forecasts. */
const isRateCard = (plan: ParsedMediaPlan) => /справочник|тариф|rate\s*card|прайс/i.test(`${plan.sheet} ${plan.title}`);

export function parseMediaPlan(sheets: RawMatrix[]): ParsedMediaPlan | null {
  const forecasted = (plan: ParsedMediaPlan) => plan.placements.filter((p) => p.planImpressions != null).length;
  const best = sheets.map(readSheet).filter((plan) => plan.placements.length > 0)
    .sort((a, b) => Number(isRateCard(a)) - Number(isRateCard(b)) || forecasted(b) - forecasted(a) || b.placements.length - a.placements.length)[0];
  return best ?? null;
}
