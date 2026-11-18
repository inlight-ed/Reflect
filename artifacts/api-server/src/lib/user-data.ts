import { and, desc, eq, gte, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { AdLine, CatalogItem, OrderLine, OrderStatus } from "./analytics";
import { database } from "./database";

/** Maps a marketplace / spreadsheet status in ru, kk or en to our four states. */
export function normalizeStatus(raw: string | null | undefined): OrderStatus {
  const text = String(raw ?? "").toLowerCase().replace(/ё/g, "е");
  if (!text) return "SOLD";
  if (/(возврат|return|қайтар|kaspi_delivery_return)/.test(text)) return "RETURNED";
  if (/(отмен|cancel|бас тарт|тоқтат)/.test(text)) return "CANCELLED";
  if (/(выдан|заверш|доставлен|completed|delivered|архив|archive|берілді|аяқталды|жеткізілді|sold|продан)/.test(text)) return "SOLD";
  return "PENDING";
}

const hash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 16);

export type OrderInput = { orderCode?: string | null; orderedAt: string; sku: string; productName?: string | null; quantity: number; amount: number; status?: string | null };
export type ProductInput = { sku: string; name?: string | null; category?: string | null; kaspiCode?: string | null; costPrice?: number | null; stock?: number | null; leadTimeDays?: number | null; commissionPct?: number | null; logisticsCost?: number | null; otherCost?: number | null };
export type AdInput = { day: string; sku?: string | null; channel?: string | null; spend: number };

export class ImportValidationError extends Error {}

/** A date built from parts must come back with the same parts, otherwise 31.02 would silently become 3 March. */
function exactDate(year: string, month: string, day: string, time: string): Date | undefined {
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}+05:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const local = new Date(date.getTime() + 5 * 3_600_000);
  return local.getUTCFullYear() === y && local.getUTCMonth() + 1 === m && local.getUTCDate() === d ? date : undefined;
}

/** Returns undefined (never an Invalid Date) when the text is not a real calendar date. */
export function parseDate(value: string): Date | undefined {
  const text = value.trim();
  const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (dotted) {
    const [, d, m, y, hh = "12", mm = "00"] = dotted;
    if (Number(hh) > 23 || Number(mm) > 59) return undefined;
    return exactDate(y!, m!, d!, `${hh.padStart(2, "0")}:${mm}:00`);
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return exactDate(iso[1]!, iso[2]!, iso[3]!, "12:00:00");
  if (/^\d{12,13}$/.test(text)) return new Date(Number(text));
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

export const MAX_AMOUNT = 1e10;
export const MAX_QUANTITY = 1e7;

export function normalizeOrders(rows: OrderInput[], source: string) {
  const occurrences = new Map<string, number>();
  const result = [];
  for (const row of rows) {
    const orderedAt = parseDate(row.orderedAt);
    const sku = row.sku?.trim();
    if (!orderedAt || !sku || !Number.isFinite(row.quantity) || !Number.isFinite(row.amount)) continue;
    if (orderedAt.getTime() > Date.now() + 86_400_000 || orderedAt.getFullYear() < 2015) continue;
    // Refund lines and corrupt cells must not turn into zero-value orders or overflow sums.
    if (row.quantity < 0 || row.amount < 0 || row.quantity > MAX_QUANTITY || row.amount > MAX_AMOUNT) continue;
    const day = orderedAt.toISOString().slice(0, 10);
    const orderCode = row.orderCode?.trim() || `F-${day}-${hash(`${sku}|${row.quantity}|${row.amount}`)}`;
    const base = `${orderCode}|${sku}`;
    const index = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, index);
    result.push({
      orderCode: orderCode.slice(0, 80),
      lineKey: `${sku.slice(0, 80)}#${index}`,
      orderedAt,
      sku: sku.slice(0, 80),
      productName: row.productName?.trim().slice(0, 300) || null,
      quantity: row.quantity,
      amount: row.amount,
      status: normalizeStatus(row.status),
      source,
    });
  }
  return result;
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export async function importOrders(workspaceId: string, rows: OrderInput[], source: string, fileName: string | null) {
  const normalized = normalizeOrders(rows, source);
  if (!normalized.length) throw new ImportValidationError("NO_VALID_ROWS");
  const { db, ordersTable, importsTable } = await database();
  // One transaction: a failure part-way leaves the stored orders exactly as they were.
  await db.transaction(async (tx) => {
    for (const part of chunk(normalized, 500)) {
      await tx.insert(ordersTable).values(part.map((row) => ({ ...row, workspaceId }))).onConflictDoUpdate({
        target: [ordersTable.workspaceId, ordersTable.orderCode, ordersTable.lineKey],
        set: { orderedAt: sql`excluded.ordered_at`, productName: sql`excluded.product_name`, quantity: sql`excluded.quantity`, amount: sql`excluded.amount`, status: sql`excluded.status`, sku: sql`excluded.sku`, source: sql`excluded.source` },
      });
    }
    await tx.insert(importsTable).values({ id: randomUUID(), workspaceId, kind: "ORDERS", source, fileName, rows: normalized.length });
  });
  return { accepted: normalized.length, skipped: rows.length - normalized.length };
}

const finite = (value: number | null | undefined, min = 0, max = 1e12) => (value === null || value === undefined || !Number.isFinite(value) ? null : Math.min(max, Math.max(min, value)));

export async function importProducts(workspaceId: string, rows: ProductInput[], source: string, fileName: string | null) {
  const now = new Date();
  const cleaned = rows.filter((row) => row.sku?.trim()).map((row) => ({
    workspaceId,
    sku: row.sku.trim().slice(0, 80),
    name: row.name?.trim().slice(0, 300) || null,
    category: row.category?.trim().slice(0, 120) || null,
    kaspiCode: row.kaspiCode?.trim().slice(0, 40) || null,
    costPrice: finite(row.costPrice),
    stock: finite(row.stock),
    leadTimeDays: row.leadTimeDays == null ? null : Math.round(finite(row.leadTimeDays, 0, 365) ?? 0) || null,
    commissionPct: finite(row.commissionPct, 0, 100),
    logisticsCost: finite(row.logisticsCost),
    otherCost: finite(row.otherCost),
    stockUpdatedAt: row.stock == null ? null : now,
    updatedAt: now,
  }));
  const normalized = mergeProductRows(cleaned);
  if (!normalized.length) throw new ImportValidationError("NO_VALID_ROWS");
  const { db, productsTable, importsTable } = await database();
  // Only overwrite columns the file actually provides: an empty cell keeps the stored value.
  const keep = (column: string) => sql.raw(`coalesce(excluded.${column}, products.${column})`);
  await db.transaction(async (tx) => {
    for (const part of chunk(normalized, 500)) {
      await tx.insert(productsTable).values(part).onConflictDoUpdate({
        target: [productsTable.workspaceId, productsTable.sku],
        set: {
          name: keep("name"), category: keep("category"), kaspiCode: keep("kaspi_code"), costPrice: keep("cost_price"), stock: keep("stock"),
          leadTimeDays: keep("lead_time_days"), commissionPct: keep("commission_pct"), logisticsCost: keep("logistics_cost"), otherCost: keep("other_cost"), stockUpdatedAt: keep("stock_updated_at"), updatedAt: sql`excluded.updated_at`,
        },
      });
    }
    await tx.insert(importsTable).values({ id: randomUUID(), workspaceId, kind: "PRODUCTS", source, fileName, rows: normalized.length });
  });
  return { accepted: cleaned.length, skipped: rows.length - cleaned.length };
}

export type ProductCostsPatch = { sku: string; costPrice?: number | null; logisticsCost?: number | null; otherCost?: number | null; commissionPct?: number | null; stock?: number | null; leadTimeDays?: number | null };

/**
 * A seller's own correction to one product, from the product's economics panel. Only the fields
 * sent change, null clears one. A SKU that sold but was never in the catalog is added, so the fix
 * from "sold but not in the catalog" works in one step.
 */
export async function updateProductCosts(workspaceId: string, patch: ProductCostsPatch) {
  const sku = patch.sku.trim().slice(0, 80);
  if (!sku) throw new ImportValidationError("NO_VALID_ROWS");
  const now = new Date();
  const fields = {
    ...(patch.costPrice !== undefined ? { costPrice: finite(patch.costPrice) } : {}),
    ...(patch.logisticsCost !== undefined ? { logisticsCost: finite(patch.logisticsCost) } : {}),
    ...(patch.otherCost !== undefined ? { otherCost: finite(patch.otherCost) } : {}),
    ...(patch.commissionPct !== undefined ? { commissionPct: finite(patch.commissionPct, 0, 100) } : {}),
    ...(patch.stock !== undefined ? { stock: finite(patch.stock), stockUpdatedAt: patch.stock === null ? null : now } : {}),
    ...(patch.leadTimeDays !== undefined ? { leadTimeDays: patch.leadTimeDays === null ? null : Math.round(finite(patch.leadTimeDays, 1, 365) ?? 1) } : {}),
  };
  const { db, productsTable } = await database();
  await db.insert(productsTable).values({ workspaceId, sku, ...fields, updatedAt: now })
    .onConflictDoUpdate({ target: [productsTable.workspaceId, productsTable.sku], set: { ...fields, updatedAt: now } });
}

/**
 * One row per SKU. PostgreSQL cannot update the same row twice in one statement, so a SKU listed
 * twice in a file (or in a MoySklad export) would fail the whole import. Rows are merged in file
 * order the way the database applies them: a later filled cell wins, an empty one keeps the value
 * from an earlier row.
 */
export function mergeProductRows<T extends { sku: string }>(rows: T[]): T[] {
  const bySku = new Map<string, T>();
  for (const row of rows) {
    const earlier = bySku.get(row.sku);
    if (!earlier) { bySku.set(row.sku, row); continue; }
    const merged = { ...earlier } as Record<string, unknown>;
    for (const [key, value] of Object.entries(row)) if (value !== null && value !== undefined) merged[key] = value;
    bySku.set(row.sku, merged as T);
  }
  return [...bySku.values()];
}

export async function importAds(workspaceId: string, rows: AdInput[], source: string, fileName: string | null) {
  const merged = new Map<string, { workspaceId: string; day: string; sku: string; channel: string; spend: number }>();
  for (const row of rows) {
    const date = parseDate(row.day);
    if (!date || !Number.isFinite(row.spend) || row.spend < 0) continue;
    const entry = { workspaceId, day: date.toISOString().slice(0, 10), sku: row.sku?.trim().slice(0, 80) ?? "", channel: row.channel?.trim().slice(0, 60) ?? "", spend: row.spend };
    const key = `${entry.day}|${entry.sku}|${entry.channel}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, spend: existing.spend + entry.spend } : entry);
  }
  const normalized = [...merged.values()];
  if (!normalized.length) throw new ImportValidationError("NO_VALID_ROWS");
  const { db, adSpendTable, importsTable } = await database();
  await db.transaction(async (tx) => {
    for (const part of chunk(normalized, 500)) {
      await tx.insert(adSpendTable).values(part).onConflictDoUpdate({ target: [adSpendTable.workspaceId, adSpendTable.day, adSpendTable.sku, adSpendTable.channel], set: { spend: sql`excluded.spend` } });
    }
    await tx.insert(importsTable).values({ id: randomUUID(), workspaceId, kind: "ADS", source, fileName, rows: normalized.length });
  });
  return { accepted: normalized.length, skipped: rows.length - normalized.length };
}

export type UserData = {
  lines: OrderLine[];
  catalog: CatalogItem[];
  ads: AdLine[];
  imports: Array<{ id: string; kind: string; source: string; fileName: string | null; rows: number; createdAt: Date }>;
  hasOrders: boolean;
};

/** Everything analytics needs for one seller, limited to ~15 months of orders. */
export async function loadUserData(workspaceId: string): Promise<UserData> {
  const { db, ordersTable, productsTable, adSpendTable, importsTable } = await database();
  const since = new Date(Date.now() - 460 * 86_400_000);
  const [lines, catalog, ads, imports] = await Promise.all([
    db.select({ orderCode: ordersTable.orderCode, orderedAt: ordersTable.orderedAt, sku: ordersTable.sku, productName: ordersTable.productName, quantity: ordersTable.quantity, amount: ordersTable.amount, status: ordersTable.status })
      .from(ordersTable).where(and(eq(ordersTable.workspaceId, workspaceId), gte(ordersTable.orderedAt, since))),
    db.select({ sku: productsTable.sku, name: productsTable.name, category: productsTable.category, kaspiCode: productsTable.kaspiCode, costPrice: productsTable.costPrice, stock: productsTable.stock, leadTimeDays: productsTable.leadTimeDays, commissionPct: productsTable.commissionPct, stockUpdatedAt: productsTable.stockUpdatedAt, logisticsCost: productsTable.logisticsCost, otherCost: productsTable.otherCost })
      .from(productsTable).where(eq(productsTable.workspaceId, workspaceId)),
    db.select({ day: adSpendTable.day, sku: adSpendTable.sku, channel: adSpendTable.channel, spend: adSpendTable.spend }).from(adSpendTable).where(eq(adSpendTable.workspaceId, workspaceId)),
    db.select({ id: importsTable.id, kind: importsTable.kind, source: importsTable.source, fileName: importsTable.fileName, rows: importsTable.rows, createdAt: importsTable.createdAt })
      .from(importsTable).where(eq(importsTable.workspaceId, workspaceId)).orderBy(desc(importsTable.createdAt)).limit(50),
  ]);
  return { lines, catalog, ads, imports, hasOrders: lines.length > 0 };
}

export async function hasUserOrders(workspaceId: string) {
  const { db, ordersTable } = await database();
  const rows = await db.select({ code: ordersTable.orderCode }).from(ordersTable).where(eq(ordersTable.workspaceId, workspaceId)).limit(1);
  return rows.length > 0;
}
