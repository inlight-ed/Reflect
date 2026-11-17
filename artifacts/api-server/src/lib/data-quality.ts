import type { CatalogItem, OrderLine, SkuStats } from "./analytics";

/**
 * What in the seller's data makes Reflect's figures less exact, and what to fix first. Each issue
 * says how many products it touches and what share of the period's revenue they carry, so the
 * list can be ordered by how much it matters, not by how many rows it has.
 */
export type DataIssueType =
  | "SOLD_NOT_IN_CATALOG"
  | "NO_COST"
  | "NO_LOGISTICS"
  | "NO_STOCK"
  | "STALE_STOCK"
  | "ORDERS_OUTDATED";

export type DataIssue = {
  type: DataIssueType;
  /** Products affected; for ORDERS_OUTDATED, days since the last order. */
  count: number;
  /** Share of the period's revenue these products carry, 0–100; null when not tied to products. */
  revenueSharePct: number | null;
  /** The products to fix first, by revenue (at most 5). */
  products: Array<{ sku: string; name: string; revenue: number }>;
};

/** Stock older than this no longer describes the shelf: a forecast built on it is a guess. */
export const STALE_STOCK_DAYS = 7;
/** No new order for this long while the shop sold before usually means the sync or uploads stopped. */
export const ORDERS_OUTDATED_DAYS = 3;
const DAY = 86_400_000;
const TOP = 5;

export function dataIssues(stats: SkuStats[], catalog: CatalogItem[], lines: OrderLine[], now: Date = new Date()): DataIssue[] {
  const sold = stats.filter((item) => item.units > 0);
  const total = sold.reduce((sum, item) => sum + item.revenue, 0);
  const inCatalog = new Set(catalog.map((item) => item.sku));
  const issue = (type: DataIssueType, affected: SkuStats[]): DataIssue | undefined => {
    if (!affected.length) return undefined;
    const revenue = affected.reduce((sum, item) => sum + item.revenue, 0);
    return {
      type,
      count: affected.length,
      revenueSharePct: total > 0 ? Math.round((1000 * revenue) / total) / 10 : null,
      products: [...affected].sort((a, b) => b.revenue - a.revenue).slice(0, TOP).map(({ sku, name, revenue: amount }) => ({ sku, name, revenue: amount })),
    };
  };

  const issues: Array<DataIssue | undefined> = [];
  // Without a catalog at all every product would be listed four times; one issue says it all.
  if (catalog.length === 0) {
    issues.push(issue("SOLD_NOT_IN_CATALOG", sold));
  } else {
    issues.push(issue("SOLD_NOT_IN_CATALOG", sold.filter((item) => !inCatalog.has(item.sku))));
    const listed = sold.filter((item) => inCatalog.has(item.sku));
    issues.push(issue("NO_COST", listed.filter((item) => item.costPrice === null)));
    issues.push(issue("NO_LOGISTICS", listed.filter((item) => item.costPrice !== null && item.logisticsCost === null)));
    issues.push(issue("NO_STOCK", listed.filter((item) => item.stock === null)));
    issues.push(issue("STALE_STOCK", listed.filter((item) => item.stock !== null && (!item.stockUpdatedAt || now.getTime() - item.stockUpdatedAt.getTime() > STALE_STOCK_DAYS * DAY))));
  }

  let last = 0;
  for (const line of lines) if (line.orderedAt.getTime() > last) last = line.orderedAt.getTime();
  const daysSince = last ? Math.floor((now.getTime() - last) / DAY) : 0;
  if (last && daysSince >= ORDERS_OUTDATED_DAYS) issues.push({ type: "ORDERS_OUTDATED", count: daysSince, revenueSharePct: null, products: [] });

  // Outdated orders first (every figure depends on them), then by the revenue each issue touches.
  return issues
    .filter((item): item is DataIssue => Boolean(item))
    .sort((a, b) => (a.type === "ORDERS_OUTDATED" ? -1 : b.type === "ORDERS_OUTDATED" ? 1 : (b.revenueSharePct ?? 0) - (a.revenueSharePct ?? 0)));
}
