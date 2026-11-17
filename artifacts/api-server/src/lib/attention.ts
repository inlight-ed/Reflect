import type { SkuStats } from "./analytics";
import type { DataIssue } from "./data-quality";

/**
 * Everything that crossed a threshold, in one list: product alerts, a shop-wide drop and the gaps
 * in the data. The overview's plan picks at most six actions for today; this list hides nothing,
 * so a seller can go through it top to bottom. Thresholds are fixed and written out here.
 */
export type AttentionType =
  | "OUT_OF_STOCK"
  | "STOCK_BEFORE_DELIVERY"
  | "SHOP_SALES_DROP"
  | "SALES_DROP"
  | "NEGATIVE_PROFIT"
  | "LOW_MARGIN"
  | "RETURNS_HIGH"
  | "ADS_LOSING"
  | `DATA_${DataIssue["type"]}`;

export type AttentionItem = {
  key: string;
  type: AttentionType;
  severity: "HIGH" | "MEDIUM";
  sku?: string;
  name?: string;
  params: Record<string, string | number>;
  /** ₸ at stake, used to order items of the same severity. */
  impactAmount: number;
};

export const THRESHOLDS = {
  /** A product's sales fell this much (%) against the comparison period… */
  salesDropPct: -30,
  /** …and by this much it is serious. */
  salesDropHighPct: -50,
  /** …counted only for products that had at least this many orders before. */
  salesDropMinOrders: 3,
  /** The whole shop's revenue fell this much (%). */
  shopDropPct: -20,
  /** Margin per unit under this share of the price, but not negative. */
  lowMarginPct: 0.1,
  /** Returns at or above this share of order lines… */
  returnsPct: 0.1,
  /** …among at least this many orders. */
  returnsMinOrders: 5,
  /** Data gaps on at least this share of revenue (%) are serious. */
  dataHighSharePct: 20,
} as const;

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

export function attentionItems(stats: SkuStats[], issues: DataIssue[], shop: { revenue: number; previousRevenue: number }): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (type: AttentionType, severity: AttentionItem["severity"], params: AttentionItem["params"], impactAmount: number, s?: SkuStats) =>
    items.push({ key: s ? `${type}:${s.sku}` : type, type, severity, ...(s ? { sku: s.sku, name: s.name } : {}), params, impactAmount: Math.max(0, Math.round(impactAmount)) });

  if (shop.previousRevenue > 0) {
    const change = ((shop.revenue - shop.previousRevenue) / shop.previousRevenue) * 100;
    if (change <= THRESHOLDS.shopDropPct) add("SHOP_SALES_DROP", "HIGH", { pct: round(Math.abs(change)), lost: Math.round(shop.previousRevenue - shop.revenue) }, shop.previousRevenue - shop.revenue);
  }

  for (const s of stats) {
    const dayRevenue = s.velocity * (s.avgPrice ?? 0);
    if (s.stock !== null && s.stock <= 0 && s.velocity > 0) {
      add("OUT_OF_STOCK", "HIGH", { perDay: Math.round(dayRevenue) }, dayRevenue * s.leadTimeDays, s);
    } else if (s.coverDays !== null && s.velocity > 0 && s.coverDays < s.leadTimeDays) {
      // Stock runs out before a batch ordered today would arrive.
      add("STOCK_BEFORE_DELIVERY", "HIGH", { days: Math.floor(s.coverDays), lead: s.leadTimeDays, qty: s.reorderQty ?? 0, date: s.stockoutDate ?? "" }, dayRevenue * (s.leadTimeDays - s.coverDays), s);
    }
    // A drop on one or two orders is noise, not a signal.
    if (s.trendPct !== null && s.trendPct <= THRESHOLDS.salesDropPct && s.previousOrders >= THRESHOLDS.salesDropMinOrders) {
      add("SALES_DROP", s.trendPct <= THRESHOLDS.salesDropHighPct ? "HIGH" : "MEDIUM", { pct: round(Math.abs(s.trendPct)), lost: Math.round(s.previousRevenue - s.revenue) }, s.previousRevenue - s.revenue, s);
    }
    if (s.netProfit !== null && s.netProfit < 0 && s.revenue > 0) {
      add("NEGATIVE_PROFIT", "HIGH", { loss: Math.round(-s.netProfit), ads: Math.round(s.adSpend) }, -s.netProfit, s);
    } else if (s.marginPct !== null && s.marginPct >= 0 && s.marginPct < THRESHOLDS.lowMarginPct && s.revenue > 0) {
      add("LOW_MARGIN", "MEDIUM", { margin: round(s.marginPct * 100, 1) }, (THRESHOLDS.lowMarginPct - s.marginPct) * s.revenue, s);
    }
    if (s.returnRate !== null && s.returnRate >= THRESHOLDS.returnsPct && s.orders >= THRESHOLDS.returnsMinOrders) {
      add("RETURNS_HIGH", "MEDIUM", { pct: round(s.returnRate * 100, 1) }, s.returnRate * s.revenue, s);
    }
    if (s.roas !== null && s.breakevenRoas !== null && s.roas < s.breakevenRoas) {
      add("ADS_LOSING", "MEDIUM", { roas: s.roas, breakeven: s.breakevenRoas, spend: Math.round(s.adSpend) }, s.adSpend * (1 - s.roas / s.breakevenRoas), s);
    }
  }

  for (const issue of issues) {
    const high = issue.type === "ORDERS_OUTDATED" || (issue.type !== "NO_LOGISTICS" && (issue.revenueSharePct ?? 0) >= THRESHOLDS.dataHighSharePct);
    items.push({
      key: `DATA_${issue.type}`,
      type: `DATA_${issue.type}`,
      severity: high ? "HIGH" : "MEDIUM",
      params: { count: issue.count, share: issue.revenueSharePct ?? "—", ...(issue.products[0] ? { first: issue.products[0].name } : {}) },
      ...(issue.products[0] ? { sku: issue.products[0].sku } : {}),
      impactAmount: issue.products.reduce((sum, product) => sum + product.revenue, 0),
    });
  }

  // Serious first; within a severity, the most money at stake first.
  return items.sort((a, b) => (a.severity === b.severity ? b.impactAmount - a.impactAmount : a.severity === "HIGH" ? -1 : 1));
}
