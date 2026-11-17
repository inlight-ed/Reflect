/**
 * The attention list: each threshold, its severity, and the order a seller reads it in.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skuStats, type CatalogItem, type OrderLine } from "../lib/analytics";
import { attentionItems } from "../lib/attention";
import { dataIssues } from "../lib/data-quality";

const NOW = new Date("2026-08-18T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const sale = (daysAgo: number, sku: string, amount: number, status = "SOLD"): OrderLine =>
  ({ orderCode: `O-${++n}`, orderedAt: new Date(NOW.getTime() - daysAgo * DAY), sku, productName: `Товар ${sku}`, quantity: 1, amount, status });
const item = (sku: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ sku, name: sku, category: null, kaspiCode: null, costPrice: null, stock: null, leadTimeDays: null, commissionPct: 10, stockUpdatedAt: NOW, logisticsCost: 0, ...extra });
const many = (count: number, from: number, to: number, sku: string, amount: number, status = "SOLD") =>
  Array.from({ length: count }, (_, i) => sale(from + ((to - from) * i) / Math.max(1, count - 1), sku, amount, status));

function run(lines: OrderLine[], catalog: CatalogItem[], ads: Array<{ day: string; sku: string; channel: string; spend: number }> = []) {
  const stats = skuStats(lines, catalog, ads, NOW, 30, "previous");
  const shop = { revenue: stats.reduce((s, x) => s + x.revenue, 0), previousRevenue: stats.reduce((s, x) => s + x.previousRevenue, 0) };
  return attentionItems(stats, dataIssues(stats, catalog, lines, NOW), shop);
}
const types = (items: ReturnType<typeof run>, sku?: string) => items.filter((i) => !sku || i.sku === sku).map((i) => i.type);

describe("attention", () => {
  it("flags stock that ends before a new batch arrives, and an empty shelf", () => {
    // 30 sales in 30 days = 1 a day; 5 in stock, lead time 14 → runs out in 5 days.
    const lines = [...many(30, 1, 29, "A", 5_000), ...many(30, 1, 29, "B", 5_000)];
    const items = run(lines, [item("A", { costPrice: 2_000, stock: 5, leadTimeDays: 14 }), item("B", { costPrice: 2_000, stock: 0 })]);
    assert.ok(types(items, "A").includes("STOCK_BEFORE_DELIVERY"));
    assert.ok(types(items, "B").includes("OUT_OF_STOCK"));
    assert.ok(Number(items.find((i) => i.sku === "A")?.params.days) <= 5);
  });

  it("flags a real sales drop but not a drop on one or two orders, and a shop-wide fall", () => {
    const lines = [...many(10, 31, 59, "D", 10_000), ...many(3, 1, 29, "D", 10_000), sale(40, "E", 1_000), sale(45, "E", 1_000)];
    const items = run(lines, [item("D", { costPrice: 1_000, stock: 100 }), item("E", { costPrice: 100, stock: 100 })]);
    const drop = items.find((i) => i.type === "SALES_DROP" && i.sku === "D");
    assert.equal(drop?.severity, "HIGH", "−70 % is serious");
    assert.equal(types(items, "E").includes("SALES_DROP"), false, "two orders before: noise");
    assert.ok(types(items).includes("SHOP_SALES_DROP"));
  });

  it("flags a loss after ads, low margin, high returns and ads that do not pay back", () => {
    const lines = [
      ...many(10, 1, 29, "L", 10_000),
      ...many(10, 1, 29, "M", 10_000),
      ...many(8, 1, 29, "R", 10_000), ...many(2, 1, 29, "R", 10_000, "RETURNED"),
    ];
    const ads = [{ day: "2026-08-10", sku: "L", channel: "Kaspi", spend: 50_000 }];
    const items = run(lines, [
      item("L", { costPrice: 6_000, stock: 500 }),
      item("M", { costPrice: 8_500, stock: 500 }),
      item("R", { costPrice: 3_000, stock: 500 }),
    ], ads);
    // L: 10 × (9 000 − 6 000) − 50 000 = −20 000.
    assert.equal(items.find((i) => i.type === "NEGATIVE_PROFIT")?.params.loss, 20_000);
    assert.ok(types(items, "L").includes("ADS_LOSING"));
    assert.ok(types(items, "M").includes("LOW_MARGIN"));
    assert.ok(types(items, "R").includes("RETURNS_HIGH"));
  });

  it("brings data gaps in, and puts serious items first, the costliest first within a severity", () => {
    const lines = [...many(30, 1, 29, "A", 5_000), ...many(5, 1, 29, "X", 1_000)];
    const items = run(lines, [item("A", { costPrice: 2_000, stock: 5, leadTimeDays: 14 })]);
    assert.ok(types(items).includes("DATA_SOLD_NOT_IN_CATALOG"));
    const severities = items.map((i) => i.severity);
    assert.deepEqual(severities, [...severities].sort((a, b) => (a === b ? 0 : a === "HIGH" ? -1 : 1)));
    const high = items.filter((i) => i.severity === "HIGH").map((i) => i.impactAmount);
    assert.deepEqual(high, [...high].sort((a, b) => b - a));
  });
});
