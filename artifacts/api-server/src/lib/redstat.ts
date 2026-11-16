import type {
  ComparableProduct,
  CompetitorSellerOffer,
  CompetitorsOverview,
  SourceMessageKey,
} from "@workspace/api-zod";

export type RedstatQuery = {
  kaspiSku: string;
};

export type RedstatCategoryData = {
  categoryId: string;
  name: string;
};

export type RedstatProductData = {
  kaspiSku: string;
  name: string;
  categoryId?: string;
};

export type RedstatCompetitorData = {
  sellers: CompetitorSellerOffer[];
  alternatives: ComparableProduct[];
  insight?: CompetitorsOverview["insight"];
};

export type RedstatMarketDynamics = {
  dataAsOf?: Date;
  observations: Array<{ label: string; value: number }>;
};

export type RedstatConnectorResult<T> = {
  source: "REDSTAT" | "MOCK";
  status: "READY" | "PARTIAL" | "NO_DATA" | "NOT_CONFIGURED" | "UNAVAILABLE";
  checkedAt: string;
  dataAsOf?: Date;
  detail?: SourceMessageKey;
  data?: T;
};

/**
 * App-facing connector boundary from the product brief.
 * Provider-specific MCP tool names and wire formats stay outside this contract.
 */
export interface RedstatConnector {
  getCategoryData(query: RedstatQuery): Promise<RedstatConnectorResult<RedstatCategoryData>>;
  getCompetitorData(query: RedstatQuery): Promise<RedstatConnectorResult<RedstatCompetitorData>>;
  getProductData(query: RedstatQuery): Promise<RedstatConnectorResult<RedstatProductData>>;
  getMarketDynamics(query: RedstatQuery): Promise<RedstatConnectorResult<RedstatMarketDynamics>>;
}

function notConfigured<T>(): RedstatConnectorResult<T> {
  return {
    source: "MOCK",
    status: "NOT_CONFIGURED",
    checkedAt: new Date().toISOString(),
    detail: "connector.redstat.methods_unconfirmed",
  };
}

/**
 * Use until RedStat documents an application-server API or a Replit connector
 * becomes available. Never present this adapter's empty result as live data.
 */
export const mockRedstatConnector: RedstatConnector = {
  async getCategoryData() {
    return notConfigured<RedstatCategoryData>();
  },
  async getCompetitorData() {
    return notConfigured<RedstatCompetitorData>();
  },
  async getProductData() {
    return notConfigured<RedstatProductData>();
  },
  async getMarketDynamics() {
    return notConfigured<RedstatMarketDynamics>();
  },
};

const arr = (value: unknown) => (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []);
const pick = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && value !== "");
const asNum = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};
const asStr = (value: unknown) => (value === undefined || value === null || value === "" ? undefined : String(value));

/** Finds the first array of objects in a tool result, under any of the given keys. */
function rowsOf(result: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return arr(result);
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(record[key])) return arr(record[key]);
  return [];
}

export function mapRedstatSellers(result: unknown): CompetitorSellerOffer[] {
  return rowsOf(result, ["sellers", "offers", "merchants", "items", "data"]).map((row) => {
    const price = asNum(pick(row, ["price", "min_price", "offer_price", "cost"]));
    if (price === undefined) return undefined;
    const rating = asNum(pick(row, ["rating", "merchant_rating", "seller_rating"]));
    const reviews = asNum(pick(row, ["reviews", "reviews_count", "review_count", "merchant_reviews"]));
    const offer: CompetitorSellerOffer = { name: asStr(pick(row, ["name", "merchant_name", "seller", "seller_name", "merchant"])) ?? "—", price };
    if (rating !== undefined) offer.rating = rating;
    if (reviews !== undefined) offer.reviews = reviews;
    const availability = asStr(pick(row, ["availability", "delivery", "delivery_info", "stock_status"]));
    if (availability) offer.availability = availability;
    const url = asStr(pick(row, ["url", "merchant_url", "kaspi_url", "link"]));
    if (url && /^https:\/\//.test(url)) offer.url = url;
    return offer;
  }).filter((offer): offer is CompetitorSellerOffer => Boolean(offer)).slice(0, 50);
}

export function mapRedstatProducts(result: unknown, excludeSku?: string): ComparableProduct[] {
  return rowsOf(result, ["products", "items", "data"]).map((row) => {
    const kaspiSku = asStr(pick(row, ["sku", "master_sku", "code"]));
    const name = asStr(pick(row, ["name", "title"]));
    if (!kaspiSku || !name || kaspiSku === excludeSku) return undefined;
    const product: ComparableProduct = { kaspiSku, name };
    const price = asNum(row.price);
    if (price !== undefined) product.price = price;
    const sellers = asNum(pick(row, ["sellers", "seller_count", "merchants"]));
    if (sellers !== undefined) product.sellerCount = sellers;
    const orders = asNum(pick(row, ["orders", "sale_qty", "sales"]));
    if (orders !== undefined) product.saleQty = orders;
    return product;
  }).filter((item): item is ComparableProduct => Boolean(item)).slice(0, 20);
}

export type ReviewDigest = { averageRating: number | null; count: number; positive: number | null; negative: number | null; samples: Array<{ rating: number | null; text: string }> };

export function mapRedstatReviews(result: unknown): ReviewDigest {
  const record = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const summary = (record.summary ?? record.stats ?? {}) as Record<string, unknown>;
  const reviews = rowsOf(result, ["reviews", "items", "comments", "data"]);
  const samples = reviews.map((row) => {
    const parts = [pick(row, ["text", "comment", "review"]), row.plus ? `+ ${row.plus}` : undefined, row.minus ? `− ${row.minus}` : undefined].map(asStr).filter(Boolean);
    return { rating: asNum(pick(row, ["rating", "stars", "score"])) ?? null, text: parts.join(" ").slice(0, 600) };
  }).filter((item) => item.text).slice(0, 60);
  const ratings = samples.map((item) => item.rating).filter((value): value is number => value !== null);
  return {
    averageRating: asNum(pick(summary, ["avg_rating", "average_rating", "rating"])) ?? asNum(pick(record, ["avg_rating", "average_rating", "rating"])) ?? (ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null),
    count: asNum(pick(summary, ["total", "count", "reviews"])) ?? asNum(pick(record, ["total", "count"])) ?? reviews.length,
    positive: asNum(pick(summary, ["positive", "positive_count", "pos"])) ?? null,
    negative: asNum(pick(summary, ["negative", "negative_count", "neg"])) ?? null,
    samples,
  };
}

/** RedStat reached through its MCP server (tool names as published by RedStat). */
export function mcpRedstatConnector(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>): RedstatConnector {
  const checkedAt = () => new Date().toISOString();
  const unavailable = <T,>(): RedstatConnectorResult<T> => ({ source: "REDSTAT", status: "UNAVAILABLE", checkedAt: checkedAt(), detail: "connector.redstat.unavailable" });
  return {
    async getCategoryData() { return { source: "REDSTAT", status: "NO_DATA", checkedAt: checkedAt() }; },
    async getProductData() { return { source: "REDSTAT", status: "NO_DATA", checkedAt: checkedAt() }; },
    async getMarketDynamics() { return { source: "REDSTAT", status: "NO_DATA", checkedAt: checkedAt() }; },
    async getCompetitorData({ kaspiSku }) {
      try {
        const [sellersResult, searchResult] = await Promise.allSettled([call("product_sellers", { query: kaspiSku }), call("search_products", { query: kaspiSku, limit: 10 })]);
        const sellers = sellersResult.status === "fulfilled" ? mapRedstatSellers(sellersResult.value) : [];
        const resolved = sellersResult.status === "fulfilled" ? ((sellersResult.value as Record<string, unknown> | undefined)?.resolved as Record<string, unknown> | undefined) : undefined;
        let alternatives = searchResult.status === "fulfilled" ? mapRedstatProducts(searchResult.value, kaspiSku) : [];
        const productName = asStr(resolved?.product_name);
        if (!alternatives.length && productName) {
          alternatives = mapRedstatProducts(await call("search_products", { query: productName.split(" ").slice(0, 4).join(" "), limit: 10 }).catch(() => []), kaspiSku);
        }
        if (!sellers.length && !alternatives.length) {
          const sellersError = sellersResult.status === "fulfilled" && (sellersResult.value as Record<string, unknown> | undefined)?.available === false;
          return sellersError ? unavailable() : { source: "REDSTAT", status: "NO_DATA", checkedAt: checkedAt() };
        }
        return { source: "REDSTAT", status: sellers.length && alternatives.length ? "READY" : "PARTIAL", checkedAt: checkedAt(), data: { sellers, alternatives } };
      } catch {
        return unavailable();
      }
    },
  };
}

export async function getCompetitorAnalysis(
  kaspiSku: string,
  connector: RedstatConnector = mockRedstatConnector,
): Promise<CompetitorsOverview> {
  const result = await connector.getCompetitorData({ kaspiSku });
  return {
    source: result.source,
    status: result.status,
    refreshedAt: result.checkedAt,
    kaspiSku,
    sellers: result.data?.sellers ?? [],
    alternatives: result.data?.alternatives ?? [],
    ...(result.dataAsOf ? { dataAsOf: result.dataAsOf } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    ...(result.data?.insight ? { insight: result.data.insight } : {}),
  };
}
