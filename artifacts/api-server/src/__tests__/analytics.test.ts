/**
 * Reference cases for the numbers sellers act on. Each expected value is worked out by hand in
 * the comment next to it, so a formula change that moves a number fails here first.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dataCoverage, overviewMetrics, recommendations, skuStats, windows, type CatalogItem, type OrderLine } from "../lib/analytics";

const NOW = new Date("2026-08-18T12:00:00Z");
const day = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
const line = (daysAgo: number, sku: string, amount: number, quantity = 1, status = "SOLD", orderCode = `O-${sku}-${daysAgo}-${amount}-${status}`): OrderLine =>
  ({ orderCode, orderedAt: day(daysAgo), sku, productName: sku, quantity, amount, status });
const item = (sku: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ sku, name: sku, category: null, kaspiCode: null, costPrice: null, stock: null, leadTimeDays: null, commissionPct: null, stockUpdatedAt: null, ...extra });

describe("windows", () => {
  it("compares with the previous period or the same period a year ago", () => {
    const previous = windows(NOW, 30, "previous");
    assert.equal(previous.comparison.to.getTime(), previous.current.from.getTime());
    const year = windows(NOW, 30, "year");
    assert.equal(NOW.getTime() - year.comparison.to.getTime(), 365 * 86_400_000);
  });
});

describe("skuStats", () => {
  // 10 sales of 10 000 ₸ in the last 30 days, cost 6 000, commission 10 %:
  // unit margin = 10 000 × 0.9 − 6 000 = 3 000; margin % = 30 %; break-even ROAS = 1 / 0.3 = 3.33.
  const lines = Array.from({ length: 10 }, (_, i) => line(i + 1, "A", 10_000));
  const stats = skuStats(lines, [item("A", { costPrice: 6_000, commissionPct: 10, stock: 20 })], [{ day: day(5).toISOString().slice(0, 10), sku: "A", channel: "Kaspi", spend: 25_000 }], NOW, 30, "previous");
  const a = stats.find((s) => s.sku === "A")!;

  it("calculates revenue, margin and ROAS", () => {
    assert.equal(a.revenue, 100_000);
    assert.equal(a.unitMargin, 3_000);
    assert.equal(a.marginPct, 0.3);
    assert.equal(a.roas, 4); // 100 000 / 25 000
    assert.equal(a.breakevenRoas, 3.33);
  });

  it("forecasts stock from average sales", () => {
    // History is 10 days, so velocity = 10 units / 10 days = 1 per day; 20 in stock → 20 days.
    assert.equal(a.velocity, 1);
    assert.equal(a.coverDays, 20);
    // Reorder covers lead time 14 + safety 7 = 21 days: 21 − 20 = 1.
    assert.equal(a.reorderQty, 1);
    assert.equal(a.stockoutDate, "2026-09-07");
  });

  it("uses the default commission and says so when none is entered", () => {
    const [b] = skuStats([line(1, "B", 1_000)], [item("B", { costPrice: 500 })], [], NOW, 30, "previous");
    assert.equal(b!.commissionAssumed, true);
    assert.equal(b!.commissionPct, 12);
    assert.equal(b!.unitMargin, 380); // 1 000 × 0.88 − 500
  });

  it("does not count cancelled or returned orders as revenue, but tracks the return rate", () => {
    const [c] = skuStats([line(1, "C", 1_000), line(2, "C", 1_000, 1, "RETURNED"), line(3, "C", 1_000, 1, "CANCELLED"), line(4, "C", 1_000, 1, "PENDING")], [], [], NOW, 30, "previous");
    assert.equal(c!.revenue, 2_000); // SOLD + PENDING
    assert.equal(c!.returnRate, 0.25);
  });

  it("leaves margin empty without a cost price instead of guessing", () => {
    const [d] = skuStats([line(1, "D", 1_000)], [], [], NOW, 30, "previous");
    assert.equal(d!.marginPct, null);
    assert.equal(d!.breakevenRoas, null);
  });

  it("returns null trend when there is nothing to compare with", () => {
    const [e] = skuStats([line(1, "E", 1_000)], [], [], NOW, 30, "previous");
    assert.equal(e!.trendPct, null);
  });
});

describe("recommendations", () => {
  it("asks to restock when stock runs out before a new delivery can arrive", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i + 1, "R", 5_000, 2));
    const stats = skuStats(lines, [item("R", { stock: 10, costPrice: 2_000, commissionPct: 10, stockUpdatedAt: day(0) })], [], NOW, 30, "previous");
    const actions = recommendations(stats, NOW);
    assert.equal(actions[0]?.type, "RESTOCK");
    assert.ok(actions[0]!.confidence >= 50 && actions[0]!.confidence <= 90);
  });

  it("never shows more than two actions of one kind or one per product", () => {
    const lines = ["A", "B", "C", "D"].flatMap((sku) => Array.from({ length: 30 }, (_, i) => line(i + 1, sku, 5_000, 2)));
    const stats = skuStats(lines, ["A", "B", "C", "D"].map((sku) => item(sku, { stock: 5, costPrice: 1_000 })), [], NOW, 30, "previous");
    const actions = recommendations(stats, NOW);
    assert.ok(actions.filter((action) => action.type === "RESTOCK").length <= 2);
    assert.equal(new Set(actions.map((action) => action.sku)).size, actions.length);
  });
});

describe("dataCoverage", () => {
  it("weights missing cost prices by revenue", () => {
    // A: 80 000 ₸ with cost, B: 20 000 ₸ without → 80 %.
    const stats = skuStats([line(1, "A", 80_000), line(2, "B", 20_000)], [item("A", { costPrice: 1 }), item("B")], [], NOW, 30, "previous");
    const coverage = dataCoverage(stats, [line(1, "A", 80_000), line(2, "B", 20_000)]);
    assert.equal(coverage.costCoveragePct, 80);
    assert.equal(coverage.stockCoveragePct, 0);
    assert.equal(coverage.lastOrderAt, day(1).toISOString());
  });

  it("is null without sales", () => {
    assert.equal(dataCoverage([], []).costCoveragePct, null);
  });

  it("marks gross profit as an estimate when the commission is assumed or costs are missing", () => {
    const lines = [line(1, "A", 10_000), line(2, "B", 5_000)];
    const profit = (catalog: CatalogItem[]) => overviewMetrics(lines, skuStats(lines, catalog, [], NOW, 30, "previous"), NOW, 30, "previous").find((m) => m.label === "metric.grossProfit");
    assert.equal(profit([item("A", { costPrice: 4_000, commissionPct: 10 }), item("B", { costPrice: 2_000, commissionPct: 10 })])?.estimated, false);
    assert.equal(profit([item("A", { costPrice: 4_000 }), item("B", { costPrice: 2_000, commissionPct: 10 })])?.estimated, true, "default commission");
    assert.equal(profit([item("A", { costPrice: 4_000, commissionPct: 10 }), item("B")])?.estimated, true, "B has no cost price");
  });
});
