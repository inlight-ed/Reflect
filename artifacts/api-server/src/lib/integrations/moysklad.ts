/**
 * МойСклад JSON API 1.2 — stock report with cost price.
 * The API requires "Accept-Encoding: gzip" and returns money in minor units (kopecks / tiyn).
 */
import type { ProductInput } from "../user-data";
import { fetchWithTimeout } from "./net";

const BASE = () => (process.env["MOYSKLAD_API_BASE"] ?? "https://api.moysklad.ru/api/remap/1.2").replace(/\/$/, "");
const PAGE = 1000;
const MAX_ROWS = 20_000;

export class MoyskladError extends Error {
  constructor(public code: "UNAUTHORIZED" | "UNAVAILABLE" | "BAD_RESPONSE") {
    super(code);
  }
}

async function get(path: string, token: string) {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${BASE()}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip", Accept: "application/json;charset=utf-8" },
      timeoutMs: 30_000,
    });
  } catch {
    throw new MoyskladError("UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) throw new MoyskladError("UNAUTHORIZED");
  if (!response.ok) throw new MoyskladError(response.status >= 500 ? "UNAVAILABLE" : "BAD_RESPONSE");
  try {
    return (await response.json()) as { rows?: Array<Record<string, unknown>>; meta?: { size?: number } };
  } catch {
    throw new MoyskladError("BAD_RESPONSE");
  }
}

export async function testMoyskladToken(token: string) {
  await get(`/report/stock/all?limit=1`, token);
  return true;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Stock and cost price for every product. SKU = article, falling back to code. */
export async function fetchMoyskladStock(token: string): Promise<ProductInput[]> {
  const products: ProductInput[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const body = await get(`/report/stock/all?limit=${PAGE}&offset=${offset}`, token);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    for (const row of rows) {
      const sku = str(row.article) ?? str(row.code);
      if (!sku) continue;
      const price = num(row.price);
      const folder = row.folder as Record<string, unknown> | undefined;
      products.push({
        sku,
        name: str(row.name) ?? null,
        category: str(folder?.name) ?? null,
        stock: num(row.stock) ?? num(row.quantity) ?? null,
        costPrice: price !== undefined ? price / 100 : null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return products;
}
