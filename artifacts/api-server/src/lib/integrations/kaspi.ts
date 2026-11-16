/**
 * Kaspi Merchant API (read-only): orders and their entries.
 * Reference: guide.kaspi.kz/partner/ru/shop/api/orders — GET /orders with
 * filter[orders][state], filter[orders][creationDate][$ge|$le] (ms), page[number|size] (≤100),
 * header X-Auth-Token, Content-Type application/vnd.api+json; entries via /orders/{id}/entries.
 */
import type { OrderInput } from "../user-data";
import { fetchWithTimeout } from "./net";

const BASE = () => (process.env["KASPI_API_BASE"] ?? "https://kaspi.kz/shop/api/v2").replace(/\/$/, "");
const DAY = 86_400_000;
// Kaspi limits how wide a creationDate filter may be; 14-day windows stay inside it.
const WINDOW_DAYS = 14;
const STATES = ["ARCHIVE", "KASPI_DELIVERY", "DELIVERY", "PICKUP", "SIGN_REQUIRED", "NEW"] as const;
const MAX_ORDERS = 3000;

export class KaspiError extends Error {
  constructor(public code: "UNAUTHORIZED" | "UNAVAILABLE" | "BAD_RESPONSE") {
    super(code);
  }
}

type JsonApiResource = { id: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string; type: string } | null; links?: { related?: string } }> };

async function kaspiGet(path: string, token: string) {
  const url = path.startsWith("http") ? path : `${BASE()}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers: { "X-Auth-Token": token, "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" }, timeoutMs: 20_000 });
  } catch {
    throw new KaspiError("UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) throw new KaspiError("UNAUTHORIZED");
  if (!response.ok) throw new KaspiError(response.status >= 500 ? "UNAVAILABLE" : "BAD_RESPONSE");
  try {
    return (await response.json()) as { data?: JsonApiResource | JsonApiResource[]; included?: JsonApiResource[]; meta?: { pageCount?: number; totalCount?: number } };
  } catch {
    throw new KaspiError("BAD_RESPONSE");
  }
}

function ordersPath(state: string, from: number, to: number, page: number) {
  const params = new URLSearchParams({
    "page[number]": String(page),
    "page[size]": "100",
    "filter[orders][state]": state,
    "filter[orders][creationDate][$ge]": String(from),
    "filter[orders][creationDate][$le]": String(to),
  });
  return `/orders?${params.toString()}`;
}

/** Cheap call that proves the token works. */
export async function testKaspiToken(token: string) {
  const now = Date.now();
  await kaspiGet(ordersPath("NEW", now - DAY, now, 0), token);
  return true;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
const num = (value: unknown) => (typeof value === "number" ? value : Number(value));

/** Pulls orders created in the last `days` days and flattens them to order lines. */
export async function fetchKaspiOrders(token: string, days = 60): Promise<{ lines: OrderInput[]; orders: number; truncated: boolean }> {
  const now = Date.now();
  const orders: JsonApiResource[] = [];
  let truncated = false;
  outer: for (let end = now; end > now - days * DAY; end -= WINDOW_DAYS * DAY) {
    const start = Math.max(now - days * DAY, end - WINDOW_DAYS * DAY);
    for (const state of STATES) {
      for (let page = 0; page < 50; page += 1) {
        const body = await kaspiGet(ordersPath(state, start, end, page), token);
        const data = Array.isArray(body.data) ? body.data : [];
        orders.push(...data);
        if (orders.length >= MAX_ORDERS) { truncated = true; break outer; }
        const pageCount = body.meta?.pageCount;
        if (data.length < 100 || (pageCount !== undefined && page + 1 >= pageCount)) break;
      }
    }
  }

  const productNames = new Map<string, { code?: string; name?: string }>();
  const lineGroups = await mapLimit(orders, 4, async (order) => {
    const attributes = order.attributes ?? {};
    const code = str(attributes.code) ?? order.id;
    const createdAt = num(attributes.creationDate);
    const status = str(attributes.status) ?? str(attributes.state) ?? "";
    const entriesBody = await kaspiGet(`/orders/${encodeURIComponent(order.id)}/entries`, token);
    const entries = Array.isArray(entriesBody.data) ? entriesBody.data : [];
    const included = new Map((entriesBody.included ?? []).map((item) => [`${item.type}:${item.id}`, item]));
    const lines: OrderInput[] = [];
    for (const entry of entries) {
      const ea = entry.attributes ?? {};
      const offer = (ea.offer ?? {}) as Record<string, unknown>;
      let productCode = str(offer.code);
      let productName = str(offer.name);
      const productRef = entry.relationships?.product;
      if (!productCode && productRef?.data) {
        const cached = productNames.get(productRef.data.id) ?? (() => {
          const inc = included.get(`${productRef.data!.type}:${productRef.data!.id}`);
          return inc ? { code: str(inc.attributes?.code), name: str(inc.attributes?.name) } : undefined;
        })();
        if (cached) {
          productCode = cached.code;
          productName ??= cached.name;
        } else if (productRef.links?.related) {
          try {
            const productBody = await kaspiGet(productRef.links.related, token);
            const product = Array.isArray(productBody.data) ? productBody.data[0] : productBody.data;
            const value = { code: str(product?.attributes?.code), name: str(product?.attributes?.name) };
            productNames.set(productRef.data.id, value);
            productCode = value.code;
            productName ??= value.name;
          } catch {
            // keep the entry with what we have
          }
        }
      }
      const quantity = num(ea.quantity) || 1;
      const totalPrice = num(ea.totalPrice);
      const basePrice = num(ea.basePrice);
      lines.push({
        orderCode: code,
        orderedAt: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : new Date().toISOString(),
        sku: productCode ?? str(ea.entryNumber) ?? entry.id,
        productName: productName ?? str((ea.category as Record<string, unknown> | undefined)?.title) ?? null,
        quantity,
        amount: Number.isFinite(totalPrice) ? totalPrice : Number.isFinite(basePrice) ? basePrice * quantity : 0,
        status,
      });
    }
    return lines;
  });
  return { lines: lineGroups.flat(), orders: orders.length, truncated };
}
