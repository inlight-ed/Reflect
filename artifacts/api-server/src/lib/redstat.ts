import type {
  ComparableProduct,
  CompetitorSellerOffer,
  CompetitorsOverview,
  MarketBrand,
  MarketCategory,
  MarketContext,
  MarketDynamics,
  MarketPoint,
  MarketProduct,
  MarketSegment,
  SourceMessageKey,
} from "@workspace/api-zod";

export type RedstatQuery = {
  kaspiSku?: string;
  categoryId?: string;
};

export type RedstatCompetitorData = {
  sellers: CompetitorSellerOffer[];
  alternatives: ComparableProduct[];
  insight?: CompetitorsOverview["insight"];
};

export type RedstatProductData = MarketProduct;
export type RedstatCategoryData = MarketCategory;
export type RedstatMarketDynamics = MarketDynamics;

export type RedstatConnectorResult<T> = {
  source: "REDSTAT" | "MOCK";
  status: "READY" | "PARTIAL" | "NO_DATA" | "NOT_CONFIGURED" | "UNAVAILABLE";
  checkedAt: string;
  /** The RedStat month the figures belong to (YYYY-MM-01). */
  month?: string;
  /** RedStat's own caveat about that month, passed on as written. */
  note?: string;
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


const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const httpsUrl = (value: unknown) => {
  const url = asStr(value);
  return url && /^https:\/\//.test(url) ? url : undefined;
};
const month = (value: unknown) => {
  const text = asStr(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
};
/** Copies only the fields that have a value, so optional API fields stay absent instead of null. */
function compact<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** A product row from search_products / top_products. Only an exact SKU match counts for "your card". */
export function mapRedstatProduct(result: unknown, kaspiSku: string): MarketProduct | undefined {
  const row = rowsOf(result, ["products", "items", "data"]).find((item) => asStr(pick(item, ["sku", "master_sku", "code"])) === kaspiSku);
  const name = row && asStr(pick(row, ["name", "title"]));
  if (!row || !name) return undefined;
  const change = row.revenue_change_pct;
  return compact<MarketProduct>({
    kaspiSku,
    name,
    brand: asStr(row.brand),
    branded: row.is_branded === undefined || row.is_branded === null ? undefined : Boolean(Number(row.is_branded)),
    categoryId: asStr(row.category_id),
    category: asStr(row.category),
    path: asStr(row.path),
    price: asNum(row.price),
    revenue: asNum(row.revenue),
    orders: asNum(pick(row, ["orders", "sale_qty"])),
    sellerCount: asNum(pick(row, ["sellers", "seller_count", "merchants"])),
    reviews: asNum(row.reviews),
    rating: asNum(row.rating),
    segment: asStr(row.segment),
    lifeStage: asStr(row.life_stage),
    // RedStat's own growth figure: null means the months cannot be compared. Never recomputed here.
    revenueChangePct: change === null ? null : asNum(change),
    kaspiUrl: httpsUrl(row.kaspi_url),
    redstatUrl: httpsUrl(row.redstat_link),
  });
}

export function mapRedstatSegments(result: unknown): MarketSegment[] {
  return rowsOf(result, ["segments"]).map((row) => {
    const index = asNum(row.segment);
    const revenue = asNum(row.total_revenue);
    if (index === undefined || revenue === undefined) return undefined;
    return compact<MarketSegment>({
      index,
      name: asStr(row.segment_name) ?? String(index),
      skuCount: asNum(row.sku_count) ?? 0,
      revenue,
      revenueSharePct: asNum(row.revenue_share_pct) ?? 0,
      avgPrice: asNum(row.avg_price) ?? 0,
      minPrice: asNum(row.min_price) ?? 0,
      maxPrice: asNum(row.max_price) ?? 0,
      avgSellers: asNum(row.avg_merchant_cnt),
      noBrandPct: asNum(row.no_brand_pct),
    });
  }).filter((item): item is MarketSegment => Boolean(item)).sort((a, b) => a.index - b.index);
}

export function mapRedstatBrands(result: unknown): MarketBrand[] {
  return rowsOf(result, ["brands"]).map((row) => {
    const name = asStr(row.brand);
    const revenue = asNum(row.revenue);
    if (!name || revenue === undefined) return undefined;
    return compact<MarketBrand>({ name, revenue, orders: asNum(row.orders), skuCount: asNum(row.sku_count), redstatUrl: httpsUrl(row.redstat_link) });
  }).filter((item): item is MarketBrand => Boolean(item)).slice(0, 10);
}

/**
 * Monthly facts of a niche. Each month keeps RedStat's own "comparable to the previous month" flag:
 * where it is false the sums differ for reasons other than sales, and the app must not show it as
 * growth or decline. Forecast points are taken only when RedStat marks them as published.
 */
export function mapRedstatDynamics(result: unknown): MarketDynamics | undefined {
  if (!isRecord(result)) return undefined;
  const points: MarketPoint[] = rowsOf(result, ["forecast", "timeline", "points"]).map((row) => {
    const date = month(pick(row, ["date", "month"]));
    const revenue = asNum(row.revenue);
    if (!date || revenue === undefined || (asStr(row.value_type) ?? "fact") !== "fact") return undefined;
    const comparable = row.comparable_to_previous === true;
    return compact<MarketPoint>({ month: date, revenue, orders: asNum(row.orders), comparable, note: comparable ? undefined : asStr(row.note) });
  }).filter((item): item is MarketPoint => Boolean(item)).sort((a, b) => a.month.localeCompare(b.month)).slice(-24);
  if (!points.length) return undefined;
  const seasonality = isRecord(result.seasonality) ? result.seasonality : {};
  const peak = asNum(seasonality.peak_month);
  const quality = isRecord(result.forecast_quality) ? result.forecast_quality : {};
  return compact<MarketDynamics>({
    points,
    peakMonth: peak !== undefined && peak >= 1 && peak <= 12 ? Math.round(peak) : undefined,
    seasonClass: asStr(seasonality.season_class),
    forecastPublished: result.predictions_enabled === true && quality.safe_for_decisions === true,
  });
}

/**
 * Tool names as RedStat publishes them on its MCP server. If RedStat renames a tool, set
 * REDSTAT_TOOLS to a JSON object with the new names, e.g. {"product_search":"find_products"}.
 */
const DEFAULT_TOOLS = {
  product_search: "search_products",
  product_sellers: "product_sellers",
  niche_segments: "niche_segments",
  niche_brands: "niche_brands",
  niche_dynamics: "niche_forecast",
} as const;
type ToolRole = keyof typeof DEFAULT_TOOLS;

export function redstatTools(env = process.env["REDSTAT_TOOLS"]): Record<ToolRole, string> {
  const tools: Record<ToolRole, string> = { ...DEFAULT_TOOLS };
  if (!env) return tools;
  try {
    const parsed: unknown = JSON.parse(env);
    if (isRecord(parsed)) for (const role of Object.keys(DEFAULT_TOOLS) as ToolRole[]) {
      const name = parsed[role];
      if (typeof name === "string" && /^[\w.-]{1,64}$/.test(name)) tools[role] = name;
    }
  } catch {
    // A broken override keeps the published names.
  }
  return tools;
}

/**
 * RedStat publishes monthly figures, so a repeated look at the same card or niche is served from
 * memory for a few hours instead of spending the seller's RedStat quota. Sellers on a card are
 * read live from Kaspi by RedStat and are never cached.
 */
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: unknown }>();
export const redstatCache = { clear: () => cache.clear(), get size() { return cache.size; } };

async function cached(key: string, load: () => Promise<unknown>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

const noteOf = (result: unknown) => (isRecord(result) ? asStr(result.note) : undefined);
const monthOf = (result: unknown) => (isRecord(result) ? month(result.date) : undefined);

/** RedStat reached through its MCP server. `scope` separates the cache of different servers. */
export function mcpRedstatConnector(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, scope = "default"): RedstatConnector {
  const tools = redstatTools();
  const checkedAt = () => new Date().toISOString();
  const unavailable = <T,>(): RedstatConnectorResult<T> => ({ source: "REDSTAT", status: "UNAVAILABLE", checkedAt: checkedAt(), detail: "connector.redstat.unavailable" });
  const noData = <T,>(): RedstatConnectorResult<T> => ({ source: "REDSTAT", status: "NO_DATA", checkedAt: checkedAt() });
  const monthly = (role: ToolRole, args: Record<string, unknown>) => cached(`${scope}|${tools[role]}|${JSON.stringify(args)}`, () => call(tools[role], args));
  const search = (kaspiSku: string) => monthly("product_search", { query: kaspiSku, limit: 10 });

  return {
    async getProductData({ kaspiSku }) {
      if (!kaspiSku) return noData();
      try {
        const result = await search(kaspiSku);
        const product = mapRedstatProduct(result, kaspiSku);
        return product ? { source: "REDSTAT", status: "READY", checkedAt: checkedAt(), month: monthOf(result), note: noteOf(result), data: product } : noData();
      } catch {
        return unavailable();
      }
    },
    async getCategoryData({ categoryId }) {
      if (!categoryId) return noData();
      const [segmentsResult, brandsResult] = await Promise.allSettled([monthly("niche_segments", { query: categoryId }), monthly("niche_brands", { query: categoryId, limit: 5 })]);
      if (segmentsResult.status === "rejected" && brandsResult.status === "rejected") return unavailable();
      const segmentsValue = segmentsResult.status === "fulfilled" ? segmentsResult.value : undefined;
      const brandsValue = brandsResult.status === "fulfilled" ? brandsResult.value : undefined;
      const segments = mapRedstatSegments(segmentsValue);
      const brands = mapRedstatBrands(brandsValue);
      if (!segments.length && !brands.length) return noData();
      const head = isRecord(segmentsValue) ? segmentsValue : isRecord(brandsValue) ? brandsValue : {};
      const category = compact<MarketCategory>({
        id: categoryId,
        name: asStr(head.name) ?? categoryId,
        kaspiUrl: httpsUrl(head.kaspi_link),
        redstatUrl: httpsUrl(head.redstat_link),
        segments,
        brands,
      });
      return { source: "REDSTAT", status: segments.length && brands.length ? "READY" : "PARTIAL", checkedAt: checkedAt(), month: monthOf(head), note: noteOf(head), data: category };
    },
    async getMarketDynamics({ categoryId }) {
      if (!categoryId) return noData();
      try {
        const dynamics = mapRedstatDynamics(await monthly("niche_dynamics", { query: categoryId }));
        return dynamics ? { source: "REDSTAT", status: "READY", checkedAt: checkedAt(), data: dynamics } : noData();
      } catch {
        return unavailable();
      }
    },
    async getCompetitorData({ kaspiSku }) {
      if (!kaspiSku) return noData();
      try {
        const [sellersResult, searchResult] = await Promise.allSettled([call(tools.product_sellers, { query: kaspiSku }), search(kaspiSku)]);
        const sellers = sellersResult.status === "fulfilled" ? mapRedstatSellers(sellersResult.value) : [];
        const resolved = sellersResult.status === "fulfilled" && isRecord(sellersResult.value) && isRecord(sellersResult.value.resolved) ? sellersResult.value.resolved : undefined;
        let alternatives = searchResult.status === "fulfilled" ? mapRedstatProducts(searchResult.value, kaspiSku) : [];
        const productName = asStr(resolved?.product_name) ?? (searchResult.status === "fulfilled" ? mapRedstatProduct(searchResult.value, kaspiSku)?.name : undefined);
        if (!alternatives.length && productName) {
          alternatives = mapRedstatProducts(await monthly("product_search", { query: productName.split(" ").slice(0, 4).join(" "), limit: 10 }).catch(() => []), kaspiSku);
        }
        if (!sellers.length && !alternatives.length) {
          const sellersError = sellersResult.status === "fulfilled" && isRecord(sellersResult.value) && sellersResult.value.available === false;
          return sellersError ? unavailable() : noData();
        }
        return { source: "REDSTAT", status: sellers.length && alternatives.length ? "READY" : "PARTIAL", checkedAt: checkedAt(), data: { sellers, alternatives } };
      } catch {
        return unavailable();
      }
    },
  };
}

/**
 * The card in its market: the product's own monthly figures, its niche split into price segments,
 * the leading brands and the niche month by month. Built only from what RedStat returned; a part
 * RedStat has no data for is left out rather than filled in.
 */
async function marketContext(kaspiSku: string, connector: RedstatConnector): Promise<MarketContext | undefined> {
  const product = await connector.getProductData({ kaspiSku });
  const categoryId = product.data?.categoryId;
  const [category, dynamics] = categoryId
    ? await Promise.all([connector.getCategoryData({ categoryId }), connector.getMarketDynamics({ categoryId })])
    : [undefined, undefined];
  if (!product.data && !category?.data && !dynamics?.data) return undefined;
  const monthValue = product.month ?? category?.month ?? dynamics?.data?.points.at(-1)?.month;
  if (!monthValue) return undefined;
  return compact<MarketContext>({
    month: monthValue,
    note: product.note ?? category?.note,
    product: product.data,
    category: category?.data,
    dynamics: dynamics?.data,
  });
}

export async function getCompetitorAnalysis(
  kaspiSku: string,
  connector: RedstatConnector = mockRedstatConnector,
): Promise<CompetitorsOverview> {
  const [result, market] = await Promise.all([
    connector.getCompetitorData({ kaspiSku }),
    marketContext(kaspiSku, connector).catch(() => undefined),
  ]);
  const status = result.status === "NO_DATA" && market ? "PARTIAL" : result.status;
  return {
    source: result.source,
    status,
    refreshedAt: result.checkedAt,
    kaspiSku,
    sellers: result.data?.sellers ?? [],
    alternatives: result.data?.alternatives ?? [],
    ...(result.detail && status !== "PARTIAL" ? { detail: result.detail } : {}),
    ...(result.data?.insight ? { insight: result.data.insight } : {}),
    ...(market ? { market } : {}),
  };
}
