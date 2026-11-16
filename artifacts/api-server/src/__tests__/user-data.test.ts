import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOrders, normalizeStatus } from "../lib/user-data";

describe("normalizeStatus", () => {
  it("maps Kaspi and spreadsheet statuses in three languages", () => {
    assert.equal(normalizeStatus("Выдан"), "SOLD");
    assert.equal(normalizeStatus("Берілді"), "SOLD");
    assert.equal(normalizeStatus("Completed"), "SOLD");
    assert.equal(normalizeStatus("Отменён"), "CANCELLED");
    assert.equal(normalizeStatus("Возврат"), "RETURNED");
    assert.equal(normalizeStatus("KASPI_DELIVERY_RETURN_REQUESTED"), "RETURNED");
    assert.equal(normalizeStatus("Ожидает отправки"), "PENDING");
    assert.equal(normalizeStatus(""), "SOLD");
  });
});

describe("normalizeOrders", () => {
  const rows = [
    { orderCode: "100", orderedAt: "15.08.2026 14:30", sku: "A", quantity: 1, amount: 5000, status: "Выдан" },
    { orderCode: "100", orderedAt: "15.08.2026 14:30", sku: "A", quantity: 1, amount: 5000, status: "Выдан" },
    { orderedAt: "2026-08-14", sku: "B", quantity: 2, amount: 3000 },
  ];

  it("keys lines so that importing the same file twice does not double revenue", () => {
    const first = normalizeOrders(rows, "FILE").map((row) => `${row.orderCode}|${row.lineKey}`);
    const second = normalizeOrders(rows, "FILE").map((row) => `${row.orderCode}|${row.lineKey}`);
    assert.deepEqual(first, second);
    // Two identical lines in one order are two items, not a duplicate.
    assert.equal(new Set(first).size, 3);
  });

  it("reads dd.mm.yyyy as Almaty time", () => {
    const [row] = normalizeOrders([rows[0]!], "FILE");
    assert.equal(row!.orderedAt.toISOString(), "2026-08-15T09:30:00.000Z");
  });

  it("drops rows without date, SKU or amount and dates in the future", () => {
    const result = normalizeOrders([
      { orderedAt: "", sku: "A", quantity: 1, amount: 1 },
      { orderedAt: "2026-08-01", sku: " ", quantity: 1, amount: 1 },
      { orderedAt: "2026-08-01", sku: "A", quantity: 1, amount: Number.NaN },
      { orderedAt: "2099-01-01", sku: "A", quantity: 1, amount: 1 },
    ], "FILE");
    assert.equal(result.length, 0);
  });
});
