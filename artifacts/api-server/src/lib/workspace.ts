import { count, desc, eq, max, min } from "drizzle-orm";
/**
 * Builds page payloads from a signed-in seller's own data, in the same shape as the demo
 * endpoints, so the web app renders both. Text that depends on numbers is sent as
 * translation keys + params; the browser localises it.
 */
import { randomUUID } from "node:crypto";
import { getIntegration } from "./integrations/store";
import {
  dataCoverage,
  beforeAfter,
  campaignImpact,
  DEFAULT_COMMISSION_PCT,
  overviewMetrics,
  recommendations,
  revenueSeries,
  skuStats,
  type Compare,
  type Period,
  type SkuStats,
} from "./analytics";
import { database } from "./database";
import { dataIssues } from "./data-quality";
import { loadUserData, type UserData } from "./user-data";

const SOURCE = "USER DATA" as const;

export function parsePeriod(value: unknown): Period {
  return value === "7" ? 7 : value === "90" ? 90 : 30;
}
export function parseCompare(value: unknown): Compare {
  return value === "year" ? "year" : "previous";
}

async function feedbackRows(userId: string) {
  const { db, feedbackTable } = await database();
  return db.select().from(feedbackTable).where(eq(feedbackTable.userId, userId)).orderBy(desc(feedbackTable.createdAt)).limit(100);
}

async function campaignRows(userId: string) {
  const { db, externalCampaignsTable } = await database();
  return db.select().from(externalCampaignsTable).where(eq(externalCampaignsTable.userId, userId)).orderBy(desc(externalCampaignsTable.createdAt)).limit(200);
}

function assumptions(data: UserData, stats: SkuStats[]) {
  const sold = stats.filter((s) => s.revenue > 0);
  return {
    commissionAssumed: sold.some((s) => s.commissionAssumed),
    defaultCommissionPct: DEFAULT_COMMISSION_PCT,
    missingCosts: sold.filter((s) => s.costPrice === null).length,
    missingStock: sold.filter((s) => s.stock === null).length,
    productCount: data.catalog.length,
    ...dataCoverage(stats, data.lines),
  };
}

function summaryInsight(metrics: ReturnType<typeof overviewMetrics>, actions: ReturnType<typeof recommendations>, period: Period) {
  const revenue = metrics[0];
  const change = revenue.changePct;
  const top = actions[0];
  const confidence = actions.length ? Math.round(actions.reduce((sum, action) => sum + action.confidence, 0) / actions.length) : 50;
  // Under 1% either way reads as "flat": "grew 0%" sounds like news when nothing changed.
  const title = change === null ? "summary.title.noComparison" : Math.abs(change) < 1 ? "summary.title.flat" : change > 0 ? "summary.title.up" : "summary.title.down";
  return {
    eyebrow: "summary.eyebrow",
    title,
    body: top ? "summary.body.top" : "summary.body.none",
    titleKey: title,
    bodyKey: top ? "summary.body.top" : "summary.body.none",
    params: { change: change === null ? 0 : Math.abs(change), period, object: top?.object ?? "", actions: actions.length },
    confidence,
    impact: "summary.impact",
    impactAmount: actions.reduce((sum, action) => sum + action.impactAmount, 0),
    severity: (change !== null && change < -10 ? "HIGH" : "MEDIUM") as "HIGH" | "MEDIUM",
  };
}

/**
 * The moment the seller's data reaches. A file covers orders up to its last line; a Kaspi API sync
 * covers everything up to the moment it ran. Analysing up to "now" instead would count the days
 * after an export as days with no sales: the revenue line would drop to zero and sales would look
 * like they collapsed. With the API connected the moment keeps moving, so a real drop still shows.
 */
export async function dataAsOf(userId: string, data: Awaited<ReturnType<typeof loadUserData>>, now = new Date()) {
  let latest = 0;
  for (const line of data.lines) latest = Math.max(latest, line.orderedAt.getTime());
  const kaspi = await getIntegration(userId, "KASPI_API").catch(() => undefined);
  const synced = typeof kaspi?.meta?.completeThrough === "string" ? new Date(kaspi.meta.completeThrough).getTime() : 0;
  // +1 ms: windows end exclusively, the latest order itself belongs inside.
  const end = Math.max(latest + 1, synced);
  return new Date(Math.min(now.getTime(), end > 1 ? end : now.getTime()));
}

export async function userDashboard(userId: string, period: Period, compare: Compare) {
  const data = await loadUserData(userId);
  const now = await dataAsOf(userId, data);
  const stats = skuStats(data.lines, data.catalog, data.ads, now, period, compare);
  const actions = recommendations(stats, now);
  const feedback = await feedbackRows(userId);
  const verdictByKey = new Map(feedback.map((row) => [row.actionKey, row.verdict]));
  const metrics = overviewMetrics(data.lines, stats, now, period, compare);
  const forecast = stats
    .filter((s) => s.coverDays !== null && s.stock !== null && s.velocity > 0 && s.coverDays < 60)
    .sort((a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0))
    .slice(0, 8)
    .map((s) => ({ sku: s.sku, name: s.name, stock: s.stock ?? 0, velocity: s.velocity, coverDays: s.coverDays ?? 0, stockoutDate: s.stockoutDate ?? "", reorderQty: s.reorderQty ?? 0, leadTimeDays: s.leadTimeDays }));
  const timeline = [
    ...data.imports.slice(0, 6).map((item) => ({ id: `import-${item.id}`, date: item.createdAt.toISOString(), label: `timeline.import.${item.kind.toLowerCase()}`, kind: "IMPORT" as const, detail: `${item.fileName ?? item.source} · ${item.rows}` })),
    ...feedback.slice(0, 6).map((row) => ({ id: `feedback-${row.id}`, date: row.createdAt.toISOString(), label: `timeline.feedback.${row.verdict.toLowerCase()}`, kind: "FEEDBACK" as const, detail: row.object })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  return {
    mode: data.hasOrders ? ("USER" as const) : ("EMPTY" as const),
    source: SOURCE,
    refreshedAt: (data.imports[0]?.createdAt ?? now).toISOString(),
    dataAsOf: data.hasOrders ? now.toISOString() : undefined,
    period,
    compare,
    summary: summaryInsight(metrics, actions, period),
    metrics,
    actions: actions.map((action) => ({
      type: action.type,
      key: action.key,
      sku: action.sku,
      object: action.object,
      signal: action.reasonKey,
      explanation: action.reasonKey,
      recommendation: action.recommendationKey,
      reasonKey: action.reasonKey,
      recommendationKey: action.recommendationKey,
      params: action.params,
      impact: "action.impact",
      impactAmount: action.impactAmount,
      confidence: action.confidence,
      confidenceBasis: action.confidenceBasis,
      ...(verdictByKey.has(action.key) ? { verdict: verdictByKey.get(action.key) as "WORKED" | "NOT_WORKED" | "TOO_EARLY" } : {}),
    })),
    timeline,
    series: revenueSeries(data.lines, now, period, compare),
    forecast,
    assumptions: assumptions(data, stats),
  };
}

export async function userProducts(userId: string, period: Period, compare: Compare) {
  const data = await loadUserData(userId);
  const stats = skuStats(data.lines, data.catalog, data.ads, await dataAsOf(userId, data), period, compare);
  const count = (label: string) => stats.filter((s) => s.opportunity === label).length;
  return {
    mode: data.hasOrders ? ("USER" as const) : ("EMPTY" as const),
    source: SOURCE,
    refreshedAt: (data.imports[0]?.createdAt ?? new Date()).toISOString(),
    products: stats.map((s) => ({
      sku: s.sku,
      name: s.name,
      category: s.category ?? "—",
      revenue: s.revenue,
      orders: s.orders,
      units: s.units,
      aov: s.avgPrice ?? 0,
      avgPrice: s.avgPrice,
      spend: s.adSpend,
      adSpend: s.adSpend,
      roas: s.roas,
      breakevenRoas: s.breakevenRoas,
      stock: s.stock,
      stockCoverDays: s.coverDays,
      stockoutDate: s.stockoutDate,
      reorderQty: s.reorderQty,
      leadTimeDays: s.leadTimeDays,
      velocity: s.velocity,
      price: s.avgPrice ?? 0,
      trendPct: s.trendPct,
      trend: s.trendPct ?? 0,
      costPrice: s.costPrice,
      unitMargin: s.unitMargin,
      marginPct: s.marginPct,
      commissionAssumed: s.commissionAssumed,
      commissionPct: s.commissionPct,
      logisticsCost: s.logisticsCost,
      otherCost: s.otherCost,
      netProfit: s.netProfit,
      missingCosts: s.missingCosts,
      kaspiCode: s.kaspiCode,
      opportunity: s.opportunity,
    })),
    // Freshness is judged against today, not the data date: stale stock is stale now.
    dataIssues: data.hasOrders ? dataIssues(stats, data.catalog, data.lines, new Date()) : [],
    matrix: [
      { label: "SCALE", count: count("SCALE"), description: "matrix.scale" },
      { label: "FIX", count: count("FIX"), description: "matrix.fix" },
      { label: "DEFEND", count: count("DEFEND"), description: "matrix.defend" },
      { label: "STOP", count: count("STOP"), description: "matrix.stop" },
      { label: "WATCH", count: count("WATCH"), description: "matrix.watch" },
    ],
  };
}

export async function userAdvertising(userId: string, period: Period, compare: Compare) {
  const data = await loadUserData(userId);
  const stats = skuStats(data.lines, data.catalog, data.ads, await dataAsOf(userId, data), period, compare);
  const withAds = stats.filter((s) => s.adSpend > 0).sort((a, b) => b.adSpend - a.adSpend);
  const spend = withAds.reduce((sum, s) => sum + s.adSpend, 0);
  const revenue = withAds.reduce((sum, s) => sum + s.revenue, 0);
  const losing = withAds.filter((s) => s.roas !== null && s.breakevenRoas !== null && s.roas < s.breakevenRoas);
  const metric = (label: string, amount: number, unit: "CURRENCY" | "MULTIPLIER") => ({ label, value: String(amount), amount, unit, change: "—", changePct: null, positive: true });
  return {
    mode: withAds.length ? ("USER" as const) : ("EMPTY" as const),
    source: SOURCE,
    refreshedAt: new Date().toISOString(),
    primaryMetrics: [metric("metric.adSpend", Math.round(spend), "CURRENCY"), metric("metric.adRevenue", Math.round(revenue), "CURRENCY"), metric("ROAS", spend ? Math.round((revenue / spend) * 100) / 100 : 0, "MULTIPLIER")],
    secondaryMetrics: [],
    signal: {
      eyebrow: "ads.signal.eyebrow",
      title: losing.length ? "ads.signal.losing" : "ads.signal.ok",
      body: "ads.signal.body",
      titleKey: losing.length ? "ads.signal.losing" : "ads.signal.ok",
      bodyKey: "ads.signal.body",
      params: { count: losing.length, total: withAds.length },
      confidence: withAds.length ? 70 : 50,
      impact: "—",
      severity: (losing.length ? "HIGH" : "LOW") as "HIGH" | "LOW",
    },
    placements: [],
    channels: [],
    activities: [],
    skuAds: withAds.map((s) => ({ sku: s.sku, name: s.name, spend: s.adSpend, revenue: s.revenue, roas: s.roas, breakevenRoas: s.breakevenRoas })),
  };
}

export async function userExternalMedia(userId: string) {
  const data = await loadUserData(userId);
  const campaigns = await campaignRows(userId);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const status = (start: string, end: string) => (start > today ? "PLANNED" : end < today ? "COMPLETE" : "ACTIVE");
  const impacts = campaigns.filter((c) => c.startDate <= today).map((campaign) => {
    const start = new Date(`${campaign.startDate}T00:00:00+05:00`);
    const end = new Date(`${campaign.endDate}T23:59:59+05:00`);
    const overlapping = campaigns.some((other) => other.id !== campaign.id && other.startDate <= campaign.endDate && other.endDate >= campaign.startDate);
    return { campaignId: campaign.id, ...campaignImpact(data.lines, start, end, now, overlapping) };
  });
  return {
    mode: campaigns.length ? ("USER" as const) : ("EMPTY" as const),
    source: SOURCE,
    refreshedAt: now.toISOString(),
    campaigns: campaigns.map(({ id, name, channel, startDate, endDate, budget, objective }) => ({ id, name, channel, startDate, endDate, budget, objective, status: status(startDate, endDate) })),
    impacts,
    insight: {
      eyebrow: "media.signal.eyebrow",
      title: "media.signal.title",
      body: "media.signal.body",
      titleKey: "media.signal.title",
      bodyKey: "media.signal.body",
      confidence: impacts.length ? Math.round(impacts.reduce((sum, item) => sum + item.confidence, 0) / impacts.length) : 50,
      impact: "—",
      severity: "MEDIUM" as const,
    },
  };
}

export async function createUserCampaign(userId: string, input: { name: string; channel: string; startDate: string; endDate: string; budget: number; objective: string }) {
  const { db, externalCampaignsTable } = await database();
  const [{ value }] = await db.select({ value: count() }).from(externalCampaignsTable).where(eq(externalCampaignsTable.userId, userId));
  if (value >= 500) throw new Error("LIMIT");
  const campaign = { id: `campaign-${randomUUID()}`, userId, ...input };
  await db.insert(externalCampaignsTable).values(campaign);
  const today = new Date().toISOString().slice(0, 10);
  return { ...input, id: campaign.id, status: input.startDate > today ? "PLANNED" : input.endDate < today ? "COMPLETE" : "ACTIVE" };
}

export async function createFeedback(userId: string, input: { actionKey: string; actionType: string; sku?: string; object: string; verdict: "WORKED" | "NOT_WORKED" | "TOO_EARLY" }) {
  const { db, feedbackTable } = await database();
  const data = await loadUserData(userId);
  const now = new Date();
  const baseline = beforeAfter(data.lines, now, now, input.sku);
  const row = { id: randomUUID(), userId, actionKey: input.actionKey, actionType: input.actionType, sku: input.sku ?? null, object: input.object, verdict: input.verdict, baseline };
  await db.insert(feedbackTable).values(row);
  return { ...row, createdAt: now.toISOString(), beforePerDay: baseline.beforePerDay, afterPerDay: null, changePct: null, daysAfter: 0 };
}

export async function listUserFeedback(userId: string) {
  const data = await loadUserData(userId);
  const rows = await feedbackRows(userId);
  const now = new Date();
  return rows.map((row) => {
    const result = beforeAfter(data.lines, row.createdAt, now, row.sku ?? undefined);
    return { id: row.id, actionKey: row.actionKey, actionType: row.actionType, sku: row.sku, object: row.object, verdict: row.verdict as "WORKED" | "NOT_WORKED" | "TOO_EARLY", createdAt: row.createdAt.toISOString(), ...result };
  });
}

export async function dataStatus(userId: string) {
  const { db, ordersTable, productsTable, adSpendTable } = await database();
  const data = await loadUserData(userId);
  const [[orders], [products], [ads]] = await Promise.all([
    db.select({ value: count(), first: min(ordersTable.orderedAt), last: max(ordersTable.orderedAt) }).from(ordersTable).where(eq(ordersTable.userId, userId)),
    db.select({ value: count() }).from(productsTable).where(eq(productsTable.userId, userId)),
    db.select({ value: count() }).from(adSpendTable).where(eq(adSpendTable.userId, userId)),
  ]);
  return {
    orders: orders.value,
    products: products.value,
    ads: ads.value,
    firstOrderAt: orders.first ? new Date(orders.first).toISOString() : null,
    lastOrderAt: orders.last ? new Date(orders.last).toISOString() : null,
    imports: data.imports.map((item) => ({ ...item, kind: item.kind as "ORDERS" | "PRODUCTS" | "ADS", createdAt: item.createdAt.toISOString() })),
  };
}
