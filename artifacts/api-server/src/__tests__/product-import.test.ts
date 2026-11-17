/**
 * A SKU listed twice in one products file. The merge rule runs without a database; the import
 * itself needs DATABASE_URL (skipped otherwise, CI runs it against PostgreSQL).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { register } from "../lib/auth";
import { database } from "../lib/database";
import { importProducts, mergeProductRows, updateProductCosts } from "../lib/user-data";

describe("products: one row per SKU", () => {
  it("merges in file order: a later filled cell wins, an empty one keeps the earlier value", () => {
    const merged = mergeProductRows([
      { sku: "A", name: "Крем", costPrice: 1000, stock: null },
      { sku: "B", name: "Бальзам", costPrice: 500, stock: 3 },
      { sku: "A", name: null, costPrice: 1200, stock: 7 },
    ]);
    assert.deepEqual(merged, [
      { sku: "A", name: "Крем", costPrice: 1200, stock: 7 },
      { sku: "B", name: "Бальзам", costPrice: 500, stock: 3 },
    ]);
  });
});

const skip = process.env["DATABASE_URL"] ? false : "set DATABASE_URL to run database tests";

describe("products import with a repeated SKU", { skip }, () => {
  let userId = "";
  after(async () => {
    if (!userId) return;
    const { db, usersTable } = await database();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("imports the file instead of failing it, and stores the merged row", async () => {
    const { user } = await register(`dup-sku-${Date.now()}@example.kz`, "password-123");
    userId = user.id;
    const rows = [
      { sku: "FX-1", name: "Крем для рук 75 мл", costPrice: 1800 },
      { sku: "FX-2", name: "Бальзам для губ", costPrice: 900 },
      { sku: "FX-1", costPrice: 1950, stock: 12 },
    ];
    const result = await importProducts(user.id, rows, "FILE", "products.csv");
    assert.equal(result.accepted, 3);

    const { db, productsTable } = await database();
    const [stored] = await db.select().from(productsTable).where(and(eq(productsTable.userId, user.id), eq(productsTable.sku, "FX-1")));
    assert.equal(stored?.name, "Крем для рук 75 мл");
    assert.equal(Number(stored?.costPrice), 1950);
    assert.equal(Number(stored?.stock), 12);
    const all = await db.select().from(productsTable).where(eq(productsTable.userId, user.id));
    assert.equal(all.length, 2);
  });

  it("a hand correction changes only the fields sent, and adds a SKU that was not in the catalog", async () => {
    await updateProductCosts(userId, { sku: "FX-1", logisticsCost: 700 });
    await updateProductCosts(userId, { sku: "NEW-9", costPrice: 2500, stock: 4 });
    const { db, productsTable } = await database();
    const [fx] = await db.select().from(productsTable).where(and(eq(productsTable.userId, userId), eq(productsTable.sku, "FX-1")));
    assert.equal(Number(fx?.logisticsCost), 700);
    assert.equal(Number(fx?.costPrice), 1950, "untouched");
    const [added] = await db.select().from(productsTable).where(and(eq(productsTable.userId, userId), eq(productsTable.sku, "NEW-9")));
    assert.equal(Number(added?.stock), 4);
    assert.ok(added?.stockUpdatedAt, "a stock entered by hand is fresh");
    await updateProductCosts(userId, { sku: "FX-1", logisticsCost: null });
    const [cleared] = await db.select().from(productsTable).where(and(eq(productsTable.userId, userId), eq(productsTable.sku, "FX-1")));
    assert.equal(cleared?.logisticsCost, null);
  });
});
