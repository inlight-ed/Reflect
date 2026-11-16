/**
 * Analytics over a seller's own data. Pure functions: no I/O, so they are easy to test.
 *
 * Inputs are order lines (from a Kaspi export, the template or the Kaspi API), the product
 * catalogue (cost, stock, lead time, commission) and optional ad spend.
 */
import type { ConfidenceSignalKey } from "@workspace/api-zod";
import { scoreConfidence, type ConfidenceCheck } from "./confidence";

export type OrderStatus = "SOLD" | "PENDING" | "CANCELLED" | "RETURNED";
export type OrderLine = { orderCode: string; orderedAt: Date; sku: string; productName: string | null; quantity: number; amount: number; status: string };
export type CatalogItem = { sku: string; name: string | null; category: string | null; kaspiCode: string | null; costPrice: number | null; stock: number | null; leadTimeDays: number | null; commissionPct: number | null; stockUpdatedAt: Date | null };
export type AdLine = { day: string; sku: string; channel: string; spend: number };
export type Period = 7 | 30 | 90;
export type Compare = "previous" | "year";

export const DEFAULT_LEAD_TIME_DAYS = 14;
export const SAFETY_DAYS = 7;
/** Used only when the seller has not entered a commission; the UI marks it as an assumption. */
export const DEFAULT_COMMISSION_PCT = 12;

const DAY = 86_400_000;
const isDemand = (status: string) => status === "SOLD" || status === "PENDING";
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

export type Window = { from: Date; to: Date };

export function windows(now: Date, period: Period, compare: Compare): { current: Window; comparison: Window } {
  const current = { from: new Date(now.getTime() - period * DAY), to: now };
  const shift = compare === "year" ? 365 * DAY : period * DAY;
  return { current, comparison: { from: new Date(current.from.getTime() - shift), to: new Date(current.to.getTime() - shift) } };
}

const inWindow = (date: Date, window: Window) => date >= window.from && date < window.to;

type Totals = { revenue: number; units: number; orders: number; returned: number; lines: number };
function totals(lines: OrderLine[], window: Window): Totals {
  const codes = new Set<string>();
  const result: Totals = { revenue: 0, units: 0, orders: 0, returned: 0, lines: 0 };
  for (const line of lines) {
    if (!inWindow(line.orderedAt, window)) continue;
    result.lines += 1;
    if (line.status === "RETURNED") result.returned += 1;
    if (!isDemand(line.status)) continue;
    result.revenue += line.amount;
    result.units += line.quantity;
    codes.add(line.orderCode);
  }
  result.orders = codes.size;
  return result;
}

const pctChange = (current: number, previous: number) => (previous > 0 ? round(((current - previous) / previous) * 100, 1) : null);

export type Opportunity = "SCALE" | "FIX" | "DEFEND" | "STOP" | "WATCH";

export type SkuStats = {
  sku: string;
  name: string;
  category: string | null;
  kaspiCode: string | null;
  revenue: number;
  units: number;
  orders: number;
  previousRevenue: number;
  trendPct: number | null;
  avgPrice: number | null;
  previousAvgPrice: number | null;
  velocity: number;
  stock: number | null;
  stockUpdatedAt: Date | null;
  coverDays: number | null;
  stockoutDate: string | null;
  leadTimeDays: number;
  reorderQty: number | null;
  costPrice: number | null;
  commissionPct: number;
  commissionAssumed: boolean;
  unitMargin: number | null;
  marginPct: number | null;
  adSpend: number;
  roas: number | null;
  breakevenRoas: number | null;
  returnRate: number | null;
  historyDays: number;
  firstHalfRevenue: number;
  secondHalfRevenue: number;
  opportunity: Opportunity;
};

export function classify(stats: Omit<SkuStats, "opportunity">): Opportunity {
  if ((stats.coverDays !== null && stats.coverDays < 7) || (stats.marginPct !== null && stats.marginPct < 0)) return "STOP";
  if (stats.trendPct !== null && stats.trendPct <= -15) return "DEFEND";
  if ((stats.marginPct !== null && stats.marginPct < 0.1) || (stats.returnRate !== null && stats.returnRate > 0.1)) return "FIX";
  if (stats.trendPct !== null && stats.trendPct >= 10 && (stats.marginPct === null || stats.marginPct >= 0.15) && (stats.coverDays === null || stats.coverDays >= 21)) return "SCALE";
  return "WATCH";
}

export function skuStats(lines: OrderLine[], catalog: CatalogItem[], ads: AdLine[], now: Date, period: Period, compare: Compare): SkuStats[] {
  const { current, comparison } = windows(now, period, compare);
  const half = new Date(current.from.getTime() + (period * DAY) / 2);
  const bySku = new Map<string, OrderLine[]>();
  for (const line of lines) {
    const list = bySku.get(line.sku) ?? [];
    list.push(line);
    bySku.set(line.sku, list);
  }
  const catalogBySku = new Map(catalog.map((item) => [item.sku, item]));
  const skus = new Set([...bySku.keys(), ...catalog.filter((item) => (item.stock ?? 0) > 0).map((item) => item.sku)]);
  const adBySku = new Map<string, number>();
  const fromDay = current.from.toISOString().slice(0, 10);
  const toDay = current.to.toISOString().slice(0, 10);
  for (const ad of ads) {
    if (!ad.sku || ad.day < fromDay || ad.day > toDay) continue;
    adBySku.set(ad.sku, (adBySku.get(ad.sku) ?? 0) + ad.spend);
  }

  const result: SkuStats[] = [];
  for (const sku of skus) {
    const skuLines = bySku.get(sku) ?? [];
    const item = catalogBySku.get(sku);
    const cur = totals(skuLines, current);
    const prev = totals(skuLines, comparison);
    const firstHalf = totals(skuLines, { from: current.from, to: half });
    const secondHalf = totals(skuLines, { from: half, to: current.to });
    const first = skuLines.reduce((min, line) => (line.orderedAt < min ? line.orderedAt : min), now);
    const historyDays = Math.max(0, Math.round((now.getTime() - first.getTime()) / DAY));
    const effectiveDays = Math.max(1, Math.min(period, historyDays || period));
    const velocity = cur.units / effectiveDays;
    const avgPrice = cur.units > 0 ? cur.revenue / cur.units : null;
    const previousAvgPrice = prev.units > 0 ? prev.revenue / prev.units : null;
    const stock = item?.stock ?? null;
    const coverDays = stock !== null && velocity > 0 ? round(stock / velocity, 1) : null;
    const leadTimeDays = item?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
    const reorderQty = stock !== null && velocity > 0 ? Math.max(0, Math.ceil(velocity * (leadTimeDays + SAFETY_DAYS) - stock)) : null;
    const commissionAssumed = item?.commissionPct == null;
    const commissionPct = item?.commissionPct ?? DEFAULT_COMMISSION_PCT;
    const costPrice = item?.costPrice ?? null;
    const unitMargin = costPrice !== null && avgPrice !== null ? avgPrice * (1 - commissionPct / 100) - costPrice : null;
    const marginPct = unitMargin !== null && avgPrice ? unitMargin / avgPrice : null;
    const adSpend = adBySku.get(sku) ?? 0;
    const roas = adSpend > 0 ? cur.revenue / adSpend : null;
    const breakevenRoas = marginPct !== null && marginPct > 0 ? 1 / marginPct : null;
    const name = item?.name || skuLines.find((line) => line.productName)?.productName || sku;
    const base = {
      sku,
      name,
      category: item?.category ?? null,
      kaspiCode: item?.kaspiCode ?? null,
      revenue: round(cur.revenue),
      units: round(cur.units, 2),
      orders: cur.orders,
      previousRevenue: round(prev.revenue),
      trendPct: pctChange(cur.revenue, prev.revenue),
      avgPrice: avgPrice === null ? null : round(avgPrice),
      previousAvgPrice: previousAvgPrice === null ? null : round(previousAvgPrice),
      velocity: round(velocity, 2),
      stock,
      stockUpdatedAt: item?.stockUpdatedAt ?? null,
      coverDays,
      stockoutDate: coverDays !== null ? new Date(now.getTime() + coverDays * DAY).toISOString().slice(0, 10) : null,
      leadTimeDays,
      reorderQty,
      costPrice,
      commissionPct,
      commissionAssumed,
      unitMargin: unitMargin === null ? null : round(unitMargin),
      marginPct: marginPct === null ? null : round(marginPct, 3),
      adSpend: round(adSpend),
      roas: roas === null ? null : round(roas, 2),
      breakevenRoas: breakevenRoas === null ? null : round(breakevenRoas, 2),
      returnRate: cur.lines > 0 ? round(cur.returned / cur.lines, 3) : null,
      historyDays,
      firstHalfRevenue: firstHalf.revenue,
      secondHalfRevenue: secondHalf.revenue,
    };
    if (base.revenue === 0 && base.previousRevenue === 0 && (stock ?? 0) === 0) continue;
    result.push({ ...base, opportunity: classify(base) });
  }
  return result.sort((a, b) => b.revenue - a.revenue);
}

// ---------- Recommendations ----------

export type ActionType = "SCALE" | "OPTIMIZE" | "DEFEND" | "FIX" | "WATCH" | "RESTOCK";
export type UserAction = {
  key: string;
  type: ActionType;
  sku: string;
  object: string;
  reasonKey: string;
  recommendationKey: string;
  params: Record<string, string | number>;
  impactAmount: number;
  confidence: number;
  confidenceBasis: { supporting: number; total: number; signals: ConfidenceCheck[] };
};

const check = (key: ConfidenceSignalKey, met: boolean): ConfidenceCheck => ({ key, met });

function common(stats: SkuStats, now: Date): Record<string, ConfidenceCheck> {
  const stockFresh = stats.stockUpdatedAt !== null && now.getTime() - stats.stockUpdatedAt.getTime() < 7 * DAY;
  const firstDir = Math.sign(stats.firstHalfRevenue - (stats.previousRevenue / 2));
  const secondDir = Math.sign(stats.secondHalfRevenue - (stats.previousRevenue / 2));
  return {
    history: check("enough_history", stats.historyDays >= 14 && stats.units >= 10),
    stockFresh: check("stock_fresh", stockFresh),
    consistent: check("trend_consistent", firstDir !== 0 && firstDir === secondDir),
    cost: check("cost_known", stats.costPrice !== null),
    commission: check("commission_known", !stats.commissionAssumed),
  };
}

export function recommendations(stats: SkuStats[], now: Date): UserAction[] {
  const candidates: UserAction[] = [];
  const push = (type: ActionType, s: SkuStats, reasonKey: string, recommendationKey: string, params: Record<string, string | number>, impactAmount: number, signals: ConfidenceCheck[]) => {
    candidates.push({ key: `${type}:${s.sku}`, type, sku: s.sku, object: s.name, reasonKey, recommendationKey, params, impactAmount: Math.max(0, Math.round(impactAmount)), ...scoreConfidence(signals) });
  };

  for (const s of stats) {
    const c = common(s, now);
    if (s.coverDays !== null && s.velocity > 0 && s.coverDays < s.leadTimeDays + SAFETY_DAYS && s.avgPrice) {
      const shortDays = s.leadTimeDays + SAFETY_DAYS - s.coverDays;
      push("RESTOCK", s, "action.restock.reason", "action.restock.next", { days: Math.floor(s.coverDays), lead: s.leadTimeDays, qty: s.reorderQty ?? 0, date: s.stockoutDate ?? "" },
        s.velocity * s.avgPrice * shortDays,
        [c.history, c.stockFresh, check("demand_growing", (s.trendPct ?? 0) >= 0), c.consistent]);
    }
    if (s.marginPct !== null && s.marginPct < 0.1 && s.revenue > 0) {
      push("FIX", s, "action.margin.reason", "action.margin.next", { margin: round(s.marginPct * 100, 1), commission: s.commissionPct },
        (0.15 - s.marginPct) * s.revenue,
        [c.cost, c.commission, c.history]);
    }
    if (s.roas !== null && s.breakevenRoas !== null && s.roas < s.breakevenRoas) {
      push("OPTIMIZE", s, "action.ads.reason", "action.ads.next", { roas: s.roas, breakeven: s.breakevenRoas, spend: s.adSpend },
        s.adSpend * (1 - s.roas / s.breakevenRoas),
        [c.cost, c.commission, c.history, check("ads_attributed", s.adSpend > 0)]);
    }
    if (s.trendPct !== null && s.trendPct >= 10 && (s.marginPct === null || s.marginPct >= 0.15) && (s.coverDays === null || s.coverDays >= 21)) {
      push("SCALE", s, "action.scale.reason", "action.scale.next", { trend: s.trendPct, margin: s.marginPct === null ? "—" : round(s.marginPct * 100, 1), days: s.coverDays === null ? "—" : Math.floor(s.coverDays) },
        s.revenue * 0.1,
        [check("demand_growing", true), c.consistent, check("stock_sufficient", s.coverDays !== null && s.coverDays >= 21), check("margin_healthy", s.marginPct !== null && s.marginPct >= 0.15), c.history]);
    }
    if (s.trendPct !== null && s.trendPct <= -15 && s.previousRevenue > 0) {
      const priceStable = s.avgPrice !== null && s.previousAvgPrice !== null && Math.abs(s.avgPrice - s.previousAvgPrice) / s.previousAvgPrice < 0.03;
      push("DEFEND", s, "action.defend.reason", "action.defend.next", { trend: Math.abs(s.trendPct), lost: Math.round(s.previousRevenue - s.revenue) },
        s.previousRevenue - s.revenue,
        [c.history, c.consistent, check("stock_sufficient", s.coverDays === null || s.coverDays >= 14), check("price_stable", priceStable)]);
    }
  }

  // One action per product and at most two of a kind, so a single issue cannot crowd out the rest.
  const ranked = candidates.sort((a, b) => b.impactAmount * b.confidence - a.impactAmount * a.confidence);
  const seen = new Set<string>();
  const perType = new Map<ActionType, number>();
  const picked: UserAction[] = [];
  for (const action of ranked) {
    if (seen.has(action.sku) || (perType.get(action.type) ?? 0) >= 2) continue;
    seen.add(action.sku);
    perType.set(action.type, (perType.get(action.type) ?? 0) + 1);
    picked.push(action);
    if (picked.length === 6) break;
  }
  return picked;
}

// ---------- Overview ----------

export type MetricOut = { label: string; value: string; amount: number; unit: "CURRENCY" | "COUNT" | "MULTIPLIER" | "DAYS"; change: string; changePct: number | null; positive: boolean; estimated?: boolean };

export function overviewMetrics(lines: OrderLine[], stats: SkuStats[], now: Date, period: Period, compare: Compare): MetricOut[] {
  const { current, comparison } = windows(now, period, compare);
  const cur = totals(lines, current);
  const prev = totals(lines, comparison);
  const metric = (label: string, amount: number, previous: number, unit: MetricOut["unit"], higherIsBetter = true): MetricOut => {
    const changePct = pctChange(amount, previous);
    return { label, value: String(round(amount, 2)), amount: round(amount, 2), unit, change: changePct === null ? "—" : `${changePct > 0 ? "+" : ""}${changePct}%`, changePct, positive: changePct === null ? true : higherIsBetter ? changePct >= 0 : changePct <= 0 };
  };
  const withCost = stats.filter((s) => s.unitMargin !== null);
  const result = [
    metric("metric.revenue", cur.revenue, prev.revenue, "CURRENCY"),
    metric("metric.orders", cur.orders, prev.orders, "COUNT"),
    metric("metric.aov", cur.orders ? cur.revenue / cur.orders : 0, prev.orders ? prev.revenue / prev.orders : 0, "CURRENCY"),
  ];
  if (withCost.length) {
    const profit = withCost.reduce((sum, s) => sum + (s.unitMargin ?? 0) * s.units, 0);
    // An estimate, not a fact, when Kaspi's commission was assumed or some sold items have no cost price.
    const sold = stats.filter((s) => s.units > 0);
    const estimated = withCost.some((s) => s.commissionAssumed) || sold.some((s) => s.unitMargin === null);
    result.push({ ...metric("metric.grossProfit", profit, 0, "CURRENCY"), change: "—", changePct: null, positive: profit >= 0, estimated });
  } else {
    result.push(metric("metric.units", cur.units, prev.units, "COUNT"));
  }
  return result;
}

export type SeriesPoint = { period: string; total: number; previous: number; orders: number };

export function revenueSeries(lines: OrderLine[], now: Date, period: Period, compare: Compare): SeriesPoint[] {
  const { current, comparison } = windows(now, period, compare);
  const bucketDays = period === 90 ? 7 : 1;
  const buckets = Math.ceil(period / bucketDays);
  const points: SeriesPoint[] = Array.from({ length: buckets }, (_, index) => ({
    period: new Date(current.from.getTime() + index * bucketDays * DAY).toISOString().slice(0, 10),
    total: 0,
    previous: 0,
    orders: 0,
  }));
  const orderSets = points.map(() => new Set<string>());
  for (const line of lines) {
    if (!isDemand(line.status)) continue;
    if (inWindow(line.orderedAt, current)) {
      const index = Math.min(buckets - 1, Math.floor((line.orderedAt.getTime() - current.from.getTime()) / (bucketDays * DAY)));
      points[index].total += line.amount;
      orderSets[index].add(line.orderCode);
    } else if (inWindow(line.orderedAt, comparison)) {
      const index = Math.min(buckets - 1, Math.floor((line.orderedAt.getTime() - comparison.from.getTime()) / (bucketDays * DAY)));
      points[index].previous += line.amount;
    }
  }
  return points.map((point, index) => ({ ...point, total: round(point.total), previous: round(point.previous), orders: orderSets[index].size }));
}

// ---------- Before / after ----------

export function dailyRevenue(lines: OrderLine[], window: Window, sku?: string) {
  const days = Math.max(1, (window.to.getTime() - window.from.getTime()) / DAY);
  const t = totals(sku ? lines.filter((line) => line.sku === sku) : lines, window);
  return { perDay: t.revenue / days, revenue: t.revenue, orders: t.orders, units: t.units, days };
}

/** Compares a fixed-length window before an event with the time since (capped at the same length). */
export function beforeAfter(lines: OrderLine[], at: Date, now: Date, sku?: string, lengthDays = 14) {
  const before = dailyRevenue(lines, { from: new Date(at.getTime() - lengthDays * DAY), to: at }, sku);
  const afterEnd = new Date(Math.min(now.getTime(), at.getTime() + lengthDays * DAY));
  const daysAfter = Math.max(0, (afterEnd.getTime() - at.getTime()) / DAY);
  const after = daysAfter >= 1 ? dailyRevenue(lines, { from: at, to: afterEnd }, sku) : null;
  return {
    beforePerDay: round(before.perDay),
    afterPerDay: after ? round(after.perDay) : null,
    changePct: after ? pctChange(after.perDay, before.perDay) : null,
    daysAfter: Math.floor(daysAfter),
  };
}

export function campaignImpact(lines: OrderLine[], start: Date, end: Date, now: Date, overlapping: boolean) {
  const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1);
  const duringEnd = new Date(Math.min(now.getTime(), end.getTime() + DAY));
  const baselineWindow = { from: new Date(start.getTime() - 14 * DAY), to: start };
  const baseline = dailyRevenue(lines, baselineWindow);
  const during = duringEnd > start ? dailyRevenue(lines, { from: start, to: duringEnd }) : null;
  const afterStart = new Date(end.getTime() + DAY);
  const afterEnd = new Date(Math.min(now.getTime(), afterStart.getTime() + durationDays * DAY));
  const after = afterEnd > afterStart ? dailyRevenue(lines, { from: afterStart, to: afterEnd }) : null;
  const period = (label: string, value: ReturnType<typeof dailyRevenue> | null) => value && {
    label,
    gmv: round(value.revenue),
    orders: value.orders,
    units: round(value.units, 1),
    aov: value.orders ? round(value.revenue / value.orders, 2) : 0,
    growth: label === "BEFORE" ? 0 : pctChange(value.perDay, baseline.perDay) ?? 0,
  };
  const periods = [period("BEFORE", baseline), period("DURING", during), period("AFTER", after)].filter(Boolean) as Array<NonNullable<ReturnType<typeof period>>>;
  const incremental = during ? Math.max(0, (during.perDay - baseline.perDay) * during.days) : 0;
  const basis = scoreConfidence([
    check("enough_history", baseline.orders >= 10),
    check("campaign_finished", now > end),
    check("no_overlap", !overlapping),
    check("trend_consistent", after !== null && during !== null && Math.sign(after.perDay - baseline.perDay) === Math.sign(during.perDay - baseline.perDay)),
  ]);
  return { periods, baseline: round(baseline.revenue), incremental: round(incremental), ...basis };
}

/**
 * How complete the numbers are, weighted by revenue: a missing cost price on a best-seller
 * matters more than on a product that sold once. Shown next to profit so it is clear when
 * profit is preliminary.
 */
export function dataCoverage(stats: SkuStats[], lines: OrderLine[]) {
  const sold = stats.filter((item) => item.revenue > 0);
  const total = sold.reduce((sum, item) => sum + item.revenue, 0);
  const share = (known: (item: SkuStats) => boolean) =>
    total > 0 ? Math.round((1000 * sold.filter(known).reduce((sum, item) => sum + item.revenue, 0)) / total) / 10 : null;
  let last: Date | null = null;
  for (const line of lines) if (!last || line.orderedAt > last) last = line.orderedAt;
  return {
    costCoveragePct: share((item) => item.costPrice !== null),
    stockCoveragePct: share((item) => item.stock !== null),
    lastOrderAt: last ? last.toISOString() : null,
  };
}
