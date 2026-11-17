/**
 * What makes Reflect's figures less exact, ordered by how much revenue it touches.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skuStats, type CatalogItem, type OrderLine } from "../lib/analytics";
import { dataIssues } from "../lib/data-quality";

const NOW = new Date("2026-08-18T12:00:00Z");
const DAY = 86_400_000;
const line = (daysAgo: number, sku: string, amount: number): OrderLine =>
  ({ orderCode: `O-${sku}-${daysAgo}`, orderedAt: new Date(NOW.getTime() - daysAgo * DAY), sku, productName: `Товар ${sku}`, quantity: 1, amount, status: "SOLD" });
const item = (sku: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ sku, name: sku, category: null, kaspiCode: null, costPrice: null, stock: null, leadTimeDays: null, commissionPct: null, stockUpdatedAt: null, ...extra });

describe("data issues", () => {
  const lines = [line(1, "A", 60_000), line(1, "B", 30_000), line(2, "C", 10_000)];
  const fresh = new Date(NOW.getTime() - DAY);
  const old = new Date(NOW.getTime() - 10 * DAY);
  const catalog = [
    item("A", { costPrice: 30_000, stock: 5, stockUpdatedAt: old }),
    item("B", { stock: 3, stockUpdatedAt: fresh, logisticsCost: 500 }),
  ];
  const issues = dataIssues(skuStats(lines, catalog, [], NOW, 30, "previous"), catalog, lines, NOW);
  const byType = Object.fromEntries(issues.map((issue) => [issue.type, issue]));

  it("finds each kind of gap with the revenue share it carries", () => {
    assert.equal(byType.SOLD_NOT_IN_CATALOG?.count, 1);
    assert.equal(byType.SOLD_NOT_IN_CATALOG?.products[0]?.sku, "C");
    assert.equal(byType.SOLD_NOT_IN_CATALOG?.revenueSharePct, 10);
    assert.equal(byType.NO_COST?.products[0]?.sku, "B");
    assert.equal(byType.NO_COST?.revenueSharePct, 30);
    assert.equal(byType.NO_LOGISTICS?.products[0]?.sku, "A", "only products with a cost price: logistics is the next gap");
    assert.equal(byType.STALE_STOCK?.products[0]?.sku, "A");
    assert.equal(byType.NO_STOCK, undefined);
  });

  it("orders issues by the revenue they touch", () => {
    assert.deepEqual(issues.map((issue) => issue.type), ["NO_LOGISTICS", "STALE_STOCK", "NO_COST", "SOLD_NOT_IN_CATALOG"]);
  });

  it("puts outdated orders first, and lists every product once when there is no catalog", () => {
    const late = new Date(NOW.getTime() + 5 * DAY);
    const result = dataIssues(skuStats(lines, [], [], NOW, 30, "previous"), [], lines, late);
    assert.deepEqual(result.map((issue) => issue.type), ["ORDERS_OUTDATED", "SOLD_NOT_IN_CATALOG"]);
    assert.equal(result[0]?.count, 6);
    assert.equal(result[1]?.count, 3);
  });
});
